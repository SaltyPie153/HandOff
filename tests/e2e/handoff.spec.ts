import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import pg from 'pg';

const origin = 'http://127.0.0.1:5174';
const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('MCP private request exposes only its title to teammates and a reviewed reply to the team', async ({ browser }) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const [senderId, recipientId, teammateId] = Array.from({ length: 3 }, () => randomUUID());
  const users = [senderId, recipientId, teammateId];
  const credentials = users.map(() => ({ session: token(), csrf: token() }));
  const projectId = randomUUID();
  const contexts: BrowserContext[] = [];
  await db.connect();
  try {
    await db.query(`INSERT INTO users(id,status,approved_at) VALUES ($1,'APPROVED',now()),($2,'APPROVED',now()),($3,'APPROVED',now())`, users);
    for (const [index, name] of ['송신자', '수신자', '팀원'].entries()) {
      await db.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name) VALUES ($1,$2,'GOOGLE',$3,$4)`,
        [randomUUID(), users[index], randomUUID(), name]);
      await db.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')`,
        [digest(credentials[index].session), digest(credentials[index].csrf), users[index]]);
    }
    await db.query('INSERT INTO projects(id,name,creator_id) VALUES ($1,$2,$3)', [projectId, 'MCP 시험 룸', senderId]);
    await db.query(`INSERT INTO project_memberships(project_id,user_id,role) VALUES
      ($1,$2,'MANAGER'),($1,$3,'MEMBER'),($1,$4,'MEMBER')`, [projectId, senderId, recipientId, teammateId]);
    async function pageFor(index: number) {
      const context = await browser.newContext();
      contexts.push(context);
      await context.addCookies([
        { name: 'ho_session', value: credentials[index].session, url: origin, httpOnly: true },
        { name: 'ho_csrf', value: credentials[index].csrf, url: origin, httpOnly: false }
      ]);
      return context.newPage();
    }
    const sender = await pageFor(0), recipient = await pageFor(1), teammate = await pageFor(2);
    await sender.goto('/settings');
    await sender.getByRole('button', { name: 'MCP 연결 발급' }).click();
    const grantToken = await sender.getByRole('textbox', { name: '새 MCP 토큰' }).inputValue();
    const send = (key: string) => fetch(`${origin}/api/mcp/requests`, { method: 'POST',
      headers: { Authorization: `Bearer ${grantToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, recipientId, publicTitle: '공개 일정 제목',
        privateBody: '비공개 계약 세부', idempotencyKey: key }) });
    const key = randomUUID();
    const first = await send(key);
    expect(first.status).toBe(201);
    const requestId = (await first.json() as { id: string }).id;
    expect((await send(key)).status).toBe(201);
    await teammate.goto(`/projects/${projectId}/feed`);
    await expect(teammate.getByText('공개 일정 제목')).toBeVisible();
    await expect(teammate.getByText('비공개 계약 세부')).not.toBeVisible();
    await teammate.goto(`/projects/${projectId}/requests/${requestId}`);
    await expect(teammate.getByRole('alert')).toContainText('접근 권한이 없습니다');
    await recipient.goto(`/projects/${projectId}/requests/${requestId}`);
    await expect(recipient.getByText('비공개 계약 세부')).toBeVisible();
    await recipient.getByRole('textbox', { name: '팀 공개 회신' }).fill('공개해도 되는 진행 상황');
    await recipient.getByRole('button', { name: '공개 내용 미리보기' }).click();
    await expect(recipient.getByText(/프로젝트 팀원 모두/)).toBeVisible();
    await recipient.getByRole('button', { name: '팀에 게시' }).click();
    await expect(recipient.getByText('회신을 게시했습니다.')).toBeVisible();
    await teammate.goto(`/projects/${projectId}/feed`);
    await expect(teammate.getByText(/공개해도 되는 진행 상황/)).toBeVisible();
    await sender.goto('/settings');
    const revoked = sender.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname.startsWith('/api/mcp/grants/'));
    await sender.getByRole('button', { name: '철회', exact: true }).click();
    expect((await revoked).status()).toBe(200);
    expect((await send(randomUUID())).status).toBe(401);
    const removed = await sender.context().request.delete(`${origin}/api/projects/${projectId}/members/${teammateId}`, {
      headers: { 'X-CSRF-Token': credentials[0].csrf }
    });
    expect(removed.status()).toBe(200);
    await teammate.reload();
    await expect(teammate.getByRole('alert')).toContainText('접근 권한이 없습니다');
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await db.end();
  }
});
