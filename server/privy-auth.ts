import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { verifyAccessToken, type VerifyAccessTokenResponse } from '@privy-io/node';
import { issueUserSession, type AuthenticatedUser } from './user-auth.ts';

export type PrivySessionResult = {
  session: { sessionToken: string; csrfToken: string; maxAge: number };
  userId: string;
  created: boolean;
};

export interface PrivyIdentityService {
  readonly enabled: true;
  login(accessToken: string, current?: AuthenticatedUser): Promise<PrivySessionResult>;
  link(accessToken: string, current: AuthenticatedUser): Promise<{ linked: true; alreadyLinked: boolean }>;
}

type TokenVerifier = (token: string) => Promise<VerifyAccessTokenResponse>;

function fingerprint(appId: string, subject: string): Buffer {
  return createHash('sha256').update(`privy\0${appId}\0${subject}`).digest();
}

export class PostgresPrivyIdentity implements PrivyIdentityService {
  readonly enabled = true as const;
  private readonly pool: Pool;
  private readonly appId: string;
  private readonly verifier: TokenVerifier;

  constructor(pool: Pool, input: { appId: string; verificationKey: string }, verifier?: TokenVerifier) {
    this.pool = pool;
    this.appId = input.appId;
    this.verifier = verifier ?? (token => verifyAccessToken({ access_token: token, app_id: input.appId, verification_key: input.verificationKey }));
  }

  async login(accessToken: string, current?: AuthenticatedUser): Promise<PrivySessionResult> {
    if (current) throw Object.assign(new Error('Sign out before using Privy, or explicitly link Privy from account security.'), { statusCode: 409, code: 'EXPLICIT_LINK_REQUIRED' });
    const subject = await this.verifiedSubject(accessToken);
    const subjectFingerprint = fingerprint(this.appId, subject);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [subjectFingerprint.toString('hex')]);
      const linked = await client.query<{ user_id: string }>(`SELECT e.user_id FROM external_identities e JOIN users u ON u.user_id=e.user_id
        WHERE e.provider='PRIVY' AND e.subject_fingerprint=$1 AND u.status='ACTIVE' FOR UPDATE OF e,u`, [subjectFingerprint]);
      let userId = linked.rows[0]?.user_id;
      let created = false;
      if (!userId) {
        userId = randomUUID(); created = true;
        await client.query(`INSERT INTO users(user_id,display_name,status,activated_at) VALUES($1,'Privy account','ACTIVE',now())`, [userId]);
        await client.query(`INSERT INTO external_identities(identity_id,provider,subject_fingerprint,user_id,linked_by)
          VALUES($1,'PRIVY',$2,$3,'PRIVY_SIGN_IN')`, [randomUUID(), subjectFingerprint, userId]);
        await client.query(`INSERT INTO identity_audit_events(user_id,event_type,details) VALUES($1,'PRIVY_ACCOUNT_CREATED',$2)`, [userId, { provider: 'PRIVY' }]);
      }
      await client.query(`INSERT INTO identity_audit_events(user_id,event_type,details) VALUES($1,'PRIVY_LOGIN_SUCCEEDED',$2)`, [userId, { provider: 'PRIVY' }]);
      const session = await issueUserSession(client, userId);
      await client.query('COMMIT');
      return { session, userId, created };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async link(accessToken: string, current: AuthenticatedUser): Promise<{ linked: true; alreadyLinked: boolean }> {
    const subject = await this.verifiedSubject(accessToken);
    const subjectFingerprint = fingerprint(this.appId, subject);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [subjectFingerprint.toString('hex')]);
      const subjectOwner = await client.query<{ user_id: string }>(`SELECT user_id FROM external_identities
        WHERE provider='PRIVY' AND subject_fingerprint=$1 FOR UPDATE`, [subjectFingerprint]);
      if (subjectOwner.rows[0] && subjectOwner.rows[0].user_id !== current.userId) {
        throw Object.assign(new Error('This Privy identity already belongs to another account. Accounts are never merged automatically.'), { statusCode: 409, code: 'IDENTITY_ALREADY_LINKED' });
      }
      if (subjectOwner.rows[0]) { await client.query('COMMIT'); return { linked: true, alreadyLinked: true }; }
      const userIdentity = await client.query(`SELECT identity_id FROM external_identities WHERE provider='PRIVY' AND user_id=$1 FOR UPDATE`, [current.userId]);
      if (userIdentity.rows[0]) throw Object.assign(new Error('This account already has a different Privy identity.'), { statusCode: 409, code: 'ACCOUNT_ALREADY_LINKED' });
      await client.query(`INSERT INTO external_identities(identity_id,provider,subject_fingerprint,user_id,linked_by)
        VALUES($1,'PRIVY',$2,$3,'AUTHENTICATED_LINK')`, [randomUUID(), subjectFingerprint, current.userId]);
      await client.query(`INSERT INTO identity_audit_events(user_id,event_type,details) VALUES($1,'PRIVY_IDENTITY_LINKED',$2)`, [current.userId, { provider: 'PRIVY' }]);
      await client.query('COMMIT'); return { linked: true, alreadyLinked: false };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  private async verifiedSubject(accessToken: string): Promise<string> {
    if (!accessToken || accessToken.length > 8_192) throw Object.assign(new Error('Privy access token is invalid.'), { statusCode: 401, code: 'PRIVY_TOKEN_INVALID' });
    try {
      const claims = await this.verifier(accessToken);
      if (claims.app_id !== this.appId || claims.issuer !== 'privy.io' || !claims.user_id) throw new Error('Unexpected Privy token claims');
      return claims.user_id;
    } catch {
      throw Object.assign(new Error('Privy access token could not be verified.'), { statusCode: 401, code: 'PRIVY_TOKEN_INVALID' });
    }
  }
}

export function bearerAccessToken(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !/^Bearer [A-Za-z0-9._~-]+$/.test(value) || value.length > 8_200) {
    throw Object.assign(new Error('A valid Privy bearer token is required.'), { statusCode: 401, code: 'PRIVY_TOKEN_REQUIRED' });
  }
  return value.slice(7);
}
