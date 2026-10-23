import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

const forbiddenNames = new Set(['operator.key', 'operator-config.json', 'operator-control.json', 'orders.json']);
const forbiddenContent = [
  /(?:seed phrase|recovery phrase|mnemonic)\s*[:=]/i,
  /(?:private[_ -]?key|operator[_ -]?hmac)\s*[:=]\s*["'][^"']{16,}["']/i,
  /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/,
];

async function scan(folder) {
  try { await access(folder, constants.R_OK); } catch { return; }
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) await scan(full);
    else {
      if (forbiddenNames.has(entry.name)) throw new Error(`Private operator artifact appears in frontend output: ${full}`);
      const source = await readFile(full, 'utf8').catch(() => '');
      for (const pattern of forbiddenContent) if (pattern.test(source)) throw new Error(`Potential credential material appears in frontend output: ${full}`);
    }
  }
}

await scan(resolve('public'));
await scan(resolve('dist'));
console.log('Privacy scan passed: no operator stores, configuration, or credential patterns appear in frontend assets.');
