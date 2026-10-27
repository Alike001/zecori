import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { assertSpeechSafeText, type SpeechLocale } from '../src/lib/voice.ts';

export const SPEECH_LIMITS = Object.freeze({
  maximumAudioBytes: 2_000_000,
  maximumDurationMs: 30_000,
  minimumDurationMs: 500,
  maximumSpeechCharacters: 200,
});

export type SpeechStatus = {
  enabled: boolean;
  provider: 'groq';
  reason?: string;
  externalRequestsApproved: boolean;
  liveValidated: boolean;
  transcription: { model: 'whisper-large-v3-turbo'; locales: readonly ['en', 'fr', 'ar']; providerDocumentationVerified: true };
  synthesis: {
    locales: readonly ['en', 'ar'];
    models: { en: 'canopylabs/orpheus-v1-english'; ar: 'canopylabs/orpheus-arabic-saudi' };
    providerDocumentationVerified: true;
  };
  limits: typeof SPEECH_LIMITS;
  retention: 'memory-only-until-provider-response';
};

export interface SpeechProvider {
  readonly status: SpeechStatus;
  transcribe(audio: Uint8Array, contentType: string, locale: SpeechLocale): Promise<string>;
  synthesize(text: string, locale: 'en' | 'ar'): Promise<Uint8Array>;
}

type Fetcher = typeof fetch;

function extension(contentType: string): string {
  const extensions: Record<string, string> = {
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/flac': 'flac',
  };
  const value = extensions[contentType.toLowerCase()];
  if (!value) throw Object.assign(new Error('This audio format is not supported.'), { statusCode: 415, code: 'UNSUPPORTED_AUDIO_FORMAT' });
  return value;
}

async function providerRequest(fetcher: Fetcher, url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 1) {
        const retryAfter = response.headers.get('retry-after');
        throw Object.assign(new Error(response.status === 429 ? 'The speech provider rate limit was reached.' : 'The speech provider is temporarily unavailable.'), {
          statusCode: response.status === 429 ? 429 : 503,
          code: response.status === 429 ? 'SPEECH_RATE_LIMITED' : 'SPEECH_PROVIDER_UNAVAILABLE',
          ...(retryAfter ? { retryAfter } : {}),
        });
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      await new Promise(resolve => setTimeout(resolve, Math.min(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 100, 1_000)));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      lastError = error;
      if (attempt === 1) throw Object.assign(new Error(error instanceof DOMException && error.name === 'TimeoutError' ? 'The speech provider timed out.' : 'The speech provider is temporarily unavailable.'), { statusCode: 503, code: error instanceof DOMException && error.name === 'TimeoutError' ? 'SPEECH_TIMEOUT' : 'SPEECH_PROVIDER_UNAVAILABLE' });
    }
  }
  throw lastError;
}

export class GroqSpeechProvider implements SpeechProvider {
  readonly status: SpeechStatus;
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;

  constructor(apiKey: string, fetcher: Fetcher = fetch, baseUrl = 'https://api.groq.com/openai/v1', liveValidated = false) {
    this.apiKey = apiKey; this.fetcher = fetcher; this.baseUrl = baseUrl.replace(/\/$/, '');
    this.status = speechStatus(true, undefined, liveValidated);
  }

