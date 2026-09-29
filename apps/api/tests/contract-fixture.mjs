import {randomUUID,createHash} from 'node:crypto';
import {PrismaService} from '../dist/src/database/prisma.service.js';
export async function fixture(){
 const db=new PrismaService({databaseUrl:process.env.DATABASE_URL});
 const [a,b,pm,ref,c,p]=Array.from({length:6},()=>randomUUID());const users=[a,b,pm,ref,c];
 await db.user.createMany({data:users.map(id=>({id,status:'APPROVED'}))});
 await db.project.create({data:{id:p,name:'contract test',creatorId:a,memberships:{create:users.map(userId=>({userId,role:'MEMBER'}))}}});
 const grant=await db.mcpGrant.create({data:{userId:a,projectId:p,tokenHash:createHash('sha256').update(randomUUID()).digest('hex'),expiresAt:new Date(Date.now()+600000)}});
 const input={recipientId:b,publicTitle:'Public contract title',proposedBody:'private body v1',requiredPmIds:[pm],referencePmIds:[ref],idempotencyKey:randomUUID()};
 return {db,a,b,pm,ref,c,p,grant,input,async close(){
  await db.developmentContract.updateMany({where:{projectId:p},data:{status:'UNCONFIRMED',currentVersionId:null,confirmedAt:null}});
  await db.project.delete({where:{id:p}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
 }};
}
export const action=(version,kind='AGREE')=>({version,action:kind,...(kind==='REQUEST_CHANGES'?{comment:'Private revision comment'}:{}),idempotencyKey:randomUUID()});
export const status=n=>e=>e?.getStatus?.()===n;
