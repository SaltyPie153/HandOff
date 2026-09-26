import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IdentityProvider } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import type { OAuthAttempt, OAuthAttemptStore } from './oauth-attempt.js';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const uniqueFailure = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export class AuthRepository implements OAuthAttemptStore {
  constructor(readonly prisma: PrismaService) {}

  async create(attempt: OAuthAttempt): Promise<void> {
    await this.prisma.oAuthAttempt.create({ data: {
      stateHash: attempt.stateHash, provider: attempt.provider, intent: attempt.intent,
      browserSessionId: attempt.browserSessionId, memberId: attempt.memberId,
      createdAt: new Date(attempt.createdAt), expiresAt: new Date(attempt.expiresAt),
      nonce: attempt.nonce, codeVerifier: attempt.codeVerifier
    } });
  }

  async consume(stateHash: string): Promise<OAuthAttempt | null> {
    const rows = await this.prisma.$queryRaw<Array<{
      state_hash: string; provider: 'GOOGLE' | 'DISCORD'; intent: 'LOGIN' | 'LINK';
      browser_session_id: string; member_id: string | null; created_at: Date;
      expires_at: Date; nonce: string | null; code_verifier: string | null;
    }>>`DELETE FROM oauth_attempts WHERE state_hash = ${stateHash} RETURNING *`;
    const row = rows[0];
    return row ? {
      stateHash: row.state_hash.trim(), provider: row.provider, intent: row.intent,
      browserSessionId: row.browser_session_id, memberId: row.member_id,
      createdAt: row.created_at.getTime(), expiresAt: row.expires_at.getTime(),
      nonce: row.nonce, codeVerifier: row.code_verifier
    } : null;
  }

  async signIn(provider: IdentityProvider, subject: string, displayName: string | null, email: string | null): Promise<string> {
    if (!subject || subject.length > 255) throw new Error('Invalid provider subject');
    const key = { provider, providerSubject: subject };
    const existing = await this.prisma.providerIdentity.findUnique({ where: { provider_providerSubject: key } });
    if (existing) return existing.userId;
    try {
      return await this.prisma.$transaction(async tx => {
        const user = await tx.user.create({ data: { id: randomUUID() } });
        await tx.providerIdentity.create({ data: {
          id: randomUUID(), userId: user.id, ...key,
          displayName: displayName?.slice(0, 255) ?? null,
          email: email?.slice(0, 320) ?? null
        } });
        return user.id;
      });
    } catch (error) {
      if (!uniqueFailure(error)) throw error;
      const winner = await this.prisma.providerIdentity.findUnique({ where: { provider_providerSubject: key } });
      if (!winner) throw error;
      return winner.userId;
    }
  }

  async link(userId: string, provider: IdentityProvider, subject: string, displayName: string | null, email: string | null, sessionToken?: string): Promise<'LINKED' | 'ALREADY_LINKED' | 'CONFLICT' | 'SESSION_INVALID'> {
    if (!subject || subject.length > 255) throw new Error('Invalid provider subject');
    if (sessionToken !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return 'SESSION_INVALID';
    const key = { provider, providerSubject: subject };
    try {
      return await this.prisma.$transaction(async tx => {
        if (sessionToken !== undefined) {
          const held = await tx.$queryRaw<Array<{ user_id: string }>>`
            SELECT user_id FROM auth_sessions
            WHERE token_hash = ${sha256(sessionToken)} AND user_id::text = ${userId}
              AND expires_at > now() FOR UPDATE`;
          if (!held.length) return 'SESSION_INVALID';
        }
        const existing = await tx.providerIdentity.findUnique({ where: { provider_providerSubject: key } });
        if (existing) return existing.userId === userId ? 'ALREADY_LINKED' : 'CONFLICT';
        await tx.providerIdentity.create({ data: {
          id: randomUUID(), userId, ...key,
          displayName: displayName?.slice(0, 255) ?? null,
          email: email?.slice(0, 320) ?? null
        } });
        return 'LINKED';
      });
    } catch (error) {
      if (!uniqueFailure(error)) throw error;
      const winner = await this.prisma.providerIdentity.findUnique({ where: { provider_providerSubject: key } });
      if (!winner) throw error;
      return winner.userId === userId ? 'ALREADY_LINKED' : 'CONFLICT';
    }
  }

  async session(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: { identities: { select: { provider: true } } } } }
    });
    return session && session.expiresAt > new Date() ? session : null;
  }

  async issueSession(userId: string, oldToken?: string): Promise<{ token: string; csrf: string }> {
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async tx => {
      if (oldToken) await tx.authSession.deleteMany({ where: { tokenHash: sha256(oldToken) } });
      await tx.authSession.create({ data: {
        tokenHash: sha256(token), csrfHash: sha256(csrf), userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      } });
    });
    return { token, csrf };
  }

  async revokeSession(token: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { tokenHash: sha256(token) } });
  }

  async pendingUsers() {
    return this.prisma.user.findMany({
      where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, identities: { select: { provider: true, displayName: true, email: true } } }
    });
  }

  async approve(actorId: string, targetId: string): Promise<'APPROVED' | 'ALREADY_APPROVED' | 'NOT_FOUND'> {
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId } });
      if (actor?.status !== 'APPROVED' || !actor.isServiceAdmin) throw new Error('FORBIDDEN');
      const changed = await tx.user.updateMany({ where: { id: targetId, status: 'PENDING' }, data: { status: 'APPROVED', approvedAt: new Date() } });
      if (changed.count) {
        await tx.membershipApproval.create({ data: { id: randomUUID(), targetId, actorId } });
        return 'APPROVED';
      }
      const target = await tx.user.findUnique({ where: { id: targetId } });
      return target ? 'ALREADY_APPROVED' : 'NOT_FOUND';
    });
  }

  async grantAdmin(actorId: string, targetId: string): Promise<'GRANTED' | 'ALREADY_GRANTED' | 'NOT_FOUND' | 'NOT_APPROVED'> {
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId } });
      if (actor?.status !== 'APPROVED' || !actor.isServiceAdmin) throw new Error('FORBIDDEN');
      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (!target) return 'NOT_FOUND';
      if (target.status !== 'APPROVED') return 'NOT_APPROVED';
      const changed = await tx.user.updateMany({ where: { id: targetId, isServiceAdmin: false }, data: { isServiceAdmin: true } });
      if (changed.count) {
        await tx.adminGrant.create({ data: { id: randomUUID(), targetId, actorId, source: 'ADMIN' } });
        return 'GRANTED';
      }
      return 'ALREADY_GRANTED';
    });
  }

  async bootstrapAdmin(targetId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(91274, 1)::text`;
      const prior = await tx.adminGrant.findFirst();
      if (prior) throw new Error('ADMIN_ALREADY_BOOTSTRAPPED');
      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (!target) throw new Error('USER_NOT_FOUND');
      await tx.user.update({ where: { id: targetId }, data: { status: 'APPROVED', approvedAt: new Date(), isServiceAdmin: true } });
      await tx.adminGrant.create({ data: { id: randomUUID(), targetId, source: 'BOOTSTRAP' } });
    });
  }
}
