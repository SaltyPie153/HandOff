import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PrismaService} from '../../../apps/api/dist/src/database/prisma.service.js';
import {EvidenceService} from '../../../apps/api/dist/src/evidence/evidence.service.js';
import {HandoffBackgroundWorker} from '../../../apps/api/dist/src/handoff/background-worker.js';
import {AgentKeyStore} from '../../../apps/api/dist/src/admin/agent-key.store.js';

export async function runContractEvidenceWorker(){
 const url=new URL(process.env.DATABASE_URL??'');
 if(process.env.NODE_ENV!=='test'||url.hostname!=='127.0.0.1'||url.port!=='5433'||url.pathname!=='/handoff_test')throw new Error('TEST_DATABASE_REQUIRED');
 const prefix=join(tmpdir(),'handoff-contract-e2e-'),root=await mkdtemp(prefix);
 const db=new PrismaService({databaseUrl:process.env.DATABASE_URL});let modelCalls=0;
 try{
  const store=new AgentKeyStore({nodeEnv:'test',secretDir:join(root,'protected')});await store.save('upstage-fake-contract-e2e-key');
  const worker=new HandoffBackgroundWorker(db,new EvidenceService(db),{confirmExplicitClaim:async()=>{modelCalls++;return true;}},store);
  await worker.wakeUnavailableJobs();const processed=await worker.processPendingJobs(100);
  return {processed,modelCalls};
 }finally{await db.$disconnect();if(!root.startsWith(prefix))throw new Error('UNSAFE_CLEANUP');await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runContractEvidenceWorker()));
