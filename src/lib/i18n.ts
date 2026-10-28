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
    fixedTermsWarning: 'Only 0.01 TAZ → 1 test USDC is supported. This is not a live quote.',
    noAuthorityWarning: 'Voice and AI cannot sign, pay, approve a payout, or create a funded order.',
    docsLanguageNotice: 'Documentation is currently authored in English. French and Arabic security copy still requires human review.',
    voiceTextFallback: 'Voice output is unavailable for this language. Continue with text.',
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
    fixedTermsWarning: 'Seul 0.01 TAZ → 1 test USDC est pris en charge. Il ne s’agit pas d’un cours en direct.',
    noAuthorityWarning: 'La voix et l’IA ne peuvent ni signer, ni payer, ni approuver un versement, ni créer une demande financée.',
    docsLanguageNotice: 'La documentation est actuellement rédigée en anglais. Les avertissements de sécurité en français et en arabe nécessitent encore une révision humaine.',
    voiceTextFallback: 'La sortie vocale n’est pas disponible dans cette langue. Continuez avec le texte.',
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
    fixedTermsWarning: 'المتاح فقط هو 0.01 TAZ → 1 test USDC. هذا ليس سعراً مباشراً.',
    noAuthorityWarning: 'لا يمكن للصوت أو الذكاء الاصطناعي التوقيع أو الدفع أو الموافقة على صرف أو إنشاء طلب ممول.',
    docsLanguageNotice: 'الوثائق مكتوبة بالإنجليزية حالياً. ما زالت نصوص الأمان الفرنسية والعربية بحاجة إلى مراجعة بشرية.',
    voiceTextFallback: 'الإخراج الصوتي غير متاح لهذه اللغة. تابع باستخدام النص.',
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

export type OrderGuidance = { title: string; body: string };

