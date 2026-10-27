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

const productMessages = {
  en: {
    routes:'Routes', account:'Account', activity:'Activity', inbox:'Inbox', assistant:'AI assistant', menu:'Menu', testnet:'Testnet only', docs:'Docs', settings:'Settings', planned:'planned', openInbox:'Open inbox', unread:'unread notifications',
    privateInbox:'Private inbox', inboxTitle:'Events backed by the ledger.', inboxBody:'Notifications come from committed account and order events. They never include wallet addresses, transaction identifiers, or private evidence.', signInInbox:'Sign in to open your inbox', ownerOnly:'Inbox items are isolated to the owning internal account.', openAccount:'Open account', markAllRead:'Mark all read', loadingEvents:'Loading private events…', noNotifications:'No notifications in this view', genuineEventsOnly:'New items appear only after a genuine backend event commits.', markRead:'Mark read', markUnread:'Mark unread', openActivity:'Open private activity',
    handleTitle:'Your optional @handle', handleBody:'Exact-match discovery only. Your handle never publishes a wallet address, contact graph, order, or payment history.', confirmation:'Type the exact confirmation', claim:'Claim handle', rename:'Rename handle', check:'Check availability', available:'Available. Type the exact confirmation before claiming.', unavailable:'Unavailable. Reserved and claimed names look the same.', contacts:'Private contacts', saveContact:'Save private contact', noContacts:'No private contacts. Exact-match discovery must be enabled by the recipient.', requestIntent:'Request route intent', confirmIntent:'Confirm non-paying request', cancel:'Cancel', noRequests:'No handle request intents.', pendingHumanReview:'French and Arabic security copy is pending human review.',
    assistantKicker:'AI route desk', assistantTitle:'Ask for facts, not execution.', assistantBody:'Every financial answer must be grounded in an allow-listed tool. The assistant has no order, wallet, signing, allocation, or payout authority.'
  },
  fr: {
    routes:'Itinéraires', account:'Compte', activity:'Activité', inbox:'Boîte de réception', assistant:'Assistant IA', menu:'Menu', testnet:'Réseau de test uniquement', docs:'Documentation', settings:'Paramètres', planned:'prévu', openInbox:'Ouvrir la boîte de réception', unread:'notifications non lues',
    privateInbox:'Boîte privée', inboxTitle:'Des événements issus du registre.', inboxBody:'Les notifications proviennent d’événements de compte et de demande validés. Elles ne contiennent ni adresse, ni identifiant de transaction, ni preuve privée.', signInInbox:'Connectez-vous pour ouvrir votre boîte', ownerOnly:'Les éléments sont isolés au compte interne propriétaire.', openAccount:'Ouvrir le compte', markAllRead:'Tout marquer comme lu', loadingEvents:'Chargement des événements privés…', noNotifications:'Aucune notification dans cette vue', genuineEventsOnly:'Les éléments apparaissent seulement après la validation d’un événement réel du serveur.', markRead:'Marquer comme lu', markUnread:'Marquer comme non lu', openActivity:'Ouvrir l’activité privée',
    handleTitle:'Votre @identifiant facultatif', handleBody:'Découverte par correspondance exacte uniquement. Votre identifiant ne publie aucune adresse, relation, demande ou historique de paiement.', confirmation:'Saisissez la confirmation exacte', claim:'Revendiquer', rename:'Renommer', check:'Vérifier la disponibilité', available:'Disponible. Saisissez la confirmation exacte avant de continuer.', unavailable:'Indisponible. Les noms réservés et attribués ont la même réponse.', contacts:'Contacts privés', saveContact:'Enregistrer le contact privé', noContacts:'Aucun contact privé. Le destinataire doit activer la découverte exacte.', requestIntent:'Demander une intention de trajet', confirmIntent:'Confirmer la demande sans paiement', cancel:'Annuler', noRequests:'Aucune intention de demande.', pendingHumanReview:'Les textes de sécurité français et arabes attendent une révision humaine.',
    assistantKicker:'Bureau IA du trajet', assistantTitle:'Demandez des faits, pas une exécution.', assistantBody:'Toute réponse financière doit provenir d’un outil autorisé. L’assistant ne peut ni créer une demande, ni accéder au portefeuille, ni signer, allouer ou verser.'
  },
  ar: {
    routes:'المسارات', account:'الحساب', activity:'النشاط', inbox:'الوارد', assistant:'مساعد الذكاء الاصطناعي', menu:'القائمة', testnet:'شبكة اختبار فقط', docs:'الوثائق', settings:'الإعدادات', planned:'مخطط', openInbox:'فتح الوارد', unread:'إشعارات غير مقروءة',
    privateInbox:'الوارد الخاص', inboxTitle:'أحداث موثقة في السجل.', inboxBody:'تأتي الإشعارات من أحداث حساب وطلبات مثبتة. ولا تتضمن عناوين محافظ أو معرّفات معاملات أو أدلة خاصة.', signInInbox:'سجّل الدخول لفتح الوارد', ownerOnly:'تُعزل عناصر الوارد لحساب المالك الداخلي.', openAccount:'فتح الحساب', markAllRead:'تحديد الكل كمقروء', loadingEvents:'جارٍ تحميل الأحداث الخاصة…', noNotifications:'لا إشعارات في هذا العرض', genuineEventsOnly:'لا تظهر العناصر إلا بعد تثبيت حدث حقيقي في الخادم.', markRead:'تحديد كمقروء', markUnread:'تحديد كغير مقروء', openActivity:'فتح النشاط الخاص',
    handleTitle:'معرّف @ اختياري', handleBody:'اكتشاف بالتطابق التام فقط. لا ينشر المعرّف عنوان محفظة أو شبكة جهات اتصال أو طلبات أو سجل دفع.', confirmation:'اكتب نص التأكيد تماماً', claim:'حجز المعرّف', rename:'تغيير المعرّف', check:'التحقق من التوفر', available:'متاح. اكتب نص التأكيد تماماً قبل المتابعة.', unavailable:'غير متاح. تبدو الأسماء المحجوزة والمستخدمة متطابقة.', contacts:'جهات الاتصال الخاصة', saveContact:'حفظ جهة الاتصال', noContacts:'لا توجد جهات اتصال خاصة. يجب على المستلم تفعيل الاكتشاف التام.', requestIntent:'طلب نية للمسار', confirmIntent:'تأكيد طلب بلا دفع', cancel:'إلغاء', noRequests:'لا توجد نوايا طلب.', pendingHumanReview:'نصوص الأمان الفرنسية والعربية بانتظار مراجعة بشرية.',
    assistantKicker:'مكتب المسار الذكي', assistantTitle:'اسأل عن الحقائق، لا التنفيذ.', assistantBody:'يجب أن تستند كل إجابة مالية إلى أداة مسموح بها. لا يملك المساعد صلاحية الطلب أو المحفظة أو التوقيع أو التخصيص أو الدفع.'
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
