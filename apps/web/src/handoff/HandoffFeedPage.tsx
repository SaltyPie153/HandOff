import { useEffect, useState } from 'react';
import { Alert, CircularProgress, Link, List, ListItem, Stack, Typography } from '@mui/material';
import { HandoffApiError, loadFeed, type FeedItem } from './api';

export function HandoffFeedPage({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<'DENIED' | 'FAILED' | null>(null);
  useEffect(() => {
    let active = true;
    void loadFeed(projectId).then(value => { if (active) setItems(value); })
      .catch(cause => { if (active) setError(cause instanceof HandoffApiError && [403, 404].includes(cause.status) ? 'DENIED' : 'FAILED'); });
    return () => { active = false; };
  }, [projectId]);
  return <Stack spacing={2}>
    <Typography component="h1" variant="h4">팀 인수인계 피드</Typography>
    <Link href={`/projects/${projectId}`}>프로젝트 룸으로</Link>
    <Link href={`/projects/${projectId}/inbox`}>내 받은함·보낸함</Link>
    {!items && !error && <CircularProgress aria-label="피드 불러오는 중" />}
    {error && <Alert severity={error === 'DENIED' ? 'warning' : 'error'}>{error === 'DENIED' ? '접근 권한이 없습니다.' : '피드를 불러오지 못했습니다.'}</Alert>}
    {items?.length === 0 && <Typography>아직 공유된 요청이 없습니다.</Typography>}
    <List>{items?.map(item => <ListItem key={item.id} sx={{ display: 'block' }}>
      <Typography component="h2" variant="h6">
        {viewerId === item.senderId || viewerId === item.recipientId
          ? <Link href={`/projects/${projectId}/requests/${item.id}`}>{item.publicTitle}</Link>
          : item.publicTitle}
      </Typography>
      {item.replies.map(reply => <Typography key={reply.id} sx={{ whiteSpace: 'pre-wrap' }}>
        {reply.source === 'CODEX_AUTO' ? '서버 자동 회신 · ' : '회원 회신 · '}{reply.body}
      </Typography>)}
    </ListItem>)}</List>
  </Stack>;
}
