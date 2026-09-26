import { Box, Container, Paper, Stack, Typography } from "@mui/material";
import { HealthPanel } from "./health/HealthPanel";

export default function App() {
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
            <HealthPanel />
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
