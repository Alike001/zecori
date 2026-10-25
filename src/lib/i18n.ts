export const supportedLocales = ['en', 'fr', 'ar'] as const;
export type SupportedLocale = typeof supportedLocales[number];

const messages = {
  en: {
    heroTitle: 'Private in.',
    heroAccent: 'Verifiable out.',
    heroBody: 'Create a scoped request for one fixed Zcash testnet route. The app will never ask for a seed phrase, sign a transaction, or treat a request as payment authorization.',
    requestReview: 'Request operator review',
    history: 'Open request history',
    agentGreeting: 'Ask about the route, shielded privacy, custody, refunds, or your request status.',
    swapPreview: 'Swap preview',
    privacyExplanation: 'Shielded source details are redacted from public views.',
    transactionPending: 'Transaction verification is pending.',
    receiptDescription: 'A verified receipt is available after independent destination verification.',
    recoveryGuidance: 'Do not resend funds. Check the request status or contact support.',
  },
  fr: {
    heroTitle: 'Privé à l’entrée.',
    heroAccent: 'Vérifiable à la sortie.',
    heroBody: 'Créez une demande limitée à un itinéraire fixe sur le réseau de test Zcash. L’application ne demandera jamais de phrase de récupération, ne signera aucune transaction et ne considérera pas une demande comme une autorisation de paiement.',
    requestReview: 'Demander l’examen par un opérateur',
    history: 'Ouvrir l’historique des demandes',
    agentGreeting: 'Posez une question sur l’itinéraire, la confidentialité, la garde, les remboursements ou l’état de votre demande.',
    swapPreview: 'Aperçu de l’échange',
    privacyExplanation: 'Les détails de la source protégée sont masqués dans les vues publiques.',
    transactionPending: 'La vérification de la transaction est en attente.',
    receiptDescription: 'Un reçu vérifié est disponible après une vérification indépendante de la destination.',
    recoveryGuidance: 'Ne renvoyez pas de fonds. Vérifiez l’état de la demande ou contactez l’assistance.',
  },
  ar: {
    heroTitle: 'خصوصية عند الإرسال.',
    heroAccent: 'وقابلية للتحقق عند الاستلام.',
    heroBody: 'أنشئ طلباً محدوداً لمسار ثابت على شبكة اختبار Zcash. لن يطلب التطبيق عبارة الاسترداد، ولن يوقّع معاملة، ولن يعتبر الطلب تفويضاً بالدفع.',
    requestReview: 'طلب مراجعة المشغّل',
    history: 'فتح سجل الطلبات',
    agentGreeting: 'اسأل عن المسار أو الخصوصية المحمية أو الحفظ أو الاسترداد أو حالة طلبك.',
    swapPreview: 'معاينة المبادلة',
    privacyExplanation: 'تُحجب تفاصيل المصدر المحمي عن العروض العامة.',
    transactionPending: 'التحقق من المعاملة قيد الانتظار.',
    receiptDescription: 'يتوفر إيصال موثّق بعد التحقق المستقل من الوجهة.',
    recoveryGuidance: 'لا ترسل الأموال مرة أخرى. تحقّق من حالة الطلب أو تواصل مع الدعم.',
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function resolveLocale(candidate: string | undefined): SupportedLocale {
  const language = candidate?.toLowerCase().split('-')[0];
  return supportedLocales.includes(language as SupportedLocale) ? language as SupportedLocale : 'en';
}

export function translate(locale: SupportedLocale, key: MessageKey): string { return messages[locale][key]; }

export function localeDirection(locale: SupportedLocale): 'ltr' | 'rtl' { return locale === 'ar' ? 'rtl' : 'ltr'; }

const statusMessages: Record<SupportedLocale, Record<string, string>> = {
  en: { AWAITING_OPERATOR: 'Awaiting operator', ACCEPTED: 'Accepted', PAYMENT_READY: 'Payment ready', SOURCE_DETECTED: 'Source detected', SOURCE_CONFIRMED: 'Source confirmed', PAYOUT_AWAITING_APPROVAL: 'Payout awaiting approval', PAYOUT_SUBMITTED: 'Payout submitted', COMPLETED: 'Completed', FAILED: 'Failed', REFUND_PENDING: 'Refund pending', REFUNDED: 'Refunded', UNRESOLVED: 'Unresolved', EXPIRED: 'Expired', CANCELLED: 'Cancelled' },
  fr: { AWAITING_OPERATOR: 'En attente de l’opérateur', ACCEPTED: 'Acceptée', PAYMENT_READY: 'Paiement prêt', SOURCE_DETECTED: 'Source détectée', SOURCE_CONFIRMED: 'Source confirmée', PAYOUT_AWAITING_APPROVAL: 'Versement en attente d’approbation', PAYOUT_SUBMITTED: 'Versement envoyé', COMPLETED: 'Terminée', FAILED: 'Échouée', REFUND_PENDING: 'Remboursement en attente', REFUNDED: 'Remboursée', UNRESOLVED: 'Non résolue', EXPIRED: 'Expirée', CANCELLED: 'Annulée' },
  ar: { AWAITING_OPERATOR: 'بانتظار المشغّل', ACCEPTED: 'مقبول', PAYMENT_READY: 'الدفع جاهز', SOURCE_DETECTED: 'تم رصد المصدر', SOURCE_CONFIRMED: 'تم تأكيد المصدر', PAYOUT_AWAITING_APPROVAL: 'الدفع بانتظار الموافقة', PAYOUT_SUBMITTED: 'تم إرسال الدفع', COMPLETED: 'مكتمل', FAILED: 'فشل', REFUND_PENDING: 'الاسترداد قيد الانتظار', REFUNDED: 'تم الاسترداد', UNRESOLVED: 'غير محلول', EXPIRED: 'منتهي الصلاحية', CANCELLED: 'ملغى' },
};

export function translateOrderStatus(locale: SupportedLocale, status: string): string {
  return statusMessages[locale][status] ?? statusMessages.en[status] ?? status;
}

export const localeMetadata: Record<SupportedLocale, { translationReview: 'human-validated' | 'machine-generated-unvalidated' }> = {
  en: { translationReview: 'human-validated' },
  fr: { translationReview: 'machine-generated-unvalidated' },
  ar: { translationReview: 'machine-generated-unvalidated' },
};
