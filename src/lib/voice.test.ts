import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSpeechSafeText, VoiceSession, type VoiceAdapter } from './voice.ts';

function adapter(log: string[]): VoiceAdapter {
  return {
    id: 'test', disclosure: { provider: 'test', audioLeavesDevice: true, retention: 'not retained' },
    async requestMicrophonePermission() { log.push('permission'); return true; },
    async transcribe() { log.push('transcribe'); return 'show my order status'; },
    async speak(text) { log.push(`speak:${text}`); },
  };
}

test('voice requires explicit disclosure before microphone access and transcript confirmation', async () => {
  const log: string[] = []; const session = new VoiceSession(adapter(log), true);
  await assert.rejects(session.requestPermission(), /disclosure consent/i);
  assert.throws(() => session.acceptDisclosure(false, true, true), /explicit user consent/i);
  session.acceptDisclosure(true, true, true, new Date('2026-01-01T00:00:00Z'));
  assert.equal(await session.requestPermission(), true);
  const transcript = await session.record();
  assert.deepEqual(transcript, { text: 'show my order status', confirmed: false, canAuthorizePayment: false });
  assert.equal(session.confirmTranscript().canAuthorizePayment, false);
  assert.deepEqual(log, ['permission', 'transcribe']);
});

test('voice stays disabled for an untested provider and blocks private speech payloads', async () => {
  const session = new VoiceSession(adapter([]), false);
  assert.equal(session.state, 'disabled');
  assert.throws(() => session.acceptDisclosure(true, true, true), /provider is tested/i);
  assert.throws(() => assertSpeechSafeText(`source tx ${'a'.repeat(64)}`), /cannot be sent/i);
  assert.throws(() => assertSpeechSafeText('my UFVK is secret'), /cannot be sent/i);
  assert.doesNotThrow(() => assertSpeechSafeText('Your request is awaiting operator review.'));
});
