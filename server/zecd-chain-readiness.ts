export const ZECD_MAXIMUM_TIP_AGE_SECONDS = 30 * 60;
export const ZECD_MAXIMUM_CLOCK_SKEW_SECONDS = 5 * 60;

export type ZecdChainInfo = {
  chain?: string;
  blocks?: number;
  headers?: number;
  initialblockdownload?: boolean;
  bestblockhash?: string;
  time?: number;
  warnings?: string;
};

/** Fail closed when a locally synced wallet is backed by a stale or refused upstream. */
export function assertFreshTestnetZecdChain(
  chain: ZecdChainInfo,
  now = Date.now(),
  maximumTipAgeSeconds = ZECD_MAXIMUM_TIP_AGE_SECONDS,
): asserts chain is ZecdChainInfo & { chain: 'test'; blocks: number; headers: number; bestblockhash: string; time: number } {
  if (chain.chain !== 'test') throw new Error('zecd is not on Zcash testnet');
  if (chain.initialblockdownload !== false || !Number.isSafeInteger(chain.blocks) || chain.blocks !== chain.headers) {
    throw new Error('zecd chain is not fully synchronized');
  }
  if (!chain.bestblockhash || !/^[0-9a-f]{64}$/i.test(chain.bestblockhash)) throw new Error('zecd chain tip identity is unavailable');
  if (chain.warnings?.trim()) throw new Error('zecd upstream reports a refusal or warning');
  if (!Number.isSafeInteger(chain.time) || (chain.time as number) <= 0) throw new Error('zecd chain tip time is unavailable');
  if (!Number.isSafeInteger(maximumTipAgeSeconds) || maximumTipAgeSeconds <= 0) throw new Error('zecd maximum tip age is invalid');
  const nowSeconds = Math.floor(now / 1000);
  if ((chain.time as number) > nowSeconds + ZECD_MAXIMUM_CLOCK_SKEW_SECONDS) throw new Error('zecd chain tip is ahead of the verifier clock');
  if (nowSeconds - (chain.time as number) > maximumTipAgeSeconds) throw new Error('zecd chain tip is stale');
}
