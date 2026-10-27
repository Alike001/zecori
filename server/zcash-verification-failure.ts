import type { RelayEvidencePayload } from './private-verification-protocol.ts';

export function classifyZcashVerificationFailure(error: unknown): NonNullable<RelayEvidencePayload['reasonCode']> {
  const message = error instanceof Error ? error.message : '';
  if (/reorg|canonical/i.test(message)) return 'REORG_DETECTED';
  if (/sync|history|enhance|stale|chain tip|upstream.*(?:warning|refusal)/i.test(message)) return 'SYNC_INCOMPLETE';
  if (/not found|missing/i.test(message)) return 'NOT_FOUND';
  if (/exactly one|ambiguous|match/i.test(message)) return 'EVIDENCE_AMBIGUOUS';
  return 'RPC_UNAVAILABLE';
}
