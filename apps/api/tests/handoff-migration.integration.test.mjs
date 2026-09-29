import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const integration = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL ? test : test.skip;
const directory = new URL('../prisma/migrations/', import.meta.url);

for (const ambiguous of [false, true]) integration(`workflow migration ${ambiguous ? 'rejects ambiguous legacy versions' : 'preserves replies without inventing human confirmation'}`, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = 'migration_' + randomUUID().replaceAll('-', '');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    for (const name of (await readdir(directory)).filter(n => /^000[1-7]_/.test(n)).sort()) {
      await client.query(await readFile(new URL(`${name}/migration.sql`, directory), 'utf8'));
    }
    const [a, b, project, request, version, reply] = Array.from({ length: 6 }, () => randomUUID());
    await client.query(`INSERT INTO users(id,status) VALUES ($1,'APPROVED'),($2,'APPROVED')`, [a,b]);
    await client.query(`INSERT INTO projects(id,name,creator_id) VALUES ($1,'migration',$2)`, [project,a]);
    await client.query(`INSERT INTO handoff_requests(id,project_id,sender_id,recipient_id,public_title,send_key,payload_hash) VALUES ($1,$2,$3,$4,'title','key',$5)`, [request,project,a,b,'a'.repeat(64)]);
    await client.query(`INSERT INTO handoff_versions(id,request_id,version,private_body) VALUES ($1,$2,1,'private')`, [version,request]);
    await client.query(`INSERT INTO handoff_replies(id,request_id,actor_id,body,source,reply_key,payload_hash) VALUES ($1,$2,$3,'existing reply','CODEX_AUTO','auto-v1',$4)`, [reply,request,b,'a'.repeat(64)]);
    await client.query(`INSERT INTO handoff_jobs(request_id,status,updated_at) VALUES ($1,'COMPLETED',now())`, [request]);
    if (ambiguous) await client.query(`INSERT INTO handoff_versions(id,request_id,version,private_body) VALUES ($1,$2,2,'later')`, [randomUUID(),request]);
    const files = await readdir(directory);
    assert.ok(files.includes('0008_handoff_human_workflow'), 'human workflow migration must exist');
    const sql = await readFile(new URL('0008_handoff_human_workflow/migration.sql', directory), 'utf8');
    if (ambiguous) {
      await assert.rejects(client.query(sql), /Ambiguous legacy handoff versions/);
    } else {
      await client.query(sql);
      assert.equal((await client.query('SELECT status FROM handoff_versions')).rows[0].status, 'AWAITING_REVIEW');
      assert.equal((await client.query('SELECT count(*)::int AS n FROM handoff_responses')).rows[0].n, 0);
      assert.deepEqual((await client.query('SELECT body,version_id FROM handoff_replies')).rows[0], { body: 'existing reply', version_id: version });
      assert.equal((await client.query('SELECT version_id FROM handoff_jobs')).rows[0].version_id, version);
    }
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
