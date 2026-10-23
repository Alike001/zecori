import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, translate } from './i18n.ts';

test('localization enables only reviewed English and safely falls back', () => {
  assert.equal(resolveLocale('en-NG'), 'en');
  assert.equal(resolveLocale('fr-FR'), 'en');
  assert.equal(translate('en', 'requestReview'), 'Request operator review');
});
