import { ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AuthAction } from './domain.js';
import { canPerform } from './domain.js';
import { AuthRepository } from './auth.repository.js';
import { readCookie, validCsrf } from './auth-http.js';
import type { OAuthProvider } from './oauth-attempt.js';
import { consumeOAuthAttempt, startOAuthAttempt } from './oauth-attempt.js';
import { discordAuthorizationUrl, fetchDiscordIdentity } from './discord-provider.js';
import { fetchGoogleIdentity, googleAuthorizationUrl } from './google-provider.js';

export type AuthConfig = { nodeEnv: string; apiPort: number; webPort: number; publicApiOrigin?: string };
export type HttpRequest = { headers: Record<string, string | string[] | undefined> };

@Injectable()
export class AuthService {
  constructor(readonly repository: AuthRepository, readonly config: AuthConfig) {}

  private cookie(req: HttpRequest, name: string): string | null {
    const header = req.headers.cookie;
    return readCookie(typeof header === 'string' ? header : undefined, name);
  }

  sessionToken(req: HttpRequest) { return this.cookie(req, 'ho_session'); }
  browserToken(req: HttpRequest) { return this.cookie(req, 'ho_browser'); }

  async requireSession(req: HttpRequest) {
    const session = await this.repository.session(this.sessionToken(req) ?? undefined);
    if (!session) throw new UnauthorizedException();
    return session;
  }

  async requireAction(req: HttpRequest, action: AuthAction, assigned = false) {
    const session = await this.requireSession(req);
    if (!canPerform(session.user, action, assigned)) throw new ForbiddenException();
    return session;
  }

  requireCsrf(req: HttpRequest, csrfHash: string): void {
    const header = req.headers['x-csrf-token'];
    if (!validCsrf(typeof header === 'string' ? header : undefined, csrfHash)) throw new ForbiddenException('CSRF token invalid');
  }

  private providerConfig(provider: OAuthProvider, intent: 'LOGIN' | 'LINK') {
    const prefix = provider === 'GOOGLE' ? 'GOOGLE' : 'DISCORD';
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) throw new ServiceUnavailableException('Login provider is not configured');
    const origin = this.config.publicApiOrigin ?? `http://127.0.0.1:${this.config.webPort}`;
    return { clientId, clientSecret, redirectUri: `${origin}/api/auth/${intent === 'LINK' ? 'links/' : ''}${provider.toLowerCase()}/callback` };
  }

  async start(provider: OAuthProvider, intent: 'LOGIN' | 'LINK', browserToken: string, memberId?: string) {
    const config = this.providerConfig(provider, intent);
    const attempt = await startOAuthAttempt(this.repository, { provider, intent, browserSessionId: browserToken, memberId });
    const url = provider === 'GOOGLE'
      ? googleAuthorizationUrl(config, attempt.state, attempt.nonce!, attempt.codeChallenge!)
      : discordAuthorizationUrl(config, attempt.state);
    return url.toString();
  }

  async finish(provider: OAuthProvider, intent: 'LOGIN' | 'LINK', browserToken: string, state: string, code: string, memberId?: string, oldSessionToken?: string) {
    const result = await consumeOAuthAttempt(this.repository, { provider, intent, browserSessionId: browserToken, state, memberId });
    if (result.kind !== 'OK' || !code) throw new ForbiddenException('OAuth state invalid');
    const config = this.providerConfig(provider, intent);
    const identity = provider === 'GOOGLE'
      ? await fetchGoogleIdentity(config, code, result.attempt.codeVerifier!, result.attempt.nonce!)
      : await fetchDiscordIdentity(config, code);
    const email = 'email' in identity && typeof identity.email === 'string' ? identity.email : null;
    if (intent === 'LINK') {
      const linked = await this.repository.link(memberId!, provider, identity.providerSubject, identity.displayName, email, browserToken);
      if (linked === 'SESSION_INVALID') throw new ForbiddenException('Session expired during linking');
      return { kind: linked };
    }
    const userId = await this.repository.signIn(provider, identity.providerSubject, identity.displayName, email);
    const session = await this.repository.issueSession(userId, oldSessionToken);
    const user = await this.repository.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { kind: 'SIGNED_IN' as const, session, status: user.status };
  }

  newBrowserToken() { return randomBytes(32).toString('base64url'); }
}
