import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('Render Blueprint is a single free fail-closed web service', async () => {
  const blueprint = await readFile('render.yaml', 'utf8');
  assert.match(blueprint, /type: web/);
  assert.match(blueprint, /runtime: node/);
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /healthCheckPath: \/health\/ready/);
  assert.match(blueprint, /PUBLIC_ORIGIN[\s\S]*https:\/\/zecori\.iamalikex\.tech/);
  assert.match(blueprint, /WEBAUTHN_RP_ID[\s\S]*zecori\.iamalikex\.tech/);
  assert.match(blueprint, /DATABASE_URL\n\s+sync: false/);
  assert.match(blueprint, /ZECATHON_ROUTE_REQUESTS_ENABLED\n\s+value: "0"/);
  assert.match(blueprint, /ZECATHON_ROUTE_LIQUIDITY_READY\n\s+value: "0"/);
  assert.doesNotMatch(blueprint, /postgres:\/\//);
  assert.doesNotMatch(blueprint, /preDeployCommand/);
});

test('Render startup refuses to migrate without the isolated judge acknowledgement', () => {
  const result = spawnSync('sh', ['scripts/render-start.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /isolated public judge demo/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /postgres(?:ql)?:\/\//);
});
