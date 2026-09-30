import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { isFreshLocalSnapshot } from '../evidence/evidence-policy.js';
import { decideReply } from './reply-decision.js';
import { type AgentRunner, ManagedAgentRunner } from './agent-runner.js';
import { lockRequest, requireParticipants, requireGrant } from './handoff-workflow.js';
import { AgentKeyStore } from '../admin/agent-key.store.js';
import {collectContractEvidence,canonicalEvidenceRefs,lockContractEvidenceProject} from '../evidence/contract-evidence.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class HandoffBackgroundWorker {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  constructor(private readonly prisma: PrismaService, private readonly evidence: EvidenceService,
    private readonly agent: AgentRunner = new ManagedAgentRunner(),
    private readonly keyStore: AgentKeyStore = new AgentKeyStore({ nodeEnv: process.env.NODE_ENV ?? 'development',
      secretDir: process.env.HANDOFF_SECRET_DIR })) {}

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
    if (!(await this.keyStore.read()).configured) return;
    await this.prisma.handoffJob.updateMany({ where: { status: 'REVIEW_REQUIRED', reviewReason: { in: ['서버 Codex 확인 불가', 'Upstage 확인 불가'] } },
      data: { status: 'PENDING', reviewReason: null, reviewDraft: null } });
  }

  private async claimNext() {
    const now = new Date();
    const candidate = await this.prisma.handoffJob.findFirst({ where: { OR: [
      { status: 'PENDING' }, { status: 'PROCESSING', leaseUntil: { lt: now } }
    ] }, orderBy: { createdAt: 'asc' }, select: { requestId: true, versionId: true, status: true,request:{select:{projectId:true}} } });
    if (!candidate) return null;
    const executionId = randomUUID();
    return this.prisma.$transaction(async tx=>{
    // A confirmation either sees this execution or commits before the claim starts.
    await lockContractEvidenceProject(tx,candidate.request.projectId,'READ');
    const claimed = await tx.handoffJob.updateMany({ where: { versionId: candidate.versionId,
      ...(candidate.status === 'PENDING' ? { status: 'PENDING' as const } :
        { status: 'PROCESSING' as const, leaseUntil: { lt: now } }) },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, executionId,
        leaseUntil: new Date(Date.now() + 10 * 60 * 1000) } });
    return claimed.count ? { requestId: candidate.requestId, versionId: candidate.versionId, executionId } : null;
    });
  }

  private async review(versionId: string, executionId: string, reason: string) {
    await this.prisma.handoffJob.updateMany({ where: { versionId, status: 'PROCESSING', executionId },
      data: { status: 'REVIEW_REQUIRED', leaseUntil: null, reviewReason: reason,
        reviewDraft: '자동 확인 근거를 검토하고 공개할 회신을 직접 작성해 주세요.' } });
  }

  private async activeRequest(requestId: string, versionId: string) {
    const request = await this.prisma.handoffRequest.findUnique({ where: { id: requestId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 }, grant: true } });
    if (!request?.grant || request.versions[0]?.id !== versionId || request.versions[0]?.status !== 'AWAITING_REVIEW' || request.grant.revokedAt || request.grant.expiresAt <= new Date()) return null;
    if (request.grant.userId !== request.senderId || request.grant.projectId !== request.projectId) return null;
    for (const userId of [request.senderId, request.recipientId]) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (user?.status !== 'APPROVED') return null;
      const member = await this.prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId: request.projectId, userId } } });
      if (!member) return null;
    }
    return request;
  }

  private async publish(requestId: string, versionId: string, executionId: string, version: number, body: string,
    refs: Array<{ kind: string; sourceId: string; version: string }>) {
    const project=await this.prisma.handoffRequest.findUnique({where:{id:requestId},select:{projectId:true}});
    if(!project)return false;
    return this.prisma.$transaction(async tx => {
      await lockContractEvidenceProject(tx,project.projectId,'READ');
      await lockRequest(tx, requestId);
      const job = await tx.handoffJob.findUnique({ where: { versionId } });
      if (job?.status !== 'PROCESSING' || job.executionId !== executionId || !job.leaseUntil || job.leaseUntil <= new Date()) return false;
      const request = await tx.handoffRequest.findUnique({ where: { id: requestId },
        include: { grant: true, versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!request?.grant || request.versions[0]?.id !== versionId || request.versions[0]?.status !== 'AWAITING_REVIEW' || request.grant.revokedAt || request.grant.expiresAt <= new Date() ||
          request.versions[0]?.version !== version) return false;
      if (request.grant.userId !== request.senderId || request.grant.projectId !== request.projectId) return false;
      await requireParticipants(tx, request);
      await requireGrant(tx, request.grant.id, request.senderId, request.projectId);
      for (const userId of [request.senderId, request.recipientId]) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
        const member = await tx.projectMembership.findUnique({ where: { projectId_userId: { projectId: request.projectId, userId } } });
        if (user?.status !== 'APPROVED' || !member) return false;
      }
      const sources = await tx.evidenceSource.findMany({
        where: { ownerId: request.recipientId, projectId: request.projectId, revokedAt: null },
        include: { snapshot: true }
      });
      const fileRefs=refs.filter(ref=>ref.kind!=='HANDOFF_CONTRACT');
      if (sources.length !== fileRefs.length || sources.some(source => {
        const ref = fileRefs.find(item => item.sourceId === source.id && item.kind === source.kind);
        if (!ref) return true;
        return source.kind === 'LOCAL' &&
          (!source.snapshot || source.snapshot.contentHash !== ref.version ||
            !isFreshLocalSnapshot(source.snapshot, new Date()));
      })) return 'EVIDENCE_CHANGED' as const;
      const contracts=await collectContractEvidence(tx,request.projectId,request.versions[0].verificationClaim,new Date());
      const contractRefs=refs.filter(ref=>ref.kind==='HANDOFF_CONTRACT');
      if(contracts.unavailable.length||JSON.stringify(canonicalEvidenceRefs(contracts.records))!==JSON.stringify(contractRefs)||
        (contracts.records.length&&decideReply(request.versions[0].verificationClaim,contracts.records,[]).kind!=='AUTO_REPLY'))return 'EVIDENCE_CHANGED' as const;
      const humanReply = await tx.handoffReply.count({ where: { versionId, source: 'HUMAN' } });
      if (humanReply) {
        await tx.handoffJob.update({ where: { versionId }, data: { status: 'COMPLETED', leaseUntil: null } });
        return true;
      }
      await tx.handoffReply.createMany({ data: [{ id: randomUUID(), requestId, versionId, actorId: request.recipientId,
        body, source: 'CODEX_AUTO', replyKey: `auto-v${version}`, payloadHash: hash(body) }], skipDuplicates: true });
      await tx.handoffJob.update({ where: { versionId }, data: { status: 'COMPLETED', leaseUntil: null,
        evidenceRefs: refs, reviewReason: null, reviewDraft: null } });
      return true;
    });
  }

  async processPendingJobs(limit = 5): Promise<number> {
    let processed = 0;
    for (let index = 0; index < limit; index++) {
      const job = await this.claimNext();
      if (!job) break;
      processed++;
      try {
        const request = await this.activeRequest(job.requestId, job.versionId);
        if (!request) { await this.review(job.versionId, job.executionId, '현재 요청 권한을 확인할 수 없습니다'); continue; }
        const version = request.versions[0];
        const existingReply = await this.prisma.handoffReply.count({ where: { versionId: job.versionId } });
        if (existingReply) {
          await this.prisma.handoffJob.updateMany({ where: { versionId: job.versionId, executionId: job.executionId },
            data: { status: 'COMPLETED', leaseUntil: null } });
          continue;
        }
        const collected = await this.evidence.collect(request.recipientId, request.projectId,new Date(),version.verificationClaim);
        const decision = decideReply(version?.verificationClaim ?? null, collected.records, collected.unavailable);
        if (decision.kind === 'REVIEW_REQUIRED') { await this.review(job.versionId, job.executionId, decision.reason); continue; }
        const keyState = await this.keyStore.read();
        if (!keyState.configured || !keyState.key) {
          await this.review(job.versionId, job.executionId, 'Upstage 확인 불가'); continue;
        }
        const confirmed = await this.agent.confirmExplicitClaim(version.verificationClaim!, collected.records, keyState.key);
        if (!confirmed) { await this.review(job.versionId, job.executionId, 'Upstage가 명시적 근거를 확인하지 못했습니다'); continue; }
        const current = await this.evidence.collect(request.recipientId, request.projectId,new Date(),version.verificationClaim);
        const second = decideReply(version.verificationClaim, current.records, current.unavailable);
        const refs=canonicalEvidenceRefs(collected.records);
        if (second.kind !== 'AUTO_REPLY' || JSON.stringify(canonicalEvidenceRefs(current.records)) !== JSON.stringify(refs)) {
          await this.review(job.versionId, job.executionId, '근거가 처리 중 변경되었습니다'); continue;
        }
        const publication = await this.keyStore.withGeneration(keyState.generation, () =>
          this.publish(request.id, job.versionId, job.executionId, version.version, decision.publicBody, refs));
        if (!publication.unchanged) {
          await this.review(job.versionId, job.executionId, 'Upstage 키 설정이 변경되었습니다'); continue;
        }
        if(publication.value==='EVIDENCE_CHANGED'){
          await this.review(job.versionId,job.executionId,'게시 전 근거가 변경되었습니다');
        }else if (!publication.value) {
          await this.review(job.versionId, job.executionId, '게시 전 권한 또는 버전이 변경되었습니다');
        }
      } catch {
        await this.review(job.versionId, job.executionId, '자동 확인을 완료하지 못했습니다');
      }
    }
    return processed;
  }
}
