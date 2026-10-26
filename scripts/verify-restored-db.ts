#!/usr/bin/env node
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';
import { verifyKeyringCanary, type KeyringCanaryRow } from '../server/keyring-canary.ts';

const pool = createPostgresPool();
const orderEncryption = await loadEncryptionKeyring();
const relayEncryption = await loadEncryptionKeyring(process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE);
let decrypted = 0;
const encryptedRecords: Record<string, number> = { canary: 0 };

async function decryptRows(name: string, query: string, context: (row: Record<string, unknown>) => string, column: string, encryption = orderEncryption) {
  const result = await pool.query(query);
  let count = 0;
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const value = row[column]; if (value === null || value === undefined) continue;
    encryption.decrypt(value as Buffer, context(row)); decrypted += 1; count += 1;
  }
  encryptedRecords[name] = count;
}

try {
  const migrations = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  const expectedMigrations = ['001_production_foundation','002_settlement_integration','003_private_verification_relay','004_crash_safe_address_allocation','005_passkey_identity','006_staging_keyring_canary','007_owner_destination_binding','008_destination_wallet_control','009_privy_identity'];
  if (migrations.rows.map(row => row.version).join(',') !== expectedMigrations.join(',')) throw new Error('Restored database migration inventory does not exactly match the reviewed 001-009 sequence');
  const canary = await pool.query<KeyringCanaryRow>('SELECT encrypted_canary,encryption_key_version,plaintext_digest FROM staging_keyring_canary WHERE singleton=true');
  verifyKeyringCanary(canary.rows[0], orderEncryption, 'Restored'); decrypted += 1; encryptedRecords.canary = 1;
  await decryptRows('publicRequestReceivers', 'SELECT request_id,encrypted_payment_receiver FROM public_order_requests', row => `request:${row.request_id}:receiver`, 'encrypted_payment_receiver');
  await decryptRows('orderPrivateStates', 'SELECT order_id,encrypted_private_state FROM orders', row => `order:${row.order_id}:private-state`, 'encrypted_private_state');
  await decryptRows('allocationDerivations', 'SELECT allocation_id,encrypted_derivation FROM address_allocation_journal', row => `allocation:${row.allocation_id}:derivation`, 'encrypted_derivation');
  await decryptRows('allocationReceivers', 'SELECT allocation_id,encrypted_receiver FROM address_allocation_journal', row => `allocation:${row.allocation_id}:receiver`, 'encrypted_receiver');
  await decryptRows('settlementEvidence', 'SELECT order_id,chain,encrypted_evidence FROM settlement_evidence', row => `order:${row.order_id}:evidence:${row.chain}`, 'encrypted_evidence');
  await decryptRows('privateReceipts', 'SELECT receipt_id,encrypted_private_receipt FROM receipts', row => `receipt:${row.receipt_id}:private`, 'encrypted_private_receipt');
  await decryptRows('relayChallenges', 'SELECT job_id,encrypted_challenge FROM private_verification_jobs', row => `relay-job:${row.job_id}:challenge`, 'encrypted_challenge', relayEncryption);
  await decryptRows('relayEnvelopes', 'SELECT job_id,encrypted_envelope FROM private_verification_messages', row => `relay-job:${row.job_id}:evidence`, 'encrypted_envelope', relayEncryption);
  await decryptRows('destinationIntents', 'SELECT intent_id,encrypted_intent FROM destination_intents', row => `destination-intent:${row.intent_id}`, 'encrypted_intent');
  await decryptRows('walletChallenges', 'SELECT challenge_id,encrypted_challenge FROM destination_wallet_challenges', row => `wallet-control:${row.challenge_id}:challenge`, 'encrypted_challenge');
  await decryptRows('walletProofs', 'SELECT challenge_id,encrypted_proof FROM destination_wallet_proofs', row => `wallet-control:${row.challenge_id}:proof`, 'encrypted_proof');
  const integrity = await pool.query<{ audit_events: string; identity_events: string; external_identities: string; destination_intent_events:string; destination_wallet_events:string; sessions: string; credentials: string; users:string; requests:string; destination_intents:string; wallet_challenges:string; wallet_proofs:string; failed_wallet_proofs:string; orders: string; unresolved_orders: string; replay_references: string; authorizations: string; relay_jobs: string; relay_messages: string; receipts: string }>(`SELECT
    (SELECT count(*) FROM audit_events) audit_events,
    (SELECT count(*) FROM identity_audit_events) identity_events,
    (SELECT count(*) FROM external_identities) external_identities,
    (SELECT count(*) FROM destination_intent_events) destination_intent_events,
    (SELECT count(*) FROM destination_wallet_audit_events) destination_wallet_events,
    (SELECT count(*) FROM user_sessions) sessions,
    (SELECT count(*) FROM passkey_credentials) credentials,
    (SELECT count(*) FROM users) users,
    (SELECT count(*) FROM public_order_requests) requests,
    (SELECT count(*) FROM destination_intents) destination_intents,
    (SELECT count(*) FROM destination_wallet_challenges) wallet_challenges,
    (SELECT count(*) FROM destination_wallet_proofs) wallet_proofs,
    (SELECT count(*) FROM destination_wallet_proofs WHERE verification_status='RECHECK_FAILED') failed_wallet_proofs,
    (SELECT count(*) FROM orders) orders,
    (SELECT count(*) FROM orders WHERE status='UNRESOLVED') unresolved_orders,
    (SELECT count(*) FROM replay_references) replay_references,
    (SELECT count(*) FROM authorization_records) authorizations,
    (SELECT count(*) FROM private_verification_jobs) relay_jobs,
    (SELECT count(*) FROM private_verification_messages) relay_messages,
    (SELECT count(*) FROM receipts) receipts`);
  process.stdout.write(`${JSON.stringify({ status: 'RESTORE_CONSISTENT', migrations: migrations.rows.map(row => row.version), decryptedEnvelopes: decrypted, encryptedRecords, records: integrity.rows[0] })}\n`);
} finally { await pool.end(); }
