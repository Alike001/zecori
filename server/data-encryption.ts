import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertOutsideWorkspace } from './private-storage.ts';

const MAGIC = Buffer.from('ZEC1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type EncryptionKeyring = { activeVersion: number; keys: ReadonlyMap<number, Buffer> };

export class DataEncryption {
  readonly activeVersion: number;
  private readonly keys: ReadonlyMap<number, Buffer>;
  constructor(keyring: EncryptionKeyring) {
    if (!Number.isSafeInteger(keyring.activeVersion) || keyring.activeVersion < 1) throw new Error('Active encryption key version is invalid');
    for (const [version, key] of keyring.keys) {
      if (!Number.isSafeInteger(version) || version < 1 || key.length !== 32) throw new Error('Every encryption key must be a versioned 32-byte key');
    }
    if (!keyring.keys.has(keyring.activeVersion)) throw new Error('Active encryption key is unavailable');
    this.activeVersion = keyring.activeVersion;
    this.keys = keyring.keys;
  }

  encrypt(value: unknown, context: string): Buffer {
    const key = this.keys.get(this.activeVersion)!;
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`zecathon:${context}:v${this.activeVersion}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const version = Buffer.alloc(4); version.writeUInt32BE(this.activeVersion);
    return Buffer.concat([MAGIC, version, nonce, cipher.getAuthTag(), ciphertext]);
  }

  decrypt<T>(envelope: Buffer, context: string): T {
    if (envelope.length < MAGIC.length + 4 + NONCE_BYTES + TAG_BYTES || !envelope.subarray(0, 4).equals(MAGIC)) throw new Error('Encrypted private data envelope is invalid');
    const version = envelope.readUInt32BE(4);
    const key = this.keys.get(version);
    if (!key) throw new Error(`Encryption key version ${version} is unavailable`);
    const nonce = envelope.subarray(8, 8 + NONCE_BYTES);
    const tag = envelope.subarray(8 + NONCE_BYTES, 8 + NONCE_BYTES + TAG_BYTES);
    const ciphertext = envelope.subarray(8 + NONCE_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(Buffer.from(`zecathon:${context}:v${version}`, 'utf8'));
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as T;
    } catch { throw new Error('Encrypted private data authentication failed'); }
  }
}

type KeyFile = { activeVersion?: unknown; keys?: unknown };

export async function loadEncryptionKeyring(path = process.env.ZECATHON_ENCRYPTION_KEY_FILE): Promise<DataEncryption> {
  if (!path) throw new Error('ZECATHON_ENCRYPTION_KEY_FILE is required');
  const absolute = resolve(path);
  assertOutsideWorkspace(absolute);
  const [file, folder] = await Promise.all([stat(absolute), stat(dirname(absolute))]);
  const managedSecret = absolute.startsWith('/run/secrets/') || absolute.startsWith('/etc/secrets/');
  if (!file.isFile() || (managedSecret ? (file.mode & 0o022) !== 0 : (file.mode & 0o077) !== 0)) throw new Error('Encryption key file must be a private regular file');
  if (!folder.isDirectory() || (!managedSecret && (folder.mode & 0o077) !== 0)) throw new Error('Encryption key directory must be mode 0700');
  const parsed = JSON.parse(await readFile(absolute, 'utf8')) as KeyFile;
  if (!Number.isSafeInteger(parsed.activeVersion) || !parsed.keys || Array.isArray(parsed.keys) || typeof parsed.keys !== 'object') throw new Error('Encryption key file schema is invalid');
  const keys = new Map<number, Buffer>();
  for (const [rawVersion, encoded] of Object.entries(parsed.keys as Record<string, unknown>)) {
    if (!/^\d+$/.test(rawVersion) || typeof encoded !== 'string') throw new Error('Encryption key file schema is invalid');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Encryption keys must be canonical base64-encoded 32-byte values');
    keys.set(Number(rawVersion), key);
  }
  return new DataEncryption({ activeVersion: parsed.activeVersion as number, keys });
}
