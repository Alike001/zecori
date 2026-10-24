import { chmod, mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { atomicCreatePrivateFile } from './private-storage.ts';
import { canonicalOperatorOrderBinding, sameOperatorOrderBinding, type OperatorOrderBinding } from '../src/lib/operator-order.ts';

export type OperatorAction = 'ADDRESS_ALLOCATION' | 'PAYOUT_APPROVAL';
export type AuthorizationState = 'AUTHORIZED' | 'IN_PROGRESS' | 'CONSUMED' | 'REVOKED';
export type AllocationRecoveryState = 'DERIVATION_PENDING' | 'DERIVED' | 'RESERVED';

export type OperatorAuthorization = {
  id: string;
  action: OperatorAction;
  target: string;
  operatorId: string;
  diversifierIndex?: string;
  createdAt: string;
  expiresAt: string;
  state: AuthorizationState;
  signature: string;
  orderBinding?: OperatorOrderBinding;
};

export type AllocationRecoveryRecord = {
  authorizationId: string;
  allocationId: string;
  diversifierIndex: string;
  state: AllocationRecoveryState;
  address?: string;
  updatedAt: string;
  orderId: string;
};

type ControlDatabase = { version: 1; authorizations: OperatorAuthorization[]; allocations: AllocationRecoveryRecord[] };

export function defaultOperatorControlPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return process.env.ZECATHON_OPERATOR_DB || join(dataHome, 'zecathon-crosschain-app', 'operator-control.json');
}

export function defaultOperatorKeyPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return process.env.ZECATHON_OPERATOR_KEY || join(dataHome, 'zecathon-crosschain-app', 'operator.key');
}

export async function inspectOperatorKey(path = defaultOperatorKeyPath()): Promise<{ ready: boolean; reason?: string }> {
  try {
    const [metadata, folder] = await Promise.all([stat(path), stat(dirname(path))]);
    if (!metadata.isFile()) return { ready: false, reason: 'operator key is not a regular file' };
    if ((metadata.mode & 0o077) !== 0) return { ready: false, reason: 'operator key permissions must be 0600' };
    if (!folder.isDirectory() || (folder.mode & 0o077) !== 0) return { ready: false, reason: 'operator key directory permissions must be 0700' };
    if (metadata.size < 32) return { ready: false, reason: 'operator key must contain at least 32 bytes' };
    return { ready: true };
  } catch (error) {
    return { ready: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'operator key is not provisioned' : 'operator key cannot be inspected' };
  }
}

const MAX_DIVERSIFIER = (1n << 88n) - 1n;

export function exactDiversifier(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error('Diversifier index must be an unsigned decimal integer');
  const parsed = BigInt(value);
  if (parsed > MAX_DIVERSIFIER) throw new Error('Diversifier index exceeds the 88-bit Zcash range');
  return parsed.toString();
}

export function randomDiversifierIndex(): string {
  let value = 0n;
  while (value === 0n) value = BigInt(`0x${randomBytes(11).toString('hex')}`);
  return value.toString();
}

async function operatorKey(path: string): Promise<Buffer> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error('Operator key must be a regular mode-0600 file');
  const key = await readFile(path);
  if (key.length < 32) throw new Error('Operator key must contain at least 32 bytes');
  return key;
}

function canonical(authorization: Omit<OperatorAuthorization, 'state' | 'signature'>): string {
  return JSON.stringify({
    id: authorization.id, action: authorization.action, target: authorization.target,
    operatorId: authorization.operatorId, diversifierIndex: authorization.diversifierIndex,
    createdAt: authorization.createdAt, expiresAt: authorization.expiresAt,
    orderBinding: authorization.orderBinding ? JSON.parse(canonicalOperatorOrderBinding(authorization.orderBinding)) as OperatorOrderBinding : undefined,
  });
}

function sign(authorization: Omit<OperatorAuthorization, 'state' | 'signature'>, key: Buffer): string {
  return createHmac('sha256', key).update(canonical(authorization)).digest('hex');
}

