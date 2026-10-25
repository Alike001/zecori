import test from 'node:test';
import assert from 'node:assert/strict';
import { localeDirection, localeMetadata, resolveLocale, translate, translateOrderStatus } from './i18n.ts';

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
