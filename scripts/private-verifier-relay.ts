#!/usr/bin/env node
import { createPublicKey } from 'node:crypto';
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';
import { PrivateVerificationRelay } from '../server/private-verification-relay.ts';
import { loadRelayPrivateKey, loadRelayPublicKey, requirePrivateRelayTransport } from '../server/relay-keys.ts';
import { relayFingerprint, signRelayEvidence, verifyRelayChallenge, type RelayEvidencePayload } from '../server/private-verification-protocol.ts';
import { verifyZcashTransaction } from '../server/zcash-verifier.ts';
import { classifyZcashVerificationFailure } from '../server/zcash-verification-failure.ts';

requirePrivateRelayTransport();
const verifierId = process.env.ZECATHON_RELAY_VERIFIER_ID;
if (!verifierId) throw new Error('ZECATHON_RELAY_VERIFIER_ID is required');
const [coordinatorPublicKey, verifierPrivateKey, encryption] = await Promise.all([
  loadRelayPublicKey(process.env.ZECATHON_RELAY_COORDINATOR_PUBLIC_KEY_FILE),
  loadRelayPrivateKey(process.env.ZECATHON_RELAY_VERIFIER_PRIVATE_KEY_FILE),
  loadEncryptionKeyring(process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE),
]);
const pool = createPostgresPool();
try {
  const relay = new PrivateVerificationRelay(pool, encryption, undefined, new Map([[verifierId, createPublicKey(verifierPrivateKey)]]));
  const challenge = await relay.claim(verifierId);
  if (!challenge) { process.stdout.write(`${JSON.stringify({ status: 'IDLE', verifierId })}\n`); }
  else {
    verifyRelayChallenge(challenge, coordinatorPublicKey, verifierId);
    const observedAt = new Date(); const expiresAt = new Date(Math.min(Date.parse(challenge.payload.expiresAt), observedAt.getTime() + 60_000));
    let payload: RelayEvidencePayload;
    try {
      const evidence = await verifyZcashTransaction(challenge.payload.request);
      payload = { version: 1, jobId: challenge.payload.jobId, verifierId, phase: challenge.payload.phase, nonce: challenge.payload.nonce, orderId: challenge.payload.orderId, manifestFingerprint: challenge.payload.manifestFingerprint, requestFingerprint: relayFingerprint(challenge.payload.request), observedAt: observedAt.toISOString(), expiresAt: expiresAt.toISOString(), outcome: 'VERIFIED', evidence };
    } catch (error) {
      payload = { version: 1, jobId: challenge.payload.jobId, verifierId, phase: challenge.payload.phase, nonce: challenge.payload.nonce, orderId: challenge.payload.orderId, manifestFingerprint: challenge.payload.manifestFingerprint, requestFingerprint: relayFingerprint(challenge.payload.request), observedAt: observedAt.toISOString(), expiresAt: expiresAt.toISOString(), outcome: 'UNRESOLVED', reasonCode: classifyZcashVerificationFailure(error) };
    }
    const state = await relay.submit(signRelayEvidence(payload, verifierPrivateKey));
    process.stdout.write(`${JSON.stringify({ status: state, jobId: challenge.payload.jobId, verifierId, privateEvidenceDisplayed: false })}\n`);
  }
} finally { await pool.end(); }
