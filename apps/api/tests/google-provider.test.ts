import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { googleAuthorizationUrl, verifyGoogleIdToken } from '../src/auth/google-provider.js';

test('Google URL includes state, nonce and S256 challenge', () => {
  const url = googleAuthorizationUrl({ clientId: 'client', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:3000/api/auth/google/callback' }, 'a'.repeat(43), 'nonce', 'challenge');
  assert.equal(url.searchParams.get('nonce'), 'nonce');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'a'.repeat(43));
});

test('Google ID token requires trusted signature, audience, issuer and nonce', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'key-1', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (nonce: string, audience = 'client') => new SignJWT({ nonce, name: 'Alice' })
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' }).setIssuer('https://accounts.google.com')
    .setAudience(audience).setSubject('google-123').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const token = await sign('expected');
  assert.deepEqual(await verifyGoogleIdToken(token, 'client', 'expected', keys), { providerSubject: 'google-123', displayName: 'Alice', email: null });
  await assert.rejects(verifyGoogleIdToken(token, 'client', 'wrong', keys));
  await assert.rejects(verifyGoogleIdToken(await sign('expected', 'other'), 'client', 'expected', keys));
});
