import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
integration('0009 contracts survive lifecycle migration with history and one open proposal',async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN');const schema='lifecycle_'+randomUUID().replaceAll('-','');await db.query(`CREATE SCHEMA "${schema}"`);await db.query(`SET LOCAL search_path TO "${schema}"`);
  const root=new URL('../prisma/migrations/',import.meta.url);
  for(const n of (await readdir(root)).filter(n=>/^000[1-9]_/.test(n)).sort())await db.query(await readFile(new URL(n+'/migration.sql',root),'utf8'));
  const [a,b,p,c,q,v,c2,q2,v2,v3]=Array.from({length:10},()=>randomUUID()),hash='a'.repeat(64);
  await db.query(`INSERT INTO users(id,status) VALUES ($1,'APPROVED'),($2,'APPROVED')`,[a,b]);await db.query(`INSERT INTO projects(id,name,creator_id) VALUES($1,'test',$2)`,[p,a]);
  await db.query(`INSERT INTO development_contracts(id,project_id,public_title) VALUES($1,$3,'active'),($2,$3,'pending')`,[c,c2,p]);
  await db.query(`INSERT INTO contract_proposals(id,contract_id,sender_id,recipient_id,send_key,payload_hash,current_version) VALUES($1,$2,$5,$6,'first',$7,1),($3,$4,$5,$6,'second',$7,2)`,[q,c,q2,c2,a,b,hash]);
  await db.query(`INSERT INTO contract_proposal_versions(id,proposal_id,contract_id,version,proposed_body,send_key,payload_hash,status,confirmed_at) VALUES($1,$2,$3,1,'original','key',$4,'CONFIRMED',now()),($5,$6,$7,1,'old','v1',$4,'SUPERSEDED',null),($8,$6,$7,2,'pending','v2',$4,'CHANGES_REQUESTED',null)`,[v,q,c,hash,v2,q2,c2,v3]);
  await db.query(`UPDATE development_contracts SET status='ACTIVE',current_version_id=$1,confirmed_at=now() WHERE id=$2`,[v,c]);
  await db.query(`INSERT INTO contract_responses(id,proposal_id,version_id,actor_id,action,response_key,payload_hash,comment) VALUES($1,$2,$3,$4,'REQUEST_CHANGES','response',$5,'private')`,[randomUUID(),q2,v3,b,hash]);
  assert.ok((await readdir(root)).includes('0010_contract_lifecycle'),'lifecycle migration exists');
  await db.query(await readFile(new URL('0010_contract_lifecycle/migration.sql',root),'utf8'));
  const row=(await db.query('SELECT * FROM development_contracts WHERE id=$1',[c])).rows[0];assert.equal(row.last_confirmed_version_id,v);assert.equal(row.sender_id,a);assert.equal(row.recipient_id,b);
  assert.deepEqual((await db.query('SELECT lifecycle FROM contract_proposals ORDER BY send_key')).rows.map(r=>r.lifecycle),['CONFIRMED','OPEN']);
  assert.equal((await db.query('SELECT comment FROM contract_responses')).rows[0].comment,'private');assert.equal((await db.query('SELECT proposed_body FROM contract_proposal_versions WHERE id=$1',[v])).rows[0].proposed_body,'original');
  async function rejected(sql,args,code){await db.query('SAVEPOINT integrity');await assert.rejects(db.query(sql,args),e=>e.code===code);await db.query('ROLLBACK TO SAVEPOINT integrity');}
  await rejected(`INSERT INTO contract_proposals(id,contract_id,sender_id,recipient_id,send_key,payload_hash) VALUES($1,$2,$3,$4,'duplicate',$5)`,[randomUUID(),c2,a,b,hash],'23505');
  await rejected(`UPDATE development_contracts SET last_confirmed_version_id=$1 WHERE id=$2`,[v,c2],'23514');
  await rejected(`INSERT INTO contract_proposals(id,contract_id,sender_id,recipient_id,send_key,payload_hash,kind,baseline_version_id) VALUES($1,$2,$3,$4,'cross',$5,'CHANGE',$6)`,[randomUUID(),c,a,b,hash,v3],'23503');
 }finally{await db.query('ROLLBACK');await db.end();}
});
