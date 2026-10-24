import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import type { ZcashShieldedReceipt } from '../src/lib/read-only-verification.ts';
import type { ZcashVerificationRequest } from './zcash-verifier.ts';

export const RELAY_DOMAIN = 'zecathon-private-verification-relay-v1';
export const RELAY_MAX_LIFETIME_MS = 5 * 60_000;
export const RELAY_CLOCK_SKEW_MS = 30_000;

export type RelayPhase = 'SOURCE_DETECTION' | 'SOURCE_CONFIRMATION';
export type RelayChallengePayload = {
  version: 1;
  jobId: string;
  verifierId: string;
  phase: RelayPhase;
  nonce: string;
  orderId: string;
  manifestFingerprint: string;
  request: ZcashVerificationRequest;
  issuedAt: string;
  expiresAt: string;
};
export type SignedRelayChallenge = { payload: RelayChallengePayload; coordinatorSignature: string };
export type RelayEvidencePayload = {
  version: 1;
  jobId: string;
  verifierId: string;
  phase: RelayPhase;
  nonce: string;
  orderId: string;
  manifestFingerprint: string;
  requestFingerprint: string;
  observedAt: string;
  expiresAt: string;
  outcome: 'VERIFIED' | 'UNRESOLVED';
  evidence?: ZcashShieldedReceipt;
  reasonCode?: 'RPC_UNAVAILABLE' | 'SYNC_INCOMPLETE' | 'EVIDENCE_AMBIGUOUS' | 'REORG_DETECTED' | 'NOT_FOUND';
};
export type SignedRelayEvidence = { payload: RelayEvidencePayload; verifierSignature: string };

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}

export function canonicalRelayJson(value: unknown): string { return JSON.stringify(normalize(value)); }
export function relayFingerprint(value: unknown): string { return createHash('sha256').update(canonicalRelayJson(value)).digest('hex'); }

function signingBytes(kind: 'challenge' | 'evidence', payload: unknown): Buffer {
  return Buffer.from(`${RELAY_DOMAIN}:${kind}:${canonicalRelayJson(payload)}`, 'utf8');
}

function exactUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${label} is invalid`);
}

function time(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} must be canonical ISO-8601`);
  return parsed;
}

function identity(value: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value)) throw new Error('Verifier identity is invalid');
}

function signature(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 64 || decoded.toString('base64') !== value) throw new Error('Relay signature is invalid');
  return decoded;
}

function key(value: KeyObject | string | Buffer, kind: 'private' | 'public'): KeyObject {
  return typeof value !== 'string' && !Buffer.isBuffer(value) ? value : kind === 'private' ? createPrivateKey(value) : createPublicKey(value);
}

function validateWindow(issuedAt: string, expiresAt: string, now: number): void {
  const issued = time(issuedAt, 'Relay issuedAt'); const expires = time(expiresAt, 'Relay expiresAt');
  if (expires <= issued || expires - issued > RELAY_MAX_LIFETIME_MS) throw new Error('Relay lifetime is invalid');
  if (issued > now + RELAY_CLOCK_SKEW_MS) throw new Error('Relay message is from the future');
  if (expires <= now - RELAY_CLOCK_SKEW_MS) throw new Error('Relay message is stale');
}

export function signRelayChallenge(payload: RelayChallengePayload, coordinatorPrivateKey: KeyObject | string | Buffer): SignedRelayChallenge {
  validateChallengeShape(payload, Date.parse(payload.issuedAt));
  return { payload, coordinatorSignature: sign(null, signingBytes('challenge', payload), key(coordinatorPrivateKey, 'private')).toString('base64') };
}

export function verifyRelayChallenge(challenge: SignedRelayChallenge, coordinatorPublicKey: KeyObject | string | Buffer, expectedVerifierId: string, now = Date.now()): void {
  validateChallengeShape(challenge.payload, now);
  if (challenge.payload.verifierId !== expectedVerifierId) throw new Error('Relay challenge targets a different verifier identity');
  if (!verify(null, signingBytes('challenge', challenge.payload), key(coordinatorPublicKey, 'public'), signature(challenge.coordinatorSignature))) throw new Error('Relay coordinator signature is invalid');
}

export function signRelayEvidence(payload: RelayEvidencePayload, verifierPrivateKey: KeyObject | string | Buffer): SignedRelayEvidence {
  validateEvidenceShape(payload, Date.parse(payload.observedAt));
  return { payload, verifierSignature: sign(null, signingBytes('evidence', payload), key(verifierPrivateKey, 'private')).toString('base64') };
}

