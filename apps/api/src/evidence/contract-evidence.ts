import type {Prisma} from '../generated/prisma/client.js';
import type {EvidenceCollection,EvidenceRecord} from './evidence.service.js';
import {parseClaim,extractClaimLines} from './evidence-clause.js';
export async function lockContractEvidenceProject(tx:Prisma.TransactionClient,projectId:string,mode:'READ'|'WRITE'):Promise<void>{
  const key='handoff:contract-evidence:'+projectId;
  if(mode==='READ')await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))::text`;
  else await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
}
export async function collectContractEvidence(db:Pick<Prisma.TransactionClient,'developmentContract'>,projectId:string,
  claim:string|null|undefined,now:Date):Promise<EvidenceCollection>{
  const parsed=parseClaim(claim),result:EvidenceCollection={records:[],unavailable:[]};
  if(!parsed)return result;
  const contracts=await db.developmentContract.findMany({where:{projectId,status:'ACTIVE'},orderBy:{id:'asc'},
    select:{id:true,currentVersionId:true,currentVersion:{select:{id:true,contractId:true,status:true,proposedBody:true,proposal:{select:{kind:true}}}}}});
  for(const contract of contracts){
    const version=contract.currentVersion;
    if(!version||version.id!==contract.currentVersionId||version.contractId!==contract.id||version.status!=='CONFIRMED'||!['INITIAL','CHANGE'].includes(version.proposal.kind)){
      result.unavailable.push('CONTRACT_UNAVAILABLE');continue;
    }
    const extracted=extractClaimLines(version.proposedBody,parsed.key);
    if(!extracted.values.length&&!extracted.malformed)continue;
    result.records.push({kind:'HANDOFF_CONTRACT',sourceId:contract.id,version:version.id,content:version.proposedBody,observedAt:now});
  }
  return result;
}
export function canonicalEvidenceRefs(records:EvidenceRecord[]):Array<{kind:string;sourceId:string;version:string}>{
  return records.map(({kind,sourceId,version})=>({kind,sourceId,version})).sort((a,b)=>
    a.kind.localeCompare(b.kind)||a.sourceId.localeCompare(b.sourceId)||a.version.localeCompare(b.version));
}
