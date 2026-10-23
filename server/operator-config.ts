import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { isFullEvmAddress } from '../src/lib/order-coordinator.ts';
import { atomicCreatePrivateFile } from './private-storage.ts';

export type OperatorConfig = {
  version: 1;
  network: 'base-sepolia';
  chainId: 84532;
  lpSender: string;
  usdcReceiver: string;
  confirmedAt: string;
  confirmationSource: 'interactive-metamask';
};

export function defaultOperatorConfigPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return process.env.ZECATHON_OPERATOR_CONFIG || join(dataHome, 'zecathon-crosschain-app', 'operator-config.json');
}

export function validateOperatorAddresses(lpSender: string, usdcReceiver: string): void {
  if (!isFullEvmAddress(lpSender)) throw new Error('LP Sender must be a full 0x-prefixed 20-byte Ethereum address');
  if (!isFullEvmAddress(usdcReceiver)) throw new Error('USDC Receiver must be a full 0x-prefixed 20-byte Ethereum address');
  if (lpSender.toLowerCase() === usdcReceiver.toLowerCase()) throw new Error('LP Sender and USDC Receiver must be different addresses');
}

function validateConfig(value: Partial<OperatorConfig>): OperatorConfig {
  if (value.version !== 1 || value.network !== 'base-sepolia' || value.chainId !== 84532
    || value.confirmationSource !== 'interactive-metamask' || typeof value.confirmedAt !== 'string'
    || typeof value.lpSender !== 'string' || typeof value.usdcReceiver !== 'string') {
    throw new Error('Operator configuration schema is invalid');
  }
  validateOperatorAddresses(value.lpSender, value.usdcReceiver);
  return value as OperatorConfig;
}

export async function loadOperatorConfig(path = defaultOperatorConfigPath()): Promise<OperatorConfig> {
  const [metadata, folder] = await Promise.all([stat(path), stat(dirname(path))]);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error('Operator configuration must be a regular mode-0600 file');
  if (!folder.isDirectory() || (folder.mode & 0o077) !== 0) throw new Error('Operator configuration directory permissions must be 0700');
  return validateConfig(JSON.parse(await readFile(path, 'utf8')) as Partial<OperatorConfig>);
}

export async function createOperatorConfig(input: { lpSender: string; usdcReceiver: string; now?: number }, path = defaultOperatorConfigPath()): Promise<void> {
  validateOperatorAddresses(input.lpSender, input.usdcReceiver);
  const config: OperatorConfig = {
    version: 1,
    network: 'base-sepolia',
    chainId: 84532,
    lpSender: input.lpSender,
    usdcReceiver: input.usdcReceiver,
    confirmedAt: new Date(input.now ?? Date.now()).toISOString(),
    confirmationSource: 'interactive-metamask',
  };
  await atomicCreatePrivateFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

export async function inspectOperatorConfig(path = defaultOperatorConfigPath()): Promise<{ ready: boolean; reason?: string }> {
  try { await loadOperatorConfig(path); return { ready: true }; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ready: false, reason: code === 'ENOENT' ? 'operator configuration is not initialized' : error instanceof Error ? error.message : 'operator configuration cannot be inspected' };
  }
}