const orderGuidance: Record<SupportedLocale, Record<string, OrderGuidance>> = {
  en: {
    AWAITING_OPERATOR: { title: 'Waiting for operator review', body: 'Do not send funds. A receiver is published only after destination control, operator readiness, and a fresh shielded allocation are verified.' },
    ACCEPTED: { title: 'Preparing a dedicated receiver', body: 'Do not send yet. Wait until this request displays verified payment instructions and an expiry.' },
    PAYMENT_READY: { title: 'Payment instructions are ready', body: 'Review the exact receiver, amount, destination, fees, refund policy, and expiry before one manual shielded send.' },
    SOURCE_DETECTED: { title: 'Shielded payment detected', body: 'Confirmations are still pending. Do not resend funds; refresh this request for independently verified progress.' },
    SOURCE_CONFIRMED: { title: 'Source payment confirmed', body: 'The payout has not been submitted. No user action is required while separate operator approval is prepared.' },
    PAYOUT_AWAITING_APPROVAL: { title: 'Payout awaiting separate approval', body: 'The public Base payout is not yet authorized. Do not retry or send another source payment.' },
    PAYOUT_SUBMITTED: { title: 'Base payout submitted for verification', body: 'Completion is not yet proven. Wait for independent chain and contract verification; do not request a duplicate payout.' },
    COMPLETED: { title: 'Settlement independently verified', body: 'Open the private receipt below. Share only the explicitly redacted receipt if disclosure is necessary.' },
    FAILED: { title: 'This request stopped safely', body: 'No payout is claimed. Do not resend funds; keep the private request ID and follow the recovery guide if you already paid.' },
    REFUND_PENDING: { title: 'Manual refund review required', body: 'A refund is not yet confirmed or guaranteed. Do not resend funds; keep the private request ID for operator support.' },
    REFUNDED: { title: 'Refund independently recorded', body: 'Review the authenticated timeline. Do not treat this label as evidence for any different request.' },
    UNRESOLVED: { title: 'Evidence needs manual reconciliation', body: 'Verification may be delayed, unavailable, ambiguous, or affected by a reorganization. Do not resend or retry; keep the private request ID.' },
    EXPIRED: { title: 'Expired — no active payment instructions', body: 'The request deadline passed. Do not send funds or use any old instructions; create a new request only when the route is open again.' },
    CANCELLED: { title: 'This request was cancelled', body: 'Do not use its payment instructions. Create a new request only if you still intend to use the route.' },
  },
  fr: {
    AWAITING_OPERATOR: { title: 'En attente de l’examen de l’opérateur', body: 'N’envoyez pas de fonds. Un destinataire apparaît seulement après vérification du contrôle de destination, de la disponibilité et d’une nouvelle allocation protégée.' },
    ACCEPTED: { title: 'Préparation d’un destinataire dédié', body: 'N’envoyez rien. Attendez les instructions vérifiées et leur date d’expiration.' },
    PAYMENT_READY: { title: 'Instructions de paiement disponibles', body: 'Vérifiez le destinataire, le montant, la destination, les frais, la politique de remboursement et l’expiration avant un seul envoi protégé manuel.' },
    SOURCE_DETECTED: { title: 'Paiement protégé détecté', body: 'Les confirmations sont en attente. Ne renvoyez pas de fonds ; actualisez cette demande.' },
    SOURCE_CONFIRMED: { title: 'Paiement source confirmé', body: 'Le versement n’est pas envoyé. Aucune action n’est requise pendant la préparation de l’approbation séparée.' },
    PAYOUT_AWAITING_APPROVAL: { title: 'Versement en attente d’une approbation séparée', body: 'Le versement public sur Base n’est pas encore autorisé. Ne réessayez pas et ne renvoyez pas de paiement source.' },
    PAYOUT_SUBMITTED: { title: 'Versement Base soumis à vérification', body: 'La fin du règlement n’est pas encore prouvée. Attendez la vérification indépendante et ne demandez pas de doublon.' },
    COMPLETED: { title: 'Règlement vérifié indépendamment', body: 'Ouvrez le reçu privé ci-dessous. Ne partagez que le reçu explicitement expurgé si nécessaire.' },
    FAILED: { title: 'Cette demande s’est arrêtée en sécurité', body: 'Aucun versement n’est déclaré. Ne renvoyez pas de fonds ; conservez l’identifiant privé et consultez le guide de récupération si vous avez payé.' },
    REFUND_PENDING: { title: 'Examen manuel du remboursement requis', body: 'Le remboursement n’est ni confirmé ni garanti. Ne renvoyez pas de fonds et conservez l’identifiant privé.' },
    REFUNDED: { title: 'Remboursement enregistré indépendamment', body: 'Consultez la chronologie authentifiée. Ce statut ne prouve rien pour une autre demande.' },
    UNRESOLVED: { title: 'Les preuves nécessitent une vérification manuelle', body: 'La vérification peut être retardée, indisponible, ambiguë ou affectée par une réorganisation. Ne renvoyez rien et conservez l’identifiant privé.' },
    EXPIRED: { title: 'Cette demande a expiré', body: 'N’utilisez pas les anciennes instructions. Créez une nouvelle demande seulement lorsque le trajet est rouvert.' },
    CANCELLED: { title: 'Cette demande a été annulée', body: 'N’utilisez pas ses instructions. Créez une nouvelle demande uniquement si vous souhaitez toujours utiliser le trajet.' },
  },
  ar: {
    AWAITING_OPERATOR: { title: 'بانتظار مراجعة المشغّل', body: 'لا ترسل أموالاً. لا يظهر عنوان الاستلام إلا بعد التحقق من التحكم بالوجهة والجاهزية وتخصيص عنوان محمي جديد.' },
    ACCEPTED: { title: 'جارٍ إعداد عنوان استلام مخصص', body: 'لا ترسل بعد. انتظر ظهور تعليمات دفع متحقق منها ووقت انتهاء صلاحيتها.' },
    PAYMENT_READY: { title: 'تعليمات الدفع جاهزة', body: 'راجع العنوان والمبلغ والوجهة والرسوم وسياسة الاسترداد والانتهاء قبل إرسال دفعة محمية يدوية واحدة.' },
    SOURCE_DETECTED: { title: 'تم رصد الدفعة المحمية', body: 'التأكيدات ما زالت معلقة. لا ترسل الأموال مجدداً؛ حدّث الطلب لمتابعة التحقق المستقل.' },
    SOURCE_CONFIRMED: { title: 'تم تأكيد دفعة المصدر', body: 'لم يُرسل الصرف بعد. لا يلزم إجراء أثناء إعداد الموافقة المنفصلة.' },
    PAYOUT_AWAITING_APPROVAL: { title: 'الصرف بانتظار موافقة منفصلة', body: 'لم يُعتمد الصرف العام على Base بعد. لا تعاود المحاولة ولا ترسل دفعة مصدر أخرى.' },
    PAYOUT_SUBMITTED: { title: 'أُرسل صرف Base للتحقق', body: 'لم يثبت اكتمال التسوية بعد. انتظر التحقق المستقل ولا تطلب صرفاً مكرراً.' },
    COMPLETED: { title: 'تم التحقق المستقل من التسوية', body: 'افتح الإيصال الخاص أدناه. شارك الإيصال المنقّح صراحةً فقط عند الحاجة.' },
    FAILED: { title: 'توقف هذا الطلب بأمان', body: 'لا يوجد ادعاء بصرف. لا ترسل الأموال مجدداً؛ احتفظ بمعرّف الطلب الخاص واتبع دليل الاسترداد إذا كنت قد دفعت.' },
    REFUND_PENDING: { title: 'تلزم مراجعة يدوية للاسترداد', body: 'الاسترداد غير مؤكد وغير مضمون. لا ترسل الأموال مجدداً واحتفظ بمعرّف الطلب الخاص.' },
    REFUNDED: { title: 'تم تسجيل الاسترداد بشكل مستقل', body: 'راجع المخطط الزمني الموثق. لا تعتبر هذه الحالة دليلاً لأي طلب آخر.' },
    UNRESOLVED: { title: 'تحتاج الأدلة إلى تسوية يدوية', body: 'قد يكون التحقق متأخراً أو غير متاح أو ملتبساً أو متأثراً بإعادة تنظيم السلسلة. لا تعاود الإرسال واحتفظ بمعرّف الطلب الخاص.' },
    EXPIRED: { title: 'انتهت صلاحية هذا الطلب', body: 'لا تستخدم التعليمات القديمة ولا ترسل الأموال. أنشئ طلباً جديداً فقط بعد إعادة فتح المسار.' },
    CANCELLED: { title: 'أُلغي هذا الطلب', body: 'لا تستخدم تعليمات الدفع الخاصة به. أنشئ طلباً جديداً فقط إذا كنت ما زلت تريد استخدام المسار.' },
  },
};

