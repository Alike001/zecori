export type ShieldedPool =
  | 'orchard'
  | 'ironwood'
  | 'transparent'
  | 'unknown';

export type RouteEvidence = {
  provider: string;
  sourcePool: ShieldedPool;
  zcashDepositPool: ShieldedPool;
  hasTransparentZcashOutput: boolean | null;
  evidenceSource:
    | 'independently-verified'
    | 'provider-claim'
    | 'unknown';
  settlementVerification:
    | 'independent'
    | 'provider-only'
    | 'unknown';
  recovery:
    | 'enforceable'
    | 'provider-dependent'
    | 'unknown';
};

export type RouteAssessment = {
  privacyCandidate: boolean;
  canExecute: false;
  blockers: string[];
  warnings: string[];
};

const isShielded = (pool: ShieldedPool): boolean =>
  pool === 'orchard' || pool === 'ironwood';

export function assessRoute(
  route: RouteEvidence
): RouteAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!isShielded(route.sourcePool)) {
    blockers.push('Source is not verified as shielded');
  }

  if (!isShielded(route.zcashDepositPool)) {
    blockers.push('Zcash deposit is not verified as shielded');
  }

  if (
    isShielded(route.sourcePool) &&
    isShielded(route.zcashDepositPool) &&
    route.sourcePool !== route.zcashDepositPool
  ) {
    blockers.push('Cross-pool value movement requires privacy review');
  }

  if (route.hasTransparentZcashOutput !== false) {
    blockers.push('Transparent output is present or not ruled out');
  }

  if (route.evidenceSource !== 'independently-verified') {
    blockers.push('Independent privacy evidence is missing');
  }

  if (route.settlementVerification !== 'independent') {
    warnings.push('Destination settlement not independently verified');
  }

  if (route.recovery !== 'enforceable') {
    warnings.push('Source refund is not enforceably guaranteed');
  }


  // These must be actual on-chain pools, not UA receiver labels.
  // Current NU6.3+ routes require same-Ironwood-pool settlement.
  if (
    route.sourcePool !== 'ironwood' ||
    route.zcashDepositPool !== 'ironwood'
  ) {
    blockers.push(
      'Post-NU6.3 routes require verified Ironwood-to-Ironwood movement'
    );
  }

  return {
    privacyCandidate: blockers.length === 0,
    canExecute: false,
    blockers,
    warnings,
  };
}
