import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Link, List, ListItem, Stack, Typography } from '@mui/material';
import { loadRoom, ProjectApiError, type RoomView } from './api';
import { HandoffNotifications } from '../handoff/HandoffNotifications';

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
  return <Stack spacing={2}>
    {loading && <CircularProgress aria-label="프로젝트 룸 불러오는 중" />}
    {denied && <Alert severity="warning">접근 권한이 없습니다. <Link href="/projects">프로젝트 선택으로 돌아가기</Link></Alert>}
    {error && <Alert severity="error">프로젝트 룸을 불러오지 못했습니다.</Alert>}
    {room && <>
      <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>{room.name}</Typography>
      {room.description && <Typography>{room.description}</Typography>}
      <Typography component="h2" variant="h6">멤버 현황</Typography>
      <List>{room.members.map(member => <ListItem key={member.userId}>{member.displayName ?? member.userId} · {member.role === 'MANAGER' ? '관리 담당자' : '멤버'}</ListItem>)}</List>
      <Link href={`/projects/${id}/feed`}>팀 인수인계 피드</Link>
      <Link href={`/projects/${id}/inbox`}>내 받은함·보낸함</Link>
      <HandoffNotifications projectId={id}/>
      {room.role === 'MANAGER' && <Link href={`/projects/${id}/members`}>멤버 관리</Link>}
      <Button onClick={() => void refresh()}>새로고침</Button>
      <Link href="/projects">프로젝트 선택으로</Link>
    </>}
  </Stack>;
}
