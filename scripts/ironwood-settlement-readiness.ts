#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkBaseHealth, checkLiquidity } from '../server/operator-preflight.ts';
import { inspectOperatorConfig, loadOperatorConfig } from '../server/operator-config.ts';
import { checkSourceWalletA } from '../server/zcash-source-wallet.ts';
import { inspectSourceWalletConfig } from '../server/zcash-source-config.ts';
import { checkWatchOnlyVerifierHealth } from '../server/zcash-verifier.ts';

type Status = 'PASSED' | 'FAILED' | 'BLOCKED';
type Check = { stage: string; status: Status; evidence: string };

const REVIEWED_NOIR_VERSION = '1.0.40';
const REVIEWED_NOIR_TESTNET_ARCHIVE_SHA256 = 'e4fdfd9702cd1252b1e40d888952e12bcf7a9caaa4ad103380839aea54d7897b';

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'unavailable'; }
function safeFailure(stage: string, error: unknown): Check {
  const message = errorMessage(error);
  const failed = /wrong|mismatch|invalid|mainnet|unlocked|spending wallet|not seedless|not watch-only/i.test(message);
  return { stage, status: failed ? 'FAILED' : 'BLOCKED', evidence: message };
}

async function sha256(path: string): Promise<string> {
  const digest = createHash('sha256');
  await new Promise<void>((complete, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', complete);
  });
  return digest.digest('hex');
}

async function noirArtifactCheck(): Promise<Check> {
  const extensionDirectory = process.env.NOIR_TESTNET_EXTENSION_DIR;
  const archive = process.env.NOIR_TESTNET_ARCHIVE;
  if (!extensionDirectory || !archive) {
    return { stage: 'Noir testnet artifact', status: 'BLOCKED', evidence: 'NOIR_TESTNET_EXTENSION_DIR and NOIR_TESTNET_ARCHIVE are required; no wallet was opened.' };
  }
  try {
    const manifest = JSON.parse(await readFile(join(resolve(extensionDirectory), 'manifest.json'), 'utf8')) as { name?: unknown; version?: unknown };
    const archiveDigest = await sha256(resolve(archive));
    if (!/testnet/i.test(String(manifest.name)) || manifest.version !== REVIEWED_NOIR_VERSION || archiveDigest !== REVIEWED_NOIR_TESTNET_ARCHIVE_SHA256) {
      return { stage: 'Noir testnet artifact', status: 'FAILED', evidence: `Expected checksum-verified Noir testnet ${REVIEWED_NOIR_VERSION}; received version ${String(manifest.version)} and archive digest ${archiveDigest}.` };
    }
    return { stage: 'Noir testnet artifact', status: 'PASSED', evidence: `Manifest says Testnet ${REVIEWED_NOIR_VERSION}; official archive SHA-256 matched.` };
  } catch (error) { return safeFailure('Noir testnet artifact', error); }
}

const checks: Check[] = [];

const sourceReference = await inspectSourceWalletConfig();
checks.push({
  stage: 'Wallet A reference', status: sourceReference.ready ? 'PASSED' : 'BLOCKED',
  evidence: sourceReference.ready ? 'Private source-wallet reference and filesystem boundary validated.' : sourceReference.reason ?? 'not configured',
});
if (sourceReference.ready) {
  try {
    const source = await checkSourceWalletA();
    checks.push({
      stage: 'Wallet A Ironwood funds', status: source.fullPrivacyCompatible && source.sufficientForPaymentAndFeeReserve ? 'PASSED' : 'FAILED',
      evidence: `locked=${source.locked}; synchronized=${source.synchronized}; ironwood zatoshis=${source.ironwoodUsableZatoshis}; required=${source.requiredZatoshis}; no address or key displayed.`,
    });
  } catch (error) { checks.push(safeFailure('Wallet A Ironwood funds', error)); }
}

try {
  const verifier = await checkWatchOnlyVerifierHealth();
  checks.push({ stage: 'Private watch-only verifier', status: 'PASSED', evidence: `seedless watch-only; synchronized at ${verifier.blocks}; history complete; wallet name matched; no key or address displayed.` });
} catch (error) { checks.push(safeFailure('Private watch-only verifier', error)); }

try {
  const base = await checkBaseHealth();
  checks.push({ stage: 'Base Sepolia RPC', status: 'PASSED', evidence: `chain=${base.chainId}; canonical tip=${base.latestBlock}; official test-USDC bytecode present at ${base.contract}.` });
} catch (error) { checks.push(safeFailure('Base Sepolia RPC', error)); }

const operator = await inspectOperatorConfig();
checks.push({
  stage: 'Operator identity and recipient', status: operator.ready ? 'PASSED' : 'BLOCKED',
  evidence: operator.ready ? 'Private operator configuration validates chain 84532 and distinct bound accounts; addresses not displayed.' : operator.reason ?? 'not configured',
});
if (operator.ready) {
  try {
    const config = await loadOperatorConfig();
    const liquidity = await checkLiquidity(config.lpSender);
    checks.push({
      stage: 'Payout liquidity', status: liquidity.sufficientUsdc && liquidity.sufficientGas ? 'PASSED' : 'FAILED',
      evidence: `test-USDC atomic=${liquidity.usdcAtomic}; gas wei=${liquidity.ethWei}; required test-USDC=1000000; required gas wei=100000000000000; address not displayed.`,
    });
  } catch (error) { checks.push(safeFailure('Payout liquidity', error)); }
}

checks.push(await noirArtifactCheck());
checks.push({
  stage: 'Fresh isolated PostgreSQL', status: 'BLOCKED',
  evidence: process.env.DATABASE_URL
    ? 'DATABASE_URL is configured, but this read-only command deliberately does not mutate or migrate it; use a disposable database for the regression gate.'
    : 'DATABASE_URL is absent; no database was contacted or mutated.',
});

const summary = {
  generatedAt: new Date().toISOString(),
  financialActionsPerformed: false,
  addressesDisplayed: false,
  checks,
  totals: {
    passed: checks.filter(check => check.status === 'PASSED').length,
    failed: checks.filter(check => check.status === 'FAILED').length,
    blocked: checks.filter(check => check.status === 'BLOCKED').length,
  },
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = checks.some(check => check.status !== 'PASSED') ? 2 : 0;
