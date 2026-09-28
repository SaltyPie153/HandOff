import { useEffect, useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { disableAgentKey, loadAgentKeyStatus, saveAgentKey, type AgentKeyStatus } from './agent-key.api';

export function AgentKeySettings() {
  const [status, setStatus] = useState<AgentKeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'load' | 'save' | 'disable' | null>(null);
  const loading = status === null && error === null;

  useEffect(() => {
    let active = true;
    void loadAgentKeyStatus().then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setError('load'); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!key || busy || loading) return;
    setBusy(true);
    setError(null);
    try { setStatus(await saveAgentKey(key)); }
    catch { setError('save'); }
    finally { setKey(''); setBusy(false); }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { setStatus(await disableAgentKey()); }
    catch { setError('disable'); }
    finally { setKey(''); setBusy(false); }
  }

  return <Stack spacing={2}>
    <Typography component="h2" variant="h6">서버 Codex API 키</Typography>
    <Typography>서비스 전체의 자동 회신 확인에 쓰는 OpenAI API 키입니다. 키 값은 저장 후 다시 표시되지 않습니다.</Typography>
    {status && <Typography>{status.configured ? '키가 설정됨' : '키가 설정되지 않음'}
      {status.source === 'disabled' ? ' · 사용 중지됨' : ''}</Typography>}
    <TextField label="OpenAI API 키" type="password" autoComplete="off" value={key}
      onChange={event => setKey(event.target.value)} disabled={busy || loading} fullWidth />
    <Stack direction="row" spacing={1}>
      <Button variant="contained" onClick={() => void save()} disabled={busy || loading || !key}>저장·교체</Button>
      <Button variant="outlined" onClick={() => void disable()} disabled={busy || !status?.configured}>사용 중지</Button>
    </Stack>
    {error && <Alert severity="error">{error === 'save' ? '키를 저장하지 못했습니다.' :
      error === 'disable' ? '키 사용을 중지하지 못했습니다.' : '키 상태를 불러오지 못했습니다.'}</Alert>}
  </Stack>;
}
