import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, List, ListItem, Stack, TextField, Typography } from '@mui/material';
import { addMember, loadCandidates, loadMembers, ProjectApiError, removeMember, type CandidateView, type MemberView } from './api';
import {PageHeader,Section} from '../ui/primitives';

export function ProjectMembersPage({ id, isServiceAdmin }: { id: string; isServiceAdmin: boolean }) {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [candidates, setCandidates] = useState<CandidateView[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const latestRequest = useRef(0);
  const refresh = useCallback(async (search = '') => {
    const request = ++latestRequest.current;
    setCandidates([]);
    try {
      const [nextMembers, nextCandidates] = await Promise.all([loadMembers(id), loadCandidates(id, search)]);
      if (request !== latestRequest.current) return;
      setMembers(nextMembers);
      setCandidates(nextCandidates);
      setDenied(false);
    } catch (cause) {
      if (request !== latestRequest.current) return;
      setMembers(null);
      setCandidates([]);
      if (cause instanceof ProjectApiError && [403, 404].includes(cause.status)) setDenied(true);
      else setError(true);
    }
  }, [id]);
  useEffect(() => { void refresh(); return () => { latestRequest.current++; }; }, [refresh]);
  async function changeMember(userId: string, action: 'add' | 'remove') {
    setBusy(true);
    setError(false);
    try {
      if (action === 'add') await addMember(id, userId);
      else await removeMember(id, userId);
      await refresh(query);
    } catch (cause) {
      if (cause instanceof ProjectApiError && [403, 404].includes(cause.status)) {
        setMembers(null); setCandidates([]); setDenied(true);
      } else setError(true);
    } finally { setBusy(false); }
  }
  return <Stack spacing={3}>
    <PageHeader title="멤버 관리" description="승인된 회원을 이 프로젝트에 추가하거나 제외하세요."/>
    {denied && <Alert severity="warning">접근 권한이 없습니다.</Alert>}
    {error && <Alert severity="error">멤버 변경에 실패했습니다. 권한과 승인 상태를 확인해 주세요.</Alert>}
    {!members && !denied && !error && <CircularProgress aria-label="멤버 불러오는 중" />}
    {members && <>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',lg:'repeat(2,minmax(0,1fr))'},gap:3}}>
      <Section title="현재 멤버">
      <List disablePadding>{members.map(member => <ListItem key={member.userId} disableGutters sx={{gap:2,py:2,borderBottom:'1px solid',borderColor:'divider',justifyContent:'space-between'}}>
        <Stack sx={{minWidth:0}}><Typography>{member.displayName ?? '이름 없음'} · {member.role === 'MANAGER' ? '관리 담당자' : '멤버'}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{overflowWrap:'anywhere'}}>회원 ID: {member.userId}</Typography></Stack>
        {member.role === 'MEMBER' && <Button disabled={busy} onClick={() => void changeMember(member.userId, 'remove')}>제외</Button>}
      </ListItem>)}</List>
      </Section>
      <Section title="승인 회원 추가"><Stack spacing={2}>
      <TextField label="회원 이름 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <Button disabled={busy} onClick={() => void refresh(query)}>검색</Button>
      {candidates.length === 0 && <Typography>추가할 수 있는 회원이 없습니다.</Typography>}
      <List disablePadding>{candidates.map(candidate => <ListItem key={candidate.id} disableGutters sx={{gap:2,py:2,borderBottom:'1px solid',borderColor:'divider',justifyContent:'space-between'}}>
        <Stack sx={{minWidth:0}}><Typography>{candidate.displayName ?? '이름 없음'}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{overflowWrap:'anywhere'}}>회원 ID: {candidate.id}</Typography></Stack>
        <Button disabled={busy} onClick={() => void changeMember(candidate.id, 'add')}>추가</Button>
      </ListItem>)}</List>
      </Stack></Section>
      </Box>
    </>}
    <Link href={isServiceAdmin ? '/admin/projects' : `/projects/${id}`}>돌아가기</Link>
  </Stack>;
}
