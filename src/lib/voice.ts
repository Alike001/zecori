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

const PRIVATE_SPEECH_DATA = /(?:u(?:test|regtest)1[a-z0-9]{20,}|\b(?:0x)?[0-9a-f]{64}\b|seed phrase|private key|spending key|ufvk|zecathon_session|cookie)/i;

export function assertSpeechSafeText(text: string): void {
  if (PRIVATE_SPEECH_DATA.test(text)) throw new Error('Private wallet or session information cannot be sent to a speech provider.');
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
  reason: 'Voice is disabled until a configured speech provider and the consent, retention, privacy review, and browser permission flows pass end-to-end testing.',
} as const;
