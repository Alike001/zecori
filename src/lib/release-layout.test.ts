import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('destination-control and payment deadline UI retain readable mobile layout guards', async () => {
  const [styles, app] = await Promise.all([
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /destination-control-status ready/);
  assert.match(app, /role="timer"/);
  assert.match(app, /Payment deadline passed — recovery only/);
  assert.match(styles, /\.destination-control-status span\s*\{[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /\.request-card\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(max-width: 44rem\)[\s\S]*\.receiver-panel\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(app, /'destination-control-status ready'[^\n]*<span\/>/);
});
