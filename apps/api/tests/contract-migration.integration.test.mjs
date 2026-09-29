import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
integration('contract migration preserves handoffs and enforces version and participant integrity',async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN');const schema='contract_test_'+randomUUID().replaceAll('-','');
  await db.query(`CREATE SCHEMA "${schema}"`);await db.query(`SET LOCAL search_path TO "${schema}"`);
  const root=new URL('../prisma/migrations/',import.meta.url);
  for(const n of (await readdir(root)).filter(n=>/^000[1-8]_/.test(n)).sort())await db.query(await readFile(new URL(n+'/migration.sql',root),'utf8'));
  const [a,b,p,r,v]=Array.from({length:5},()=>randomUUID());
  await db.query(`INSERT INTO users(id,status) VALUES ($1,'APPROVED'),($2,'APPROVED')`,[a,b]);
  await db.query(`INSERT INTO projects(id,name,creator_id) VALUES ($1,'test',$2)`,[p,a]);
  await db.query(`INSERT INTO handoff_requests(id,project_id,sender_id,recipient_id,public_title,send_key,payload_hash) VALUES ($1,$2,$3,$4,'old','key',$5)`,[r,p,a,b,'a'.repeat(64)]);
  await db.query(`INSERT INTO handoff_versions(id,request_id,version,private_body) VALUES ($1,$2,1,'preserved')`,[v,r]);
  await db.query(`INSERT INTO handoff_responses(id,request_id,version_id,actor_id,action,response_key,payload_hash) VALUES ($1,$2,$3,$4,'ACKNOWLEDGE','key',$5)`,[randomUUID(),r,v,b,'a'.repeat(64)]);
  assert.ok((await readdir(root)).includes('0009_contract_agreement'),'contract migration exists');
  await db.query(await readFile(new URL('0009_contract_agreement/migration.sql',root),'utf8'));
  assert.equal((await db.query('SELECT count(*)::int n FROM contract_responses')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM handoff_responses')).rows[0].n,1);
  assert.equal((await db.query('SELECT private_body FROM handoff_versions')).rows[0].private_body,'preserved');
  const [c,q,w,c2]=Array.from({length:4},()=>randomUUID());
  await db.query(`INSERT INTO development_contracts(id,project_id,public_title) VALUES($1,$2,'contract'),($3,$2,'other')`,[c,p,c2]);
  await db.query(`INSERT INTO contract_proposals(id,contract_id,sender_id,recipient_id,send_key,payload_hash) VALUES($1,$2,$3,$4,'proposal',$5)`,[q,c,a,b,'b'.repeat(64)]);
  await db.query(`INSERT INTO contract_proposal_versions(id,proposal_id,contract_id,version,proposed_body,send_key,payload_hash) VALUES($1,$2,$3,1,'body','version',$4)`,[w,q,c,'b'.repeat(64)]);
  await db.query(`INSERT INTO contract_participants(version_id,user_id,role) VALUES($1,$2,'SENDER')`,[w,a]);
  await db.query(`INSERT INTO contract_responses(id,proposal_id,version_id,actor_id,action,response_key,payload_hash) VALUES($1,$2,$3,$4,'AGREE','agree',$5)`,[randomUUID(),q,w,a,'b'.repeat(64)]);
  async function rejected(sql,args,code){await db.query('SAVEPOINT integrity_check');await assert.rejects(db.query(sql,args),e=>e.code===code);await db.query('ROLLBACK TO SAVEPOINT integrity_check');}
  await rejected(`INSERT INTO contract_participants(version_id,user_id,role) VALUES($1,$2,'REQUIRED_PM')`,[w,a],'23505');
  await rejected(`INSERT INTO contract_responses(id,proposal_id,version_id,actor_id,action,response_key,payload_hash) VALUES($1,$2,$3,$4,'AGREE','other',$5)`,[randomUUID(),q,w,a,'b'.repeat(64)],'23505');
  await rejected(`UPDATE development_contracts SET status='ACTIVE',current_version_id=$1,confirmed_at=now() WHERE id=$2`,[w,c2],'23503');
  await rejected(`UPDATE contract_proposal_versions SET version=0 WHERE id=$1`,[w],'23514');
  await rejected(`UPDATE contract_responses SET action='REQUEST_CHANGES',comment=NULL WHERE version_id=$1`,[w],'23514');
 }finally{await db.query('ROLLBACK');await db.end();}
});
