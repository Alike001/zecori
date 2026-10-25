#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { assertRecoveryInventoryContinuity } from '../server/keyring-canary.ts';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Before and after inventory files are required.');
const [before, after] = await Promise.all([
  readFile(beforePath, 'utf8').then(JSON.parse),
  readFile(afterPath, 'utf8').then(JSON.parse),
]);
assertRecoveryInventoryContinuity(before, after);
process.stdout.write(`${JSON.stringify({ status: 'RESTORE_RESTART_INVENTORY_VERIFIED' })}\n`);
