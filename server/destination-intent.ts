import { createHash } from 'node:crypto';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';
import { normalizeEvmAddress } from '../src/lib/evm-address.ts';
import { DESTINATION_CONSENT, DESTINATION_CONSENT_VERSION, FIXED_ROUTE_ID, type WalletReadinessIntent } from './wallet-intent.ts';

export type DestinationIntentPayload = {
  version: 1;
  intentId: string;
  requestId: string;
  ownerId: string;
  routeId: typeof FIXED_ROUTE_ID;
  source: WalletReadinessIntent['source'];
  destination: WalletReadinessIntent['destination'];
  amountZatoshis: '1000000';
  destinationAmountAtomic: '1000000';
  consentVersion: typeof DESTINATION_CONSENT_VERSION;
  consentStatement: typeof DESTINATION_CONSENT;
  confirmedAt: string;
  expiresAt: string;
  walletControlVerification: 'not-performed';
};

export function destinationIntentContext(intentId: string): string { return `destination-intent:${intentId}`; }

export function canonicalDestinationIntent(payload: DestinationIntentPayload): string {
  return JSON.stringify({
    version: payload.version, intentId: payload.intentId, requestId: payload.requestId, ownerId: payload.ownerId,
    routeId: payload.routeId, source: payload.source,
    destination: { ...payload.destination, address: payload.destination.address.toLowerCase() },
    amountZatoshis: payload.amountZatoshis, destinationAmountAtomic: payload.destinationAmountAtomic,
    consentVersion: payload.consentVersion, consentStatement: payload.consentStatement,
    confirmedAt: payload.confirmedAt, expiresAt: payload.expiresAt, walletControlVerification: payload.walletControlVerification,
  });
}

export function digestDestinationIntent(payload: DestinationIntentPayload): Buffer {
  return createHash('sha256').update(canonicalDestinationIntent(payload)).digest();
}

export function destinationRecipientFingerprint(address: string): Buffer {
  return createHash('sha256').update(normalizeEvmAddress(address).toLowerCase()).digest();
}

export function createDestinationIntentPayload(input: {
  intentId: string; requestId: string; ownerId: string; intent: WalletReadinessIntent; confirmedAt: string; expiresAt: string;
}): DestinationIntentPayload {
  return {
    version: 1, intentId: input.intentId, requestId: input.requestId, ownerId: input.ownerId, routeId: FIXED_ROUTE_ID,
    source: input.intent.source,
    destination: { ...input.intent.destination, address: normalizeEvmAddress(input.intent.destination.address), contract: BASE_USDC },
    amountZatoshis: '1000000', destinationAmountAtomic: '1000000', consentVersion: DESTINATION_CONSENT_VERSION,
    consentStatement: DESTINATION_CONSENT, confirmedAt: input.confirmedAt, expiresAt: input.expiresAt, walletControlVerification: 'not-performed',
  };
}

export function assertDestinationPayload(payload: DestinationIntentPayload): void {
  if (payload.version !== 1 || payload.routeId !== FIXED_ROUTE_ID || payload.amountZatoshis !== '1000000' || payload.destinationAmountAtomic !== '1000000') throw new Error('Destination intent route terms are invalid');
  if (payload.destination.network !== 'base-sepolia' || payload.destination.chainId !== 84532 || payload.destination.contract.toLowerCase() !== BASE_USDC.toLowerCase()) throw new Error('Destination intent network or token is invalid');
  if (payload.source.network !== 'zcash-testnet' || payload.source.pool !== 'ironwood') throw new Error('Destination intent source privacy terms are invalid');
  normalizeEvmAddress(payload.destination.address);
  if (payload.consentVersion !== DESTINATION_CONSENT_VERSION || payload.consentStatement !== DESTINATION_CONSENT || payload.walletControlVerification !== 'not-performed') throw new Error('Destination intent consent evidence is invalid');
}
