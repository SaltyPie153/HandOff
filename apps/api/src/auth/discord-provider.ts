import { Buffer } from 'node:buffer';

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface DiscordIdentity {
  providerSubject: string;
  displayName: string | null;
}

type HttpClient = (input: string | URL, init?: RequestInit) => Promise<Response>;
const statePattern = /^[A-Za-z0-9_-]{43}$/;
const failed = 'Discord authentication failed';

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'));
  } catch {
    return false;
  }
}

export function discordAuthorizationUrl(config: DiscordOAuthConfig, state: string): URL {
  if (!statePattern.test(state)) {
    throw new Error('Invalid Discord state');
  }
  if (!config.clientId || !validRedirectUri(config.redirectUri)) {
    throw new Error('Invalid Discord OAuth configuration');
  }

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', config.redirectUri);
  return url;
}

export async function fetchDiscordIdentity(
  config: DiscordOAuthConfig,
  code: string,
  http: HttpClient = fetch,
): Promise<DiscordIdentity> {
  if (!code || !config.clientId || !config.clientSecret || !validRedirectUri(config.redirectUri)) {
    throw new Error(failed);
  }

  try {
    const tokenResponse = await http('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(5000),
    });
    if (!tokenResponse.ok) {
      throw new Error(failed);
    }

    const token: unknown = await tokenResponse.json();
    if (
      typeof token !== 'object' || token === null ||
      !('access_token' in token) || typeof token.access_token !== 'string' ||
      token.access_token.length === 0 ||
      !('token_type' in token) || typeof token.token_type !== 'string' ||
      token.token_type.toLowerCase() !== 'bearer'
    ) {
      throw new Error(failed);
    }

    const userResponse = await http('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bearer ' + token.access_token },
      signal: AbortSignal.timeout(5000),
    });
    if (!userResponse.ok) {
      throw new Error(failed);
    }

    const user: unknown = await userResponse.json();
    if (
      typeof user !== 'object' || user === null ||
      !('id' in user) || typeof user.id !== 'string' ||
      !/^[0-9]+$/.test(user.id)
    ) {
      throw new Error(failed);
    }
    const displayName =
      'global_name' in user && typeof user.global_name === 'string' && user.global_name
        ? user.global_name
        : 'username' in user && typeof user.username === 'string' && user.username
          ? user.username
          : null;
    return { providerSubject: user.id, displayName };
  } catch {
    // Provider bodies and network errors may contain tokens or client details.
    throw new Error(failed);
  }
}
