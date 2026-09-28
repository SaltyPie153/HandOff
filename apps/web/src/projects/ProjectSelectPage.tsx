import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, CircularProgress, Link, List, ListItem, Stack, TextField, Typography } from '@mui/material';
import { createProject, loadMine, type ProjectView } from './api';

export function ProjectSelectPage({ isServiceAdmin }: { isServiceAdmin: boolean }) {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadMine().then(items => { if (active) setProjects(items); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const project = await createProject(name, description);
      setProjects(previous => [project, ...(previous ?? [])]);
      setName('');
      setDescription('');
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <Stack spacing={2}>
    <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>프로젝트 선택</Typography>
    {error && <Alert severity="error">프로젝트를 불러오거나 만들지 못했습니다. 다시 시도해 주세요.</Alert>}
    {!projects && !error && <CircularProgress aria-label="프로젝트 불러오는 중" />}
    {projects?.length === 0 && <Typography>배정된 프로젝트가 없습니다. 새 프로젝트를 만들거나 관리 담당자에게 배정을 요청하세요.</Typography>}
    <List>{projects?.map(project => <ListItem key={project.id}>
      <Link href={`/projects/${project.id}`}>{project.name}</Link>
      <Typography variant="body2" sx={{ ml: 1 }} color="text.secondary">{project.role === 'MANAGER' ? '관리 담당자' : '멤버'}</Typography>
    </ListItem>)}</List>
    <Stack component="form" spacing={2} onSubmit={event => void create(event)}>
      <TextField label="프로젝트 이름" value={name} onChange={event => setName(event.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} required />
      <TextField label="설명 (선택)" value={description} onChange={event => setDescription(event.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} multiline />
      <Button type="submit" variant="contained" disabled={busy || !name.trim()}>프로젝트 만들기</Button>
    </Stack>
    <Link href="/settings">로그인 수단 관리</Link>
    {isServiceAdmin && <><Link href="/admin/pending">가입 승인 대기 목록</Link><Link href="/admin/projects">프로젝트 배정 관리</Link></>}
  </Stack>;
}
