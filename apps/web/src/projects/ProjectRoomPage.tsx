import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, List, ListItem, Paper, Stack, Typography } from '@mui/material';
import { loadRoom, ProjectApiError, type RoomView } from './api';
import { HandoffNotifications } from '../handoff/HandoffNotifications';
import {PageHeader,Section,twoColumns} from '../ui/primitives';

export function ProjectRoomPage({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    setRoom(null);
    setLoading(true);
    setDenied(false);
    setError(false);
    try { setRoom(await loadRoom(id)); }
    catch (cause) {
      if (cause instanceof ProjectApiError && (cause.status === 403 || cause.status === 404)) setDenied(true);
      else setError(true);
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Stack spacing={3}>
    {loading && <CircularProgress aria-label="프로젝트 룸 불러오는 중" />}
    {denied && <Alert severity="warning">접근 권한이 없습니다. <Link href="/projects">프로젝트 선택으로 돌아가기</Link></Alert>}
    {error && <Alert severity="error">프로젝트 룸을 불러오지 못했습니다.</Alert>}
    {room && <>
      <PageHeader title={room.name} eyebrow="PROJECT OVERVIEW" description={room.description??'팀의 요청과 회신, 확정된 개발 계약을 한곳에서 확인하세요.'} actions={<Button variant="outlined" onClick={() => void refresh()}>새로고침</Button>}/>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(3,minmax(0,1fr))'},gap:2}}>
        {[['feed','팀 인수인계 피드','팀에 공개된 회신과 진행 상황'],['inbox','내 받은함·보낸함','나와 상대방 사이의 비공개 요청'],['contracts','개발 계약·합의','팀에서 합의한 최신 개발 기준']].map(([slug,label,description])=><Paper key={slug} variant="outlined" sx={{p:3}}><Link href={`/projects/${id}/${slug}`} sx={{fontWeight:650}}>{label}</Link><Typography color="text.secondary" variant="body2" sx={{mt:1}}>{description}</Typography></Paper>)}
      </Box>
      <Box sx={twoColumns}>
        <Section><HandoffNotifications projectId={id}/></Section>
        <Section id="members" title="멤버 현황" actions={room.role==='MANAGER'?<Link href={`/projects/${id}/members`}>멤버 관리</Link>:undefined}>
          <List disablePadding>{room.members.map(member=><ListItem key={member.userId} disableGutters sx={{py:1.5,gap:1.5,justifyContent:'space-between',borderBottom:'1px solid',borderColor:'divider'}}><Typography sx={{minWidth:0}}>{member.displayName??member.userId} · {member.role==='MANAGER'?'관리 담당자':'멤버'}</Typography></ListItem>)}</List>
        </Section>
      </Box>
    </>}
  </Stack>;
}
