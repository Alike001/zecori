import { PUBLIC_ROUTE_REGISTRY, registeredRouteIds } from './route-registry.ts';

const WRONG_NETWORK = /\b(?:bitcoin|btc|ethereum|eth|solana|sol|doge|avalanche|polygon|arbitrum|optimism|mainnet|goerli)\b/gi;
const TRANSACTION_HASH = /\b(?:0x)?[0-9a-f]{64}\b/i;
const TRANSACTION_COMPLETION_CLAIM = /\b(?:transaction|swap|payment|order)\b[^.!?]{0,40}\b(?:completed|settled|executed|paid|confirmed)\b|\b(?:completed|settled|executed|paid|confirmed)\b[^.!?]{0,40}\b(?:transaction|swap|payment|order)\b/i;
const LIVE_QUOTE_CLAIM = /\b(?:i|we|the assistant)\s+(?:can|will|am able to|are able to)\s+(?:get|fetch|retrieve|provide|compare|find)\s+(?:a\s+)?live\s+(?:market\s+)?quotes?\b|\blive\s+(?:market\s+)?quotes?\s+(?:are|is)\s+(?:available|supported)\b/i;
const ORDER_ACTION_CLAIM = /\b(?:i|we|the assistant)\s+(?:can|will|am able to|are able to)\s+(?:place|create|execute|submit|authorize)\s+(?:an?\s+)?(?:orders?|swaps?|transactions?|payments?)\b|\bje\s+peux\s+(?:cr[ée]er|ex[ée]cuter|soumettre|autoriser)\s+(?:une?\s+)?(?:commande|transaction|paiement)|(?:يمكنني|نستطيع)\s+(?:إنشاء|تنفيذ|إرسال|تفويض)\s+(?:طلب|معاملة|دفعة)/iu;
const ROUTE_ID_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/i;
const ROUTE_ID_LABEL = /^(?:route\s+(?:id|identifier)|(?:id|identifiant)\s+(?:de|du)\s+(?:la\s+)?route|معرف\s+المسار)$/iu;
const PROVIDER_LABEL = /^(?:provider|liquidity\s+provider|fournisseur|fournisseur\s+de\s+liquidit[ée]|مزود|مزود\s+السيولة)$/iu;
const EXACT_PRICING = [
  /\b1\s+TAZ\s*(?:=|equals?|is worth)\s*100\s+(?:test[-\s]+)?USDC\b/gi,
  /\b100\s+(?:test[-\s]+)?USDC\s+(?:per|for)\s+(?:1\s+)?TAZ\b/gi,
];

export type FinancialTextValidation = { valid: true; normalized: string } | { valid: false; normalized: string; reason: string };
export type FinancialNarrativeRule =
  | 'empty-output' | 'unsupported-network' | 'unverified-transaction-hash'
  | 'unverified-transaction-completion-claim'
  | 'unavailable-live-quote-claim' | 'unavailable-order-action-claim'
  | 'incorrect-fixed-pricing' | 'incorrect-taz-amount' | 'incorrect-usdc-amount'
  | 'incorrect-route-id' | 'unregistered-provider-claim' | 'incorrect-destination-chain-id' | 'missing-taz-amount' | 'missing-usdc-amount'
  | 'missing-destination-chain' | 'missing-test-only-classification' | 'missing-no-spending-authority';
export type PublicNarrativeFacts = {
  tazAmounts: string[];
  usdcAmounts: string[];
  exactFixedPricing: boolean;
  routeId?: string;
  routeIds: string[];
  providerIds: string[];
  destinationChainIds: string[];
  mentionsBaseSepolia: boolean;
  statesNoLiveMarketQuote: boolean;
  statesNoSpendingAuthority: boolean;
  unsupportedNetworkClaims: string[];
};
export type FinancialNarrativeDiagnostic = { valid: boolean; normalized: string; failedRule?: FinancialNarrativeRule; facts: PublicNarrativeFacts };

export function normalizeFinancialText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{Cf}+/gu, ' ')
    .replace(/[\p{Z}\s]+/gu, ' ')
    .replace(/[|*_~`#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalFactText(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function markdownCells(line: string): string[] | undefined {
  if (!line.includes('|')) return undefined;
  const cells = line.split('|');
  if (!cells[0].trim()) cells.shift();
  if (!cells.at(-1)?.trim()) cells.pop();
  return cells.map(cell => cell.normalize('NFKC').replace(/[\\*_~`#]+/g, ' ').replace(/\s+/g, ' ').trim());
}

function isMarkdownDivider(cells: string[] | undefined): boolean {
  return Boolean(cells?.length && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, ''))));
}

