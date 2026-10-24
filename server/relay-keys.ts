import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { lstat, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertOutsideWorkspace } from './private-storage.ts';

async function readRegular(path: string, privateMaterial: boolean): Promise<Buffer> {
  const absolute = resolve(path); assertOutsideWorkspace(absolute);
  const [link, metadata] = await Promise.all([lstat(absolute), stat(absolute)]);
  if (link.isSymbolicLink() || !metadata.isFile()) throw new Error('Relay key must be a non-symlink regular file');
  if (privateMaterial && (metadata.mode & 0o077) !== 0) throw new Error('Relay private key must be mode 0600');
  const value = await readFile(absolute); if (value.length > 16_384) throw new Error('Relay key file is unexpectedly large'); return value;
}

export async function loadRelayPrivateKey(path: string | undefined): Promise<KeyObject> {
  if (!path) throw new Error('Relay private key path is required');
  const key = createPrivateKey(await readRegular(path, true));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Relay private key must be Ed25519');
  return key;
}

export async function loadRelayPublicKey(path: string | undefined): Promise<KeyObject> {
  if (!path) throw new Error('Relay public key path is required');
  const key = createPublicKey(await readRegular(path, false));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Relay public key must be Ed25519');
  return key;
}

export function requirePrivateRelayTransport(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const url = process.env.DATABASE_URL ?? '';
  if (process.env.ZECATHON_RELAY_TRANSPORT_AUTH !== 'mtls' || !/[?&]sslmode=verify-full(?:&|$)/.test(url) || !process.env.PGSSLROOTCERT || !process.env.PGSSLCERT || !process.env.PGSSLKEY) throw new Error('Production relay requires PostgreSQL mTLS with sslmode=verify-full and separate CA/certificate/key files');
}
