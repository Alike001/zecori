import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  activateOrder, attachDestinationEvidence, attachSourceEvidence, authorizePayout, completeOrder,
  confirmSourceEvidence, createOrder, expireOrder, markUnresolved, queuePayoutApproval, receiptKey,
  recordPayoutSubmission, type CreateOrderInput, type DestinationReceiptLink, type PaymentOrder,
  type SourceReceiptLink,
} from '../src/lib/order-coordinator.ts';
import { verifyBaseSepoliaErc20Receipt, verifyZcashShieldedReceipt } from '../src/lib/read-only-verification.ts';
import { createFinalReceipt, toShareableReceipt, type FinalReceipt, type ShareableReceipt } from '../src/lib/receipt.ts';
import { verifyBaseSepoliaTransaction, type BaseVerificationRequest } from './base-sepolia-verifier.ts';
import { validateUnusedWalletBAddress, type ValidatedReceivingAddress } from './zcash-address-allocator.ts';
import { verifyZcashTransaction, type ZcashVerificationRequest } from './zcash-verifier.ts';
import { atomicCreatePrivateFile } from './private-storage.ts';
import { validateOperatorOrderBinding, type OperatorOrderBinding } from '../src/lib/operator-order.ts';

type StoredOrder = PaymentOrder & { ownerId: string };
export type PreparedOperatorOrder = {
  binding: OperatorOrderBinding;
  operatorId: string;
  manifestSignature: string;
  state: 'PREPARED' | 'ADDRESS_ALLOCATED' | 'ACTIVE';
  createdAt: string;
  allocationId?: string;
  activatedAt?: string;
  sourceWalletCheck?: { checkedAt: string; confirmedZatoshis: string; requiredZatoshis: string };
};
type Database = {
  orders: StoredOrder[];
  allocations: ValidatedReceivingAddress[];
  receiptIndex: Record<string, string>;
  receipts: FinalReceipt[];
  preparedOrders: PreparedOperatorOrder[];
};
type SourceVerifier = (request: ZcashVerificationRequest) => ReturnType<typeof verifyZcashTransaction>;
type DestinationVerifier = (request: BaseVerificationRequest) => ReturnType<typeof verifyBaseSepoliaTransaction>;
type AddressValidator = (address: string) => Promise<ValidatedReceivingAddress>;

export type OrderView = Pick<PaymentOrder,
  | 'id' | 'createdAt' | 'status' | 'sourceNetwork' | 'sourceAsset' | 'sourcePool' | 'sourceAmountZat' | 'amount'
  | 'destinationNetwork' | 'destinationChainId' | 'destinationAmountAtomic' | 'destinationAsset' | 'fixedRate'
  | 'expiresAt' | 'sourceMinimumConfirmations' | 'destinationMinimumConfirmations' | 'provider' | 'refundPolicy'
  | 'finalReceiptId' | 'resolutionReason'
> & {
  sourceReceiver: '[redacted]';
  destinationRecipient: '[redacted]';
  sourceReceipt?: { verification: 'independent'; verifier: 'zcash-rpc-adapter' };
  destinationReceipt?: { verification: 'independent'; verifier: 'base-rpc-adapter' };
  payoutAuthorization: { state: PaymentOrder['payoutAuthorization']['state'] };
};

export function defaultOrderDatabasePath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return process.env.ZECATHON_ORDER_DB || join(dataHome, 'zecathon-crosschain-app', 'orders.json');
}

function view(order: StoredOrder): OrderView {
  return {
    id: order.id, createdAt: order.createdAt, status: order.status,
    sourceNetwork: order.sourceNetwork, sourceAsset: order.sourceAsset, sourcePool: order.sourcePool,
    sourceAmountZat: order.sourceAmountZat, amount: order.amount,
    destinationNetwork: order.destinationNetwork, destinationChainId: order.destinationChainId,
    destinationAmountAtomic: order.destinationAmountAtomic, destinationAsset: order.destinationAsset,
    fixedRate: order.fixedRate, expiresAt: order.expiresAt,
    sourceMinimumConfirmations: order.sourceMinimumConfirmations,
    destinationMinimumConfirmations: order.destinationMinimumConfirmations,
    provider: order.provider, refundPolicy: order.refundPolicy,
    finalReceiptId: order.finalReceiptId, resolutionReason: order.resolutionReason,
    sourceReceiver: '[redacted]', destinationRecipient: '[redacted]',
    sourceReceipt: order.sourceReceipt && { verification: 'independent', verifier: 'zcash-rpc-adapter' },
    destinationReceipt: order.destinationReceipt && { verification: 'independent', verifier: 'base-rpc-adapter' },
    payoutAuthorization: { state: order.payoutAuthorization.state },
  };
}

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  return values.map((existing, current) => current === index ? value : existing);
}

