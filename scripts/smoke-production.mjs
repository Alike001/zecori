const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const forwardedProto = process.env.SMOKE_FORWARDED_PROTO;
const headers = forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {};
for (const [path, expected] of [['/health/live', 200], ['/health/ready', 200], ['/api/v1/capabilities', 200], ['/history', 200]]) {
  const response = await fetch(`${base}${path}`, { headers });
  if (response.status !== expected) throw new Error(`${path}: expected ${expected}, received ${response.status}`);
}
const forbidden = await fetch(`${base}/api/v1/orders/example/approve-payout`, { method: 'POST', headers: { ...headers, origin: process.env.SMOKE_PUBLIC_ORIGIN ?? base, 'content-type': 'application/json' }, body: '{}' });
if (![403, 404].includes(forbidden.status)) throw new Error(`operator route unexpectedly responded ${forbidden.status}`);
process.stdout.write('Production smoke checks passed.\n');
