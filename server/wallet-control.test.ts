import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { BaseSepoliaWalletControlVerifier, contractWalletPolicy, destinationControlTypedData, typedDataDigest, type WalletControlRpc } from './wallet-control.ts';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const now = Date.parse('2026-10-25T12:00:00.000Z');
const block = { number: 12_345n, hash: `0x${'ab'.repeat(32)}` as Hex };
const typedData = destinationControlTypedData({
  ownerId:'11111111-1111-4111-8111-111111111111', sessionToken:'a'.repeat(64),
  intentId:'22222222-2222-4222-8222-222222222222', recipient:account.address,
  origin:'https://zecathon.example', nonce:`0x${'33'.repeat(32)}`, issuedAt:now, expiresAt:now+300_000,
});

function rpc(overrides: Partial<WalletControlRpc> = {}): WalletControlRpc {
  return {
    chainId: async () => 84532, block: async () => block, code: async () => '0x', isValidSignature: async () => false, ...overrides,
  };
}

test('EIP-712 destination proof recovers the exact EOA and rejects substitution and expiry', async () => {
  const signature = await account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]);
  const verifier = new BaseSepoliaWalletControlVerifier(rpc());
  const proof = await verifier.verify(typedData, signature, now+1);
  assert.equal(proof.method, 'EIP712_EOA'); assert.equal(proof.digest, typedDataDigest(typedData));
  const substituted = { ...typedData, message:{ ...typedData.message, recipient:`0x${'44'.repeat(20)}` as Address } };
  await assert.rejects(verifier.verify(substituted, signature, now+1), /does not match/);
  await assert.rejects(verifier.verify(typedData, signature, now+300_001), /expired/);
});

test('ERC-1271 is checked at a pinned block and fails closed when RPC or recheck is unavailable', async () => {
  const calls: bigint[] = []; let valid=true;
  const verifier = new BaseSepoliaWalletControlVerifier(rpc({
    code: async () => '0x01',
    isValidSignature: async (_address, digest, _signature, blockHash) => { calls.push(blockHash === block.hash ? block.number : -1n); assert.equal(digest, typedDataDigest(typedData)); return valid; },
  }), { allowContractWallets: true });
  const proof = await verifier.verify(typedData, '0x1234', now+1); assert.equal(proof.method, 'ERC1271'); assert.deepEqual(calls, [block.number]);
  await verifier.recheck(account.address, proof); assert.deepEqual(calls, [block.number, block.number]);
  valid=false; await assert.rejects(verifier.recheck(account.address,proof),/no longer valid/);
  await assert.rejects(new BaseSepoliaWalletControlVerifier(rpc({ block: async () => { throw new Error('offline'); } })).verify(typedData, '0x1234', now+1), /unavailable/);
  await assert.rejects(new BaseSepoliaWalletControlVerifier(rpc({ chainId:async()=>1 })).verify(typedData, '0x1234', now+1), /unavailable/);
  await assert.rejects(new BaseSepoliaWalletControlVerifier(rpc({ code:async(_address,blockHash)=>{ assert.equal(blockHash,block.hash); throw new Error('block is not canonical'); } })).verify(typedData, '0x1234', now+1), /unavailable/);
  await assert.rejects(new BaseSepoliaWalletControlVerifier(rpc({ code: async () => '0x01', isValidSignature: async () => false }), { allowContractWallets: true }).verify(typedData, '0x1234', now+1), /rejected/);
});

test('contract-wallet capability is disabled by default and configuration is fail-closed', async () => {
  const disabled = new BaseSepoliaWalletControlVerifier(rpc({ code: async () => '0x01', isValidSignature: async () => true }));
  await assert.rejects(disabled.verify(typedData, '0x1234', now+1), /disabled/);
  await assert.rejects(disabled.recheck(account.address, { method:'ERC1271', digest:typedDataDigest(typedData), signature:'0x1234', verifiedAt:new Date(now).toISOString(), blockNumber:'1', blockHash:block.hash }), /disabled/);
  assert.deepEqual(contractWalletPolicy(undefined), { allowContractWallets:false });
  assert.deepEqual(contractWalletPolicy('0'), { allowContractWallets:false });
  assert.deepEqual(contractWalletPolicy('1'), { allowContractWallets:true });
  assert.throws(() => contractWalletPolicy('true'), /exactly 0 or 1/);
});
