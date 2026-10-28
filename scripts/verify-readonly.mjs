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
          && source.includes("memo: 'OMITTED'") && source.includes('legacyOrchard !== 0n')
          && !/jsonRpcClient|RpcCall|fetch\s*\(|\.send\s*\(/.test(source);
        const disabledMetaMaskDescriptor = full === join('server','metamask-payout.ts')
          && pattern.source.includes('eth_sendTransaction')
          && source.includes('REAL_METAMASK_BROADCAST_ENABLED=false')
          && !/provider\.request\(\{method:\s*['"]eth_sendTransaction/.test(source);
        const guardedWalletASubmission = full === join('server','zcash-source-payment.ts')
          && pattern.source.includes('z_sendmany')
          && source.includes('beginSubmission(input.operationId, input.packetDigest')
          && source.includes("markSubmissionAmbiguous(input.operationId, 'zecd-submit-response-ambiguous'")
          && source.includes('never call z_sendmany again')
          && source.includes("exactJsonDecimal('0.01000000')")
          && !source.includes('walletpassphrase');
        const metaMaskJournal = source.indexOf('await input.store.beginSubmission(input.packet.packetId,input.rehearsal.requestDigest,now)');
        const metaMaskPrompt = source.indexOf("await input.provider.request({method:'eth_sendTransaction'");
        const guardedMetaMaskSubmission = full === join('server','metamask-payout.ts')
          && pattern.source.includes('eth_sendTransaction')
          && source.includes('expectedMetaMaskPayoutConfirmation(input.packet)')
          && source.includes('broadcastEnabled:true')
          && source.includes('const fresh=await rehearseMetaMaskPayout(input.packet,input.provider,now)')
          && metaMaskJournal !== -1 && metaMaskPrompt > metaMaskJournal
          && source.includes('await input.store.recordTransactionHash(input.packet.packetId,hash,now)')
          && source.includes('await input.store.recordRejection(input.packet.packetId,4001,now)')
          && source.includes('await input.store.requireRecovery(input.packet.packetId')
          && source.includes('automatic retry is forbidden');
        if (!reviewedPacketOnly && !disabledMetaMaskDescriptor && !guardedWalletASubmission && !guardedMetaMaskSubmission) throw new Error(`Unsafe execution API appears in ${full}: ${pattern}`);
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
console.log('Safety gate passed: Wallet A and injected-provider MetaMask broadcasts are confined to durable one-attempt operator workflows; other financial execution APIs remain absent and frontend logging is disabled.');
