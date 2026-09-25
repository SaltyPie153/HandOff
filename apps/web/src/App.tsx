import { useState } from "react";
import { Box, Button, Container, Paper, Stack, Typography } from "@mui/material";

type CheckStatus = "미확인" | "확인 중" | "응답 확인" | "확인 불가";

export default function App() {
  const [status, setStatus] = useState<CheckStatus>("미확인");

  async function checkStatus() {
    setStatus("확인 중");

    try {
      const response = await fetch("/api/health/ready", { cache: "no-store" });
      setStatus(response.ok ? "응답 확인" : "확인 불가");
    } catch {
      setStatus("확인 불가");
    }
  }

  return (
    <Box component="main" sx={{ minHeight: "100vh", display: "grid", alignItems: "center", py: 6 }}>
      <Container maxWidth="sm">
        <Paper elevation={2} sx={{ p: { xs: 3, sm: 5 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography component="p" variant="overline" color="primary.main">
                개발 환경
              </Typography>
              <Typography component="h1" variant="h3" sx={{ fontWeight: 700 }}>
                HandOff
              </Typography>
            </Box>
            <Typography color="text.secondary">
              로컬 서비스 연결 상태를 확인할 수 있습니다.
            </Typography>
            <Box>
              <Typography component="p" variant="subtitle2" color="text.secondary">
                서비스 상태
              </Typography>
              <Typography role="status" aria-live="polite" variant="h6">
                {status}
              </Typography>
            </Box>
            <Button variant="contained" onClick={checkStatus} sx={{ alignSelf: "flex-start" }}>
              상태 확인
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
