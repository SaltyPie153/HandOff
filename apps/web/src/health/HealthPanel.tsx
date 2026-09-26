import { Box, Button, Stack, Typography } from "@mui/material";
import { useHealth } from "./useHealth";

export function HealthPanel() {
  const { state, check } = useHealth();

  const announcement = {
    initial: "미확인",
    checking: "확인 중",
    ready: "준비 완료",
    degraded: "저장소 점검 필요",
    unavailable: "확인 불가"
  }[state.status];
  const storage = {
    initial: "미확인",
    checking: "확인 중",
    ready: "정상",
    degraded: state.status === "degraded" && state.database === "schema_missing" ? "스키마 준비 필요" : "연결 불가",
    unavailable: "확인 불가"
  }[state.status];

  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="p" variant="subtitle2" color="text.secondary">서비스 상태</Typography>
        <Typography component="p" variant="h6" role="status" aria-live="polite">{announcement}</Typography>
      </Box>
      <Typography component="p">저장소 상태: {storage}</Typography>
      {state.status === "degraded" && (
        <Typography component="p" color="text.secondary">
          {state.database === "schema_missing"
            ? "스키마를 준비하려면 npm run db:migrate를 실행하세요."
            : "DB 설정을 확인하고 npm run db:up으로 실행하세요."}
        </Typography>
      )}
      {state.status === "unavailable" && (
        <Typography component="p" color="text.secondary">API 프로세스를 확인하세요. 필요하면 npm run dev:api로 실행하세요.</Typography>
      )}
      {(state.status === "ready" || state.status === "degraded") && (
        <Typography component="p" color="text.secondary">확인 시각 {state.checkedAt}</Typography>
      )}
      {state.status === "unavailable" && (
        <Typography component="p" color="text.secondary">확인 시도 시각 {state.attemptedAt}</Typography>
      )}
      <Button type="button" variant="contained" onClick={check} sx={{ alignSelf: "flex-start" }}>
        상태 확인
      </Button>
    </Stack>
  );
}
