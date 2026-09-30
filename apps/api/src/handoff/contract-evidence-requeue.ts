import {Prisma,type HandoffJobStatus} from '../generated/prisma/client.js';
import {parseClaim} from '../evidence/evidence-clause.js';
import {EVIDENCE_REVIEW_REASONS} from '../evidence/evidence-review.js';

export async function requeueContractEvidenceJobs(tx:Prisma.TransactionClient,projectId:string):Promise<number>{
  // Lock existing executions before choosing them so claim/review cannot lose the event.
  const jobs=await tx.$queryRaw<Array<{versionId:string;status:HandoffJobStatus;executionId:string|null;
    reviewReason:string|null;version:number;claim:string|null}>>`
    SELECT j.version_id AS "versionId",j.status,j.execution_id AS "executionId",j.review_reason AS "reviewReason",
      v.version,v.verification_claim AS claim
    FROM handoff_jobs j JOIN handoff_versions v ON v.id=j.version_id
      JOIN handoff_requests r ON r.id=j.request_id
    WHERE r.project_id=${projectId}::uuid AND r.current_version=v.version AND v.status='AWAITING_REVIEW'
      AND j.status IN ('PROCESSING','REVIEW_REQUIRED')
      AND NOT EXISTS(SELECT 1 FROM handoff_replies reply WHERE reply.version_id=v.id)
      AND NOT EXISTS(SELECT 1 FROM handoff_responses response WHERE response.version_id=v.id)
    ORDER BY j.version_id FOR UPDATE OF j`;
  let count=0;
  for(const job of jobs){
    if(!parseClaim(job.claim)||(job.status==='REVIEW_REQUIRED'&&!EVIDENCE_REVIEW_REASONS.includes(job.reviewReason??'')))continue;
    const updated=await tx.handoffJob.updateMany({where:{versionId:job.versionId,status:job.status,
      executionId:job.executionId,reviewReason:job.reviewReason,request:{projectId,currentVersion:job.version},
      version:{status:'AWAITING_REVIEW',replies:{none:{}},responses:{none:{}}}},
      data:{status:'PENDING',executionId:null,leaseUntil:null,reviewReason:null,reviewDraft:null,evidenceRefs:Prisma.DbNull}});
    count+=updated.count;
  }
  return count;
}
