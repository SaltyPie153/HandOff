import { Alert, Box, Button, Stack, Typography } from '@mui/material';

export function LoginPage({ error }: { error?: string | null }) {
  return <Stack spacing={3}>
    <Box>
      <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>HandOff 로그인</Typography>
      <Typography color="text.secondary">팀에서 사용하는 계정으로 로그인하세요. 가입 후 관리자 승인이 필요합니다.</Typography>
    </Box>
    {error && <Alert severity={error === 'cancelled' ? 'info' : 'error'} role="alert">
      {error === 'cancelled' ? '로그인이 취소되었습니다. 원할 때 다시 시도해 주세요.' : '로그인에 실패했습니다. 다시 시도해 주세요.'}
    </Alert>}
    <Button variant="contained" component="a" href="/api/auth/google/start">Google로 로그인</Button>
    <Button variant="outlined" component="a" href="/api/auth/discord/start">Discord로 로그인</Button>
  </Stack>;
}
