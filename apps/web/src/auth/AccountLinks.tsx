import { useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { post, startLink, type Provider } from './api';

export function AccountLinks({ linkedProviders, onNavigate = url => window.location.assign(url) }: {
  linkedProviders: Provider[]; onNavigate?: (url: string) => void;
}) {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function link(provider: Provider) {
    setBusy(true);
    try { setError(!await startLink(provider, onNavigate)); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await post('/api/auth/logout');
      if (response.ok) onNavigate('/login');
      else setError(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <Stack spacing={2}>
    <Typography>연결된 로그인 수단: {linkedProviders.join(', ') || '없음'}</Typography>
    {(['GOOGLE', 'DISCORD'] as const).filter(provider => !linkedProviders.includes(provider)).map(provider =>
      <Button key={provider} variant="outlined" disabled={busy} onClick={() => void link(provider)}>{provider === 'GOOGLE' ? 'Google' : 'Discord'} 계정 연결</Button>
    )}
    <Button disabled={busy} onClick={() => void logout()}>로그아웃</Button>
    {error && <Alert severity="error" role="alert">요청을 처리하지 못했습니다. 다시 시도해 주세요.</Alert>}
  </Stack>;
}
