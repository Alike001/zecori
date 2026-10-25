import { BASE_USDC } from '../src/lib/order-coordinator.ts';
import { normalizeEvmAddress } from '../src/lib/evm-address.ts';

export const FIXED_ROUTE_ID = 'zcash-testnet-to-base-sepolia-fixed' as const;
export const DESTINATION_CONSENT_VERSION = 'base-destination-intent-v1' as const;
export const DESTINATION_CONSENT = 'I confirm this exact Base Sepolia address is the intended USDC recipient. This records my intent and does not prove that I control the wallet.' as const;

export type WalletReadinessIntent = {
  routeId: typeof FIXED_ROUTE_ID;
  source: { mode: 'connected-read-only' | 'external'; network: 'zcash-testnet'; pool: 'ironwood' };
  destination: { mode: 'connected-read-only' | 'manual'; network: 'base-sepolia'; chainId: 84532; contract: typeof BASE_USDC; address: string };
  amountZatoshis: '1000000';
  termsAccepted: true;
  destinationConsent: { version: typeof DESTINATION_CONSENT_VERSION; statement: typeof DESTINATION_CONSENT; confirmed: true };
};

function invalid(message: string, code = 'INVALID_WALLET_CONFIGURATION'): never {
  throw Object.assign(new Error(message), { code });
}

export function validateWalletReadinessIntent(body: Record<string, unknown>): WalletReadinessIntent {
  const allowed = new Set(['routeId', 'source', 'destination', 'amountZatoshis', 'termsAccepted', 'destinationConsent']);
  if (Object.keys(body).some(key => !allowed.has(key))) invalid('The request contains unsupported wallet fields.');
  if (body.routeId !== FIXED_ROUTE_ID || body.amountZatoshis !== '1000000' || body.termsAccepted !== true) {
    invalid('The request must accept the exact fixed test-route terms.');
  }
  if (!body.source || typeof body.source !== 'object' || Array.isArray(body.source)) invalid('A Zcash source wallet selection is required.');
  const source = body.source as Record<string, unknown>;
  if (!['connected-read-only', 'external'].includes(String(source.mode))) invalid('The Zcash wallet mode is unsupported.');
  if (source.network !== 'zcash-testnet') invalid('Only Zcash testnet source wallets are supported.', 'UNSUPPORTED_SOURCE_NETWORK');
  if (source.pool !== 'ironwood') invalid('Only shielded Ironwood source funds are supported.', 'UNSUPPORTED_SOURCE_POOL');

  if (!body.destination || typeof body.destination !== 'object' || Array.isArray(body.destination)) invalid('A Base destination wallet selection is required.');
  const destination = body.destination as Record<string, unknown>;
  if (!['connected-read-only', 'manual'].includes(String(destination.mode))) invalid('The Base wallet mode is unsupported.');
  if (destination.network !== 'base-sepolia' || destination.chainId !== 84532) invalid('Only Base Sepolia chain 84532 is supported.', 'UNSUPPORTED_DESTINATION_NETWORK');
  if (destination.contract !== BASE_USDC) invalid('Only the official Base Sepolia test-USDC contract is supported.', 'UNSUPPORTED_DESTINATION_TOKEN');
  let address: string;
  try { address = normalizeEvmAddress(String(destination.address ?? '')); }
  catch { invalid('A complete, non-zero Base Sepolia address with a valid mixed-case EIP-55 checksum is required.', 'INVALID_DESTINATION_RECIPIENT'); }
  const consent = body.destinationConsent as Record<string, unknown> | undefined;
  if (!consent || consent.version !== DESTINATION_CONSENT_VERSION || consent.statement !== DESTINATION_CONSENT || consent.confirmed !== true) {
    invalid('Explicit confirmation of the exact destination intent is required.', 'DESTINATION_CONSENT_REQUIRED');
  }
  return { ...(body as WalletReadinessIntent), destination: { ...(destination as WalletReadinessIntent['destination']), address } };
}

export function fixedWalletReadinessIntent(address: string, sourceMode: WalletReadinessIntent['source']['mode'] = 'external', destinationMode: WalletReadinessIntent['destination']['mode'] = 'manual'): WalletReadinessIntent {
  return validateWalletReadinessIntent({
    routeId: FIXED_ROUTE_ID, amountZatoshis: '1000000', termsAccepted: true,
    source: { mode: sourceMode, network: 'zcash-testnet', pool: 'ironwood' },
    destination: { mode: destinationMode, network: 'base-sepolia', chainId: 84532, contract: BASE_USDC, address },
    destinationConsent: { version: DESTINATION_CONSENT_VERSION, statement: DESTINATION_CONSENT, confirmed: true },
  });
}
