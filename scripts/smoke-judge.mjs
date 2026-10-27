const base = process.argv[2];
if (!base) throw new Error('Usage: node scripts/smoke-judge.mjs https://judge.example.org');
const origin = new URL(base).origin;
if (origin !== base || !base.startsWith('https://')) throw new Error('Judge smoke requires an exact HTTPS origin');

for (const path of ['/health/live', '/health/ready', '/api/v1/capabilities', '/history', '/inbox']) {
  const response = await fetch(`${base}${path}`, { redirect: 'error' });
  if (!response.ok) throw new Error(`${path}: expected success, received ${response.status}`);
  if (!response.headers.get('strict-transport-security')) throw new Error(`${path}: HSTS is missing`);
}

const capabilitiesResponse = await fetch(`${base}/api/v1/capabilities`);
const capabilities = await capabilitiesResponse.json();
const expectedRequests = process.env.EXPECT_ROUTE_REQUESTS === '1';
if (capabilities.orderCreation?.enabled !== expectedRequests) {
  throw new Error(`orderCreation.enabled did not match EXPECT_ROUTE_REQUESTS=${expectedRequests ? '1' : '0'}`);
}
if (!expectedRequests && capabilities.orderCreation?.state !== 'operator-review-required') {
  throw new Error('Disabled judge route did not report operator-review-required');
}
if (!capabilities.destinations?.some(item => item.id === 'base-sepolia-usdc' && item.status === 'supported' && item.network?.chainId === 84532 && item.asset?.contractIdentity?.kind === 'erc20')) {
  throw new Error('Base Sepolia USDC destination capability is missing or malformed');
}
if (capabilities.destinations?.some(item => item.id !== 'base-sepolia-usdc' && item.status === 'supported')) {
  throw new Error('An unsupported destination is advertised as supported');
}

const rejected = await fetch(`${base}/api/v1/order-requests`, {
  method: 'POST',
  headers: { origin: 'https://invalid-origin.example', 'content-type': 'application/json' },
  body: '{}',
});
if (rejected.status !== 403) throw new Error(`invalid origin: expected 403, received ${rejected.status}`);

const forbidden = await fetch(`${base}/api/v1/orders/example/approve-payout`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}',
});
if (forbidden.status !== 404) throw new Error(`operator mutation route unexpectedly responded ${forbidden.status}`);

process.stdout.write(`Judge smoke passed with route requests ${expectedRequests ? 'enabled' : 'disabled'}.\n`);
