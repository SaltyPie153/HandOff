import { useEffect, useState } from 'react';
import { Alert, CircularProgress, Link, List, ListItem, Stack, Typography } from '@mui/material';
import { loadAdminProjects, type AdminProjectView } from './api';

export function AdminProjectsPage() {
  const [projects, setProjects] = useState<AdminProjectView[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAdminProjects().then(items => { if (active) setProjects(items); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  return <Stack spacing={2}>
    <Typography component="h1" variant="h4">프로젝트 배정 관리</Typography>
    {error && <Alert severity="error">프로젝트 목록을 불러오지 못했습니다.</Alert>}
    {!projects && !error && <CircularProgress aria-label="프로젝트 목록 불러오는 중" />}
    {projects?.length === 0 && <Typography>등록된 프로젝트가 없습니다.</Typography>}
    <List>{projects?.map(project => <ListItem key={project.id} sx={{ gap: 2 }}>
      <Typography>{project.name} · 멤버 {project.memberCount}명</Typography>
      <Link href={`/projects/${project.id}/members`}>멤버 관리</Link>
    </ListItem>)}</List>
    <Link href="/projects">프로젝트 선택으로</Link>
  </Stack>;
}
