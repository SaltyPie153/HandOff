import { useEffect, useState } from 'react';
import { Alert, CircularProgress, Link, List, ListItem, Stack, Typography } from '@mui/material';
import { loadAdminProjects, type AdminProjectView } from './api';
import {EmptyState,PageHeader,Section} from '../ui/primitives';

export function AdminProjectsPage() {
  const [projects, setProjects] = useState<AdminProjectView[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAdminProjects().then(items => { if (active) setProjects(items); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  return <Stack spacing={3}>
    <PageHeader title="프로젝트 배정 관리" description="각 프로젝트의 승인 회원 배정을 관리합니다."/>
    {error && <Alert severity="error">프로젝트 목록을 불러오지 못했습니다.</Alert>}
    {!projects && !error && <CircularProgress aria-label="프로젝트 목록 불러오는 중" />}
    <Section>
    {projects?.length === 0 && <EmptyState>등록된 프로젝트가 없습니다.</EmptyState>}
    <List disablePadding>{projects?.map(project => <ListItem key={project.id} disableGutters sx={{gap:2,justifyContent:'space-between',py:2,borderBottom:'1px solid',borderColor:'divider'}}>
      <Typography>{project.name} · 멤버 {project.memberCount}명</Typography>
      <Link href={`/projects/${project.id}/members`}>멤버 관리</Link>
    </ListItem>)}</List>
    </Section>
    <Link href="/projects">프로젝트 선택으로</Link>
  </Stack>;
}
