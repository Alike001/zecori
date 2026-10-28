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

test('Render startup refuses an unidentified deployment before database access', () => {
  const result = spawnSync('sh', ['scripts/render-start.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /isolated public judge demo/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /postgres(?:ql)?:\/\//);
});

 test('Public startup performs only read-only schema verification and rejects private execution configuration', async () => {
  const script = await readFile('scripts/render-start.sh', 'utf8');
  assert.doesNotMatch(script, /scripts\/migrate|db:migrate/);
  assert.match(script, /scripts\/verify-public-schema.ts/);
  const env = { PATH: process.env.PATH, ZECORI_DEPLOYMENT_KIND: 'public-judge-demo', NODE_ENV: 'production', HOST: '0.0.0.0', TRUST_PROXY: '1', PUBLIC_ORIGIN: 'https://zecori.iamalikex.tech', WEBAUTHN_RP_ID: 'zecori.iamalikex.tech', DATABASE_URL: 'postgresql://unused.invalid/db?sslmode=require' };
  for (const key of ['ZECATHON_ROUTE_REQUESTS_ENABLED', 'ZECATHON_ROUTE_LIQUIDITY_READY', 'ZECATHON_TEST_VARIABLE_QUOTES_ENABLED', 'ZECORI_PRIVATE_REQUEST_WINDOW_FILE', 'ZECORI_OPERATOR_DATABASE_URL', 'ZECORI_OPERATOR_LOGIN_TOKEN_FILE', 'ZECORI_OPERATOR_APPROVED_PACKET']) {
    const result = spawnSync('sh', ['scripts/render-start.sh'], { encoding: 'utf8', env: { ...env, [key]: '1' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Render judge startup refused/);
    assert.doesNotMatch(result.stderr, /unused.invalid/);
  }
 });
