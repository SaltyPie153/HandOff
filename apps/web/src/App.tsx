import { Alert, Box, CircularProgress, Container, Link, Paper, Stack, Typography } from "@mui/material";
import { HealthPanel } from "./health/HealthPanel";
import { LoginPage } from './auth/LoginPage';
import { PendingPage } from './auth/PendingPage';
import { PendingUsersPage } from './auth/PendingUsersPage';
import { AccountLinks } from './auth/AccountLinks';
import { useViewer } from './auth/useViewer';
import { ProjectSelectPage } from './projects/ProjectSelectPage';
import { ProjectRoomPage } from './projects/ProjectRoomPage';
import { ProjectMembersPage } from './projects/ProjectMembersPage';
import { AdminProjectsPage } from './projects/AdminProjectsPage';
import { HandoffFeedPage } from './handoff/HandoffFeedPage';
import { HandoffInboxPage } from './handoff/HandoffInboxPage';
import { HandoffRequestPage } from './handoff/HandoffRequestPage';
import { McpGrants } from './handoff/McpGrants';
import { EvidenceSources } from './handoff/EvidenceSources';
import { AgentKeySettings } from './handoff/AgentKeySettings';
import {ContractListPage} from './contracts/ContractListPage';
import {ContractDetailPage} from './contracts/ContractDetailPage';
import {ContractInboxPage} from './contracts/ContractInboxPage';
import {ContractProposalPage} from './contracts/ContractProposalPage';
import {AppShell} from './ui/AppShell';
import {PageHeader,Section} from './ui/primitives';

export default function App() {
  const health = window.location.pathname === '/dev/health';
  const state = useViewer(!health);
  const path = window.location.pathname;
  const error = new URLSearchParams(window.location.search).get('error');
  let content;
  if (health) {
    content = <Stack spacing={3}>
      <Typography component="p" variant="overline" color="primary.main">개발 환경</Typography>
      <Typography component="h1" variant="h3" sx={{ fontWeight: 700 }}>HandOff</Typography>
      <Typography color="text.secondary">로컬 서비스 연결 상태를 확인할 수 있습니다.</Typography>
      <HealthPanel />
    </Stack>;
  } else if (state.loading) {
    content = <CircularProgress aria-label="회원 상태 확인 중" />;
  } else if (state.unavailable) {
    content = <Alert severity="error">회원 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>;
  } else if (!state.viewer) {
    content = <LoginPage error={error} />;
  } else if (state.viewer.status === 'PENDING') {
    content = <PendingPage linkedProviders={state.viewer.linkedProviders} error={path === '/settings' ? error : null} />;
  } else if (path === '/admin/pending') {
    content = state.viewer.isServiceAdmin ? <PendingUsersPage /> : <Alert severity="error">관리자만 열 수 있습니다.</Alert>;
  } else if (path === '/admin/projects') {
    content = state.viewer.isServiceAdmin ? <AdminProjectsPage /> : <Alert severity="error">관리자만 열 수 있습니다.</Alert>;
  } else if (path === '/settings') {
    content = <Stack spacing={3}>
      <PageHeader title="설정" description="로그인 계정과 Codex 연결, 자동 회신에 사용할 근거를 관리하세요."/>
      {error && <Alert severity={error === 'cancelled' ? 'info' : 'error'}>
        {error === 'cancelled' ? '계정 연결이 취소되었습니다.' : '계정 연결에 실패했습니다. 다른 회원에게 연결된 계정인지 확인해 주세요.'}
      </Alert>}
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',lg:'minmax(0,1fr) minmax(0,1fr)'},gap:3}}>
        <Section title="로그인 수단 관리"><AccountLinks linkedProviders={state.viewer.linkedProviders} /></Section>
        <Section><McpGrants /></Section>
      </Box>
      <Section><EvidenceSources /></Section>
      {state.viewer.isServiceAdmin && <Section><AgentKeySettings /></Section>}
    </Stack>;
  } else if (/^\/projects\/[0-9a-f-]{36}\/contract-proposals\/[0-9a-f-]{36}$/i.test(path)) {
    content=<ContractProposalPage projectId={path.split('/')[2]} proposalId={path.split('/')[4]} viewerId={state.viewer.id}/>;
  } else if (/^\/projects\/[0-9a-f-]{36}\/contracts\/[0-9a-f-]{36}$/i.test(path)) {
    content=<ContractDetailPage projectId={path.split('/')[2]} contractId={path.split('/')[4]}/>;
  } else if (/^\/projects\/[0-9a-f-]{36}\/contracts$/i.test(path)) {
    content=<ContractListPage projectId={path.split('/')[2]}/>;
  } else if (/^\/projects\/[0-9a-f-]{36}\/contract-inbox$/i.test(path)) {
    content=<ContractInboxPage projectId={path.split('/')[2]}/>;
  } else if (/^\/projects\/[0-9a-f-]{36}\/requests\/[0-9a-f-]{36}$/i.test(path)) {
    content = <HandoffRequestPage projectId={path.split('/')[2]} requestId={path.split('/')[4]} viewerId={state.viewer.id} />;
  } else if (/^\/projects\/[0-9a-f-]{36}\/feed$/i.test(path)) {
    content = <HandoffFeedPage projectId={path.split('/')[2]} viewerId={state.viewer.id} />;
  } else if (/^\/projects\/[0-9a-f-]{36}\/inbox$/i.test(path)) {
    content = <HandoffInboxPage projectId={path.split('/')[2]} viewerId={state.viewer.id} />;
  } else if (/^\/projects\/[0-9a-f-]{36}\/members$/i.test(path)) {
    content = <ProjectMembersPage id={path.split('/')[2]} isServiceAdmin={state.viewer.isServiceAdmin} />;
  } else if (/^\/projects\/[0-9a-f-]{36}$/i.test(path)) {
    content = <ProjectRoomPage id={path.split('/')[2]} />;
  } else {
    content = <ProjectSelectPage isServiceAdmin={state.viewer.isServiceAdmin} />;
  }
  if (!health&&!state.loading&&!state.unavailable&&state.viewer?.status==='APPROVED') {
    return <AppShell path={path} isServiceAdmin={state.viewer.isServiceAdmin}>{content}</AppShell>;
  }
  return (
    <Box component="main" sx={{ minHeight: "100vh", display: "grid", alignItems: "center", py: 6 }}>
      <Container maxWidth="sm">
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 } }}>
          {content}
        </Paper>
      </Container>
    </Box>
  );
}
