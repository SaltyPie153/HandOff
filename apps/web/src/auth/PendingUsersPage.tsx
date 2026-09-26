import { useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, List, ListItem, Stack, Typography } from '@mui/material';
import { post } from './api';

type PendingUser = { id: string; createdAt: string; identities: Array<{ provider: string; displayName: string | null; email: string | null }> };

export function PendingUsersPage() {
  const [users, setUsers] = useState<PendingUser[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/pending-users', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Request failed');
        const body: unknown = await response.json();
        if (!Array.isArray(body)) throw new Error('Invalid response');
        setUsers(body as PendingUser[]);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  async function approve(id: string) {
    setBusy(id);
    try {
      const response = await post(`/api/admin/users/${id}/approve`);
      if (!response.ok) throw new Error('Request failed');
      setUsers(previous => previous?.filter(user => user.id !== id) ?? null);
    } catch { setError(true); }
    finally { setBusy(null); }
  }
  return <Stack spacing={2}>
    <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>가입 승인 대기 목록</Typography>
    {error && <Alert severity="error" role="alert">목록을 불러오거나 승인하지 못했습니다. 권한과 연결 상태를 확인해 주세요.</Alert>}
    {!users && !error && <CircularProgress aria-label="대기 목록 불러오는 중" />}
    {users?.length === 0 && <Typography>대기 중인 회원이 없습니다.</Typography>}
    <List>{users?.map(user => <ListItem key={user.id} sx={{ display: 'flex', gap: 2, justifyContent: 'space-between' }}>
      <Stack>
        <Typography>{user.identities[0]?.displayName ?? '이름 없음'}</Typography>
        <Typography variant="body2" color="text.secondary">{user.identities.map(identity => identity.provider).join(', ')} · {new Date(user.createdAt).toLocaleDateString('ko-KR')}</Typography>
      </Stack>
      <Button variant="contained" disabled={busy !== null} onClick={() => void approve(user.id)}>승인</Button>
    </ListItem>)}</List>
  </Stack>;
}
