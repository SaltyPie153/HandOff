import { createHash, randomBytes } from 'node:crypto';

export type OAuthProvider = 'GOOGLE' | 'DISCORD';
export type OAuthIntent = 'LOGIN' | 'LINK';

export interface OAuthAttempt {
  stateHash: string;
  provider: OAuthProvider;
  intent: OAuthIntent;
  browserSessionId: string;
  memberId: string | null;
  createdAt: number;
  expiresAt: number;
  nonce: string | null;
  codeVerifier: string | null;
}

export interface OAuthAttemptStore {
  create(attempt: OAuthAttempt): Promise<void>;
  // The store must remove or mark the row used atomically before returning it.
  consume(stateHash: string): Promise<OAuthAttempt | null>;
}

export interface StartOAuthInput {
  provider: OAuthProvider;
  intent: OAuthIntent;
  browserSessionId: string;
  memberId?: string;
}

export interface OAuthCallbackInput {
  state: string;
  provider: OAuthProvider;
  intent: OAuthIntent;
  browserSessionId: string;
  memberId?: string;
}

export type ConsumeOAuthResult =
  | { kind: 'OK'; attempt: OAuthAttempt }
  | { kind: 'INVALID' };

const lifetimeMs = 10 * 60 * 1000;
const statePattern = /^[A-Za-z0-9_-]{43}$/;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function startOAuthAttempt(
  store: OAuthAttemptStore,
  input: StartOAuthInput,
  now: number = Date.now(),
): Promise<{ state: string; nonce?: string; codeChallenge?: string }> {
  if (
    !input.browserSessionId ||
    (input.provider !== 'GOOGLE' && input.provider !== 'DISCORD') ||
    (input.intent !== 'LOGIN' && input.intent !== 'LINK')
  ) {
    throw new Error('Invalid OAuth attempt');
  }
  if (input.intent === 'LINK' && !input.memberId) {
    throw new Error('Link requires a signed-in member');
  }

  const state = randomBytes(32).toString('base64url');
  const nonce = input.provider === 'GOOGLE'
    ? randomBytes(32).toString('base64url')
    : null;
  const codeVerifier = input.provider === 'GOOGLE'
    ? randomBytes(32).toString('base64url')
    : null;

  await store.create({
    stateHash: digest(state),
    provider: input.provider,
    intent: input.intent,
    browserSessionId: input.browserSessionId,
    memberId: input.intent === 'LINK' ? input.memberId! : null,
    createdAt: now,
    expiresAt: now + lifetimeMs,
    nonce,
    codeVerifier,
  });

  return {
    state,
    ...(nonce === null ? {} : { nonce }),
    ...(codeVerifier === null
      ? {}
      : { codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url') }),
  };
}

export async function consumeOAuthAttempt(
  store: OAuthAttemptStore,
  callback: OAuthCallbackInput,
  now: number = Date.now(),
): Promise<ConsumeOAuthResult> {
  if (!statePattern.test(callback.state)) {
    return { kind: 'INVALID' };
  }

  const attempt = await store.consume(digest(callback.state));
  if (
    attempt === null ||
    now >= attempt.expiresAt ||
    attempt.provider !== callback.provider ||
    attempt.intent !== callback.intent ||
    attempt.browserSessionId !== callback.browserSessionId ||
    (attempt.intent === 'LINK' && attempt.memberId !== callback.memberId) ||
    (attempt.intent === 'LOGIN' && callback.memberId !== undefined)
  ) {
    return { kind: 'INVALID' };
  }

  return { kind: 'OK', attempt };
}
