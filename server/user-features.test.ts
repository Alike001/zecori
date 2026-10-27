import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHandle } from './user-features.ts';

test('handle normalization rejects spoofing, confusables, separators and reserved syntax shapes', () => {
  assert.equal(normalizeHandle('@Private-Route9'), 'private-route9');
  for (const invalid of ['ab', 'a--b', '-admin', 'admin-', 'аdmin', 'Ａdmin', 'white space', 'under_score', 'a'.repeat(25)]) {
    assert.throws(() => normalizeHandle(invalid), /handle/i, invalid);
  }
});
