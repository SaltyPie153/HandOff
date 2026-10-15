import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import { createProject, loadMine, type ProjectView } from './api';
import {EmptyState,PageHeader,Section,StatusBadge,twoColumns} from '../ui/primitives';

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
  return <Stack spacing={3}>
    <PageHeader title="프로젝트 선택" eyebrow="WORKSPACE" description="함께 작업할 프로젝트를 열고, 요청과 합의한 계약을 확인하세요."/>
    {error && <Alert severity="error">프로젝트를 불러오거나 만들지 못했습니다. 다시 시도해 주세요.</Alert>}
    {!projects && !error && <CircularProgress aria-label="프로젝트 불러오는 중" />}
    <Box sx={twoColumns}>
    <Stack spacing={2}>
    {projects?.length === 0 && <Section><EmptyState>배정된 프로젝트가 없습니다. 새 프로젝트를 만들거나 관리 담당자에게 배정을 요청하세요.</EmptyState></Section>}
    {projects?.map(project => <Paper key={project.id} variant="outlined" sx={{p:3,'&:hover':{borderColor:'primary.light'}}}>
      <Stack direction="row" sx={{gap:2,alignItems:'start',justifyContent:'space-between'}}><Link href={`/projects/${project.id}`} sx={{fontSize:18,fontWeight:650}}>{project.name}</Link><StatusBadge>{project.role === 'MANAGER' ? '관리 담당자' : '멤버'}</StatusBadge></Stack>
      {project.description&&<Typography color="text.secondary" sx={{mt:1}}>{project.description}</Typography>}
      <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:2}}>생성 {new Date(project.createdAt).toLocaleDateString()}</Typography>
    </Paper>)}
    </Stack>
    <Section title="새 프로젝트" description="프로젝트를 만들면 관리 담당자가 됩니다.">
    <Stack component="form" spacing={2.5} onSubmit={event => void create(event)}>
      <TextField label="프로젝트 이름" value={name} onChange={event => setName(event.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} required />
      <TextField label="설명 (선택)" value={description} onChange={event => setDescription(event.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} multiline minRows={3}/>
      <Button type="submit" variant="contained" disabled={busy || !name.trim()}>프로젝트 만들기</Button>
    </Stack>
    </Section>
    </Box>
    <Stack direction="row" sx={{gap:3,flexWrap:'wrap'}}>
    <Link href="/settings">로그인 수단 관리</Link>
    {isServiceAdmin && <><Link href="/admin/pending">가입 승인 대기 목록</Link><Link href="/admin/projects">프로젝트 배정 관리</Link></>}
    </Stack>
  </Stack>;
}
