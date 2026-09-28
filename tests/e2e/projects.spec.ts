import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import pg from 'pg';

const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const origin = 'http://127.0.0.1:5174';

test('two members share one room only while assigned; service admin manages without room access', async ({ browser }) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const ownerId = randomUUID(), memberId = randomUUID(), otherId = randomUUID(), adminId = randomUUID(), pendingId = randomUUID();
  const users = [ownerId, memberId, otherId, adminId, pendingId];
  const credentials = users.map(() => ({ session: token(), csrf: token() }));
  const contexts: BrowserContext[] = [];
  let projectId: string | undefined;
  await client.connect();
  try {
    await client.query(`INSERT INTO users(id,status,is_service_admin,approved_at) VALUES
      ($1,'APPROVED',false,now()),($2,'APPROVED',false,now()),($3,'APPROVED',false,now()),
      ($4,'APPROVED',true,now()),($5,'PENDING',false,NULL)`, users);
    for (const [index, name] of ['담당자', '시험 팀원', '보조 팀원', '서비스 관리자', '승인 대기자'].entries()) {
      await client.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name)
        VALUES ($1,$2,'GOOGLE',$3,$4)`, [randomUUID(), users[index], randomUUID(), name]);
      await client.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at)
        VALUES ($1,$2,$3,now()+interval '1 day')`, [digest(credentials[index].session), digest(credentials[index].csrf), users[index]]);
    }
    async function pageFor(index: number) {
      const context = await browser.newContext();
      contexts.push(context);
      await context.addCookies([
        { name: 'ho_session', value: credentials[index].session, url: origin, httpOnly: true },
        { name: 'ho_csrf', value: credentials[index].csrf, url: origin, httpOnly: false }
      ]);
      return context.newPage();
    }
    const owner = await pageFor(0), member = await pageFor(1), other = await pageFor(2), admin = await pageFor(3), pending = await pageFor(4);
    await owner.goto('/projects');
    await expect(owner.getByRole('heading', { name: '프로젝트 선택' })).toBeVisible();
    await owner.getByRole('textbox', { name: '프로젝트 이름' }).fill('계약 공유 룸');
    await owner.getByRole('button', { name: '프로젝트 만들기' }).click();
    const projectLink = owner.getByRole('link', { name: '계약 공유 룸' });
    await expect(projectLink).toBeVisible();
    projectId = (await projectLink.getAttribute('href'))!.split('/')[2];
    await projectLink.click();
    await expect(owner.getByText('아직 공유된 요청이 없습니다.')).toBeVisible();
    await expect(owner.getByText(/담당자 · 관리 담당자/)).toBeVisible();
    await member.goto('/projects');
    await expect(member.getByText(/배정된 프로젝트가 없습니다/)).toBeVisible();
    await member.goto(`/projects/${projectId}`);
    await expect(member.getByRole('alert')).toContainText('접근 권한이 없습니다');
    await pending.goto(`/projects/${projectId}`);
    await expect(pending.getByRole('heading', { name: /가입 승인 대기/ })).toBeVisible();
    await owner.getByRole('link', { name: '멤버 관리' }).click();
    await owner.getByRole('textbox', { name: '회원 이름 검색' }).fill('시험 팀원');
    await owner.getByRole('button', { name: '검색' }).click();
    await owner.getByRole('listitem').filter({ hasText: '시험 팀원' }).getByRole('button', { name: '추가' }).click();
    await expect(owner.getByText(/시험 팀원 · 멤버/)).toBeVisible();
    await member.goto('/projects');
    await expect(member.getByRole('link', { name: '계약 공유 룸' })).toBeVisible();
    await member.getByRole('link', { name: '계약 공유 룸' }).click();
    await expect(member.getByText(/담당자 · 관리 담당자/)).toBeVisible();
    await expect(member.getByText(/시험 팀원 · 멤버/)).toBeVisible();
    await admin.goto('/admin/projects');
    await expect(admin.getByText(/계약 공유 룸 · 멤버 2명/)).toBeVisible();
    await admin.goto(`/projects/${projectId}`);
    await expect(admin.getByRole('alert')).toContainText('접근 권한이 없습니다');
    await admin.goto('/admin/projects');
    await admin.getByRole('link', { name: '멤버 관리' }).click();
    await admin.getByRole('textbox', { name: '회원 이름 검색' }).fill('보조 팀원');
    await admin.getByRole('button', { name: '검색' }).click();
    await admin.getByRole('listitem').filter({ hasText: '보조 팀원' }).getByRole('button', { name: '추가' }).click();
    await other.goto('/projects');
    await expect(other.getByRole('link', { name: '계약 공유 룸' })).toBeVisible();
    await owner.goto(`/projects/${projectId}/members`);
    await owner.getByRole('listitem').filter({ hasText: '시험 팀원 · 멤버' }).getByRole('button', { name: '제외' }).click();
    await expect(owner.getByText(/시험 팀원 · 멤버/)).not.toBeVisible();
    await member.goto('/projects');
    await expect(member.getByRole('link', { name: '계약 공유 룸' })).not.toBeVisible();
    await member.goto(`/projects/${projectId}`);
    await expect(member.getByRole('alert')).toContainText('접근 권한이 없습니다');
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    if (projectId) await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await client.end();
  }
});
