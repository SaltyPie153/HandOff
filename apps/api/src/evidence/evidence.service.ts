import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute as isPosixAbsolute } from 'node:path/posix';
import { isAbsolute as isWindowsAbsolute } from 'node:path/win32';
import { PrismaService } from '../database/prisma.service.js';
import { decryptEvidence, encryptEvidence } from './evidence-crypto.js';
import { isFreshLocalSnapshot } from './evidence-policy.js';
import {collectContractEvidence} from './contract-evidence.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const canonicalPath = (value: string) => value.replaceAll('\\', '/').replace(/\/$/, '');
const safeLocalPath = (value: string) => {
  if (typeof value !== 'string' || value.length > 1024 || (!isPosixAbsolute(value) && !isWindowsAbsolute(value)) ||
      value.split(/[\\/]/).some(part => part === '..' || part === '.') || !/\.(md|txt|json|ya?ml)$/i.test(value)) {
    throw new BadRequestException('Invalid local evidence path');
  }
  return canonicalPath(value);
};
const safeGitPart = (value: string, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  /^[a-zA-Z0-9._/-]+$/.test(value) && !value.split('/').some(part => part === '..' || part === '.' || !part);

export type EvidenceRecord = { kind: 'LOCAL' | 'GITHUB' | 'HANDOFF_CONTRACT'; sourceId: string; content: string;
  version: string; observedAt: Date };
export type EvidenceCollection = { records: EvidenceRecord[]; unavailable: string[] };

export class EvidenceService {
  constructor(private readonly prisma: PrismaService, private readonly http: typeof fetch = fetch) {}

  private async requeueReviews(ownerId: string, projectId: string) {
    await this.prisma.handoffJob.updateMany({ where: { status: 'REVIEW_REQUIRED',
      request: { recipientId: ownerId, projectId } },
      data: { status: 'PENDING', reviewReason: null, reviewDraft: null } });
  }

  private async requireMember(userId: string, projectId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (user?.status !== 'APPROVED') throw new ForbiddenException();
    const membership = await this.prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { userId: true } });
    if (!membership) throw new NotFoundException();
  }

  async registerLocal(ownerId: string, projectId: string, localPath: string) {
    await this.requireMember(ownerId, projectId);
    const path = safeLocalPath(localPath);
    const syncToken = randomBytes(32).toString('base64url');
    const source = await this.prisma.evidenceSource.create({ data: {
      id: randomUUID(), ownerId, projectId, kind: 'LOCAL', localPath: path, syncTokenHash: digest(syncToken)
    }, select: { id: true, projectId: true, localPath: true, createdAt: true } });
    await this.requeueReviews(ownerId, projectId);
    return { ...source, syncToken };
  }

  async registerGithub(ownerId: string, projectId: string, input: { owner: string; repo: string; path: string; ref: string }) {
    await this.requireMember(ownerId, projectId);
    if (!safeGitPart(input.owner, 100) || input.owner.includes('/') || !safeGitPart(input.repo, 100) || input.repo.includes('/') ||
        !safeGitPart(input.path, 1024) || !safeGitPart(input.ref, 255)) throw new BadRequestException('Invalid GitHub source');
    const source = await this.prisma.evidenceSource.create({ data: { id: randomUUID(), ownerId, projectId, kind: 'GITHUB',
      githubOwner: input.owner, githubRepo: input.repo, githubPath: input.path, githubRef: input.ref },
      select: { id: true, projectId: true, kind: true, githubOwner: true, githubRepo: true, githubPath: true, githubRef: true, createdAt: true } });
    await this.requeueReviews(ownerId, projectId);
    return source;
  }

  async list(ownerId: string, projectId: string) {
    await this.requireMember(ownerId, projectId);
    return this.prisma.evidenceSource.findMany({ where: { ownerId, projectId, revokedAt: null },
      select: { id: true, kind: true, localPath: true, githubOwner: true, githubRepo: true, githubPath: true,
        githubRef: true, createdAt: true, snapshot: { select: { contentHash: true, syncedAt: true, dirtyAt: true } } },
      orderBy: { createdAt: 'desc' } });
  }

  async revoke(ownerId: string, sourceId: string) {
    return this.prisma.$transaction(async tx => {
      const source = await tx.evidenceSource.findUnique({ where: { id: sourceId }, select: { ownerId: true, projectId: true } });
      if (!source || source.ownerId !== ownerId) throw new NotFoundException();
      await this.requireMember(ownerId, source.projectId);
      await tx.evidenceSnapshot.deleteMany({ where: { sourceId } });
      await tx.evidenceSource.update({ where: { id: sourceId }, data: { revokedAt: new Date(), syncTokenHash: null } });
      return { revoked: true };
    });
  }

  private async requireLocalToken(sourceId: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    const source = await this.prisma.evidenceSource.findUnique({ where: { id: sourceId },
      select: { id: true, ownerId: true, projectId: true, kind: true, localPath: true, revokedAt: true, syncTokenHash: true } });
    if (!source || source.kind !== 'LOCAL' || source.revokedAt || source.syncTokenHash !== digest(token)) throw new UnauthorizedException();
    await this.requireMember(source.ownerId, source.projectId);
    return source;
  }

  async markDirty(sourceId: string, token: string) {
    await this.requireLocalToken(sourceId, token);
    await this.prisma.evidenceSnapshot.updateMany({ where: { sourceId }, data: { dirtyAt: new Date() } });
    return { dirty: true };
  }

  async syncLocal(sourceId: string, token: string, path: string, content: string, contentHash: string) {
    const source = await this.requireLocalToken(sourceId, token);
    if (source.localPath !== safeLocalPath(path) || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 60_000 ||
        !/^[0-9a-f]{64}$/i.test(contentHash) || digest(content) !== contentHash.toLowerCase()) {
      throw new BadRequestException('Invalid local snapshot');
    }
    const encryptedContent = encryptEvidence(content);
    const syncedAt = new Date();
    await this.prisma.evidenceSnapshot.upsert({ where: { sourceId },
      create: { sourceId, encryptedContent, contentHash: contentHash.toLowerCase(), syncedAt },
      update: { encryptedContent, contentHash: contentHash.toLowerCase(), syncedAt, dirtyAt: null } });
    await this.requeueReviews(source.ownerId, source.projectId);
    return { contentHash: contentHash.toLowerCase(), syncedAt };
  }

  private async fetchGithub(source: { id: string; githubOwner: string | null; githubRepo: string | null;
    githubPath: string | null; githubRef: string | null }): Promise<EvidenceRecord> {
    if (!source.githubOwner || !source.githubRepo || !source.githubPath || !source.githubRef) throw new Error('Source incomplete');
    const repoRoot = `https://api.github.com/repos/${encodeURIComponent(source.githubOwner)}/${encodeURIComponent(source.githubRepo)}`;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (process.env.GITHUB_READ_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_READ_TOKEN}`;
    const options: RequestInit = { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) };
    const commitResponse = await this.http(`${repoRoot}/commits/${encodeURIComponent(source.githubRef)}`, options);
    if (!commitResponse.ok) throw new Error('GitHub commit unavailable');
    const commit = await commitResponse.json() as { sha?: unknown };
    if (typeof commit.sha !== 'string' || !/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error('GitHub commit invalid');
    const path = source.githubPath.split('/').map(encodeURIComponent).join('/');
    const fileResponse = await this.http(`${repoRoot}/contents/${path}?ref=${commit.sha}`, options);
    if (!fileResponse.ok) throw new Error('GitHub file unavailable');
    const file = await fileResponse.json() as { content?: unknown; encoding?: unknown; size?: unknown; type?: unknown };
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' ||
        typeof file.size !== 'number' || file.size > 128_000 || file.content.length > 200_000) throw new Error('GitHub file unsupported');
    return { kind: 'GITHUB', sourceId: source.id, content: Buffer.from(file.content.replaceAll('\n', ''), 'base64').toString('utf8'),
      version: commit.sha, observedAt: new Date() };
  }

  async collect(ownerId: string, projectId: string, now = new Date(), claim?:string|null): Promise<EvidenceCollection> {
    await this.requireMember(ownerId, projectId);
    const sources = await this.prisma.evidenceSource.findMany({ where: { ownerId, projectId, revokedAt: null }, include: { snapshot: true } });
    const records: EvidenceRecord[] = [];
    const unavailable: string[] = [];
    for (const source of sources) {
      if (source.kind === 'LOCAL') {
        if (!source.snapshot || !isFreshLocalSnapshot(source.snapshot, now)) { unavailable.push('LOCAL_STALE'); continue; }
        try {
          records.push({ kind: 'LOCAL', sourceId: source.id, content: decryptEvidence(source.snapshot.encryptedContent),
            version: source.snapshot.contentHash, observedAt: source.snapshot.syncedAt });
        } catch { unavailable.push('LOCAL_UNREADABLE'); }
      } else {
        try { records.push(await this.fetchGithub(source)); }
        catch { unavailable.push('GITHUB_UNAVAILABLE'); }
      }
    }
    const contracts=await collectContractEvidence(this.prisma,projectId,claim,now);
    records.push(...contracts.records);unavailable.push(...contracts.unavailable);
    return { records, unavailable };
  }
}