function explicitLabeledValues(value: string, label: RegExp, inlineValuePattern: string): string[] {
  const normalizedLines = value.normalize('NFKC').replace(/\p{Cf}+/gu, ' ').split(/\r?\n/);
  const found: string[] = [];
  const tableLineIndexes = new Set<number>();
  for (let index = 0; index < normalizedLines.length - 2; index += 1) {
    const headings = markdownCells(normalizedLines[index]);
    const divider = markdownCells(normalizedLines[index + 1]);
    if (!headings || !isMarkdownDivider(divider)) continue;
    const column = headings.findIndex(heading => label.test(canonicalFactText(heading)));
    if (column < 0) continue;
    tableLineIndexes.add(index); tableLineIndexes.add(index + 1);
    for (let row = index + 2; row < normalizedLines.length; row += 1) {
      const cells = markdownCells(normalizedLines[row]);
      if (!cells || cells.length !== headings.length || isMarkdownDivider(cells)) break;
      tableLineIndexes.add(row);
      if (cells[column]) found.push(cells[column]);
    }
  }

  const prose = normalizedLines.filter((_, index) => !tableLineIndexes.has(index)).join('\n').replace(/[\\*_~`#]+/g, ' ');
  const labelSource = label.source.replace(/^\^|\$$/g, '');
  const inline = new RegExp(`(?:${labelSource})\\s*(?:(?:is|est|هو)\\s+|[:=：–—-]\\s*|\\s+)(${inlineValuePattern})`, 'giu');
  for (const match of prose.matchAll(inline)) found.push(match[1]);
  return [...new Set(found.map(item => item.trim().toLowerCase()))];
}

export function extractStatedRouteIds(value: string): string[] {
  return explicitLabeledValues(value, ROUTE_ID_LABEL, '[a-z0-9]+(?:-[a-z0-9]+)+').filter(candidate => ROUTE_ID_TOKEN.test(candidate));
}

export function extractStatedProviderIds(value: string): string[] {
  return explicitLabeledValues(value, PROVIDER_LABEL, '[\\p{L}\\p{N}][\\p{L}\\p{N}._-]*');
}

function assetAmounts(value: string, asset: 'TAZ' | 'USDC'): string[] {
  const matches = value.matchAll(new RegExp(`(?<![\\d.,])(\\d+(?:[.,]\\d+)?)\\s+(?:test[-\\s]+)?${asset}\\b`, 'gi'));
  return [...matches].map(match => match[1].replace(',', '.'));
}

function unsupportedNetworkClaims(value: string): string[] {
  const claims: string[] = [];
  for (const match of value.matchAll(WRONG_NETWORK)) {
    const name = match[0];
    const index = match.index ?? 0;
    const before = value.slice(Math.max(0, index - 55), index);
    const after = value.slice(index + name.length, index + name.length + 55);
    const negatedBefore = /\b(?:not|no|never|without|unsupported|unavailable|exclude[sd]?|does not|doesn't|cannot|can't)\b[^.!?]{0,45}$/i.test(before);
    const negatedAfter = /^[^.!?]{0,45}\b(?:not supported|unsupported|unavailable|excluded)\b/i.test(after);
    if (!negatedBefore && !negatedAfter) claims.push(name.toLowerCase());
  }
  return [...new Set(claims)];
}

function pricingPairs(value: string): Array<{ taz: string; usdc: string }> {
  const forward = [...value.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s+TAZ\s*(?:=|equals?|is worth)\s*(\d+(?:[.,]\d+)?)\s+(?:test[-\s]+)?USDC\b/gi)]
    .map(match => ({ taz: match[1].replace(',', '.'), usdc: match[2].replace(',', '.') }));
  const reverse = [...value.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s+(?:test[-\s]+)?USDC\s+(?:per|for)\s+(?:(\d+(?:[.,]\d+)?)\s+)?TAZ\b/gi)]
    .map(match => ({ taz: (match[2] ?? '1').replace(',', '.'), usdc: match[1].replace(',', '.') }));
  return [...forward, ...reverse];
}

export function diagnoseFinancialNarrative(text: string, requireSupportedRouteFacts = false, allowVerifiedTransactionCompletion = false): FinancialNarrativeDiagnostic {
  const normalized = normalizeFinancialText(text);
  const unsupportedClaims = unsupportedNetworkClaims(normalized);
  const prices = pricingPairs(normalized);
  const routeAmountsOnly = EXACT_PRICING.reduce((value, pattern) => value.replace(pattern, ' '), normalized);
  const tazAmounts = assetAmounts(routeAmountsOnly, 'TAZ');
  const usdcAmounts = assetAmounts(routeAmountsOnly, 'USDC');
  const routeIds = extractStatedRouteIds(text);
  const routeId = routeIds[0];
  const providerIds = extractStatedProviderIds(text);
  const canonical = canonicalFactText(normalized);
  const destinationChainIds = [...normalized.matchAll(/\bchain\s*id\s*:?\s*(\d+)\b/gi)].map(match => match[1]);
  const facts: PublicNarrativeFacts = {
    tazAmounts,
    usdcAmounts,
    exactFixedPricing: prices.some(price => price.taz === '1' && price.usdc === '100'),
    ...(routeId ? { routeId } : {}),
    routeIds,
    providerIds,
    destinationChainIds,
    mentionsBaseSepolia: /\bbase sepolia\b/.test(canonical),
    statesNoLiveMarketQuote: /(?:not|no)\s+(?:a\s+)?(?:live|real-time)\s+(?:market\s+)?(?:quote|pricing|rate)|no\s+live\s+quote\s+feed|fixed\s+(?:test\s+)?(?:terms|rate)|test-only/i.test(normalized),
    statesNoSpendingAuthority: /(?:no|without)\s+spending authority|cannot\s+(?:create|place|execute|submit|authorize)|(?:do|does|did)\s+not\s+(?:create|place|execute|submit|authorize)|no (?:orders?|payments?) (?:is|are|was|were) (?:created|authorized)(?:\s+or\s+authorized)?|no action (?:is|was) taken|informational only|preview only/i.test(normalized),
    unsupportedNetworkClaims: unsupportedClaims,
  };
  const fail = (failedRule: FinancialNarrativeRule): FinancialNarrativeDiagnostic => ({ valid: false, normalized, failedRule, facts });
  if (!normalized) return fail('empty-output');
  if (unsupportedClaims.length) return fail('unsupported-network');
  if (TRANSACTION_HASH.test(normalized)) return fail('unverified-transaction-hash');
  if (!allowVerifiedTransactionCompletion && TRANSACTION_COMPLETION_CLAIM.test(normalized)) return fail('unverified-transaction-completion-claim');
  if (LIVE_QUOTE_CLAIM.test(normalized)) return fail('unavailable-live-quote-claim');
  if (ORDER_ACTION_CLAIM.test(normalized)) return fail('unavailable-order-action-claim');
  if (prices.some(price => price.taz !== '1' || price.usdc !== '100')) return fail('incorrect-fixed-pricing');
  if (tazAmounts.some(amount => amount !== '0.01')) return fail('incorrect-taz-amount');
  if (usdcAmounts.some(amount => !/^1(?:\.0+)?$/.test(amount))) return fail('incorrect-usdc-amount');
  const allowedRouteIds = new Set(registeredRouteIds().map(id => id.toLowerCase()));
  if (routeIds.some(id => !allowedRouteIds.has(id))) return fail('incorrect-route-id');
  const allowedProviderIds = new Set(PUBLIC_ROUTE_REGISTRY.map(route => route.terms.provider.id.toLowerCase()));
  allowedProviderIds.add('trusted');
  if (providerIds.some(id => !allowedProviderIds.has(id))) return fail('unregistered-provider-claim');
  if (destinationChainIds.some(chainId => chainId !== '84532')) return fail('incorrect-destination-chain-id');

  if (requireSupportedRouteFacts) {
    if (!tazAmounts.includes('0.01')) return fail('missing-taz-amount');
    if (!usdcAmounts.some(amount => /^1(?:\.0+)?$/.test(amount))) return fail('missing-usdc-amount');
    if (!facts.mentionsBaseSepolia) return fail('missing-destination-chain');
    if (!facts.statesNoLiveMarketQuote) return fail('missing-test-only-classification');
    if (!facts.statesNoSpendingAuthority) return fail('missing-no-spending-authority');
  }
  return { valid: true, normalized, facts };
}

export function validateFinancialNarrative(text: string, requireSupportedRouteFacts = false, allowVerifiedTransactionCompletion = false): FinancialTextValidation {
  const diagnostic = diagnoseFinancialNarrative(text, requireSupportedRouteFacts, allowVerifiedTransactionCompletion);
  return diagnostic.valid
    ? { valid: true, normalized: diagnostic.normalized }
    : { valid: false, normalized: diagnostic.normalized, reason: diagnostic.failedRule! };
}
