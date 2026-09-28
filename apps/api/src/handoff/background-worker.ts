import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { isFreshLocalSnapshot } from '../evidence/evidence-policy.js';
import { decideReply } from './reply-decision.js';
import { type AgentRunner, ManagedAgentRunner } from './agent-runner.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class HandoffBackgroundWorker {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  constructor(private readonly prisma: PrismaService, private readonly evidence: EvidenceService,
    private readonly agent: AgentRunner = new ManagedAgentRunner()) {}

  start() {
    if (this.timer) return;
    const tick = () => {
      if (this.busy) return;
      this.busy = true;
      void this.processPendingJobs().catch(() => undefined).finally(() => { this.busy = false; });
    };
    void this.wakeUnavailableJobs().then(tick).catch(() => undefined);
    this.timer = setInterval(tick, 10_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async wakeUnavailableJobs() {
    if (!process.env.OPENAI_API_KEY) return;
    await this.prisma.handoffJob.updateMany({ where: { status: 'REVIEW_REQUIRED', reviewReason: '서버 Codex 확인 불가' },
      data: { status: 'PENDING', reviewReason: null, reviewDraft: null } });
  }

  private async claimNext() {
    const now = new Date();
    const candidate = await this.prisma.handoffJob.findFirst({ where: { OR: [
      { status: 'PENDING' }, { status: 'PROCESSING', leaseUntil: { lt: now } }
    ] }, orderBy: { createdAt: 'asc' }, select: { requestId: true, status: true } });
    if (!candidate) return null;
    const executionId = randomUUID();
    const claimed = await this.prisma.handoffJob.updateMany({ where: { requestId: candidate.requestId,
      ...(candidate.status === 'PENDING' ? { status: 'PENDING' as const } :
        { status: 'PROCESSING' as const, leaseUntil: { lt: now } }) },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, executionId,
        leaseUntil: new Date(Date.now() + 10 * 60 * 1000) } });
    return claimed.count ? { requestId: candidate.requestId, executionId } : null;
  }

  private async review(requestId: string, executionId: string, reason: string) {
    await this.prisma.handoffJob.updateMany({ where: { requestId, status: 'PROCESSING', executionId },
      data: { status: 'REVIEW_REQUIRED', leaseUntil: null, reviewReason: reason,
        reviewDraft: '자동 확인 근거를 검토하고 공개할 회신을 직접 작성해 주세요.' } });
  }

  private async activeRequest(requestId: string) {
    const request = await this.prisma.handoffRequest.findUnique({ where: { id: requestId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 }, grant: true } });
    if (!request?.grant || request.grant.revokedAt || request.grant.expiresAt <= new Date()) return null;
    if (request.grant.userId !== request.senderId || request.grant.projectId !== request.projectId) return null;
    for (const userId of [request.senderId, request.recipientId]) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (user?.status !== 'APPROVED') return null;
      const member = await this.prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId: request.projectId, userId } } });
      if (!member) return null;
    }
    return request;
  }

  private async publish(requestId: string, executionId: string, version: number, body: string,
    refs: Array<{ kind: string; sourceId: string; version: string }>) {
    return this.prisma.$transaction(async tx => {
      const job = await tx.handoffJob.findUnique({ where: { requestId } });
      if (job?.status !== 'PROCESSING' || job.executionId !== executionId || !job.leaseUntil || job.leaseUntil <= new Date()) return false;
      const request = await tx.handoffRequest.findUnique({ where: { id: requestId },
        include: { grant: true, versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!request?.grant || request.grant.revokedAt || request.grant.expiresAt <= new Date() ||
          request.versions[0]?.version !== version) return false;
      if (request.grant.userId !== request.senderId || request.grant.projectId !== request.projectId) return false;
      for (const userId of [request.senderId, request.recipientId]) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
        const member = await tx.projectMembership.findUnique({ where: { projectId_userId: { projectId: request.projectId, userId } } });
        if (user?.status !== 'APPROVED' || !member) return false;
      }
      const sources = await tx.evidenceSource.findMany({
        where: { ownerId: request.recipientId, projectId: request.projectId, revokedAt: null },
        include: { snapshot: true }
      });
      if (sources.length !== refs.length || sources.some(source => {
        const ref = refs.find(item => item.sourceId === source.id && item.kind === source.kind);
        if (!ref) return true;
        return source.kind === 'LOCAL' &&
          (!source.snapshot || source.snapshot.contentHash !== ref.version ||
            !isFreshLocalSnapshot(source.snapshot, new Date()));
      })) return false;
      const humanReply = await tx.handoffReply.count({ where: { requestId, source: 'HUMAN' } });
      if (humanReply) {
        await tx.handoffJob.update({ where: { requestId }, data: { status: 'COMPLETED', leaseUntil: null } });
        return true;
      }
      await tx.handoffReply.createMany({ data: [{ id: randomUUID(), requestId, actorId: request.recipientId,
        body, source: 'CODEX_AUTO', replyKey: `auto-v${version}`, payloadHash: hash(body) }], skipDuplicates: true });
      await tx.handoffJob.update({ where: { requestId }, data: { status: 'COMPLETED', leaseUntil: null,
        evidenceRefs: refs, reviewReason: null, reviewDraft: null } });
      return true;
    }, { isolationLevel: 'Serializable' });
  }

  async processPendingJobs(limit = 5): Promise<number> {
    let processed = 0;
    for (let index = 0; index < limit; index++) {
      const job = await this.claimNext();
      if (!job) break;
      processed++;
      try {
        const request = await this.activeRequest(job.requestId);
        if (!request) { await this.review(job.requestId, job.executionId, '현재 요청 권한을 확인할 수 없습니다'); continue; }
        const version = request.versions[0];
        const existingReply = await this.prisma.handoffReply.count({ where: { requestId: request.id } });
        if (existingReply) {
          await this.prisma.handoffJob.updateMany({ where: { requestId: request.id, executionId: job.executionId },
            data: { status: 'COMPLETED', leaseUntil: null } });
          continue;
        }
        const collected = await this.evidence.collect(request.recipientId, request.projectId);
        const decision = decideReply(version?.verificationClaim ?? null, collected.records, collected.unavailable);
        if (decision.kind === 'REVIEW_REQUIRED') { await this.review(request.id, job.executionId, decision.reason); continue; }
        if (!process.env.OPENAI_API_KEY && this.agent instanceof ManagedAgentRunner) {
          await this.review(request.id, job.executionId, '서버 Codex 확인 불가'); continue;
        }
        const confirmed = await this.agent.confirmExplicitClaim(version.verificationClaim!, collected.records);
        if (!confirmed) { await this.review(request.id, job.executionId, '서버 Codex가 명시적 근거를 확인하지 못했습니다'); continue; }
        const current = await this.evidence.collect(request.recipientId, request.projectId);
        const second = decideReply(version.verificationClaim, current.records, current.unavailable);
        if (second.kind !== 'AUTO_REPLY' || JSON.stringify(second.evidenceRefs) !== JSON.stringify(decision.evidenceRefs)) {
          await this.review(request.id, job.executionId, '근거가 처리 중 변경되었습니다'); continue;
        }
        if (!await this.publish(request.id, job.executionId, version.version, decision.publicBody, decision.evidenceRefs)) {
          await this.review(request.id, job.executionId, '게시 전 권한 또는 버전이 변경되었습니다');
        }
      } catch {
        await this.review(job.requestId, job.executionId, '자동 확인을 완료하지 못했습니다');
      }
    }
    return processed;
  }
}
