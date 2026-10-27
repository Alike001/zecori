export type VoicePrivacyDisclosure = {
  provider: string;
  audioLeavesDevice: boolean;
  retention: string;
};

export interface VoiceAdapter {
  readonly id: string;
  readonly disclosure: VoicePrivacyDisclosure;
  requestMicrophonePermission(): Promise<boolean>;
  transcribe(): Promise<string>;
  speak(text: string): Promise<void>;
}

export type VoiceState = 'disabled' | 'disclosure-required' | 'permission-required' | 'ready' | 'recording' | 'processing' | 'transcript-confirmation' | 'speaking' | 'error';

export type VoiceConsent = {
  userInitiated: true;
  audioProcessingAccepted: true;
  retentionAccepted: true;
  acceptedAt: string;
};

export type VoiceTranscript = { text: string; confirmed: boolean; canAuthorizePayment: false };
export type SpeechLocale = 'en' | 'fr' | 'ar';

export const VOICE_CAPTURE_LIMITS = Object.freeze({ maximumBytes: 2_000_000, maximumDurationMs: 30_000, minimumDurationMs: 500 });

const PRIVATE_SPEECH_DATA = /(?:u(?:test|regtest)1[a-z0-9]{20,}|\b0x[0-9a-f]{40}\b|\b(?:0x)?[0-9a-f]{64}\b|seed phrase|private key|spending key|ufvk|zecathon_session|cookie)/i;

export function assertSpeechSafeText(text: string): void {
  if (PRIVATE_SPEECH_DATA.test(text)) throw new Error('Private wallet or session information cannot be sent to a speech provider.');
}

export type VoiceTranscriptReview = { safeToPrepare: true } | { safeToPrepare: false; reason: 'empty' | 'private-data' | 'incorrect-amount' };

export function reviewVoiceTranscript(text: string): VoiceTranscriptReview {
  const normalized = text.trim();
  if (!normalized) return { safeToPrepare: false, reason: 'empty' };
  try { assertSpeechSafeText(normalized); } catch { return { safeToPrepare: false, reason: 'private-data' }; }
  const tazAmounts = [...normalized.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*TAZ\b/gi)].map(match => match[1].replace(',', '.'));
  const usdcAmounts = [...normalized.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:test\s*)?USDC\b/gi)].map(match => match[1].replace(',', '.'));
  if (tazAmounts.some(amount => amount !== '0.01') || usdcAmounts.some(amount => !/^1(?:\.0+)?$/.test(amount))) return { safeToPrepare: false, reason: 'incorrect-amount' };
  return { safeToPrepare: true };
}

export class VoiceSession {
  state: VoiceState = 'disclosure-required';
  consent?: VoiceConsent;
  transcript?: VoiceTranscript;
  readonly adapter: VoiceAdapter;
  readonly providerTested: boolean;

  constructor(adapter: VoiceAdapter, providerTested: boolean) {
    this.adapter = adapter; this.providerTested = providerTested;
    if (!providerTested) this.state = 'disabled';
  }

  acceptDisclosure(userInitiated: boolean, audioProcessingAccepted: boolean, retentionAccepted: boolean, now = new Date()): void {
    if (!this.providerTested) throw new Error('Voice is disabled until the configured provider is tested.');
    if (!userInitiated || !audioProcessingAccepted || !retentionAccepted) throw new Error('Explicit user consent to processing and retention terms is required.');
    this.consent = { userInitiated: true, audioProcessingAccepted: true, retentionAccepted: true, acceptedAt: now.toISOString() };
    this.state = 'permission-required';
  }

  async requestPermission(): Promise<boolean> {
    if (!this.consent || this.state !== 'permission-required') throw new Error('Voice disclosure consent is required before microphone permission.');
    const allowed = await this.adapter.requestMicrophonePermission();
    this.state = allowed ? 'ready' : 'error';
    return allowed;
  }

  async record(): Promise<VoiceTranscript> {
    if (this.state !== 'ready') throw new Error('Microphone permission and consent are required before recording.');
    this.state = 'recording';
    try {
      this.state = 'processing';
      const text = (await this.adapter.transcribe()).trim();
      this.transcript = { text, confirmed: false, canAuthorizePayment: false };
      this.state = 'transcript-confirmation';
      return this.transcript;
    } catch (error) { this.state = 'error'; throw error; }
  }

  confirmTranscript(): VoiceTranscript {
    if (this.state !== 'transcript-confirmation' || !this.transcript) throw new Error('A transcript must be visible before confirmation.');
    this.transcript = { ...this.transcript, confirmed: true, canAuthorizePayment: false };
    this.state = 'ready';
    return this.transcript;
  }

  async speak(text: string): Promise<void> {
    if (!this.consent || this.state !== 'ready') throw new Error('Voice consent and readiness are required for speech output.');
    assertSpeechSafeText(text);
    this.state = 'speaking';
    try { await this.adapter.speak(text); this.state = 'ready'; }
    catch (error) { this.state = 'error'; throw error; }
  }
}

export const voiceAvailability = {
  enabled: false,
  reason: 'Voice is available only to signed-in users after privacy review and when the separately approved Groq speech gateway is enabled.',
} as const;
