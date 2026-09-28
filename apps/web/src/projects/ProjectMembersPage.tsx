import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Link, List, ListItem, Stack, TextField, Typography } from '@mui/material';
import { addMember, loadCandidates, loadMembers, ProjectApiError, removeMember, type CandidateView, type MemberView } from './api';

export function ProjectMembersPage({ id, isServiceAdmin }: { id: string; isServiceAdmin: boolean }) {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [candidates, setCandidates] = useState<CandidateView[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const refresh = useCallback(async (search = '') => {
    setCandidates([]);
    try {
      const [nextMembers, nextCandidates] = await Promise.all([loadMembers(id), loadCandidates(id, search)]);
      setMembers(nextMembers);
      setCandidates(nextCandidates);
      setDenied(false);
    } catch (cause) {
      setMembers(null);
      setCandidates([]);
      if (cause instanceof ProjectApiError && [403, 404].includes(cause.status)) setDenied(true);
      else setError(true);
    }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);
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
  return <Stack spacing={2}>
    <Typography component="h1" variant="h4">멤버 관리</Typography>
    {denied && <Alert severity="warning">접근 권한이 없습니다.</Alert>}
    {error && <Alert severity="error">멤버 변경에 실패했습니다. 권한과 승인 상태를 확인해 주세요.</Alert>}
    {!members && !denied && !error && <CircularProgress aria-label="멤버 불러오는 중" />}
    {members && <>
      <Typography component="h2" variant="h6">현재 멤버</Typography>
      <List>{members.map(member => <ListItem key={member.userId} sx={{ gap: 2 }}>
        <Typography>{member.displayName ?? member.userId} · {member.role === 'MANAGER' ? '관리 담당자' : '멤버'}</Typography>
        {member.role === 'MEMBER' && <Button disabled={busy} onClick={() => void changeMember(member.userId, 'remove')}>제외</Button>}
      </ListItem>)}</List>
      <Typography component="h2" variant="h6">승인 회원 추가</Typography>
      <TextField label="회원 이름 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <Button disabled={busy} onClick={() => void refresh(query)}>검색</Button>
      {candidates.length === 0 && <Typography>추가할 수 있는 회원이 없습니다.</Typography>}
      <List>{candidates.map(candidate => <ListItem key={candidate.id} sx={{ gap: 2 }}>
        <Typography>{candidate.displayName ?? candidate.id}</Typography>
        <Button disabled={busy} onClick={() => void changeMember(candidate.id, 'add')}>추가</Button>
      </ListItem>)}</List>
    </>}
    <Link href={isServiceAdmin ? '/admin/projects' : `/projects/${id}`}>돌아가기</Link>
  </Stack>;
}
