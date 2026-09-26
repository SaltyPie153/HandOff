import { Alert, Stack, Typography } from '@mui/material';
import { AccountLinks } from './AccountLinks';
import type { Provider } from './api';

export function PendingPage({ linkedProviders, onNavigate, error }: { linkedProviders: Provider[]; onNavigate?: (url: string) => void; error?: string | null }) {
  return <Stack spacing={3}>
    <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>가입 승인 대기</Typography>
    {error && <Alert severity={error === 'cancelled' ? 'info' : 'error'} role="alert">
      {error === 'cancelled' ? '계정 연결이 취소되었습니다.' : '계정 연결에 실패했습니다. 다른 회원에게 연결된 계정인지 확인해 주세요.'}
    </Alert>}
    <Alert severity="info">관리자 승인 후 프로젝트에 접근할 수 있습니다. 승인 여부는 이 페이지를 다시 열어 확인하세요.</Alert>
    <AccountLinks linkedProviders={linkedProviders} onNavigate={onNavigate} />
  </Stack>;
}