  async transcribe(audio: Uint8Array, contentType: string, locale: SpeechLocale): Promise<string> {
    if (audio.byteLength > SPEECH_LIMITS.maximumAudioBytes) throw Object.assign(new Error('Audio exceeds the 2 MB application limit.'), { statusCode: 413, code: 'AUDIO_TOO_LARGE' });
    const form = new FormData();
    form.set('model', 'whisper-large-v3-turbo');
    form.set('language', locale);
    form.set('response_format', 'json');
    form.set('temperature', '0');
    const audioBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
    form.set('file', new Blob([audioBuffer], { type: contentType }), `voice.${extension(contentType)}`);
    const response = await providerRequest(this.fetcher, `${this.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}` }, body: form });
    const raw = await response.text();
    if (raw.length > 32_000) throw Object.assign(new Error('Speech provider response exceeded the safe boundary.'), { statusCode: 503, code: 'MALFORMED_SPEECH_RESPONSE' });
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw Object.assign(new Error('Speech provider returned malformed JSON.'), { statusCode: 503, code: 'MALFORMED_SPEECH_RESPONSE' }); }
    const text = value && typeof value === 'object' && 'text' in value && typeof value.text === 'string' ? value.text.trim() : '';
    if (!text) throw Object.assign(new Error('No speech was detected. Try again in a quieter place.'), { statusCode: 422, code: 'NO_SPEECH_DETECTED' });
    if (text.length > 2_000) throw Object.assign(new Error('Transcript exceeds the review boundary.'), { statusCode: 422, code: 'TRANSCRIPT_TOO_LONG' });
    return text;
  }

  async synthesize(text: string, locale: 'en' | 'ar'): Promise<Uint8Array> {
    const input = text.trim();
    if (!input || input.length > SPEECH_LIMITS.maximumSpeechCharacters) throw Object.assign(new Error('Speech output must contain 1 to 200 characters.'), { statusCode: 400, code: 'INVALID_SPEECH_TEXT' });
    assertSpeechSafeText(input);
    const model = locale === 'ar' ? 'canopylabs/orpheus-arabic-saudi' : 'canopylabs/orpheus-v1-english';
    const voice = locale === 'ar' ? 'noura' : 'autumn';
    const response = await providerRequest(this.fetcher, `${this.baseUrl}/audio/speech`, {
      method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, voice, input, response_format: 'wav' }),
    });
    const audio = new Uint8Array(await response.arrayBuffer());
    if (!audio.byteLength || audio.byteLength > 4_000_000) throw Object.assign(new Error('Speech provider returned invalid audio.'), { statusCode: 503, code: 'MALFORMED_SPEECH_RESPONSE' });
    return audio;
  }
}

function speechStatus(enabled: boolean, reason?: string, liveValidated = false): SpeechStatus {
  return {
    enabled, provider: 'groq', ...(reason ? { reason } : {}), externalRequestsApproved: enabled, liveValidated,
    transcription: { model: 'whisper-large-v3-turbo', locales: ['en', 'fr', 'ar'], providerDocumentationVerified: true },
    synthesis: { locales: ['en', 'ar'], models: { en: 'canopylabs/orpheus-v1-english', ar: 'canopylabs/orpheus-arabic-saudi' }, providerDocumentationVerified: true },
    limits: SPEECH_LIMITS, retention: 'memory-only-until-provider-response',
  };
}

async function privateKey(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('AI_API_KEY_FILE must be an absolute path.');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) throw new Error('AI_API_KEY_FILE must be a mode-0600 regular file.');
  const key = (await readFile(path, 'utf8')).trim();
  if (key.length < 20 || key.includes('\n')) throw new Error('AI_API_KEY_FILE must contain one credential.');
  return key;
}

export async function loadSpeechProvider(environment: NodeJS.ProcessEnv = process.env): Promise<{ provider?: SpeechProvider; status: SpeechStatus }> {
  const enabled = environment.VOICE_ENABLED === '1';
  const approved = environment.VOICE_EXTERNAL_REQUESTS_APPROVED === 'I_APPROVE_CHARGEABLE_SPEECH_REQUESTS';
  if (!enabled) return { status: speechStatus(false, 'Voice is disabled by configuration.') };
  if (!approved) return { status: speechStatus(false, 'Voice is configured but chargeable speech requests have not been explicitly approved.') };
  if (environment.AI_PROVIDER !== 'groq-responses') throw new Error('Voice requires the existing Groq server integration (AI_PROVIDER=groq-responses).');
  const file = environment.AI_API_KEY_FILE?.trim();
  if (!file) throw new Error('AI_API_KEY_FILE is required for Groq speech.');
  const baseUrl = environment.AI_BASE_URL?.trim() || 'https://api.groq.com/openai/v1';
  const parsed = new URL(baseUrl);
  const official = parsed.origin === 'https://api.groq.com' && parsed.pathname.replace(/\/$/, '') === '/openai/v1' && !parsed.search && !parsed.hash;
  const local = environment.NODE_ENV !== 'production' && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (!official && !local) throw new Error('AI_BASE_URL must be the official Groq OpenAI-compatible v1 endpoint (or loopback HTTP in development).');
  const provider = new GroqSpeechProvider(await privateKey(file), fetch, baseUrl, environment.VOICE_PROVIDER_LIVE_VALIDATED === '1');
  return { provider, status: provider.status };
}