export function translateOrderGuidance(locale: SupportedLocale, status: string): OrderGuidance {
  return orderGuidance[locale][status] ?? orderGuidance.en[status] ?? {
    title: 'Check the authenticated request state',
    body: 'Do not send or resend funds. Refresh the request or use the recovery guide.',
  };
}

const safeResolutionReasons: Record<string, string> = {
  'accepted-unallocated-expired': 'The accepted request expired before any payment receiver was allocated or published.',
  'expired-before-activation': 'The request expired before payment instructions were activated.',
  'expired-during-address-recovery': 'The request expired while its dedicated receiver allocation was being recovered.',
  'late-source-payment': 'A source payment was detected after the payment deadline and requires manual refund review.',
  'payment-timeout': 'No qualifying source payment was confirmed before the deadline.',
  'expired-with-source-funds': 'Source funds were detected before expiry, but settlement did not progress in time.',
  'source-reorganization': 'Previously observed source evidence is no longer canonical and requires manual reconciliation.',
  'uncertain-payout-broadcast': 'The payout broadcast outcome is uncertain and must be reconciled before any retry.',
  'manual-reconciliation-required': 'The evidence requires manual reconciliation before any further action.',
  'private-verifier:rpc_unavailable': 'The private verifier is temporarily unavailable; no settlement outcome is being claimed.',
  'private-verifier:sync_incomplete': 'The private verifier is not sufficiently synchronized to make a settlement claim.',
  'private-verifier:evidence_ambiguous': 'The private verifier found ambiguous evidence and stopped for manual review.',
  'private-verifier:reorg_detected': 'The private verifier detected a chain reorganization and stopped for manual review.',
  'private-verifier:not_found': 'The private verifier did not find qualifying evidence; no settlement outcome is being claimed.',
};

