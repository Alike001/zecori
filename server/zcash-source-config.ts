import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { lstat, readFile, stat } from 'node:fs/promises';
import { atomicCreatePrivateFile } from './private-storage.ts';
import { ZECD_WALLET_B_DATA } from './zcash-verifier.ts';

export type SourceWalletConfig = {
  version: 1;
  role: 'wallet-a-source';
  network: 'zcash-testnet';
  rpcUrl: string;
  dataDir: string;
  configuredAt: string;
};

export function defaultSourceWalletConfigPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataHome, 'zecathon-crosschain-app', 'source-wallet-config.json');
}

export async function validateExistingSourceWallet(input: { rpcUrl: string; dataDir: string }): Promise<{ rpcUrl: string; dataDir: string }> {
  let rpc: URL;
  try { rpc = new URL(input.rpcUrl); } catch { throw new Error('Wallet A RPC URL is invalid'); }
  if (rpc.protocol !== 'http:' || rpc.hostname !== '127.0.0.1' || rpc.port !== '18392' || (rpc.pathname !== '/' && rpc.pathname !== '')) throw new Error('Wallet A RPC must be exactly loopback port 18392');
  if (rpc.username || rpc.password || rpc.search || rpc.hash) throw new Error('Wallet A RPC URL must not contain credentials or extra parameters');
  const rpcUrl = 'http://127.0.0.1:18392/';
  if (!isAbsolute(input.dataDir)) throw new Error('Wallet A data directory must be an absolute path');
  const dataDir = resolve(input.dataDir);
  if (dataDir === resolve(ZECD_WALLET_B_DATA) || /wallet-b/i.test(dataDir)) throw new Error('Wallet A data directory must never use Wallet B');
  const [folder, keys] = await Promise.all([lstat(dataDir), stat(join(dataDir, 'default', 'keys.toml'))]);
  if (!folder.isDirectory() || folder.isSymbolicLink() || (folder.mode & 0o077) !== 0) throw new Error('Wallet A data directory must be a real mode-0700 directory');
  if (!keys.isFile() || (keys.mode & 0o077) !== 0) throw new Error('Wallet A keys file must be a private mode-0600 file');
  return { rpcUrl, dataDir };
}

export async function createSourceWalletConfig(input: { rpcUrl: string; dataDir: string; now?: number }, path = defaultSourceWalletConfigPath()): Promise<void> {
  const validated = await validateExistingSourceWallet(input);
  const config: SourceWalletConfig = { version: 1, role: 'wallet-a-source', network: 'zcash-testnet', ...validated, configuredAt: new Date(input.now ?? Date.now()).toISOString() };
  await atomicCreatePrivateFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

export async function loadSourceWalletConfig(path = defaultSourceWalletConfigPath()): Promise<SourceWalletConfig> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error('Wallet A configuration must be a regular mode-0600 file');
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SourceWalletConfig>;
  if (parsed.version !== 1 || parsed.role !== 'wallet-a-source' || parsed.network !== 'zcash-testnet' || typeof parsed.rpcUrl !== 'string' || typeof parsed.dataDir !== 'string' || typeof parsed.configuredAt !== 'string') throw new Error('Wallet A configuration schema is invalid');
  const validated = await validateExistingSourceWallet({ rpcUrl: parsed.rpcUrl, dataDir: parsed.dataDir });
  return { ...parsed, ...validated } as SourceWalletConfig;
}

export async function inspectSourceWalletConfig(path = defaultSourceWalletConfigPath()): Promise<{ ready: boolean; reason?: string }> {
  try { await loadSourceWalletConfig(path); return { ready: true }; }
  catch (error) { return { ready: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Wallet A configuration is not initialized' : error instanceof Error ? error.message : 'Wallet A configuration cannot be inspected' }; }
}
