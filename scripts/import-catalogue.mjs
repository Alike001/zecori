import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: node scripts/import-catalogue.mjs <near-tokens.json>');
  process.exit(1);
}
let parsed;
try { parsed = JSON.parse(await readFile(resolve(sourcePath), 'utf8')); }
catch (e) { console.error('Could not read JSON:', e.message); process.exit(1); }

const data = Array.isArray(parsed) ? parsed : parsed?.tokens ?? parsed?.data;
if (!Array.isArray(data) || !data.length || data.length > 10000) {
  console.error('Expected an array of 1–10000 tokens; refusing to save catalogue.');
  process.exit(1);
}
const ids = new Set();
const tokens = [];
for (const t of data) {
  if (!t || typeof t !== 'object' || typeof t.assetId !== 'string' ||
    typeof t.symbol !== 'string' || typeof t.blockchain !== 'string' ||
    !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) {
    console.error('Malformed token record; refusing import.');
    process.exit(1);
  }
  if (ids.has(t.assetId)) continue;
  ids.add(t.assetId);
  tokens.push({
    assetId: t.assetId,
    symbol: t.symbol,
    blockchain: t.blockchain,
    decimals: t.decimals,
    ...(typeof t.contractAddress === 'string' ? { contractAddress: t.contractAddress } : {}),
  });
}
if (!tokens.some(t => t.assetId === 'nep141:zec.omft.near' && t.blockchain === 'zec' && t.symbol.toUpperCase() === 'ZEC')) {
  console.error('Native ZEC missing; refusing import.'); process.exit(1);
}
const dest = resolve('public/token-catalogue.json');
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, JSON.stringify({ importedAt: new Date().toISOString(), tokens }, null, 2) + '\n');
console.log(`Imported ${tokens.length} distinct asset records from ${sourcePath}`);
console.log('Discovery only. No route execution or quote availability verified.');