function sourceLink(evidence: Awaited<ReturnType<SourceVerifier>>, verifiedAt = new Date().toISOString()): SourceReceiptLink {
  return {
    transactionId: evidence.transactionId, verifiedAt, verification: 'independent', verifier: 'zcash-rpc-adapter',
    amountZatoshis: evidence.amountZatoshis, outputIndex: evidence.outputIndex,
    diversifierIndex: evidence.diversifierIndex, blockHeight: evidence.blockHeight,
    blockHash: evidence.blockHash, blockTime: evidence.blockTime, confirmations: evidence.confirmations,
  };
}

export class FileOrderStore {
  private readonly file: string;
  private db: Database = { orders: [], allocations: [], receiptIndex: {}, receipts: [], preparedOrders: [] };
  private loaded = false;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(file = defaultOrderDatabasePath()) { this.file = file; }

  databasePath(): string { return this.file; }

  async initialize(): Promise<void> {
    const empty: Database = { orders: [], allocations: [], receiptIndex: {}, receipts: [], preparedOrders: [] };
    await atomicCreatePrivateFile(this.file, `${JSON.stringify(empty, null, 2)}\n`);
    this.db = empty;
    this.loaded = true;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const stored = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Database>;
      const validOrders = Array.isArray(stored.orders) && stored.orders.every(order =>
        order && typeof order.id === 'string' && typeof order.allocationId === 'string'
        && typeof order.sourceAmountZat === 'string' && typeof order.destinationAmountAtomic === 'string'
        && typeof order.payoutAuthorization?.state === 'string'
      );
      if (!validOrders || !Array.isArray(stored.receipts) || !stored.receiptIndex || Array.isArray(stored.receiptIndex) || typeof stored.receiptIndex !== 'object') throw new Error('Order database schema is invalid');
      if (stored.preparedOrders !== undefined && !Array.isArray(stored.preparedOrders)) throw new Error('Prepared operator order schema is invalid');
      this.db = { orders: stored.orders as StoredOrder[], allocations: stored.allocations ?? [], receiptIndex: stored.receiptIndex, receipts: stored.receipts, preparedOrders: stored.preparedOrders ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  private async save(next: Database): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.file), 0o700);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, this.file);
    await chmod(this.file, 0o600);
    const directory = await open(dirname(this.file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    this.db = next;
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action, action);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private find(ownerId: string, id: string): [number, StoredOrder] {
    const index = this.db.orders.findIndex(order => order.id === id && (order.ownerId === ownerId || order.ownerId === 'operator'));
    if (index < 0) throw new Error('Order not found');
    return [index, this.db.orders[index]];
  }

  async list(ownerId: string): Promise<OrderView[]> {
    await this.load();
    return this.db.orders.filter(order => order.ownerId === ownerId || order.ownerId === 'operator').map(view);
  }

  async prepareOperatorOrder(binding: OperatorOrderBinding, operatorId: string, manifestSignature: string, now = Date.now()): Promise<void> {
    await this.exclusive(async () => {
      await this.load();
      if (!operatorId.trim() || !/^[0-9a-f]{64}$/i.test(manifestSignature)) throw new Error('Signed operator order manifest is required');
      validateOperatorOrderBinding(binding, now);
      if (this.db.preparedOrders.some(item => item.binding.orderId === binding.orderId) || this.db.orders.some(item => item.id === binding.orderId)) throw new Error('Operator order ID already exists');
      if (this.db.preparedOrders.some(item => item.state === 'PREPARED') || this.db.orders.some(item => !['COMPLETED', 'FAILED', 'REFUNDED'].includes(item.status))) throw new Error('Another operator order is already pending or unresolved');
      const prepared: PreparedOperatorOrder = { binding, operatorId, manifestSignature, state: 'PREPARED', createdAt: new Date(now).toISOString() };
      await this.save({ ...this.db, preparedOrders: [...this.db.preparedOrders, prepared] });
    });
  }

  async operatorOrderManifest(orderId: string): Promise<PreparedOperatorOrder> {
    await this.load();
    const prepared = this.db.preparedOrders.find(item => item.binding.orderId === orderId);
    if (!prepared) throw new Error('Prepared operator order not found');
    return structuredClone(prepared);
  }

  async preparedOrderSnapshot(): Promise<Array<{ orderId: string; state: PreparedOperatorOrder['state']; expiresAt: string; providerId: string }>> {
    await this.load();
    return this.db.preparedOrders.map(item => ({ orderId: item.binding.orderId, state: item.state, expiresAt: item.binding.expiresAt, providerId: item.binding.providerId }));
  }

  async bindReceivingAddressToPreparedOrder(orderId: string, address: string, validator: AddressValidator = validateUnusedWalletBAddress, now = Date.now()): Promise<string> {
    return this.exclusive(async () => {
      await this.load();
      const preparedIndex = this.db.preparedOrders.findIndex(item => item.binding.orderId === orderId);
      if (preparedIndex < 0) throw new Error('Prepared operator order not found');
      const prepared = this.db.preparedOrders[preparedIndex];
      const existingOrder = this.db.orders.find(item => item.id === orderId);
      if (prepared.state !== 'PREPARED') {
        if (existingOrder && prepared.allocationId === existingOrder.allocationId && existingOrder.sourceReceiver === address) return existingOrder.allocationId;
        throw new Error('Prepared operator order is already bound to a different allocation');
      }
      const candidate = await validator(address);
      if (this.db.allocations.some(item => item.address === candidate.address || item.diversifierIndex === candidate.diversifierIndex || item.allocationId === candidate.allocationId)) throw new Error('Receiving address, diversifier or allocation ID is already reserved');
      const binding = prepared.binding;
      const created: StoredOrder = {
        ...createOrder({ allocationId: candidate.allocationId, destinationRecipient: binding.destinationRecipient, sourceAmountZat: binding.sourceAmountZat, expiresAt: binding.expiresAt, providerId: binding.providerId }, {
          allocationId: candidate.allocationId, sourceReceiver: candidate.address,
          sourceDiversifierIndex: candidate.diversifierIndex, sourceNotBeforeHeight: candidate.sourceNotBeforeHeight,
        }, Date.parse(prepared.createdAt), binding.orderId),
        ownerId: 'operator',
      };
      const order: StoredOrder = Date.parse(binding.expiresAt) <= now ? { ...created, status: 'FAILED', resolutionReason: 'expired-during-address-recovery' } : created;
      if (order.destinationAmountAtomic !== binding.destinationAmountAtomic || order.destinationAsset.contract.toLowerCase() !== binding.destinationTokenContract.toLowerCase()) throw new Error('Bound order terms do not match the signed operator manifest');
      const assigned = { ...candidate, state: 'ASSIGNED' as const, assignedOrderId: order.id };
      const nextPrepared: PreparedOperatorOrder = { ...prepared, state: 'ADDRESS_ALLOCATED', allocationId: candidate.allocationId };
      await this.save({ ...this.db, orders: [...this.db.orders, order], allocations: [...this.db.allocations, assigned], preparedOrders: replaceAt(this.db.preparedOrders, preparedIndex, nextPrepared) });
      return candidate.allocationId;
    });
  }

  async activateOperatorOrder(orderId: string, operatorId: string, sourceWalletCheck: { checkedAt: string; confirmedZatoshis: string; requiredZatoshis: string }, now = Date.now()): Promise<{ order: OrderView; receiver: string }> {
    return this.exclusive(async () => {
      await this.load();
      const preparedIndex = this.db.preparedOrders.findIndex(item => item.binding.orderId === orderId);
      const orderIndex = this.db.orders.findIndex(item => item.id === orderId && item.ownerId === 'operator');
      if (preparedIndex < 0 || orderIndex < 0) throw new Error('Allocated operator order not found');
      const prepared = this.db.preparedOrders[preparedIndex];
      if (prepared.operatorId !== operatorId) throw new Error('Operator identity does not match the prepared order');
      if (prepared.state !== 'ADDRESS_ALLOCATED' || this.db.orders[orderIndex].status !== 'CREATED') throw new Error('Operator order is not ready for activation');
      if (BigInt(sourceWalletCheck.confirmedZatoshis) < BigInt(sourceWalletCheck.requiredZatoshis)) throw new Error('Source Wallet A lacks sufficient confirmed testnet funds');
      const next = { ...activateOrder(this.db.orders[orderIndex], now), ownerId: 'operator' };
      if (next.status !== 'AWAITING_PAYMENT') throw new Error('Operator order expired before activation');
      const nextPrepared: PreparedOperatorOrder = { ...prepared, state: 'ACTIVE', activatedAt: new Date(now).toISOString(), sourceWalletCheck };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, orderIndex, next), preparedOrders: replaceAt(this.db.preparedOrders, preparedIndex, nextPrepared) });
      return { order: view(next), receiver: next.sourceReceiver };
    });
  }

  async operatorSnapshot(): Promise<{
    orders: Array<{ id: string; status: PaymentOrder['status']; createdAt: string; expiresAt: string; payoutAuthorizationState: PaymentOrder['payoutAuthorization']['state']; resolutionReason?: string }>;
    allocationCounts: { available: number; assigned: number };
    replayReferenceCount: number;
  }> {
    await this.load();
    return {
      orders: this.db.orders.map(order => ({ id: order.id, status: order.status, createdAt: order.createdAt, expiresAt: order.expiresAt, payoutAuthorizationState: order.payoutAuthorization.state, resolutionReason: order.resolutionReason })),
      allocationCounts: {
        available: this.db.allocations.filter(item => item.state === 'AVAILABLE').length,
        assigned: this.db.allocations.filter(item => item.state === 'ASSIGNED').length,
      },
      replayReferenceCount: Object.keys(this.db.receiptIndex).length,
    };
  }

  async getReceipt(ownerId: string, receiptId: string): Promise<ShareableReceipt | undefined> {
    await this.load();
    const receipt = this.db.receipts.find(candidate => candidate.receiptId === receiptId);
    if (!receipt || !this.db.orders.some(order => order.id === receipt.orderId && (order.ownerId === ownerId || order.ownerId === 'operator'))) return undefined;
    return toShareableReceipt(receipt);
  }

  /** Operator-only. This method is deliberately not exposed by orderApi. */
  async reserveReceivingAddress(address: string, validator: AddressValidator = validateUnusedWalletBAddress): Promise<string> {
    return this.exclusive(async () => {
      await this.load();
      const candidate = await validator(address);
      const exact = this.db.allocations.find(item => item.allocationId === candidate.allocationId && item.address === candidate.address && item.diversifierIndex === candidate.diversifierIndex);
      if (exact) return exact.allocationId;
      if (this.db.allocations.some(item => item.address === candidate.address || item.diversifierIndex === candidate.diversifierIndex || item.allocationId === candidate.allocationId)) throw new Error('Receiving address, diversifier or allocation ID is already reserved');
      await this.save({ ...this.db, allocations: [...this.db.allocations, candidate] });
      return candidate.allocationId;
    });
  }

  async create(ownerId: string, input: CreateOrderInput): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load();
      const allocationIndex = this.db.allocations.findIndex(item => item.allocationId === input.allocationId && item.state === 'AVAILABLE');
      if (allocationIndex < 0) throw new Error('A valid unused operator allocation is required');
      const allocation = this.db.allocations[allocationIndex];
      const order: StoredOrder = {
        ...createOrder(input, {
          allocationId: allocation.allocationId, sourceReceiver: allocation.address,
          sourceDiversifierIndex: allocation.diversifierIndex, sourceNotBeforeHeight: allocation.sourceNotBeforeHeight,
        }),
        ownerId,
      };
      const assigned = { ...allocation, state: 'ASSIGNED' as const, assignedOrderId: order.id };
      await this.save({ ...this.db, orders: [...this.db.orders, order], allocations: replaceAt(this.db.allocations, allocationIndex, assigned) });
      return view(order);
    });
  }

  async activate(ownerId: string, id: string, now = Date.now()): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load();
      const [index, order] = this.find(ownerId, id);
      const next = { ...activateOrder(order, now), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next) });
      return view(next);
    });
  }

  async observeSource(ownerId: string, id: string, transactionId: string, verifier: SourceVerifier, now = Date.now()): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load();
      const [index, order] = this.find(ownerId, id);
      if (order.status !== 'AWAITING_PAYMENT') throw new Error('Order is not awaiting payment');
      const evidence = await verifier({
        orderId: order.id, transactionId, receiver: order.sourceReceiver, amountZatoshis: order.sourceAmountZat,
        expectedDiversifierIndex: order.sourceDiversifierIndex, minimumBlockHeight: order.sourceNotBeforeHeight,
        minimumBlockTime: Math.floor(Date.parse(order.createdAt) / 1000),
        requiredPool: 'ironwood', minimumConfirmations: 1,
      });
      const result = verifyZcashShieldedReceipt(order, evidence);
      if (result.outcome !== 'verified') throw new Error(`Source ${result.outcome}: ${result.reason}`);
      const key = receiptKey('zcash', evidence.transactionId);
      if (this.db.receiptIndex[key]) throw new Error('Source output evidence has already been consumed');
      const next = { ...attachSourceEvidence(order, sourceLink(evidence), now), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next), receiptIndex: { ...this.db.receiptIndex, [key]: id } });
      return view(next);
    });
  }

  async confirmSource(ownerId: string, id: string, verifier: SourceVerifier): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load();
      const [index, order] = this.find(ownerId, id);
      if (!order.sourceReceipt) throw new Error('No detected source payment exists');
      const evidence = await verifier({
        orderId: order.id, transactionId: order.sourceReceipt.transactionId, receiver: order.sourceReceiver,
        amountZatoshis: order.sourceAmountZat, expectedDiversifierIndex: order.sourceDiversifierIndex,
        minimumBlockHeight: order.sourceNotBeforeHeight, minimumBlockTime: Math.floor(Date.parse(order.createdAt) / 1000),
        requiredPool: 'ironwood', minimumConfirmations: order.sourceMinimumConfirmations,
      });
      const result = verifyZcashShieldedReceipt(order, evidence);
      if (result.outcome !== 'verified') throw new Error(`Source ${result.outcome}: ${result.reason}`);
      const next = { ...confirmSourceEvidence(order, sourceLink(evidence)), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next) });
      return view(next);
    });
  }

  async queuePayout(ownerId: string, id: string): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load(); const [index, order] = this.find(ownerId, id);
      const next = { ...queuePayoutApproval(order), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next) }); return view(next);
    });
  }

  /** Operator-only. Not exposed by orderApi. */
  async approvePayout(ownerId: string, id: string, grant: { operatorId: string; authorizationId: string }, now = Date.now()): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load(); const [index, order] = this.find(ownerId, id);
      if (order.payoutAuthorization.state === 'APPROVED' && order.payoutAuthorization.authorizationId === grant.authorizationId && order.payoutAuthorization.approvedBy === grant.operatorId) return view(order);
      const next = { ...authorizePayout(order, grant.operatorId, grant.authorizationId, now), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next) }); return view(next);
    });
  }

  /** Operator-only record of an externally and manually submitted testnet payout. It does not broadcast. */
  async recordPayout(ownerId: string, id: string, transactionId: string, now = Date.now()): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load(); const [index, order] = this.find(ownerId, id);
      const key = receiptKey('base', transactionId);
      if (this.db.receiptIndex[key]) throw new Error('Payout transaction reference has already been reserved');
      const next = { ...recordPayoutSubmission(order, transactionId, now), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next), receiptIndex: { ...this.db.receiptIndex, [key]: id } }); return view(next);
    });
  }

  /** Operator-only verification. The stored approved reference is used; browser-supplied hashes are never accepted. */
  async verifyPayout(ownerId: string, id: string, verifier: DestinationVerifier = verifyBaseSepoliaTransaction): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load(); const [index, order] = this.find(ownerId, id);
      if (!order.payoutTransactionId || order.status !== 'PAYOUT_SUBMITTED') throw new Error('No approved payout submission exists');
      const key = receiptKey('base', order.payoutTransactionId);
      if (this.db.receiptIndex[key] !== id) throw new Error('Payout evidence is not reserved for this order');
      const evidence = await verifier({
        orderId: order.id, transactionId: order.payoutTransactionId, recipient: order.destinationRecipient,
        amountAtomic: order.destinationAmountAtomic, minimumConfirmations: order.destinationMinimumConfirmations,
      });
      const result = verifyBaseSepoliaErc20Receipt(order, evidence);
      if (result.outcome !== 'verified') throw new Error(`Destination ${result.outcome}: ${result.reason}`);
      const destination: DestinationReceiptLink = { ...result, amountAtomic: evidence.amountAtomic };
      const withDestination = attachDestinationEvidence(order, destination);
      const receipt = createFinalReceipt(withDestination, withDestination.sourceReceipt!, destination, randomUUID());
      const completed = { ...completeOrder(withDestination, receipt.receiptId), ownerId };
      await this.save({
        orders: replaceAt(this.db.orders, index, completed), allocations: this.db.allocations,
        receipts: [...this.db.receipts, receipt], receiptIndex: { ...this.db.receiptIndex, [key]: id }, preparedOrders: this.db.preparedOrders,
      });
      return view(completed);
    });
  }

  async expire(ownerId: string, id: string, now = Date.now()): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load(); const [index, order] = this.find(ownerId, id);
      const next = { ...expireOrder(order, now), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next) }); return view(next);
    });
  }

  async setUnresolved(ownerId: string, id: string, reason: string): Promise<OrderView> {
    return this.exclusive(async () => {
      await this.load(); const [index, order] = this.find(ownerId, id);
      const next = { ...markUnresolved(order, reason), ownerId };
      await this.save({ ...this.db, orders: replaceAt(this.db.orders, index, next) }); return view(next);
    });
  }
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function session(request: IncomingMessage, response: ServerResponse): string {
  const existing = cookieValue(request, 'zecathon_session');
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const created = randomBytes(32).toString('hex');
  response.setHeader('set-cookie', `zecathon_session=${created}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
  return created;
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function validBrowserOrigin(request: IncomingMessage): boolean {
  if (!request.headers.origin) return false;
  try {
    const origin = new URL(request.headers.origin);
    return origin.protocol === 'http:' && (origin.hostname === 'localhost' || origin.hostname === '127.0.0.1') && origin.host === request.headers.host;
  } catch { return false; }
}

async function parseBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 16_384) throw new Error('Request body is too large'); }
  return JSON.parse(raw || '{}') as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store'); response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(value));
}

export function orderApi(store = new FileOrderStore(), verifiers: { source?: SourceVerifier } = {}) {
  const sourceVerifier = verifiers.source ?? verifyZcashTransaction;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/api/orders') && !pathname.startsWith('/api/receipts')) return next();
    if (!isLoopback(request.socket.remoteAddress)) return send(response, 403, { error: 'Coordinator is localhost-only' });
    if (request.headers.origin && !validBrowserOrigin(request)) return send(response, 403, { error: 'Local same-origin request required' });
    if (request.method !== 'GET' && !validBrowserOrigin(request)) return send(response, 403, { error: 'Local same-origin request required' });
    const ownerId = session(request, response);
    try {
      const parts = pathname.split('/').filter(Boolean);
      if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'receipts' && parts.length === 3) {
        const receipt = await store.getReceipt(ownerId, parts[2]); return receipt ? send(response, 200, receipt) : send(response, 404, { error: 'Receipt not found' });
      }
      if (request.method === 'GET' && parts[1] === 'orders' && parts.length === 2) return send(response, 200, { orders: await store.list(ownerId) });
      if (request.method === 'POST' && parts[1] === 'orders' && parts.length === 2) return send(response, 403, { error: 'Order creation requires the authenticated operator CLI' });
      if (request.method === 'POST' && parts[1] === 'orders' && parts.length === 4) {
        if (parts[3] === 'activate') return send(response, 403, { error: 'Order activation requires the authenticated operator CLI' });
        if (parts[3] === 'verify-source') {
          const body = await parseBody(request); if (typeof body.transactionId !== 'string') throw new Error('Complete transaction ID is required');
          return send(response, 200, await store.observeSource(ownerId, parts[2], body.transactionId, sourceVerifier));
        }
        return send(response, 404, { error: 'Not found' });
      }
      return send(response, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Coordinator request failed';
      const unavailable = /RPC|fetch failed|ECONNREFUSED|timed out/i.test(message);
      return send(response, unavailable ? 503 : 400, { error: unavailable ? 'Verification service unavailable' : message });
    }
  };
}
