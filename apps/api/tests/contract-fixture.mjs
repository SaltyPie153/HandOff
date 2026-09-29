import {randomUUID,createHash} from 'node:crypto';
import {PrismaService} from '../dist/src/database/prisma.service.js';
export async function fixture(){
 const applicationName='contract-test-'+randomUUID(),url=new URL(process.env.DATABASE_URL);url.searchParams.set('application_name',applicationName);
 const db=new PrismaService({databaseUrl:url.href});
 const [a,b,pm,ref,c,p]=Array.from({length:6},()=>randomUUID());const users=[a,b,pm,ref,c];
 await db.user.createMany({data:users.map(id=>({id,status:'APPROVED'}))});
 const sessions=new Map(users.map(userId=>[userId,{tokenHash:createHash('sha256').update(randomUUID()).digest('hex'),csrfHash:createHash('sha256').update(randomUUID()).digest('hex')}]));
 await db.authSession.createMany({data:users.map(userId=>({...sessions.get(userId),userId,expiresAt:new Date(Date.now()+600000)}))});
 await db.project.create({data:{id:p,name:'contract test',creatorId:a,memberships:{create:users.map(userId=>({userId,role:'MEMBER'}))}}});
 const grant=await db.mcpGrant.create({data:{userId:a,projectId:p,tokenHash:createHash('sha256').update(randomUUID()).digest('hex'),expiresAt:new Date(Date.now()+600000)}});
 const input={recipientId:b,publicTitle:'Public contract title',proposedBody:'private body v1',requiredPmIds:[pm],referencePmIds:[ref],idempotencyKey:randomUUID()};
 return {db,a,b,pm,ref,c,p,grant,input,applicationName,sessionFor:id=>sessions.get(id),async close(){
  await db.developmentContract.updateMany({where:{projectId:p},data:{status:'UNCONFIRMED',currentVersionId:null,confirmedAt:null}});
  await db.project.delete({where:{id:p}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
 }};
}
export const action=(version,kind='AGREE')=>({version,action:kind,...(kind==='REQUEST_CHANGES'?{comment:'Private revision comment'}:{}),idempotencyKey:randomUUID()});
export const status=n=>e=>e?.getStatus?.()===n;
export function sessionFlow(Repository,f){const repo=new Repository(f.db);return {propose:repo.propose.bind(repo),revise:repo.revise.bind(repo),respond:(actor,p,id,input)=>repo.respond(actor,p,id,input,f.sessionFor(actor))};}
