import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

export type AuthenticatedUser = {
  userId: string;
  displayName: string;
  csrfToken: string;
  passkeyCount: number;
  sessionToken: string;
};

export type PublicSession = {
  authenticated: boolean;
  user?: { id: string; displayName: string; passkeyCount: number };
  csrfToken?: string;
};

export type PasskeyConfig = { rpName: string; rpId: string; expectedOrigin: string; secureCookies: boolean };

export interface UserIdentityService {
  readonly config: PasskeyConfig;
  health(): Promise<void>;
  session(request: IncomingMessage): Promise<AuthenticatedUser | undefined>;
  publicSession(session?: AuthenticatedUser): PublicSession;
  beginRegistration(input: { displayName?: unknown; passkeyLabel?: unknown }, session?: AuthenticatedUser): Promise<unknown>;
  finishRegistration(input: { challengeId?: unknown; passkeyLabel?: unknown; response?: unknown }, session?: AuthenticatedUser): Promise<{ session: { sessionToken: string; csrfToken: string; maxAge: number }; userId: string }>;
  beginAuthentication(): Promise<unknown>;
  finishAuthentication(input: { challengeId?: unknown; response?: unknown }, session?: AuthenticatedUser): Promise<{ session: { sessionToken: string; csrfToken: string; maxAge: number }; userId: string }>;
  logout(session: AuthenticatedUser): Promise<void>;
  verifyCsrf(session: AuthenticatedUser, provided: string | string[] | undefined): boolean;
}

