import { createHash, randomUUID } from 'node:crypto';
import { getAddress, isAddress } from 'viem';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';

export const TEST_QUOTE_CHAIN_ID = 84532 as const;
export const TEST_QUOTE_TOKEN_CONTRACT = BASE_USDC;

export const TEST_VARIABLE_QUOTES_FLAG = 'ZECATHON_TEST_VARIABLE_QUOTES_ENABLED';

export type ApprovedTestRate = Readonly<{
  providerId: string;
  approvalId: string;
  approvedAt: string;
  expiresAt: string;
  destinationAtomicNumerator: string;
  sourceAtomicDenominator: string;
  feeBps: number;
  fixedFeeDestinationAtomic: string;
  minimumDestinationAtomic: string;
  minimumSourceAtomic: string;
  maximumSourceAtomic: string;
  liquidityCapacityDestinationAtomic: string;
}>;

export type TestVariableQuote = Readonly<{
  quoteId: string;
  orderId: string;
  destinationRecipient: string;
  destinationChainId: typeof TEST_QUOTE_CHAIN_ID;
  destinationTokenContract: string;
  bindingFingerprint: string;
  providerId: string;
  providerApprovalId: string;
  sourceAtomic: string;
  grossDestinationAtomic: string;
  feeDestinationAtomic: string;
  destinationAtomic: string;
  rounding: 'gross-floor-fee-ceiling';
  rateKind: 'operator-approved-test-rate-not-market-price';
  createdAt: string;
  expiresAt: string;
  status: 'RESERVED' | 'CONSUMED';
}>;

type ReservedQuote = Omit<TestVariableQuote, 'status'> & {
  destinationAtomicReserved: bigint;
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
};

