import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { PostgresPasskeyAuth } from './user-auth.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';
import { DataEncryption } from './data-encryption.ts';
import { fixedWalletReadinessIntent } from './wallet-intent.ts';

const databaseUrl = process.env.POSTGRES_TEST_URL;
function request(sessionToken: string, csrfToken: string): IncomingMessage {
  return { headers: { cookie: `zecathon_session=${sessionToken}; zecathon_csrf=${csrfToken}` } } as IncomingMessage;
}
function registrationResponse(id: string): RegistrationResponseJSON {
  return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'test', attestationObject: 'test', transports: ['internal'] } };
}
function authenticationResponse(id: string): AuthenticationResponseJSON {
  return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'test', authenticatorData: 'test', signature: 'test' } };
}

test('TEST-ONLY passkey registration, second credential, cross-session login, replay rejection, ownership and logout', { skip: !databaseUrl }, async t => {
  const pool = createPostgresPool(databaseUrl); await migrateDatabase(pool); t.after(() => pool.end());
  const auth = new PostgresPasskeyAuth(pool, { rpName: 'Zecathon Test', rpId: 'localhost', expectedOrigin: 'http://localhost:8787', secureCookies: false }, {
    registration: async options => ({ verified: true, registrationInfo: {
      fmt: 'none', aaguid: randomUUID(), credential: { id: options.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
      credentialType: 'public-key', attestationObject: new Uint8Array(), userVerified: true, credentialDeviceType: 'multiDevice', credentialBackedUp: true,
      origin: 'http://localhost:8787', rpID: 'localhost',
    } }),
    authentication: async options => ({ verified: true, authenticationInfo: {
      credentialID: options.response.id, newCounter: options.credential.counter + 1, userVerified: true,
      credentialDeviceType: 'multiDevice', credentialBackedUp: true, origin: 'http://localhost:8787', rpID: 'localhost',
    } }),
  });
  const firstId = randomBytes(32).toString('base64url');
  const first = await auth.beginRegistration({ displayName: 'TEST-ONLY account', passkeyLabel: 'Primary' }) as { challengeId: string };
  const registered = await auth.finishRegistration({ challengeId: first.challengeId, passkeyLabel: 'Primary', response: registrationResponse(firstId) });
  const firstSession = await auth.session(request(registered.session.sessionToken, registered.session.csrfToken));
  assert.equal(firstSession?.passkeyCount, 1);
  await assert.rejects(auth.finishRegistration({ challengeId: first.challengeId, passkeyLabel: 'Replay', response: registrationResponse(firstId) }), /already used/);

  const secondId = randomBytes(32).toString('base64url');
  const second = await auth.beginRegistration({ passkeyLabel: 'Recovery' }, firstSession) as { challengeId: string };
  const added = await auth.finishRegistration({ challengeId: second.challengeId, passkeyLabel: 'Recovery', response: registrationResponse(secondId) }, firstSession);
  assert.equal(await auth.session(request(registered.session.sessionToken, registered.session.csrfToken)), undefined, 'adding a passkey rotates the current session');
  const rotated = await auth.session(request(added.session.sessionToken, added.session.csrfToken));
  assert.equal(rotated?.passkeyCount, 2);

  const orders = new PostgresPublicOrderRequestStore(pool, new DataEncryption({ activeVersion: 1, keys: new Map([[1, randomBytes(32)]]) })); const created = await orders.create(registered.userId, fixedWalletReadinessIntent(`0x${randomBytes(20).toString('hex')}`));
  const login = await auth.beginAuthentication() as { challengeId: string };
  const authenticated = await auth.finishAuthentication({ challengeId: login.challengeId, response: authenticationResponse(secondId) });
  const newSession = await auth.session(request(authenticated.session.sessionToken, authenticated.session.csrfToken));
  assert.equal(newSession?.userId, registered.userId);
  assert.equal((await orders.list(newSession!.userId))[0].id, created.id, 'history follows the account into a new session');
  assert.equal(await orders.get(randomUUID(), created.id), undefined, 'another user cannot read the order');
  await assert.rejects(auth.finishAuthentication({ challengeId: login.challengeId, response: authenticationResponse(secondId) }), /already used/);

  await auth.logout(newSession!);
  assert.equal(await auth.session(request(authenticated.session.sessionToken, authenticated.session.csrfToken)), undefined);
});
