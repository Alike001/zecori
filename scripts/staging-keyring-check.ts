#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';

const pool = createPostgresPool(); const encryption = await loadEncryptionKeyring();
try {
  const existing = await pool.query<{ encrypted_canary: Buffer; plaintext_digest: Buffer }>('SELECT encrypted_canary,plaintext_digest FROM staging_keyring_canary WHERE singleton=true');
  if (!existing.rows[0]) {
    const canary = randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO staging_keyring_canary(singleton,encrypted_canary,encryption_key_version,plaintext_digest)
      VALUES(true,$1,$2,$3)`, [encryption.encrypt({ canary }, 'staging:keyring-canary'), encryption.activeVersion, createHash('sha256').update(canary).digest()]);
  }
  const row = (await pool.query<{ encrypted_canary: Buffer; plaintext_digest: Buffer }>('SELECT encrypted_canary,plaintext_digest FROM staging_keyring_canary WHERE singleton=true')).rows[0];
  const value = encryption.decrypt<{ canary: string }>(row.encrypted_canary, 'staging:keyring-canary');
  if (!createHash('sha256').update(value.canary).digest().equals(row.plaintext_digest)) throw new Error('Staging keyring canary digest mismatch');
  await pool.query('UPDATE staging_keyring_canary SET verified_at=now() WHERE singleton=true');
  process.stdout.write(`${JSON.stringify({ status: 'STAGING_KEYRING_VERIFIED', activeVersion: encryption.activeVersion })}\n`);
} finally { await pool.end(); }
