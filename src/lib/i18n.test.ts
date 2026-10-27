import test from 'node:test';
import assert from 'node:assert/strict';
import { localeDirection, localeMetadata, productText, resolveLocale, translate, translateInboxEvent, translateOrderStatus } from './i18n.ts';

test('localization resolves incremental locales and safely falls back', () => {
  assert.equal(resolveLocale('en-NG'), 'en');
  assert.equal(resolveLocale('fr-FR'), 'fr');
  assert.equal(resolveLocale('ar-EG'), 'ar');
  assert.equal(resolveLocale('zu-ZA'), 'en');
  assert.equal(translate('en', 'requestReview'), 'Request operator review');
  assert.equal(localeDirection('ar'), 'rtl');
  assert.equal(localeDirection('fr'), 'ltr');
  assert.equal(localeMetadata.fr.translationReview, 'machine-generated-unvalidated');
  assert.equal(translateOrderStatus('fr', 'COMPLETED'), 'Terminée');
  assert.equal(translateOrderStatus('ar', 'FAILED'), 'فشل');
});

test('every supported backend lifecycle state has an explicit UI label in every locale', () => {
  const statuses=['AWAITING_OPERATOR','ACCEPTED','PAYMENT_READY','SOURCE_DETECTED','SOURCE_CONFIRMED','PAYOUT_AWAITING_APPROVAL','PAYOUT_SUBMITTED','COMPLETED','FAILED','REFUND_PENDING','REFUNDED','UNRESOLVED','EXPIRED','CANCELLED'];
  for(const locale of ['en','fr','ar'] as const) for(const status of statuses) assert.notEqual(translateOrderStatus(locale,status),status,`${locale} ${status}`);
});

test('security-critical locale strings preserve financial tokens and disclose incomplete review', () => {
  for (const locale of ['en','fr','ar'] as const) {
    assert.match(translate(locale, 'fixedTermsWarning'), /0\.01 TAZ → 1 test USDC/);
    assert.match(translate(locale, 'docsLanguageNotice'), /review|révision|مراجعة/i);
    assert.ok(translate(locale, 'noAuthorityWarning').length > 30);
  }
  assert.equal(localeMetadata.en.translationReview, 'human-validated');
  assert.notEqual(localeMetadata.fr.translationReview, 'human-validated');
  assert.notEqual(localeMetadata.ar.translationReview, 'human-validated');
});

test('handles, inbox, assistant and navigation have English, French and Arabic labels', () => {
  const keys = ['routes','account','activity','inbox','assistant','handleTitle','confirmation','contacts','privateInbox','inboxTitle','markRead','assistantTitle'] as const;
  const events = ['inbox.order.received','inbox.order.completed','inbox.handle.claimed','inbox.request.received','inbox.request.accepted','inbox.request.declined'];
  for (const locale of ['en','fr','ar'] as const) {
    for (const key of keys) assert.ok(productText(locale,key).trim().length > 2,`${locale} ${key}`);
    for (const event of events) assert.notEqual(translateInboxEvent(locale,event),'Account event',`${locale} ${event}`);
  }
  assert.equal(localeDirection('ar'),'rtl');
  assert.match(productText('ar','pendingHumanReview'),/مراجعة/);
});