export function unsignedAtomic(label: string, value: string, allowZero = false): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an unsigned base-10 integer`);
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

export function exactEvmRecipient(value: string): string {
  if (!isAddress(value, { strict: true })) throw new Error('Destination recipient must be a full EIP-55 address');
  return getAddress(value);
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function bindingFingerprint(orderId: string, recipient: string, sourceAtomic: string, approvalId: string): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1, orderId, recipient, sourceAtomic, approvalId,
    destinationChainId: TEST_QUOTE_CHAIN_ID, destinationTokenContract: TEST_QUOTE_TOKEN_CONTRACT,
  })).digest('hex');
}

export function calculateApprovedTestQuote(rate: ApprovedTestRate, sourceAtomic: string): {
  source: bigint; gross: bigint; fee: bigint; destination: bigint;
} {
  const source = unsignedAtomic('Source amount', sourceAtomic);
  const gross = (source * unsignedAtomic('Rate numerator', rate.destinationAtomicNumerator))
    / unsignedAtomic('Rate denominator', rate.sourceAtomicDenominator);
  const fee = ceilDivide(gross * BigInt(rate.feeBps), 10_000n)
    + unsignedAtomic('Fixed fee', rate.fixedFeeDestinationAtomic, true);
  if (gross <= fee) throw new Error('Approved test rate produces no destination amount after fees');
  const destination = gross - fee;
  if (destination < unsignedAtomic('Minimum destination amount', rate.minimumDestinationAtomic)) {
    throw new Error('Approved test rate produces less than the minimum destination amount');
  }
  return { source, gross, fee, destination };
}

export class DisabledTestVariableQuoteEngine {
  readonly #rate: ApprovedTestRate;
  readonly #quoteLifetimeMs: number;
  readonly #capacity: bigint;
  readonly #quotesByOrder = new Map<string, ReservedQuote>();
  #reserved = 0n;

  constructor(input: { enabled?: boolean; rate: ApprovedTestRate; quoteLifetimeMs?: number }) {
    if (input.enabled !== true) throw new Error(`Test variable quotes are disabled; ${TEST_VARIABLE_QUOTES_FLAG} must be explicitly enabled in an isolated test process`);
    this.#rate = structuredClone(input.rate);
    this.#quoteLifetimeMs = input.quoteLifetimeMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(this.#quoteLifetimeMs) || this.#quoteLifetimeMs < 1_000 || this.#quoteLifetimeMs > 15 * 60_000) throw new Error('Quote lifetime must be between one second and fifteen minutes');
    this.#capacity = this.#validateRate(this.#rate);
  }

  static enabledFromEnvironment(environment: NodeJS.ProcessEnv = process.env): boolean {
    return environment[TEST_VARIABLE_QUOTES_FLAG] === '1';
  }

  get availableDestinationAtomic(): string {
    return (this.#capacity - this.#reserved).toString();
  }

  quote(input: { orderId: string; destinationRecipient: string; sourceAtomic: string; now?: number }): TestVariableQuote {
    const now = input.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Quote time is invalid');
    this.releaseExpired(now);
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(input.orderId)) throw new Error('Quote requires an exact UUID order binding');
    if (now < Date.parse(this.#rate.approvedAt)) throw new Error('Approved provider rate is not active yet');
    const recipient = exactEvmRecipient(input.destinationRecipient);
    const source = unsignedAtomic('Source amount', input.sourceAtomic);
    const minimum = unsignedAtomic('Minimum source amount', this.#rate.minimumSourceAtomic);
    const maximum = unsignedAtomic('Maximum source amount', this.#rate.maximumSourceAtomic);
    if (source < minimum || source > maximum) throw new Error('Source amount is outside the approved test range');

    const prior = this.#quotesByOrder.get(input.orderId);
    if (prior && prior.status === 'RESERVED') {
      const expected = bindingFingerprint(input.orderId, recipient, source.toString(), this.#rate.approvalId);
      if (prior.bindingFingerprint !== expected) throw new Error('Order already has a quote with different immutable terms');
      return this.#publicQuote(prior);
    }
    if (prior) throw new Error('Order quote allocation is terminal and cannot be replaced');

    const { gross, fee, destination } = calculateApprovedTestQuote(this.#rate, source.toString());
    if (destination > this.#capacity - this.#reserved) throw new Error('Approved test liquidity capacity is unavailable');

    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(Math.min(now + this.#quoteLifetimeMs, Date.parse(this.#rate.expiresAt))).toISOString();
    if (Date.parse(expiresAt) <= now) throw new Error('Approved provider rate has expired');
    const quote: ReservedQuote = {
      quoteId: randomUUID(), orderId: input.orderId, destinationRecipient: recipient,
      destinationChainId: TEST_QUOTE_CHAIN_ID, destinationTokenContract: TEST_QUOTE_TOKEN_CONTRACT,
      bindingFingerprint: bindingFingerprint(input.orderId, recipient, source.toString(), this.#rate.approvalId),
      providerId: this.#rate.providerId, providerApprovalId: this.#rate.approvalId,
      sourceAtomic: source.toString(), grossDestinationAtomic: gross.toString(),
      feeDestinationAtomic: fee.toString(), destinationAtomic: destination.toString(),
      rounding: 'gross-floor-fee-ceiling', rateKind: 'operator-approved-test-rate-not-market-price',
      createdAt, expiresAt, status: 'RESERVED', destinationAtomicReserved: destination,
    };
    this.#reserved += destination;
    this.#quotesByOrder.set(input.orderId, quote);
    return this.#publicQuote(quote);
  }

  consume(input: { quoteId: string; orderId: string; destinationRecipient: string; now?: number }): TestVariableQuote {
    const now = input.now ?? Date.now();
    this.releaseExpired(now);
    const quote = this.#quotesByOrder.get(input.orderId);
    if (!quote || quote.quoteId !== input.quoteId || quote.destinationRecipient !== exactEvmRecipient(input.destinationRecipient)) throw new Error('Quote does not match the exact order and recipient binding');
    if (quote.status !== 'RESERVED' || Date.parse(quote.expiresAt) <= now) throw new Error('Quote reservation is not active');
    quote.status = 'CONSUMED';
    return this.#publicQuote(quote);
  }

  releaseExpired(now = Date.now()): number {
    let released = 0;
    for (const quote of this.#quotesByOrder.values()) {
      if (quote.status === 'RESERVED' && Date.parse(quote.expiresAt) <= now) {
        quote.status = 'RELEASED';
        this.#reserved -= quote.destinationAtomicReserved;
        released += 1;
      }
    }
    return released;
  }

  #validateRate(rate: ApprovedTestRate): bigint {
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(rate.providerId)) throw new Error('Approved provider id is invalid');
    if (!rate.approvalId.trim()) throw new Error('Provider approval id is required');
    const approvedAt = Date.parse(rate.approvedAt); const expiresAt = Date.parse(rate.expiresAt);
    if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || expiresAt <= approvedAt) throw new Error('Provider approval window is invalid');
    unsignedAtomic('Rate numerator', rate.destinationAtomicNumerator);
    unsignedAtomic('Rate denominator', rate.sourceAtomicDenominator);
    const minimum = unsignedAtomic('Minimum source amount', rate.minimumSourceAtomic);
    const maximum = unsignedAtomic('Maximum source amount', rate.maximumSourceAtomic);
    if (maximum < minimum) throw new Error('Maximum source amount is below the minimum');
    if (!Number.isSafeInteger(rate.feeBps) || rate.feeBps < 0 || rate.feeBps > 10_000) throw new Error('Fee basis points are invalid');
    unsignedAtomic('Fixed fee', rate.fixedFeeDestinationAtomic, true);
    unsignedAtomic('Minimum destination amount', rate.minimumDestinationAtomic);
    return unsignedAtomic('Liquidity capacity', rate.liquidityCapacityDestinationAtomic);
  }

  #publicQuote(quote: ReservedQuote): TestVariableQuote {
    if (quote.status === 'RELEASED') throw new Error('Released quotes are not actionable');
    const status: TestVariableQuote['status'] = quote.status;
    const { destinationAtomicReserved: _reserved, status: _internalStatus, ...visible } = quote;
    return structuredClone({ ...visible, status });
  }
}
