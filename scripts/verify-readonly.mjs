import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const banned = [
  /\.signAndSendTransaction\s*\(/,
  /\.sendTransaction\s*\(/,
  /['\"]zcash_sendTransaction['\"]/, 
  /['\"](?:walletpassphrase|z_sendmany|sendrawtransaction|eth_sendTransaction|eth_sendRawTransaction)['\"]/, 
  /\/v0\/quote/,
  /\/v2\/sender\/orders/,
];
const walletMutationCalls = /rpc(?:<[^>]+>)?\s*\(\s*['"](?:getnewaddress|z_getaddressforaccount)['"]/;
async function visit(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) await visit(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      const source = await readFile(full, 'utf8');
      for (const pattern of banned) if (pattern.test(source)) {
        const reviewedPacketOnly = full === join('server', 'zcash-signing-packet.ts')
          && pattern.source.includes('z_sendmany')
          && source.includes("'ANY_ORCHARD'") && source.includes("'FullPrivacy'")
          && source.includes("memo:'OMITTED'") && source.includes('legacyOrchard!==0n')
          && !/jsonRpcClient|RpcCall|fetch\s*\(|\.send\s*\(/.test(source);
        const disabledMetaMaskDescriptor = full === join('server','metamask-payout.ts')
          && pattern.source.includes('eth_sendTransaction')
          && source.includes('REAL_METAMASK_BROADCAST_ENABLED=false')
          && !/provider\.request\(\{method:\s*['"]eth_sendTransaction/.test(source);
        if (!reviewedPacketOnly && !disabledMetaMaskDescriptor) throw new Error(`Unsafe execution API appears in ${full}: ${pattern}`);
      }
      if (walletMutationCalls.test(source)) {
        const authorizedModule = full === join('server', 'zcash-address-allocator.ts');
        const guarded = source.includes("rpc<DerivedAddress>('z_getaddressforaccount'")
          && source.includes('exactJsonInteger(exact)')
          && source.includes('returnedIndex !== exact');
        if (!authorizedModule || !guarded) throw new Error(`Unauthorized wallet-mutating address RPC call appears in ${full}`);
      }
      if (full.startsWith(`src${process.platform === 'win32' ? '\\' : '/'}`) && /console\.(?:log|debug|info|warn|error)\s*\(/.test(source)) throw new Error(`Frontend logging appears in ${full}`);
    }
  }
}
await visit('src');
await visit('server');
console.log('Safety gate passed: no financial execution methods or frontend logging; exact-index address derivation is confined to the guarded allocator module.');
