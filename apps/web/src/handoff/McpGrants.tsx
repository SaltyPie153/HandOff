import { useEffect, useState } from 'react';
import { Alert, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { loadMine, type ProjectView } from '../projects/api';
import { issueMcpGrant, loadMcpGrants, revokeMcpGrant, type McpGrant } from './api';

export function McpGrants() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [grants, setGrants] = useState<McpGrant[]>([]);
  const [projectId, setProjectId] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([loadMine(), loadMcpGrants()]).then(([rooms, connections]) => {
      if (!active) return;
      setProjects(rooms);
      setGrants(connections);
      setProjectId(rooms[0]?.id ?? '');
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  async function issue() {
    if (!projectId) return;
    setBusy(true);
    setError(false);
    setNewToken(null);
    try {
      const grant = await issueMcpGrant(projectId);
      setGrants(current => [{ ...grant }, ...current]);
      setNewToken(grant.token);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError(false);
    try {
      await revokeMcpGrant(id);
      setGrants(current => current.filter(grant => grant.id !== id));
      setNewToken(null);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <Stack spacing={2}>
    <Typography component="h2" variant="h6">Codex MCP 연결</Typography>
    <Typography>선택한 프로젝트에서 Codex가 요청을 전송할 수 있습니다. 사람의 계약 동의·확인 완료 권한은 포함되지 않습니다.</Typography>
    <FormControl fullWidth><InputLabel id="mcp-project-label">프로젝트</InputLabel>
      <Select labelId="mcp-project-label" label="프로젝트" value={projectId} onChange={event => setProjectId(event.target.value)}>
        {projects.map(room => <MenuItem key={room.id} value={room.id}>{room.name}</MenuItem>)}
      </Select>
    </FormControl>
    <Button variant="outlined" disabled={!projectId || busy} onClick={() => void issue()}>MCP 연결 발급</Button>
    {newToken && <Alert severity="warning">
      이 토큰은 지금 한 번만 표시됩니다. 안전한 저장소에 보관하고 Codex MCP 프로세스의 HANDOFF_MCP_TOKEN 환경 변수로 설정하세요.
      <TextField fullWidth label="새 MCP 토큰" value={newToken} slotProps={{ input: { readOnly: true } }} sx={{ mt: 1 }} />
    </Alert>}
    {grants.map(grant => <Stack key={grant.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography>{projects.find(room => room.id === grant.projectId)?.name ?? grant.projectId} · 만료 {new Date(grant.expiresAt).toLocaleDateString()}</Typography>
      <Button disabled={busy} onClick={() => void revoke(grant.id)}>철회</Button>
    </Stack>)}
    {error && <Alert severity="error">MCP 연결 요청을 처리하지 못했습니다.</Alert>}
  </Stack>;
}
