#!/usr/bin/env node
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';
import { createHash } from 'node:crypto';

const pool = createPostgresPool();
const orderEncryption = await loadEncryptionKeyring();
const relayEncryption = await loadEncryptionKeyring(process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE);
let decrypted = 0;

async function decryptRows(query: string, context: (row: Record<string, unknown>) => string, column: string, encryption = orderEncryption) {
  const result = await pool.query(query);
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const value = row[column]; if (value === null || value === undefined) continue;
    encryption.decrypt(value as Buffer, context(row)); decrypted += 1;
  }
}

try {
  const migrations = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  if (!migrations.rows.some(row => row.version === '005_passkey_identity')) throw new Error('Restored database is missing passkey identity migration');
  const canary = await pool.query<{ encrypted_canary: Buffer; plaintext_digest: Buffer }>('SELECT encrypted_canary,plaintext_digest FROM staging_keyring_canary WHERE singleton=true');
  if (!canary.rows[0]) throw new Error('Restored database is missing the keyring continuity canary');
  const canaryValue = orderEncryption.decrypt<{ canary: string }>(canary.rows[0].encrypted_canary, 'staging:keyring-canary'); decrypted += 1;
  if (!createHash('sha256').update(canaryValue.canary).digest().equals(canary.rows[0].plaintext_digest)) throw new Error('Restored keyring canary digest mismatch');
  await decryptRows('SELECT request_id,encrypted_payment_receiver FROM public_order_requests', row => `request:${row.request_id}:receiver`, 'encrypted_payment_receiver');
  await decryptRows('SELECT order_id,encrypted_private_state FROM orders', row => `order:${row.order_id}:private-state`, 'encrypted_private_state');
  await decryptRows('SELECT allocation_id,encrypted_derivation FROM address_allocation_journal', row => `allocation:${row.allocation_id}:derivation`, 'encrypted_derivation');
  await decryptRows('SELECT allocation_id,encrypted_receiver FROM address_allocation_journal', row => `allocation:${row.allocation_id}:receiver`, 'encrypted_receiver');
  await decryptRows('SELECT order_id,chain,encrypted_evidence FROM settlement_evidence', row => `order:${row.order_id}:evidence:${row.chain}`, 'encrypted_evidence');
  await decryptRows('SELECT receipt_id,encrypted_private_receipt FROM receipts', row => `receipt:${row.receipt_id}:private`, 'encrypted_private_receipt');
  await decryptRows('SELECT job_id,encrypted_challenge FROM private_verification_jobs', row => `relay-job:${row.job_id}:challenge`, 'encrypted_challenge', relayEncryption);
  await decryptRows('SELECT job_id,encrypted_envelope FROM private_verification_messages', row => `relay-job:${row.job_id}:evidence`, 'encrypted_envelope', relayEncryption);
  const integrity = await pool.query<{ audit_events: string; identity_events: string; sessions: string; credentials: string }>(`SELECT
    (SELECT count(*) FROM audit_events) audit_events,
    (SELECT count(*) FROM identity_audit_events) identity_events,
    (SELECT count(*) FROM user_sessions) sessions,
    (SELECT count(*) FROM passkey_credentials) credentials`);
  process.stdout.write(`${JSON.stringify({ status: 'RESTORE_CONSISTENT', migrations: migrations.rows.map(row => row.version), decryptedEnvelopes: decrypted, records: integrity.rows[0] })}\n`);
} finally { await pool.end(); }
