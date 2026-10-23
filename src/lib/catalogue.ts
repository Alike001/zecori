/** This file treats 1Click supported-token records as discovery data, never an executable route. */
export interface Token {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  contractAddress?: string;
}

export interface Catalogue {
  importedAt: string;
  tokens: Token[];
}

export const NATIVE_ZEC_ID = 'nep141:zec.omft.near';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNativeZec(token: Token): boolean {
  return token.assetId === NATIVE_ZEC_ID && token.blockchain === 'zec' && token.symbol.toUpperCase() === 'ZEC';
}

export function isValidToken(value: unknown): value is Token {
  if (!record(value)) return false;
  return typeof value.assetId === 'string' && value.assetId.length > 0 &&
    typeof value.symbol === 'string' && value.symbol.length > 0 &&
    typeof value.blockchain === 'string' && value.blockchain.length > 0 &&
    typeof value.decimals === 'number' && Number.isInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 36;
}

export function readCatalogue(value: unknown): Catalogue {
  if (!record(value) || typeof value.importedAt !== 'string' || !Array.isArray(value.tokens)) {
    throw new Error('Catalogue missing or malformed. Run: corepack pnpm import:catalogue');
  }
  const tokens: Token[] = [];
  const ids = new Set<string>();
  for (const raw of value.tokens) {
    if (!isValidToken(raw)) throw new Error('Invalid token in catalogue');
    if (ids.has(raw.assetId)) continue;
    ids.add(raw.assetId);
    tokens.push({
      assetId: raw.assetId, symbol: raw.symbol, blockchain: raw.blockchain,
      decimals: raw.decimals,
      ...(typeof raw.contractAddress === 'string' ? { contractAddress: raw.contractAddress } : {}),
    });
  }
  if (!tokens.some(isNativeZec)) throw new Error('Native Zcash source asset missing');
  return { importedAt: value.importedAt, tokens };
}

export function destinations(tokens: Token[], search: string, chain: string): Token[] {
  const q = search.trim().toLowerCase();
  return tokens.filter(t => t.assetId !== NATIVE_ZEC_ID)
    .filter(t => chain === 'all' || t.blockchain === chain)
    .filter(t => !q || `${t.symbol} ${t.blockchain} ${t.assetId} ${t.contractAddress ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
}

export function validZecAmount(amount: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amount)) return false;
  const num = Number(amount);
  return Number.isFinite(num) && num > 0 && num <= 21000000;
}
