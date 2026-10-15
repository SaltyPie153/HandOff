import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {expect,test} from '@playwright/test';
import pg from 'pg';

test('desktop and mobile navigation preserve project scope, privacy and keyboard access',async({browser})=>{
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});
  const userId=randomUUID(),projectId=randomUUID(),session=randomBytes(32).toString('base64url');
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  await db.connect();
  try{
    await db.query(`INSERT INTO users(id,status) VALUES ($1,'APPROVED')`,[userId]);
    await db.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name) VALUES ($1,$2,'GOOGLE',$3,'디자인 시험 멤버')`,[randomUUID(),userId,randomUUID()]);
    await db.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')`,[createHash('sha256').update(session).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex'),userId]);
    await db.query(`INSERT INTO projects(id,name,description,creator_id) VALUES ($1,'HandOff 디자인 시험','팀의 요청과 개발 계약을 함께 확인하는 공간입니다.',$2)`,[projectId,userId]);
    await db.query(`INSERT INTO project_memberships(project_id,user_id,role) VALUES ($1,$2,'MANAGER')`,[projectId,userId]);
    await context.addCookies([{name:'ho_session',value:session,url:'http://127.0.0.1:5174',httpOnly:true}]);
    const page=await context.newPage();
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('heading',{name:'HandOff 디자인 시험'})).toBeVisible();
    const nav=page.getByRole('navigation',{name:'주 메뉴',exact:true});
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link',{name:'가입 승인'})).toHaveCount(0);
    await expect(page.getByRole('main')).toBeVisible();
    await mkdir('work/ui-cleanup/screenshots',{recursive:true});
    await page.screenshot({path:'work/ui-cleanup/screenshots/desktop.png',fullPage:true});
    await nav.getByRole('link',{name:'내 요청',exact:true}).click();
    await expect(page.getByRole('heading',{name:'내 받은함·보낸함'})).toBeVisible();
    await expect(page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('link',{name:'내 요청',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.getByText('내 요청이 없습니다.')).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    await expect(page.getByRole('navigation',{name:'주 메뉴',exact:true})).not.toBeVisible();
    await page.getByRole('button',{name:'메뉴 열기'}).click();
    const dialog=page.getByRole('dialog',{name:'탐색 메뉴'});
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button',{name:'메뉴 열기'})).toBeFocused();
    await page.getByRole('button',{name:'메뉴 열기'}).click();
    await page.getByRole('dialog',{name:'탐색 메뉴'}).getByRole('link',{name:'멤버',exact:true}).click();
    await expect(page.getByRole('heading',{name:'멤버 현황'})).toBeVisible();
    expect(page.url()).toContain(`/projects/${projectId}#members`);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
    await page.screenshot({path:'work/ui-cleanup/screenshots/mobile.png',fullPage:true});
    await page.goto('/settings');
    await expect(page.getByRole('heading',{name:'설정',exact:true})).toBeVisible();
    await expect(page.getByRole('textbox',{name:'Upstage API 키'})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
    await page.setViewportSize({width:1440,height:960});
    await page.screenshot({path:'work/ui-cleanup/screenshots/settings.png',fullPage:true});
    // Read-only DTO fixtures exercise long details without posting replies or consent.
    const requestId=randomUUID(),proposalId=randomUUID(),createdAt='2026-10-04T00:00:00Z';
    await context.route(`**/api/projects/${projectId}/requests/${requestId}`,route=>route.fulfill({json:{
      id:requestId,projectId,publicTitle:'회원 식별자 전달 규칙 확인',senderId:randomUUID(),recipientId:userId,
      privateBody:'회원 식별자는 UUID v4 형식으로 전달합니다.\n변경된 응답 규칙이 현재 계약과 일치하는지 확인해 주세요.\n'+('문서의 긴 경로/'.repeat(35)),verificationClaim:'USER_ID_FORMAT: uuid-v4',
      version:1,currentVersion:1,versionId:randomUUID(),status:'AWAITING_REVIEW',canRespond:true,response:null,
      versions:[{version:1,status:'AWAITING_REVIEW',createdAt}],
      replies:[{id:randomUUID(),version:1,body:'요청한 항목이 등록된 최신 근거에서 일치함을 확인했습니다.',source:'CODEX_AUTO',createdAt}],job:null
    }}));
    await page.goto(`/projects/${projectId}/requests/${requestId}`);
    await expect(page.getByRole('button',{name:'내용 확인 완료'})).toBeVisible();
    await page.screenshot({path:'work/ui-cleanup/screenshots/request.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
    await expect(page.getByRole('textbox',{name:'팀 공개 회신'})).toBeVisible();
    await context.route(`**/api/projects/${projectId}/contract-proposals/${proposalId}`,route=>route.fulfill({json:{
      contractId:randomUUID(),proposalId,publicTitle:'API 응답 계약',senderId:randomUUID(),recipientId:userId,
      currentVersion:1,versionId:randomUUID(),version:1,proposedBody:'USER_ID_FORMAT: uuid-v4\n모든 회원 식별자는 UUID v4 문자열로 전달합니다.',
      kind:'INITIAL',status:'IN_REVIEW',blocked:false,canRespond:true,canRevise:false,canWithdraw:false,
      participants:[{userId,role:'RECIPIENT',displayName:'디자인 시험 멤버'}],versions:[{version:1,status:'IN_REVIEW',createdAt}],responses:[]
    }}));
    await page.goto(`/projects/${projectId}/contract-proposals/${proposalId}`);
    await expect(page.getByRole('button',{name:'이 버전에 동의'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
    await page.setViewportSize({width:1440,height:960});
    await page.screenshot({path:'work/ui-cleanup/screenshots/proposal.png',fullPage:true});
  }finally{
    await context.close();
    await db.query('DELETE FROM projects WHERE id=$1',[projectId]);
    await db.query('DELETE FROM users WHERE id=$1',[userId]);
    await db.end();
  }
});
