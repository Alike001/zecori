import { createHash } from 'node:crypto';
import {
  createPublicClient, decodeFunctionResult, encodeFunctionData, hashTypedData,
  http, recoverTypedDataAddress, type Address, type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { normalizeEvmAddress } from '../src/lib/evm-address.ts';
import { baseSepoliaRpcUrl } from './base-sepolia-verifier.ts';

export const WALLET_CONTROL_CHAIN_ID = 84532 as const;
export const WALLET_CONTROL_PURPOSE = 'Verify control of this Base Sepolia destination for one Zecori destination intent. This does not authorize payment, payout, or any transaction.' as const;
export const WALLET_CONTROL_DOMAIN = Object.freeze({ name: 'Zecori Destination Control', version: '1', chainId: WALLET_CONTROL_CHAIN_ID });
export const WALLET_CONTROL_TYPES = Object.freeze({
  DestinationControl: [
    { name: 'owner', type: 'bytes32' }, { name: 'session', type: 'bytes32' },
    { name: 'intentId', type: 'string' }, { name: 'recipient', type: 'address' },
    { name: 'chainId', type: 'uint256' }, { name: 'origin', type: 'string' },
    { name: 'purpose', type: 'string' }, { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
  ],
} as const);

export type DestinationControlMessage = {
  owner: Hex; session: Hex; intentId: string; recipient: Address; chainId: 84532;
  origin: string; purpose: typeof WALLET_CONTROL_PURPOSE; nonce: Hex; issuedAt: number; expiresAt: number;
};
export type DestinationControlTypedData = {
  domain: typeof WALLET_CONTROL_DOMAIN; types: typeof WALLET_CONTROL_TYPES;
  primaryType: 'DestinationControl'; message: DestinationControlMessage;
};
export type WalletControlProof = {
  method: 'EIP712_EOA' | 'ERC1271'; digest: Hex; signature: Hex;
  verifiedAt: string; blockNumber: string; blockHash: Hex;
};
export type WalletControlRpc = {
  chainId(): Promise<number>;
  block(): Promise<{ number: bigint; hash: Hex }>;
  code(address: Address, blockHash: Hex): Promise<Hex>;
  isValidSignature(address: Address, digest: Hex, signature: Hex, blockHash: Hex): Promise<boolean>;
};

export type WalletControlPolicy = { allowContractWallets: boolean };

const ERC1271_ABI = [{ type: 'function', name: 'isValidSignature', stateMutability: 'view', inputs: [{ name: 'hash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }], outputs: [{ name: 'magicValue', type: 'bytes4' }] }] as const;
const ERC1271_MAGIC = '0x1626ba7e';

export function sha256Hex(value: string): Hex { return `0x${createHash('sha256').update(value).digest('hex')}`; }
export function sessionFingerprint(sessionToken: string): Hex { return sha256Hex(sessionToken); }
export function ownerFingerprint(ownerId: string): Hex { return sha256Hex(ownerId); }
export function proofContext(challengeId: string): string { return `wallet-control:${challengeId}:proof`; }
export function challengeContext(challengeId: string): string { return `wallet-control:${challengeId}:challenge`; }

export function destinationControlTypedData(input: {
  ownerId: string; sessionToken: string; intentId: string; recipient: string; origin: string;
  nonce: Hex; issuedAt: number; expiresAt: number;
}): DestinationControlTypedData {
  const parsedOrigin = new URL(input.origin);
  if (parsedOrigin.origin !== input.origin || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('Wallet-control origin must be exact');
  return {
    domain: WALLET_CONTROL_DOMAIN, types: WALLET_CONTROL_TYPES, primaryType: 'DestinationControl',
    message: {
      owner: ownerFingerprint(input.ownerId), session: sessionFingerprint(input.sessionToken), intentId: input.intentId,
      recipient: normalizeEvmAddress(input.recipient) as Address, chainId: WALLET_CONTROL_CHAIN_ID,
      origin: input.origin, purpose: WALLET_CONTROL_PURPOSE, nonce: input.nonce,
      issuedAt: Math.floor(input.issuedAt / 1000), expiresAt: Math.floor(input.expiresAt / 1000),
    },
  };
}

export function typedDataDigest(typedData: DestinationControlTypedData): Hex { return hashTypedData(typedData as Parameters<typeof hashTypedData>[0]); }

export class BaseSepoliaWalletControlVerifier {
  private readonly rpc: WalletControlRpc;
  readonly policy: WalletControlPolicy;
  constructor(rpc: WalletControlRpc, policy: WalletControlPolicy = { allowContractWallets: false }) { this.rpc = rpc; this.policy = policy; }
  async verify(typedData: DestinationControlTypedData, signature: Hex, now = Date.now()): Promise<WalletControlProof> {
    if (!/^0x[0-9a-f]+$/i.test(signature) || signature.length < 4 || signature.length > 16_386) throw Object.assign(new Error('Wallet signature encoding is invalid.'), { code: 'INVALID_WALLET_SIGNATURE' });
    if (typedData.message.chainId !== WALLET_CONTROL_CHAIN_ID || typedData.domain.chainId !== WALLET_CONTROL_CHAIN_ID) throw new Error('Wallet-control chain binding is invalid');
    if (Number(typedData.message.expiresAt) * 1000 <= now) throw Object.assign(new Error('Wallet-control challenge has expired.'), { code: 'WALLET_CHALLENGE_EXPIRED' });
    const digest = typedDataDigest(typedData); const recipient = typedData.message.recipient;
    let block: { number: bigint; hash: Hex }; let code: Hex;
    try { const state=await Promise.all([this.rpc.chainId(),this.rpc.block()]); if(state[0]!==WALLET_CONTROL_CHAIN_ID) throw new Error('wrong chain'); block=state[1]; code = await this.rpc.code(recipient, block.hash); }
    catch { throw Object.assign(new Error('Trusted Base Sepolia verification is unavailable.'), { statusCode: 503, code: 'WALLET_VERIFICATION_UNAVAILABLE' }); }
    let method: WalletControlProof['method'];
    if (code === '0x') {
      let recovered: Address;
      try { recovered = await recoverTypedDataAddress({ ...typedData, signature } as Parameters<typeof recoverTypedDataAddress>[0]); }
      catch { throw Object.assign(new Error('Wallet signature is invalid.'), { code: 'INVALID_WALLET_SIGNATURE' }); }
      if (recovered.toLowerCase() !== recipient.toLowerCase()) throw Object.assign(new Error('Wallet signature does not match the immutable recipient.'), { code: 'WALLET_SIGNER_MISMATCH' });
      method = 'EIP712_EOA';
    } else {
      if (!this.policy.allowContractWallets) throw Object.assign(new Error('Contract-wallet destination verification is disabled for this release.'), { code: 'CONTRACT_WALLET_DISABLED' });
      let valid = false;
      try { valid = await this.rpc.isValidSignature(recipient, digest, signature, block.hash); }
      catch { throw Object.assign(new Error('Trusted ERC-1271 verification is unavailable.'), { statusCode: 503, code: 'WALLET_VERIFICATION_UNAVAILABLE' }); }
      if (!valid) throw Object.assign(new Error('The contract wallet rejected this signature.'), { code: 'INVALID_ERC1271_SIGNATURE' });
      method = 'ERC1271';
    }
    return { method, digest, signature, verifiedAt: new Date(now).toISOString(), blockNumber: block.number.toString(), blockHash: block.hash };
  }
  async recheck(recipient: Address, proof: WalletControlProof): Promise<void> {
    if (proof.method !== 'ERC1271') return;
    if (!this.policy.allowContractWallets) throw Object.assign(new Error('Contract-wallet execution is disabled for this release.'), { code: 'CONTRACT_WALLET_DISABLED' });
    let block: { number: bigint; hash: Hex }; let valid = false;
    try { const state=await Promise.all([this.rpc.chainId(),this.rpc.block()]); if(state[0]!==WALLET_CONTROL_CHAIN_ID) throw new Error('wrong chain'); block=state[1]; valid = await this.rpc.isValidSignature(recipient, proof.digest, proof.signature, block.hash); }
    catch { throw Object.assign(new Error('Trusted ERC-1271 checkpoint verification is unavailable.'), { code: 'WALLET_VERIFICATION_UNAVAILABLE' }); }
    if (!valid) throw Object.assign(new Error('Contract-wallet control proof is no longer valid at the settlement checkpoint.'), { code: 'ERC1271_PROOF_NO_LONGER_VALID' });
  }
}

export function contractWalletPolicy(value: string | undefined): WalletControlPolicy {
  if (value === undefined || value === '' || value === '0') return { allowContractWallets: false };
  if (value === '1') return { allowContractWallets: true };
  throw new Error('ZECATHON_ERC1271_ENABLED must be exactly 0 or 1');
}

export function createBaseSepoliaWalletControlVerifier(rpcUrl: string | undefined, policy: WalletControlPolicy = { allowContractWallets: false }): BaseSepoliaWalletControlVerifier | undefined {
  if (!rpcUrl) return undefined;
  const endpoint = baseSepoliaRpcUrl({ BASE_SEPOLIA_RPC_URL: rpcUrl });
  const client = createPublicClient({ chain: baseSepolia, transport: http(endpoint, { timeout: 10_000, retryCount: 1 }) });
  const rpc: WalletControlRpc = {
    chainId: () => client.getChainId(),
    async block() { const block = await client.getBlock(); if (!block.hash) throw new Error('latest Base block has no hash'); return { number: block.number, hash: block.hash }; },
    code: async (address, blockHash) => (await client.getCode({ address, blockHash, requireCanonical: true })) ?? '0x',
    async isValidSignature(address, digest, signature, blockHash) {
      const data = encodeFunctionData({ abi: ERC1271_ABI, functionName: 'isValidSignature', args: [digest, signature] });
      const result = await client.call({ to: address, data, blockHash, requireCanonical: true }); if (!result.data) return false;
      return decodeFunctionResult({ abi: ERC1271_ABI, functionName: 'isValidSignature', data: result.data }).toLowerCase() === ERC1271_MAGIC;
    },
  };
  return new BaseSepoliaWalletControlVerifier(rpc, policy);
}