function verifySignature(authorization: OperatorAuthorization, key: Buffer): boolean {
  const { state: _state, signature, ...immutable } = authorization;
  const expected = Buffer.from(sign(immutable, key), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

async function atomicWrite(path: string, value: ControlDatabase): Promise<void> {
  const folder = dirname(path);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  await chmod(path, 0o600);
  const directory = await open(folder, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export class OperatorControlStore {
  private mutation: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly keyPath: string;
  constructor(path = defaultOperatorControlPath(), keyPath = defaultOperatorKeyPath()) { this.path = path; this.keyPath = keyPath; }

  async initialize(): Promise<void> {
    await atomicCreatePrivateFile(this.path, `${JSON.stringify({ version: 1, authorizations: [], allocations: [] }, null, 2)}\n`);
  }

  async provisionKey(): Promise<void> {
    await atomicCreatePrivateFile(this.keyPath, randomBytes(32));
  }

  async health(): Promise<{ ready: boolean; reason?: string }> {
    try {
      const [file, folder] = await Promise.all([stat(this.path), stat(dirname(this.path))]);
      if (!file.isFile() || (file.mode & 0o077) !== 0) return { ready: false, reason: 'operator control database permissions must be 0600' };
      if (!folder.isDirectory() || (folder.mode & 0o077) !== 0) return { ready: false, reason: 'operator control directory permissions must be 0700' };
      await this.read();
      return { ready: true };
    } catch (error) {
      return { ready: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'operator control database is not initialized' : error instanceof Error ? error.message : 'operator control database cannot be inspected' };
    }
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action, action);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<ControlDatabase> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<ControlDatabase>;
      if (parsed.version !== 1 || !Array.isArray(parsed.authorizations) || !Array.isArray(parsed.allocations)) throw new Error('Operator control database schema is invalid');
      return parsed as ControlDatabase;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, authorizations: [], allocations: [] };
      throw error;
    }
  }

  async inspect(): Promise<{ authorizations: Array<Omit<OperatorAuthorization, 'signature'>>; allocations: AllocationRecoveryRecord[] }> {
    const db = await this.read();
    return { authorizations: db.authorizations.map(({ signature: _signature, ...safe }) => safe), allocations: db.allocations };
  }

  async signOrderManifest(binding: OperatorOrderBinding, operatorId: string): Promise<string> {
    if (!operatorId.trim()) throw new Error('Operator identity is required');
    const key = await operatorKey(this.keyPath);
    return createHmac('sha256', key).update(`zecathon-order-v1\n${operatorId}\n${canonicalOperatorOrderBinding(binding)}`).digest('hex');
  }

  async verifyOrderManifest(binding: OperatorOrderBinding, operatorId: string, signature: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(signature)) throw new Error('Operator order manifest signature is invalid');
    const expected = Buffer.from(await this.signOrderManifest(binding, operatorId), 'hex');
    const provided = Buffer.from(signature, 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new Error('Operator order manifest signature is invalid');
  }

  async signReceipt(canonicalReceipt: string): Promise<string> {
    const key = await operatorKey(this.keyPath);
    return createHmac('sha256', key).update(`zecathon-receipt-v1\n${canonicalReceipt}`).digest('hex');
  }

  async verifyReceipt(canonicalReceipt: string, signature: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(signature)) throw new Error('Receipt authenticity signature is invalid');
    const expected = Buffer.from(await this.signReceipt(canonicalReceipt), 'hex'); const provided = Buffer.from(signature, 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new Error('Receipt authenticity signature is invalid');
  }

  async signOperatorPayload(domain: 'allocation-authorization-v1' | 'payout-authorization-v1', canonicalPayload: string): Promise<string> {
    const key = await operatorKey(this.keyPath);
    return createHmac('sha256', key).update(`zecathon-${domain}\n${canonicalPayload}`).digest('hex');
  }

  async verifyOperatorPayload(domain: 'allocation-authorization-v1' | 'payout-authorization-v1', canonicalPayload: string, signature: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(signature)) throw new Error('Operator authorization signature is invalid');
    const expected = Buffer.from(await this.signOperatorPayload(domain, canonicalPayload), 'hex'); const provided = Buffer.from(signature, 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new Error('Operator authorization signature is invalid');
  }

  async authorize(input: { action: OperatorAction; target: string; operatorId: string; orderBinding?: OperatorOrderBinding; diversifierIndex?: string; ttlSeconds?: number; now?: number }): Promise<string> {
    return this.exclusive(async () => {
      const key = await operatorKey(this.keyPath);
      const db = await this.read();
      const now = input.now ?? Date.now();
      if (!input.operatorId.trim() || !input.target.trim()) throw new Error('Operator identity and authorization target are required');
      if (input.action === 'ADDRESS_ALLOCATION') {
        if (!input.orderBinding || input.target !== `order:${input.orderBinding.orderId}`) throw new Error('Address allocation authorization must bind one exact operator order');
        const unfinished = db.authorizations.find(item => item.action === 'ADDRESS_ALLOCATION' && item.target === input.target && ['AUTHORIZED', 'IN_PROGRESS'].includes(item.state));
        if (unfinished?.state === 'IN_PROGRESS') throw new Error('Address allocation is already in progress; recover the existing authorization');
        if (unfinished && Date.parse(unfinished.expiresAt) > now) throw new Error('A live address authorization already exists for this order');
      }
      const prior = db.authorizations.map(item => item.action === 'ADDRESS_ALLOCATION' && item.target === input.target && item.state === 'AUTHORIZED' && Date.parse(item.expiresAt) <= now
        ? { ...item, state: 'REVOKED' as const }
        : item);
      const immutable = {
        id: randomUUID(), action: input.action, target: input.target, operatorId: input.operatorId,
        ...(input.action === 'ADDRESS_ALLOCATION' ? { diversifierIndex: exactDiversifier(input.diversifierIndex ?? randomDiversifierIndex()) } : {}),
        ...(input.orderBinding ? { orderBinding: input.orderBinding } : {}),
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + (input.ttlSeconds ?? 900) * 1000).toISOString(),
      };
      const authorization: OperatorAuthorization = { ...immutable, state: 'AUTHORIZED', signature: sign(immutable, key) };
      await atomicWrite(this.path, { ...db, authorizations: [...prior, authorization] });
      return authorization.id;
    });
  }

  async begin(input: { authorizationId: string; action: OperatorAction; target: string; operatorId: string; orderBinding?: OperatorOrderBinding; now?: number }): Promise<OperatorAuthorization> {
    return this.exclusive(async () => {
      const key = await operatorKey(this.keyPath); const db = await this.read();
      const index = db.authorizations.findIndex(item => item.id === input.authorizationId);
      if (index < 0) throw new Error('Operator authorization not found');
      const authorization = db.authorizations[index];
      if (!verifySignature(authorization, key)) throw new Error('Operator authorization signature is invalid');
      if (authorization.action !== input.action || authorization.target !== input.target || authorization.operatorId !== input.operatorId) throw new Error('Operator authorization scope mismatch');
      if (input.action === 'ADDRESS_ALLOCATION' && (!input.orderBinding || !authorization.orderBinding || !sameOperatorOrderBinding(input.orderBinding, authorization.orderBinding))) throw new Error('Operator order binding mismatch');
      const existingAllocation = db.allocations.find(item => item.authorizationId === authorization.id);
      if (authorization.state === 'CONSUMED' && input.action === 'ADDRESS_ALLOCATION' && existingAllocation?.state === 'RESERVED') return authorization;
      if (Date.parse(authorization.expiresAt) <= (input.now ?? Date.now()) && !(input.action === 'ADDRESS_ALLOCATION' && authorization.state === 'IN_PROGRESS')) throw new Error('Operator authorization has expired');
      if (!['AUTHORIZED', 'IN_PROGRESS'].includes(authorization.state)) throw new Error('Operator authorization is no longer usable');
      const next = { ...authorization, state: 'IN_PROGRESS' as const };
      const authorizations = db.authorizations.map((item, current) => current === index ? next : item);
      let allocations = db.allocations;
      if (input.action === 'ADDRESS_ALLOCATION' && !allocations.some(item => item.authorizationId === authorization.id)) {
        allocations = [...allocations, {
          authorizationId: authorization.id, allocationId: randomUUID(),
          diversifierIndex: exactDiversifier(authorization.diversifierIndex!), state: 'DERIVATION_PENDING',
          updatedAt: new Date(input.now ?? Date.now()).toISOString(), orderId: authorization.orderBinding!.orderId,
        }];
      }
      await atomicWrite(this.path, { ...db, authorizations, allocations });
      return next;
    });
  }

  async recordDerived(authorizationId: string, address: string, diversifierIndex: string, now = Date.now()): Promise<void> {
    await this.exclusive(async () => {
      const db = await this.read(); const index = db.allocations.findIndex(item => item.authorizationId === authorizationId);
      if (index < 0) throw new Error('Allocation recovery record not found');
      const existing = db.allocations[index];
      if (exactDiversifier(diversifierIndex) !== existing.diversifierIndex) throw new Error('Derived diversifier does not match the journaled index');
      const next: AllocationRecoveryRecord = { ...existing, address, state: 'DERIVED', updatedAt: new Date(now).toISOString() };
      await atomicWrite(this.path, { ...db, allocations: db.allocations.map((item, current) => current === index ? next : item) });
    });
  }

  async completeAddressAllocation(authorizationId: string, now = Date.now()): Promise<void> {
    await this.exclusive(async () => {
      const db = await this.read();
      const allocationIndex = db.allocations.findIndex(item => item.authorizationId === authorizationId);
      const authorizationIndex = db.authorizations.findIndex(item => item.id === authorizationId);
      if (allocationIndex < 0 || authorizationIndex < 0 || db.allocations[allocationIndex].state !== 'DERIVED') throw new Error('Derived allocation is not ready for completion');
      const allocation = { ...db.allocations[allocationIndex], state: 'RESERVED' as const, updatedAt: new Date(now).toISOString() };
      const authorization = { ...db.authorizations[authorizationIndex], state: 'CONSUMED' as const };
      await atomicWrite(this.path, {
        ...db,
        allocations: db.allocations.map((item, current) => current === allocationIndex ? allocation : item),
        authorizations: db.authorizations.map((item, current) => current === authorizationIndex ? authorization : item),
      });
    });
  }

  async completePayoutAuthorization(authorizationId: string): Promise<void> {
    await this.exclusive(async () => {
      const db = await this.read(); const index = db.authorizations.findIndex(item => item.id === authorizationId);
      if (index < 0 || db.authorizations[index].action !== 'PAYOUT_APPROVAL' || db.authorizations[index].state !== 'IN_PROGRESS') throw new Error('Payout authorization is not in progress');
      const next = { ...db.authorizations[index], state: 'CONSUMED' as const };
      await atomicWrite(this.path, { ...db, authorizations: db.authorizations.map((item, current) => current === index ? next : item) });
    });
  }
}
