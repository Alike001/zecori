import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { relayFingerprint, signRelayChallenge, signRelayEvidence, verifyRelayChallenge, verifyRelayEvidence, type RelayChallengePayload, type RelayEvidencePayload } from './private-verification-protocol.ts';

const coordinator = generateKeyPairSync('ed25519'); const verifier = generateKeyPairSync('ed25519');
const now = Date.parse('2026-10-24T12:00:00.000Z');
const request = { orderId: randomUUID(), transactionId: 'a'.repeat(64), receiver: 'utest1relayreceiver', amountZatoshis: '1000000', expectedDiversifierIndex: '42', minimumBlockHeight: 500, minimumBlockTime: 1_900_000_000, requiredPool: 'ironwood' as const, minimumConfirmations: 10 };
const payload: RelayChallengePayload = { version: 1, jobId: randomUUID(), verifierId: 'operator-zcash-01', phase: 'SOURCE_CONFIRMATION', nonce: 'b'.repeat(64), orderId: request.orderId, manifestFingerprint: 'c'.repeat(64), request, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 120_000).toISOString() };
const receipt = { orderId: request.orderId, transactionId: request.transactionId, network: 'zcash-testnet' as const, receiver: request.receiver, amount: '0.01', amountZatoshis: request.amountZatoshis, pool: 'ironwood' as const, status: 'mined' as const, confirmations: 12, blockHeight: 510, blockHash: 'd'.repeat(64), blockTime: 1_900_000_100, outputIndex: 0, diversifierIndex: '42', shielded: true as const, independentlyVerified: true as const };

function evidence(): RelayEvidencePayload {
  return { version: 1, jobId: payload.jobId, verifierId: payload.verifierId, phase: payload.phase, nonce: payload.nonce, orderId: payload.orderId, manifestFingerprint: payload.manifestFingerprint, requestFingerprint: relayFingerprint(payload.request), observedAt: new Date(now + 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), outcome: 'VERIFIED', evidence: receipt };
}

test('dual signatures bind fresh relay evidence to the exact order manifest and request', () => {
  const challenge = signRelayChallenge(payload, coordinator.privateKey);
  verifyRelayChallenge(challenge, coordinator.publicKey, payload.verifierId, now + 2_000);
  verifyRelayEvidence(signRelayEvidence(evidence(), verifier.privateKey), challenge, verifier.publicKey, now + 2_000);
});

test('rejects forgery, replay binding changes, stale evidence, and incorrect settlement facts', () => {
  const challenge = signRelayChallenge(payload, coordinator.privateKey);
  const forged = signRelayEvidence(evidence(), coordinator.privateKey);
  assert.throws(() => verifyRelayEvidence(forged, challenge, verifier.publicKey, now + 2_000), /signature/);
  const wrongOrder = { ...evidence(), orderId: randomUUID() };
  assert.throws(() => verifyRelayEvidence(signRelayEvidence(wrongOrder, verifier.privateKey), challenge, verifier.publicKey, now + 2_000), /orderId binding/);
  const wrongAmount = { ...evidence(), evidence: { ...receipt, amountZatoshis: '999999' } };
  assert.throws(() => verifyRelayEvidence(signRelayEvidence(wrongAmount, verifier.privateKey), challenge, verifier.publicKey, now + 2_000), /amount mismatch/);
  assert.throws(() => verifyRelayEvidence(signRelayEvidence(evidence(), verifier.privateKey), challenge, verifier.publicKey, now + 600_000), /stale|lifetime/);
});

test('unresolved evidence is signed but carries no guessed wallet facts', () => {
  const challenge = signRelayChallenge(payload, coordinator.privateKey);
  const unresolved: RelayEvidencePayload = { ...evidence(), outcome: 'UNRESOLVED', evidence: undefined, reasonCode: 'RPC_UNAVAILABLE' };
  verifyRelayEvidence(signRelayEvidence(unresolved, verifier.privateKey), challenge, verifier.publicKey, now + 2_000);
});