export function publicResolutionReason(reason: string): string {
  return safeResolutionReasons[reason.toLowerCase()] ?? 'The request stopped for a private operator or verifier reason. No settlement outcome is being claimed.';
}

const productMessages = {
  en: {
    routes:'Home / Move', account:'Account', activity:'Activity', inbox:'Inbox', assistant:'Help', menu:'Menu', testnet:'Testnet only', docs:'Docs', settings:'Settings', planned:'planned', openInbox:'Open inbox', unread:'unread notifications',
    privateInbox:'Private inbox', inboxTitle:'Events backed by the ledger.', inboxBody:'Notifications come from committed account and order events. They never include wallet addresses, transaction identifiers, or private evidence.', signInInbox:'Sign in to open your inbox', ownerOnly:'Inbox items are isolated to the owning internal account.', openAccount:'Open account', markAllRead:'Mark all read', loadingEvents:'Loading private events…', noNotifications:'No notifications in this view', genuineEventsOnly:'New items appear only after a genuine backend event commits.', markRead:'Mark read', markUnread:'Mark unread', openActivity:'Open private activity',
    handleTitle:'Your optional @handle', handleBody:'Exact-match discovery only. Your handle never publishes a wallet address, contact graph, order, or payment history.', confirmation:'Type the exact confirmation', claim:'Claim handle', rename:'Rename handle', check:'Check availability', available:'Available. Type the exact confirmation before claiming.', unavailable:'Unavailable. Reserved and claimed names look the same.', contacts:'Private contacts', saveContact:'Save private contact', noContacts:'No private contacts. Exact-match discovery must be enabled by the recipient.', requestIntent:'Request route intent', confirmIntent:'Confirm non-paying request', cancel:'Cancel', noRequests:'No handle request intents.', pendingHumanReview:'French and Arabic security copy is pending human review.',
    assistantKicker:'Guided help', assistantTitle:'Clear answers before any action.', assistantBody:'Ask about privacy, route status, fixed test terms, refunds, or recovery. In default mode, answers come from reviewed Zecori facts—not a live generative agent.'
  },
  fr: {
    routes:'Accueil / Transfert', account:'Compte', activity:'Activité', inbox:'Boîte de réception', assistant:'Aide', menu:'Menu', testnet:'Réseau de test uniquement', docs:'Documentation', settings:'Paramètres', planned:'prévu', openInbox:'Ouvrir la boîte de réception', unread:'notifications non lues',
    privateInbox:'Boîte privée', inboxTitle:'Des événements issus du registre.', inboxBody:'Les notifications proviennent d’événements de compte et de demande validés. Elles ne contiennent ni adresse, ni identifiant de transaction, ni preuve privée.', signInInbox:'Connectez-vous pour ouvrir votre boîte', ownerOnly:'Les éléments sont isolés au compte interne propriétaire.', openAccount:'Ouvrir le compte', markAllRead:'Tout marquer comme lu', loadingEvents:'Chargement des événements privés…', noNotifications:'Aucune notification dans cette vue', genuineEventsOnly:'Les éléments apparaissent seulement après la validation d’un événement réel du serveur.', markRead:'Marquer comme lu', markUnread:'Marquer comme non lu', openActivity:'Ouvrir l’activité privée',
    handleTitle:'Votre @identifiant facultatif', handleBody:'Découverte par correspondance exacte uniquement. Votre identifiant ne publie aucune adresse, relation, demande ou historique de paiement.', confirmation:'Saisissez la confirmation exacte', claim:'Revendiquer', rename:'Renommer', check:'Vérifier la disponibilité', available:'Disponible. Saisissez la confirmation exacte avant de continuer.', unavailable:'Indisponible. Les noms réservés et attribués ont la même réponse.', contacts:'Contacts privés', saveContact:'Enregistrer le contact privé', noContacts:'Aucun contact privé. Le destinataire doit activer la découverte exacte.', requestIntent:'Demander une intention de trajet', confirmIntent:'Confirmer la demande sans paiement', cancel:'Annuler', noRequests:'Aucune intention de demande.', pendingHumanReview:'Les textes de sécurité français et arabes attendent une révision humaine.',
    assistantKicker:'Aide guidée', assistantTitle:'Des réponses claires avant toute action.', assistantBody:'Posez vos questions sur la confidentialité, l’état du trajet, les conditions fixes, les remboursements ou la récupération. Par défaut, les réponses proviennent de faits Zecori vérifiés, et non d’un agent génératif en direct.'
  },
  ar: {
    routes:'الرئيسية / النقل', account:'الحساب', activity:'النشاط', inbox:'الوارد', assistant:'المساعدة', menu:'القائمة', testnet:'شبكة اختبار فقط', docs:'الوثائق', settings:'الإعدادات', planned:'مخطط', openInbox:'فتح الوارد', unread:'إشعارات غير مقروءة',
    privateInbox:'الوارد الخاص', inboxTitle:'أحداث موثقة في السجل.', inboxBody:'تأتي الإشعارات من أحداث حساب وطلبات مثبتة. ولا تتضمن عناوين محافظ أو معرّفات معاملات أو أدلة خاصة.', signInInbox:'سجّل الدخول لفتح الوارد', ownerOnly:'تُعزل عناصر الوارد لحساب المالك الداخلي.', openAccount:'فتح الحساب', markAllRead:'تحديد الكل كمقروء', loadingEvents:'جارٍ تحميل الأحداث الخاصة…', noNotifications:'لا إشعارات في هذا العرض', genuineEventsOnly:'لا تظهر العناصر إلا بعد تثبيت حدث حقيقي في الخادم.', markRead:'تحديد كمقروء', markUnread:'تحديد كغير مقروء', openActivity:'فتح النشاط الخاص',
    handleTitle:'معرّف @ اختياري', handleBody:'اكتشاف بالتطابق التام فقط. لا ينشر المعرّف عنوان محفظة أو شبكة جهات اتصال أو طلبات أو سجل دفع.', confirmation:'اكتب نص التأكيد تماماً', claim:'حجز المعرّف', rename:'تغيير المعرّف', check:'التحقق من التوفر', available:'متاح. اكتب نص التأكيد تماماً قبل المتابعة.', unavailable:'غير متاح. تبدو الأسماء المحجوزة والمستخدمة متطابقة.', contacts:'جهات الاتصال الخاصة', saveContact:'حفظ جهة الاتصال', noContacts:'لا توجد جهات اتصال خاصة. يجب على المستلم تفعيل الاكتشاف التام.', requestIntent:'طلب نية للمسار', confirmIntent:'تأكيد طلب بلا دفع', cancel:'إلغاء', noRequests:'لا توجد نوايا طلب.', pendingHumanReview:'نصوص الأمان الفرنسية والعربية بانتظار مراجعة بشرية.',
    assistantKicker:'مساعدة موجّهة', assistantTitle:'إجابات واضحة قبل أي إجراء.', assistantBody:'اسأل عن الخصوصية أو حالة المسار أو شروط الاختبار الثابتة أو الاسترداد أو التعافي. تعتمد الإجابات الافتراضية على حقائق Zecori المراجعة وليست وكيلاً توليدياً مباشراً.'
  }
} as const;

