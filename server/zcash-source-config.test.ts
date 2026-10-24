import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceWalletConfig, loadSourceWalletConfig, validateExistingSourceWallet } from './zcash-source-config.ts';

async function walletDirectory(name = 'zecd-testnet-data') {
  const root = await mkdtemp(join(tmpdir(), 'zecathon-wallet-a-'));
  const dataDir = join(root, name); await mkdir(join(dataDir, 'default'), { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700); await chmod(join(dataDir, 'default'), 0o700);
  await writeFile(join(dataDir, 'default', 'keys.toml'), 'private-test-fixture', { mode: 0o600 });
  return { root, dataDir };
}

test('stores an explicit existing Wallet A path without copying cookie or key material', async () => {
  const wallet = await walletDirectory(); const configPath = join(wallet.root, 'operator-private', 'source-wallet-config.json');
  await createSourceWalletConfig({ rpcUrl: 'http://127.0.0.1:18392/', dataDir: wallet.dataDir, walletName: 'default', now: 1_900_000_000_000 }, configPath);
  const config = await loadSourceWalletConfig(configPath);
  assert.equal(config.network, 'zcash-testnet'); assert.equal(config.role, 'wallet-a-source'); assert.equal(config.dataDir, wallet.dataDir); assert.equal(config.walletName, 'default');
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  const raw = await readFile(configPath, 'utf8'); assert.ok(!raw.includes('private-test-fixture')); assert.ok(!raw.includes('cookie'));
  await assert.rejects(createSourceWalletConfig({ rpcUrl: 'http://127.0.0.1:18392/', dataDir: wallet.dataDir, walletName: 'default' }, configPath), /EEXIST/);
});

test('rejects Wallet B, non-loopback or wrong ports, weak permissions and symlinked wallet directories', async () => {
  const wallet = await walletDirectory();
  await assert.rejects(validateExistingSourceWallet({ rpcUrl: 'http://127.0.0.1:18393/', dataDir: wallet.dataDir, walletName: 'default' }), /18392/);
  await assert.rejects(validateExistingSourceWallet({ rpcUrl: 'http://example.com:18392/', dataDir: wallet.dataDir, walletName: 'default' }), /18392/);
  const namedB = await walletDirectory('wallet-b-testnet');
  await assert.rejects(validateExistingSourceWallet({ rpcUrl: 'http://127.0.0.1:18392/', dataDir: namedB.dataDir, walletName: 'default' }), /Wallet B/);
  await chmod(wallet.dataDir, 0o755);
  await assert.rejects(validateExistingSourceWallet({ rpcUrl: 'http://127.0.0.1:18392/', dataDir: wallet.dataDir, walletName: 'default' }), /0700/);
  await chmod(wallet.dataDir, 0o700);
  const linked = join(wallet.root, 'linked-wallet-a'); await symlink(wallet.dataDir, linked);
  await assert.rejects(validateExistingSourceWallet({ rpcUrl: 'http://127.0.0.1:18392/', dataDir: linked, walletName: 'default' }), /real mode-0700/);
  await assert.rejects(validateExistingSourceWallet({ rpcUrl: 'http://127.0.0.1:18392/', dataDir: wallet.dataDir, walletName: '../default' }), /name/);
});
