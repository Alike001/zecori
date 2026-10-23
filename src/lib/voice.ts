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

export const voiceAvailability = {
  enabled: false,
  reason: 'Voice is disabled until a speech provider, retention policy, and explicit microphone consent flow pass privacy review.',
} as const;