export type ProductMessageKey = keyof typeof productMessages.en;
export function productText(locale: SupportedLocale, key: ProductMessageKey): string { return productMessages[locale][key]; }

const inboxMessages: Record<SupportedLocale, Record<string,string>> = {
  en: {'inbox.order.received':'Route request received for operator review','inbox.order.instructions':'Verified payment instructions are available inside your request','inbox.order.sourceDetected':'A candidate source payment was detected — not yet confirmed','inbox.order.sourceConfirmed':'The required source confirmations were recorded','inbox.order.payoutApproval':'Payout is awaiting separate approval','inbox.order.payoutSubmitted':'A payout candidate was submitted — settlement is not yet complete','inbox.order.completed':'A verified final receipt is available','inbox.order.failed':'The request failed; review the recovery guidance','inbox.order.unresolved':'The request needs manual resolution','inbox.order.expired':'The request expired','inbox.order.cancelled':'The request was cancelled','inbox.order.refundPending':'Refund review is pending — no refund is confirmed','inbox.order.refunded':'A refund was independently recorded','inbox.handle.claimed':'Your handle was claimed','inbox.handle.renamed':'Your handle was renamed','inbox.request.received':'A private contact sent a fixed-route request intent','inbox.request.accepted':'Your fixed-route request intent was accepted','inbox.request.declined':'Your fixed-route request intent was declined'},
  fr: {'inbox.order.received':'Demande de trajet reçue pour examen','inbox.order.instructions':'Les instructions de paiement vérifiées sont disponibles dans votre demande','inbox.order.sourceDetected':'Un paiement source potentiel a été détecté — pas encore confirmé','inbox.order.sourceConfirmed':'Les confirmations source requises ont été enregistrées','inbox.order.payoutApproval':'Le versement attend une approbation distincte','inbox.order.payoutSubmitted':'Un versement potentiel a été envoyé — le règlement reste incomplet','inbox.order.completed':'Un reçu final vérifié est disponible','inbox.order.failed':'La demande a échoué ; consultez les conseils de récupération','inbox.order.unresolved':'La demande nécessite une résolution manuelle','inbox.order.expired':'La demande a expiré','inbox.order.cancelled':'La demande a été annulée','inbox.order.refundPending':'Examen du remboursement en attente — aucun remboursement confirmé','inbox.order.refunded':'Un remboursement a été enregistré indépendamment','inbox.handle.claimed':'Votre identifiant a été revendiqué','inbox.handle.renamed':'Votre identifiant a été renommé','inbox.request.received':'Un contact privé a envoyé une intention de trajet fixe','inbox.request.accepted':'Votre intention de trajet fixe a été acceptée','inbox.request.declined':'Votre intention de trajet fixe a été refusée'},
  ar: {'inbox.order.received':'تم استلام طلب المسار لمراجعة المشغّل','inbox.order.instructions':'تعليمات الدفع المتحقق منها متاحة داخل طلبك','inbox.order.sourceDetected':'تم رصد دفعة مصدر محتملة — لم تُؤكد بعد','inbox.order.sourceConfirmed':'تم تسجيل تأكيدات المصدر المطلوبة','inbox.order.payoutApproval':'الصرف بانتظار موافقة منفصلة','inbox.order.payoutSubmitted':'أُرسل صرف محتمل — التسوية غير مكتملة','inbox.order.completed':'إيصال نهائي متحقق منه متاح','inbox.order.failed':'فشل الطلب؛ راجع إرشادات الاسترداد','inbox.order.unresolved':'يحتاج الطلب إلى حل يدوي','inbox.order.expired':'انتهت صلاحية الطلب','inbox.order.cancelled':'أُلغي الطلب','inbox.order.refundPending':'مراجعة الاسترداد معلقة — لا يوجد استرداد مؤكد','inbox.order.refunded':'تم تسجيل الاسترداد بشكل مستقل','inbox.handle.claimed':'تم حجز معرّفك','inbox.handle.renamed':'تم تغيير معرّفك','inbox.request.received':'أرسل اتصال خاص نية لطلب المسار الثابت','inbox.request.accepted':'قُبلت نية طلب المسار الثابت','inbox.request.declined':'رُفضت نية طلب المسار الثابت'}
};
export function translateInboxEvent(locale: SupportedLocale, key: string): string { return inboxMessages[locale][key] ?? inboxMessages.en[key] ?? 'Account event'; }

export const localeMetadata: Record<SupportedLocale, { translationReview: 'human-validated' | 'machine-generated-unvalidated' }> = {
  en: { translationReview: 'human-validated' },
  fr: { translationReview: 'machine-generated-unvalidated' },
  ar: { translationReview: 'machine-generated-unvalidated' },
};
