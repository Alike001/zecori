import { keccak_256 } from '@noble/hashes/sha3.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function toChecksumAddress(value: string): string {
  if (!ADDRESS.test(value)) throw new Error('EVM address must contain exactly 20 bytes');
  const lower = value.slice(2).toLowerCase();
  const hash = Array.from(keccak_256(new TextEncoder().encode(lower)), byte => byte.toString(16).padStart(2, '0')).join('');
  return `0x${Array.from(lower, (character, index) => Number.parseInt(hash[index], 16) >= 8 ? character.toUpperCase() : character).join('')}`;
}

export function normalizeEvmAddress(value: string): string {
  if (!ADDRESS.test(value)) throw new Error('EVM address must contain exactly 20 bytes');
  if (/^0x0{40}$/i.test(value)) throw new Error('EVM zero address is not allowed');
  const body = value.slice(2);
  const mixedCase = /[a-f]/.test(body) && /[A-F]/.test(body);
  const checksum = toChecksumAddress(value);
  if (mixedCase && value !== checksum) throw new Error('Mixed-case EVM address has an invalid EIP-55 checksum');
  return checksum;
}
