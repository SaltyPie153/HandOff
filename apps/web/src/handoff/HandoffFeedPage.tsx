import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Link, Paper, Stack, Typography } from '@mui/material';
import { HandoffApiError, loadFeed, type FeedItem } from './api';
import {EmptyState,PageHeader,StatusBadge} from '../ui/primitives';

export function HandoffFeedPage({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<'DENIED' | 'FAILED' | null>(null);
  useEffect(() => {
    let active = true;
    void loadFeed(projectId).then(value => { if (active) setItems(value); })
      .catch(cause => { if (active) setError(cause instanceof HandoffApiError && [403, 404].includes(cause.status) ? 'DENIED' : 'FAILED'); });
    return () => { active = false; };
  }, [projectId]);
  return <Stack spacing={3}>
    <PageHeader title="팀 인수인계 피드" description="프로젝트에 공유된 요청 제목과 공개 회신을 확인하세요. 요청 본문은 당사자만 열람할 수 있습니다." actions={<Link href={`/projects/${projectId}/inbox`}>내 받은함·보낸함</Link>}/>
    {!items && !error && <CircularProgress aria-label="피드 불러오는 중" />}
    {error && <Alert severity={error === 'DENIED' ? 'warning' : 'error'}>{error === 'DENIED' ? '접근 권한이 없습니다.' : '피드를 불러오지 못했습니다.'}</Alert>}
    {items?.length === 0 && <Paper variant="outlined"><EmptyState>아직 공유된 요청이 없습니다.</EmptyState></Paper>}
    {items?.map(item => <Paper key={item.id} variant="outlined" sx={{p:{xs:2.5,sm:3}}}>
      <Stack direction="row" sx={{alignItems:'start',justifyContent:'space-between',gap:2,mb:2}}><Typography component="h2" variant="h6">
        {item.canOpen
          ? <Link href={`/projects/${projectId}/requests/${item.id}`}>{item.publicTitle}</Link>
          : item.publicTitle}
      </Typography><StatusBadge tone="info">팀 공개</StatusBadge></Stack>
      {item.replies.length===0&&<Typography variant="body2" color="text.secondary">아직 공개 회신이 없습니다.</Typography>}
      <Stack spacing={2}>{item.replies.map(reply => <Box key={reply.id} sx={{borderLeft:'2px solid',borderColor:reply.source==='CODEX_AUTO'?'primary.light':'divider',pl:2,py:.5}}><Typography sx={{ whiteSpace:'pre-wrap' }}>
        버전 {reply.version} · {reply.source === 'CODEX_AUTO' ? '서버 자동 회신 · ' : '회원 회신 · '}{reply.body}
      </Typography></Box>)}</Stack>
    </Paper>)}
  </Stack>;
}
