import { useEffect, useState } from 'react';
import { Alert, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { loadMine, type ProjectView } from '../projects/api';
import { loadEvidence, registerGithubEvidence, registerLocalEvidence, revokeEvidence, type EvidenceSource } from './api';

export function EvidenceSources() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [projectId, setProjectId] = useState('');
  const [sources, setSources] = useState<EvidenceSource[]>([]);
  const [localPath, setLocalPath] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [path, setPath] = useState('');
  const [ref, setRef] = useState('main');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { void loadMine().then(rooms => { setProjects(rooms); setProjectId(rooms[0]?.id ?? ''); }).catch(() => setError(true)); }, []);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void loadEvidence(projectId).then(value => { if (active) setSources(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [projectId]);
  async function addLocal() {
    setBusy(true); setError(false); setNewToken(null);
    try {
      const source = await registerLocalEvidence(projectId, localPath);
      setNewToken(source.syncToken);
      setLocalPath('');
      setSources(await loadEvidence(projectId));
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  async function addGithub() {
    setBusy(true); setError(false);
    try {
      await registerGithubEvidence(projectId, { owner, repo, path, ref });
      setSources(await loadEvidence(projectId));
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  async function remove(sourceId: string) {
    setBusy(true); setError(false);
    try { await revokeEvidence(projectId, sourceId); setSources(current => current.filter(source => source.id !== sourceId)); setNewToken(null); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <Stack spacing={2}>
    <Typography component="h2" variant="h6">자동 회신 근거</Typography>
    <Typography>지정한 파일만 근거로 사용합니다. 로컬 파일은 마지막 성공 동기화 후 24시간까지만 자동 회신에 사용됩니다.</Typography>
    <FormControl fullWidth><InputLabel id="evidence-project-label">근거 프로젝트</InputLabel>
      <Select labelId="evidence-project-label" label="근거 프로젝트" value={projectId} onChange={event => { setProjectId(event.target.value); setNewToken(null); }}>
        {projects.map(room => <MenuItem key={room.id} value={room.id}>{room.name}</MenuItem>)}
      </Select>
    </FormControl>
    <TextField label="허용할 로컬 계약 파일의 절대 경로" value={localPath} onChange={event => setLocalPath(event.target.value)} />
    <Button disabled={!projectId || !localPath || busy} onClick={() => void addLocal()}>로컬 파일 지정</Button>
    {newToken && <Alert severity="warning">동기화 토큰은 지금 한 번만 표시됩니다. HANDOFF_SYNC_TOKEN 환경 변수에 보관하세요.
      <TextField fullWidth label="새 동기화 토큰" value={newToken} slotProps={{ input: { readOnly: true } }} sx={{ mt: 1 }} />
    </Alert>}
    <Typography>GitHub 읽기 전용 근거</Typography>
    <TextField label="GitHub 소유자" value={owner} onChange={event => setOwner(event.target.value)} />
    <TextField label="GitHub 저장소" value={repo} onChange={event => setRepo(event.target.value)} />
    <TextField label="저장소 내 파일 경로" value={path} onChange={event => setPath(event.target.value)} />
    <TextField label="기준 브랜치 또는 커밋" value={ref} onChange={event => setRef(event.target.value)} />
    <Button disabled={!projectId || !owner || !repo || !path || !ref || busy} onClick={() => void addGithub()}>GitHub 파일 지정</Button>
    {sources.map(source => <Stack key={source.id} spacing={1}>
      <Typography>{source.kind === 'LOCAL' ? source.localPath : `${source.githubOwner}/${source.githubRepo}/${source.githubPath}@${source.githubRef}`}</Typography>
      {source.kind === 'LOCAL' && <Typography color="text.secondary">마지막 동기화: {source.snapshot?.syncedAt ? new Date(source.snapshot.syncedAt).toLocaleString() : '없음'}</Typography>}
      <Button disabled={busy} onClick={() => void remove(source.id)}>근거 지정 해제</Button>
    </Stack>)}
    {error && <Alert severity="error">근거 설정을 처리하지 못했습니다.</Alert>}
  </Stack>;
}
