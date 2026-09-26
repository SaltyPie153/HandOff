import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';

const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('pending member stays on approval screen until admin approves, then sees project selection', async ({ page, context }) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const adminId = randomUUID();
  const memberId = randomUUID();
  const adminToken = token();
  const adminCsrf = token();
  const memberToken = token();
  const memberCsrf = token();
  await client.connect();
  try {
    await client.query(`INSERT INTO users(id,status,is_service_admin,approved_at) VALUES ($1,'APPROVED',true,now()),($2,'PENDING',false,NULL)`, [adminId, memberId]);
    await client.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name) VALUES ($1,$2,'GOOGLE',$3,'승인 대기 팀원')`, [randomUUID(), memberId, randomUUID()]);
    await client.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 day'),($4,$5,$6,now()+interval '1 day')`, [digest(adminToken), digest(adminCsrf), adminId, digest(memberToken), digest(memberCsrf), memberId]);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Google로 로그인/ })).toBeVisible();
    await context.addCookies([
      { name: 'ho_session', value: memberToken, url: 'http://127.0.0.1:5174', httpOnly: true },
      { name: 'ho_csrf', value: memberCsrf, url: 'http://127.0.0.1:5174', httpOnly: false }
    ]);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: /가입 승인 대기/ })).toBeVisible();
    await context.addCookies([
      { name: 'ho_session', value: adminToken, url: 'http://127.0.0.1:5174', httpOnly: true },
      { name: 'ho_csrf', value: adminCsrf, url: 'http://127.0.0.1:5174', httpOnly: false }
    ]);
    await page.goto('/admin/pending');
    await expect(page.getByText('승인 대기 팀원')).toBeVisible();
    await page.getByRole('button', { name: '승인' }).click();
    await expect(page.getByText('대기 중인 회원이 없습니다.')).toBeVisible();
    await context.addCookies([
      { name: 'ho_session', value: memberToken, url: 'http://127.0.0.1:5174', httpOnly: true },
      { name: 'ho_csrf', value: memberCsrf, url: 'http://127.0.0.1:5174', httpOnly: false }
    ]);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: '프로젝트 선택' })).toBeVisible();
  } finally {
    await client.query('DELETE FROM membership_approvals WHERE target_id = $1', [memberId]);
    await client.query('DELETE FROM users WHERE id IN ($1,$2)', [adminId, memberId]);
    await client.end();
  }
});