export function verifyRelayEvidence(envelope: SignedRelayEvidence, challenge: SignedRelayChallenge, verifierPublicKey: KeyObject | string | Buffer, now = Date.now()): void {
  validateEvidenceShape(envelope.payload, now);
  const evidence = envelope.payload; const expected = challenge.payload;
  if (!verify(null, signingBytes('evidence', evidence), key(verifierPublicKey, 'public'), signature(envelope.verifierSignature))) throw new Error('Relay verifier signature is invalid');
  for (const field of ['jobId', 'verifierId', 'phase', 'nonce', 'orderId', 'manifestFingerprint'] as const) if (evidence[field] !== expected[field]) throw new Error(`Relay ${field} binding mismatch`);
  if (evidence.requestFingerprint !== relayFingerprint(expected.request)) throw new Error('Relay request binding mismatch');
  if (time(evidence.observedAt, 'Relay observedAt') < time(expected.issuedAt, 'Relay issuedAt') - RELAY_CLOCK_SKEW_MS || time(evidence.expiresAt, 'Relay expiresAt') > time(expected.expiresAt, 'Challenge expiresAt')) throw new Error('Relay evidence is outside the challenge window');
  if (evidence.outcome === 'VERIFIED') validateExactEvidence(expected.request, evidence.evidence!);
}

function validateChallengeShape(payload: RelayChallengePayload, now: number): void {
  if (payload.version !== 1) throw new Error('Relay challenge version is unsupported');
  exactUuid(payload.jobId, 'Relay job ID'); exactUuid(payload.orderId, 'Relay order ID'); identity(payload.verifierId);
  if (!['SOURCE_DETECTION', 'SOURCE_CONFIRMATION'].includes(payload.phase)) throw new Error('Relay phase is invalid');
  if (!/^[0-9a-f]{64}$/.test(payload.nonce) || !/^[0-9a-f]{64}$/.test(payload.manifestFingerprint)) throw new Error('Relay challenge binding is invalid');
  if (payload.request.orderId !== payload.orderId) throw new Error('Relay request order binding mismatch');
  validateWindow(payload.issuedAt, payload.expiresAt, now);
}

function validateEvidenceShape(payload: RelayEvidencePayload, now: number): void {
  if (payload.version !== 1) throw new Error('Relay evidence version is unsupported');
  exactUuid(payload.jobId, 'Relay job ID'); exactUuid(payload.orderId, 'Relay order ID'); identity(payload.verifierId);
  if (!['SOURCE_DETECTION', 'SOURCE_CONFIRMATION'].includes(payload.phase)) throw new Error('Relay phase is invalid');
  if (!/^[0-9a-f]{64}$/.test(payload.nonce) || !/^[0-9a-f]{64}$/.test(payload.manifestFingerprint) || !/^[0-9a-f]{64}$/.test(payload.requestFingerprint)) throw new Error('Relay evidence binding is invalid');
  const observed = time(payload.observedAt, 'Relay observedAt'); const expires = time(payload.expiresAt, 'Relay expiresAt');
  if (expires <= observed || expires - observed > RELAY_MAX_LIFETIME_MS || observed > now + RELAY_CLOCK_SKEW_MS || expires <= now - RELAY_CLOCK_SKEW_MS) throw new Error('Relay evidence lifetime is invalid or stale');
  if (payload.outcome === 'VERIFIED') {
    if (!payload.evidence || payload.reasonCode) throw new Error('Verified relay evidence has an invalid result shape');
  } else if (payload.outcome === 'UNRESOLVED') {
    if (payload.evidence || !payload.reasonCode) throw new Error('Unresolved relay evidence has an invalid result shape');
  } else throw new Error('Relay evidence outcome is invalid');
}

function exactString(left: string | undefined, right: string | undefined, label: string): void {
  const a = Buffer.from(left ?? ''); const b = Buffer.from(right ?? '');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error(`Relay evidence ${label} mismatch`);
}

function validateExactEvidence(request: ZcashVerificationRequest, evidence: ZcashShieldedReceipt): void {
  exactString(evidence.orderId, request.orderId, 'order');
  exactString(evidence.transactionId.toLowerCase(), request.transactionId.toLowerCase(), 'transaction');
  exactString(evidence.receiver, request.receiver, 'receiver');
  exactString(evidence.amountZatoshis, BigInt(request.amountZatoshis).toString(), 'amount');
  exactString(evidence.diversifierIndex, request.expectedDiversifierIndex, 'diversifier');
  if (evidence.network !== 'zcash-testnet' || evidence.pool !== (request.requiredPool ?? 'ironwood') || evidence.status !== 'mined' || evidence.shielded !== true || evidence.independentlyVerified !== true) throw new Error('Relay evidence chain or pool mismatch');
  if (!Number.isSafeInteger(evidence.outputIndex) || evidence.outputIndex < 0 || !/^[0-9a-f]{64}$/.test(evidence.blockHash)) throw new Error('Relay evidence output identity is invalid');
  if (evidence.confirmations < (request.minimumConfirmations ?? 10)) throw new Error('Relay evidence lacks confirmations');
  if (request.minimumBlockHeight !== undefined && evidence.blockHeight < request.minimumBlockHeight) throw new Error('Relay evidence predates the allocation');
  if (request.minimumBlockTime !== undefined && evidence.blockTime < request.minimumBlockTime) throw new Error('Relay evidence predates the order');
}
