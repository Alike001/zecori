export const supportedLocales = ['en'] as const;
export type SupportedLocale = typeof supportedLocales[number];

const messages = {
  en: {
    heroTitle: 'Private in.',
    heroAccent: 'Verifiable out.',
    heroBody: 'Create a scoped request for one fixed Zcash testnet route. The app will never ask for a seed phrase, sign a transaction, or treat a request as payment authorization.',
    requestReview: 'Request operator review',
    history: 'Open request history',
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function resolveLocale(candidate: string | undefined): SupportedLocale {
  return candidate?.toLowerCase().split('-')[0] === 'en' ? 'en' : 'en';
}

export function translate(locale: SupportedLocale, key: MessageKey): string { return messages[locale][key]; }
