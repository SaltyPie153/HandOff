import assert from 'node:assert/strict';
import test from 'node:test';
import { discordAuthorizationUrl, fetchDiscordIdentity } from '../src/auth/discord-provider.ts';

const config = {
  clientId: '123456789012345678',
  clientSecret: 'private-client-secret',
  redirectUri: 'http://127.0.0.1:4000/api/auth/discord/callback',
};
const state = 'A'.repeat(43);

test('authorization URL requests only identify and binds the callback state', () => {
  const url = discordAuthorizationUrl(config, state);
  assert.equal(url.origin, 'https://discord.com');
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), config.clientId);
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(url.href.includes(config.clientSecret), false);
  assert.throws(() => discordAuthorizationUrl(config, 'bad-state'), /state/i);
});

test('exchanges code on server and uses verified Discord user id', async () => {
  const calls = [];
  const http = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        access_token: 'access-token',
        token_type: 'Bearer',
        refresh_token: 'unused-refresh-token',
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: '987654321098765432',
      username: 'salty',
      global_name: 'Salty',
      email: 'not-requested@example.com',
    }), { status: 200 });
  };

  const identity = await fetchDiscordIdentity(config, 'one-time-code', http);
  assert.deepEqual(identity, {
    providerSubject: '987654321098765432',
    displayName: 'Salty',
  });
  assert.equal(calls[0].url, 'https://discord.com/api/oauth2/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[0].init.headers.Authorization,
    'Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64'));
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'one-time-code');
  assert.equal(form.get('redirect_uri'), config.redirectUri);
  assert.equal(calls[1].url, 'https://discord.com/api/v10/users/@me');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer access-token');
});

test('token failure is generic and does not expose credentials', async () => {
  const http = async () => new Response(JSON.stringify({ message: 'sensitive provider error' }), { status: 401 });
  await assert.rejects(
    fetchDiscordIdentity(config, 'bad-code', http),
    (error) => {
      assert.equal(error.message, 'Discord authentication failed');
      assert.equal(error.message.includes(config.clientSecret), false);
      return true;
    },
  );
});

test('missing or malformed user id never creates a provider identity', async () => {
  for (const id of [undefined, '', 'not-a-snowflake']) {
    let calls = 0;
    const http = async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ access_token: 'access-token', token_type: 'Bearer' }), { status: 200 })
        : new Response(JSON.stringify({ id, username: 'salty' }), { status: 200 });
    };
    await assert.rejects(fetchDiscordIdentity(config, 'code', http), /Discord authentication failed/);
  }
});