export async function issueUserSession(client: { query: Pool['query'] }, userId: string, prior?: string) {
  if (validToken(prior)) {
    await client.query(`WITH revoked AS (UPDATE user_sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL RETURNING user_id)
      INSERT INTO identity_audit_events(user_id,event_type,details) SELECT user_id,'SESSION_ROTATED','{}'::jsonb FROM revoked`, [hash(prior)]);
  }
  const sessionToken = randomBytes(32).toString('hex'); const csrfToken = randomBytes(32).toString('hex');
  await client.query(`INSERT INTO user_sessions(session_hash,user_id,csrf_hash,created_at,last_seen_at,expires_at)
    VALUES($1,$2,$3,now(),now(),now()+interval '7 days')`, [hash(sessionToken), userId, hash(csrfToken)]);
  return { sessionToken, csrfToken, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

type PasskeyVerification = {
  registration: typeof verifyRegistrationResponse;
  authentication: typeof verifyAuthenticationResponse;
};

function hash(value: string): Buffer { return createHash('sha256').update(value).digest(); }
function fingerprint(value: string): Buffer { return hash(value.toLowerCase()); }

export function cookieValue(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function validToken(value: string | undefined): value is string { return Boolean(value && /^[0-9a-f]{64}$/.test(value)); }

type ChallengeRow = { challenge_id: string; ceremony: 'REGISTRATION' | 'AUTHENTICATION'; challenge: string; user_id: string | null };
type CredentialRow = {
  credential_id: string; user_id: string; public_key: Buffer; counter: string; transports: AuthenticatorTransportFuture[];
  device_type: 'singleDevice' | 'multiDevice'; backed_up: boolean; revoked_at: Date | null;
};

export class PostgresPasskeyAuth implements UserIdentityService {
  readonly config: PasskeyConfig;
  private readonly pool: Pool;
  private readonly verification: PasskeyVerification;
  constructor(pool: Pool, config: PasskeyConfig, verification: PasskeyVerification = { registration: verifyRegistrationResponse, authentication: verifyAuthenticationResponse }) {
    this.pool = pool; this.config = config; this.verification = verification;
  }

  async health(): Promise<void> {
    const result = await this.pool.query('SELECT 1 FROM schema_migrations WHERE version=$1', ['005_passkey_identity']);
    if (result.rowCount !== 1) throw new Error('Passkey identity migration is missing');
  }

  async session(request: IncomingMessage): Promise<AuthenticatedUser | undefined> {
    const token = cookieValue(request, 'zecathon_session');
    const csrf = cookieValue(request, 'zecathon_csrf');
    if (!validToken(token) || !validToken(csrf)) return undefined;
    const result = await this.pool.query<{ user_id: string; display_name: string; csrf_hash: Buffer; passkey_count: string }>(`
      SELECT s.user_id,u.display_name,s.csrf_hash,
        (SELECT count(*) FROM passkey_credentials p WHERE p.user_id=s.user_id AND p.revoked_at IS NULL) AS passkey_count
      FROM user_sessions s JOIN users u ON u.user_id=s.user_id
      WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status='ACTIVE'`, [hash(token)]);
    const row = result.rows[0];
    if (!row || !timingSafeEqual(row.csrf_hash, hash(csrf))) return undefined;
    await this.pool.query('UPDATE user_sessions SET last_seen_at=now() WHERE session_hash=$1', [hash(token)]);
    return { userId: row.user_id, displayName: row.display_name, csrfToken: csrf, passkeyCount: Number(row.passkey_count), sessionToken: token };
  }

  publicSession(session?: AuthenticatedUser): PublicSession {
    return session ? { authenticated: true, user: { id: session.userId, displayName: session.displayName, passkeyCount: session.passkeyCount }, csrfToken: session.csrfToken } : { authenticated: false };
  }

  async beginRegistration(input: { displayName?: unknown; passkeyLabel?: unknown }, session?: AuthenticatedUser) {
    const displayName = session ? session.displayName : this.label(input.displayName, 'Account name');
    const passkeyLabel = this.label(input.passkeyLabel ?? 'Passkey', 'Passkey label');
    const userId = session?.userId ?? randomUUID();
    if (!session) await this.pool.query(`INSERT INTO users(user_id,display_name,status) VALUES($1,$2,'PENDING')`, [userId, displayName]);
    const credentials = await this.pool.query<{ credential_id: string; transports: AuthenticatorTransportFuture[] }>(
      'SELECT credential_id,transports FROM passkey_credentials WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName, rpID: this.config.rpId, userName: userId, userID: Buffer.from(userId.replaceAll('-', ''), 'hex'),
      userDisplayName: displayName, timeout: CHALLENGE_TTL_MS, attestationType: 'none',
      excludeCredentials: credentials.rows.map(row => ({ id: row.credential_id, transports: row.transports })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    });
    const challengeId = randomUUID();
    await this.pool.query(`INSERT INTO webauthn_challenges(challenge_id,ceremony,challenge,user_id,created_at,expires_at)
      VALUES($1,'REGISTRATION',$2,$3,now(),now()+interval '5 minutes')`, [challengeId, options.challenge, userId]);
    return { challengeId, passkeyLabel, options };
  }

  async finishRegistration(input: { challengeId?: unknown; passkeyLabel?: unknown; response?: unknown }, current?: AuthenticatedUser) {
    const challengeId = this.uuid(input.challengeId, 'Registration challenge');
    const passkeyLabel = this.label(input.passkeyLabel ?? 'Passkey', 'Passkey label');
    const challenge = await this.consumeChallenge(challengeId, 'REGISTRATION');
    if (!challenge.user_id || (current && current.userId !== challenge.user_id)) throw new Error('Registration challenge owner mismatch');
    const response = input.response as RegistrationResponseJSON;
    const verification = await this.verification.registration({ response, expectedChallenge: challenge.challenge, expectedOrigin: this.config.expectedOrigin, expectedRPID: this.config.rpId, requireUserVerification: true });
    if (!verification.verified) throw new Error('Passkey registration could not be verified');
    const info = verification.registrationInfo;
    const transports = response.response.transports ?? [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ status: string }>('SELECT status FROM users WHERE user_id=$1 FOR UPDATE', [challenge.user_id]);
      if (!user.rows[0] || user.rows[0].status === 'DISABLED') throw new Error('Passkey account is unavailable');
      await client.query(`INSERT INTO passkey_credentials
        (credential_id,user_id,public_key,counter,transports,device_type,backed_up,label)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [info.credential.id, challenge.user_id, Buffer.from(info.credential.publicKey), info.credential.counter, transports, info.credentialDeviceType, info.credentialBackedUp, passkeyLabel]);
      const first = user.rows[0].status === 'PENDING';
      if (first) await client.query(`UPDATE users SET status='ACTIVE',activated_at=now() WHERE user_id=$1`, [challenge.user_id]);
      await client.query(`INSERT INTO identity_audit_events(user_id,event_type,credential_fingerprint,details)
        VALUES($1,$2,$3,$4)`, [challenge.user_id, first ? 'ACCOUNT_REGISTERED' : 'PASSKEY_ADDED', fingerprint(info.credential.id), { userVerified: info.userVerified, deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp }]);
      const issued = await issueUserSession(client, challenge.user_id, current?.sessionToken);
      await client.query('COMMIT');
      return { session: issued, userId: challenge.user_id };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async beginAuthentication() {
    const options = await generateAuthenticationOptions({ rpID: this.config.rpId, timeout: CHALLENGE_TTL_MS, userVerification: 'required' });
    const challengeId = randomUUID();
    await this.pool.query(`INSERT INTO webauthn_challenges(challenge_id,ceremony,challenge,created_at,expires_at)
      VALUES($1,'AUTHENTICATION',$2,now(),now()+interval '5 minutes')`, [challengeId, options.challenge]);
    return { challengeId, options };
  }

  async finishAuthentication(input: { challengeId?: unknown; response?: unknown }, current?: AuthenticatedUser) {
    const challenge = await this.consumeChallenge(this.uuid(input.challengeId, 'Authentication challenge'), 'AUTHENTICATION');
    const response = input.response as AuthenticationResponseJSON;
    if (!response || typeof response.id !== 'string') throw new Error('Authentication response is invalid');
    const selected = await this.pool.query<CredentialRow>(`SELECT credential_id,user_id,public_key,counter,transports,device_type,backed_up,revoked_at
      FROM passkey_credentials WHERE credential_id=$1`, [response.id]);
    const row = selected.rows[0];
    if (!row || row.revoked_at) throw new Error('Passkey is not registered or has been revoked');
    const credential: WebAuthnCredential = { id: row.credential_id, publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports };
    const verification = await this.verification.authentication({ response, expectedChallenge: challenge.challenge, expectedOrigin: this.config.expectedOrigin, expectedRPID: this.config.rpId, credential, requireUserVerification: true });
    if (!verification.verified || !verification.authenticationInfo.userVerified) throw new Error('Passkey authentication could not be verified');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE passkey_credentials SET counter=$2,last_used_at=now(),device_type=$3,backed_up=$4
        WHERE credential_id=$1 AND counter=$5 AND revoked_at IS NULL`, [row.credential_id, verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialDeviceType, verification.authenticationInfo.credentialBackedUp, row.counter]);
      if (updated.rowCount !== 1) throw new Error('Passkey counter changed concurrently');
      await client.query(`INSERT INTO identity_audit_events(user_id,event_type,credential_fingerprint,details)
        VALUES($1,'LOGIN_SUCCEEDED',$2,$3)`, [row.user_id, fingerprint(row.credential_id), { userVerified: true }]);
      const issued = await issueUserSession(client, row.user_id, current?.sessionToken);
      await client.query('COMMIT');
      return { session: issued, userId: row.user_id };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async logout(session: AuthenticatedUser): Promise<void> {
    await this.pool.query(`WITH revoked AS (
      UPDATE user_sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL RETURNING user_id
    ) INSERT INTO identity_audit_events(user_id,event_type,details)
      SELECT user_id,'SESSION_REVOKED','{}'::jsonb FROM revoked`, [hash(session.sessionToken)]);
  }

  verifyCsrf(session: AuthenticatedUser, provided: string | string[] | undefined): boolean {
    if (typeof provided !== 'string') return false;
    const left = Buffer.from(provided); const right = Buffer.from(session.csrfToken);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private async consumeChallenge(id: string, ceremony: ChallengeRow['ceremony']): Promise<ChallengeRow> {
    const result = await this.pool.query<ChallengeRow>(`UPDATE webauthn_challenges SET consumed_at=now()
      WHERE challenge_id=$1 AND ceremony=$2 AND consumed_at IS NULL AND expires_at > now()
      RETURNING challenge_id,ceremony,challenge,user_id`, [id, ceremony]);
    if (!result.rows[0]) throw new Error('Passkey challenge is expired, already used, or invalid');
    return result.rows[0];
  }

  private label(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error(`${field} must be between 1 and 80 characters`);
    return value.trim();
  }
  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${field} is invalid`);
    return value;
  }
}

export function sessionCookies(session: { sessionToken: string; csrfToken: string; maxAge: number }, secure: boolean): string[] {
  const flag = secure ? '; Secure' : '';
  return [
    `zecathon_session=${session.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${session.maxAge}${flag}`,
    `zecathon_csrf=${session.csrfToken}; SameSite=Strict; Path=/; Max-Age=${session.maxAge}${flag}`,
  ];
}

export function clearSessionCookies(secure: boolean): string[] {
  const flag = secure ? '; Secure' : '';
  return [
    `zecathon_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${flag}`,
    `zecathon_csrf=; SameSite=Strict; Path=/; Max-Age=0${flag}`,
  ];
}
