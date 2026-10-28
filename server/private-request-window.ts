import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertOutsideWorkspace } from './private-storage.ts';
import { normalizeEvmAddress } from '../src/lib/evm-address.ts';
import type { WalletReadinessIntent } from './wallet-intent.ts';

export type PrivateRequestWindow = {
  version: 1; state: 'PREPARED' | 'ACTIVE' | 'CLOSED'; origin: 'http://localhost:8788';
  database: 'zecori_linked_settlement_01'; maximumRequests: 1;
  routeId: 'zcash-testnet-to-base-sepolia-fixed'; sourceZatoshis: '1000000';
  destinationAtomic: '1000000'; chainId: 84532; token: string; recipient: string;
  sourceConfirmations: 10; destinationConfirmations: 3;
  openedAt?: string; expiresAt?: string; approval?: string;
};
const TOKEN = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export function validatePrivateRequestWindow(value: PrivateRequestWindow): void {
  if (value.version !== 1 || !['PREPARED', 'ACTIVE', 'CLOSED'].includes(value.state)
    || value.origin !== 'http://localhost:8788' || value.database !== 'zecori_linked_settlement_01'
    || value.maximumRequests !== 1 || value.routeId !== 'zcash-testnet-to-base-sepolia-fixed'
    || value.sourceZatoshis !== '1000000' || value.destinationAtomic !== '1000000'
    || value.chainId !== 84532 || value.token?.toLowerCase() !== TOKEN.toLowerCase()
    || value.sourceConfirmations !== 10 || value.destinationConfirmations !== 3) throw new Error('Invalid private one-request scope');
  normalizeEvmAddress(value.recipient);
  if (value.state === 'ACTIVE') {
    const opened = Date.parse(value.openedAt ?? ''), expires = Date.parse(value.expiresAt ?? '');
    if (!Number.isFinite(opened) || !Number.isFinite(expires) || expires <= opened || expires - opened > 600_000
      || !value.approval?.trim()) throw new Error('Private request window needs a recorded approval and at most ten minutes');
  }
}

export function assertPrivateRequestAllowed(window: PrivateRequestWindow, intent: WalletReadinessIntent, now = Date.now()): void {
  validatePrivateRequestWindow(window);
  if (window.state !== 'ACTIVE' || Date.parse(window.openedAt!) > now || Date.parse(window.expiresAt!) <= now) {
    throw Object.assign(new Error('The private request window is closed.'), { statusCode: 503, code: 'PRIVATE_REQUEST_WINDOW_CLOSED' });
  }
  if (intent.routeId !== window.routeId || intent.amountZatoshis !== window.sourceZatoshis
    || intent.source.network !== 'zcash-testnet' || intent.source.pool !== 'ironwood'
    || intent.destination.chainId !== window.chainId || intent.destination.network !== 'base-sepolia'
    || intent.destination.contract.toLowerCase() !== window.token.toLowerCase()
    || intent.destination.address.toLowerCase() !== window.recipient.toLowerCase()) {
    throw Object.assign(new Error('Request differs from the approved private route and recipient.'), { statusCode: 409, code: 'PRIVATE_REQUEST_SCOPE_MISMATCH' });
  }
}

export async function loadPrivateRequestWindow(path: string | undefined, origin: string, databaseUrl: string | undefined): Promise<PrivateRequestWindow | undefined> {
  if (!path) return undefined;
  assertOutsideWorkspace(path);
  const [file, folder] = await Promise.all([lstat(path), lstat(dirname(path))]);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o777) !== 0o600 || file.uid !== process.getuid?.()
    || !folder.isDirectory() || folder.isSymbolicLink() || (folder.mode & 0o077) !== 0) throw new Error('Private request policy must be an operator-owned mode-0600 file in a private directory');
  const window = JSON.parse(await readFile(path, 'utf8')) as PrivateRequestWindow;
  validatePrivateRequestWindow(window);
  const db = new URL(databaseUrl ?? '');
  if (origin !== window.origin || db.hostname !== '127.0.0.1' || db.port !== '55440'
    || db.pathname !== `/${window.database}` || db.username !== 'zecori_linked_runtime'
    || db.protocol !== 'postgresql:' || db.hash
    || JSON.stringify([...db.searchParams]) !== JSON.stringify([['application_name', 'zecori-linked-settlement-01']])) throw new Error('Private request policy cannot target another app or coordinator');
  return window;
}
