import { useEffect, useState } from 'react';
import { Alert, CircularProgress, Link, List, ListItem, Stack, Typography, Tabs, Tab } from '@mui/material';
import { HandoffApiError, loadInbox, statusLabel, type InboxItem } from './api';
import { HandoffNotifications } from './HandoffNotifications';

export function HandoffInboxPage({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<'DENIED' | 'FAILED' | null>(null);
  const [direction,setDirection]=useState<'received'|'sent'>('received');
  useEffect(() => {
    let active = true;
    setItems(null);setError(null);
    void loadInbox(projectId,direction).then(value => { if (active) setItems(value); })
      .catch(cause => { if (active) setError(cause instanceof HandoffApiError && [403, 404].includes(cause.status) ? 'DENIED' : 'FAILED'); });
    return () => { active = false; };
  }, [projectId,direction]);
  return <Stack spacing={2}>
    <Typography component="h1" variant="h4">내 받은함·보낸함</Typography>
    <Link href={`/projects/${projectId}/feed`}>팀 피드로</Link>
    <HandoffNotifications projectId={projectId}/>
    <Tabs value={direction} onChange={(_,value)=>setDirection(value)} aria-label="내 요청 분류">
      <Tab value="received" label="받은함"/><Tab value="sent" label="보낸함"/>
    </Tabs>
    {!items && !error && <CircularProgress aria-label="받은함 불러오는 중" />}
    {error && <Alert severity={error === 'DENIED' ? 'warning' : 'error'}>{error === 'DENIED' ? '접근 권한이 없습니다.' : '받은함을 불러오지 못했습니다.'}</Alert>}
    {items?.length === 0 && <Typography>내 요청이 없습니다.</Typography>}
    <List>{items?.map(item => <ListItem key={item.id} sx={{ display: 'block' }}>
      <Link href={`/projects/${projectId}/requests/${item.id}`}>{item.publicTitle}</Link>
      <Typography color="text.secondary">{item.recipientId === viewerId ? '받은 요청' : '보낸 요청'}
        {' · 버전 '+item.currentVersion+' · '+statusLabel[item.status]}
        {item.currentVersion>1&&item.status==='AWAITING_REVIEW'?' · 재검토 필요':''}
        {item.recipientId === viewerId && item.job?.status === 'REVIEW_REQUIRED' ? ' · 검토 필요' : ''}</Typography>
    </ListItem>)}</List>
  </Stack>;
}
