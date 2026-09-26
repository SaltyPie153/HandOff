import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleIdentity {
  providerSubject: string;
  displayName: string | null;
  email: string | null;
}

const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const failed = 'Google authentication failed';

export function googleAuthorizationUrl(config: GoogleOAuthConfig, state: string, nonce: string, challenge: string): URL {
  if (!config.clientId || !/^[-_A-Za-z0-9]{43}$/.test(state) || !nonce || !challenge) throw new Error(failed);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url;
}

export async function verifyGoogleIdToken(token: string, clientId: string, nonce: string, key: JWTVerifyGetKey = jwks): Promise<GoogleIdentity> {
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'nonce']
  });
  if (protectedHeader.alg !== 'RS256' || payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub) throw new Error(failed);
  return {
    providerSubject: payload.sub,
    displayName: typeof payload.name === 'string' ? payload.name : null,
    email: typeof payload.email === 'string' ? payload.email : null
  };
}

export async function fetchGoogleIdentity(config: GoogleOAuthConfig, code: string, verifier: string, nonce: string, http: typeof fetch = fetch): Promise<GoogleIdentity> {
  if (!code || !verifier || !nonce || !config.clientId || !config.clientSecret || !config.redirectUri) throw new Error(failed);
  try {
    const response = await http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(failed);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('id_token' in result) || typeof result.id_token !== 'string') throw new Error(failed);
    return await verifyGoogleIdToken(result.id_token, config.clientId, nonce);
  } catch {
    throw new Error(failed);
  }
}
