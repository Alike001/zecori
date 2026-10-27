import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroqSpeechProvider, loadSpeechProvider, SPEECH_LIMITS } from './speech-provider.ts';

const sample = new Uint8Array([1, 2, 3, 4]);

test('speech remains disabled until its separate exact approval and does not read credentials early', async () => {
  const base = { VOICE_ENABLED: '1', AI_PROVIDER: 'groq-responses', AI_API_KEY_FILE: '/does/not/exist' };
  const inert = await loadSpeechProvider(base);
  assert.equal(inert.provider, undefined); assert.equal(inert.status.enabled, false); assert.match(inert.status.reason ?? '', /not been explicitly approved/i);
  assert.deepEqual(inert.status.transcription.locales, ['en','fr','ar']);
  assert.deepEqual(inert.status.synthesis.locales, ['en','ar']);
  assert.equal(inert.status.liveValidated, false);
});

test('approved speech configuration uses the existing Groq server key boundary', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-speech-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'key'); await writeFile(file, 'synthetic-groq-speech-key-value'); await chmod(file, 0o600);
  const loaded = await loadSpeechProvider({ VOICE_ENABLED: '1', VOICE_EXTERNAL_REQUESTS_APPROVED: 'I_APPROVE_CHARGEABLE_SPEECH_REQUESTS', AI_PROVIDER: 'groq-responses', AI_API_KEY_FILE: file });
  assert.ok(loaded.provider); assert.equal(loaded.status.externalRequestsApproved, true); assert.equal(loaded.status.retention, 'memory-only-until-provider-response');
  await assert.rejects(loadSpeechProvider({ VOICE_ENABLED: '1', VOICE_EXTERNAL_REQUESTS_APPROVED: 'I_APPROVE_CHARGEABLE_SPEECH_REQUESTS', AI_PROVIDER: 'openai-responses', AI_API_KEY_FILE: file }), /existing Groq/i);
});

test('Groq transcription sends bounded multipart audio, retries one transient response, and rejects silence', async () => {
  const calls: Array<{ url: string; authorization: string | null; body: FormData }> = []; let attempt = 0;
  const provider = new GroqSpeechProvider('synthetic-key-value', async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization'), body: init?.body as FormData });
    attempt += 1;
    return attempt === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ text: '  ما حالة طلبي؟  ' }), { status: 200 });
  });
  assert.equal(await provider.transcribe(sample, 'audio/webm', 'ar'), 'ما حالة طلبي؟');
  assert.equal(calls.length, 2); assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/audio/transcriptions'); assert.equal(calls[1].authorization, 'Bearer synthetic-key-value');
  assert.equal(calls[1].body.get('model'), 'whisper-large-v3-turbo'); assert.equal(calls[1].body.get('language'), 'ar');
  const silence = new GroqSpeechProvider('synthetic-key-value', async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 }));
  await assert.rejects(silence.transcribe(sample, 'audio/webm', 'en'), /No speech was detected/i);
  await assert.rejects(provider.transcribe(new Uint8Array(SPEECH_LIMITS.maximumAudioBytes + 1), 'audio/webm', 'en'), /2 MB/i);
  await assert.rejects(provider.transcribe(sample, 'application/octet-stream', 'en'), /not supported/i);
});

test('Groq voice output selects only verified English and Arabic models and blocks private payloads', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const provider = new GroqSpeechProvider('synthetic-key-value', async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(new Uint8Array([82,73,70,70]), { status: 200, headers: { 'content-type': 'audio/wav' } }); });
  assert.equal((await provider.synthesize('Review the fixed route.', 'en')).byteLength, 4);
  assert.equal((await provider.synthesize('راجع المسار الثابت.', 'ar')).byteLength, 4);
  assert.equal(bodies[0].model, 'canopylabs/orpheus-v1-english'); assert.equal(bodies[1].model, 'canopylabs/orpheus-arabic-saudi');
  await assert.rejects(provider.synthesize(`transaction ${'a'.repeat(64)}`, 'en'), /cannot be sent/i);
});
