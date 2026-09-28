import { useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
import { HandoffApiError, loadRequest, publishReply, type RequestDetail } from './api';

export function HandoffRequestPage({ projectId, requestId, viewerId }: { projectId: string; requestId: string; viewerId: string }) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<'DENIED' | 'FAILED' | null>(null);
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  useEffect(() => {
    let active = true;
    void loadRequest(projectId, requestId).then(value => { if (active) setDetail(value); })
      .catch(cause => { if (active) setError(cause instanceof HandoffApiError && [403, 404].includes(cause.status) ? 'DENIED' : 'FAILED'); });
    return () => { active = false; };
  }, [projectId, requestId]);
  async function post() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await publishReply(projectId, requestId, body, crypto.randomUUID());
      setDetail(value => value && { ...value, replies: [...value.replies, reply] });
      setPosted(true);
      setBody('');
      setPreview(false);
    } catch { setError('FAILED'); }
    finally { setBusy(false); }
  }
  return <Stack spacing={2}>
    <Link href={`/projects/${projectId}/feed`}>팀 피드로</Link>
    {!detail && !error && <CircularProgress aria-label="요청 불러오는 중" />}
    {error && <Alert severity={error === 'DENIED' ? 'warning' : 'error'}>{error === 'DENIED' ? '접근 권한이 없습니다.' : '요청을 처리하지 못했습니다.'}</Alert>}
    {detail && <>
      <Typography component="h1" variant="h4">{detail.publicTitle}</Typography>
      <Typography color="text.secondary">비공개 요청 · 버전 {detail.version}</Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap' }}>{detail.privateBody}</Typography>
      {detail.verificationClaim && <Typography>자동 확인 항목: {detail.verificationClaim}</Typography>}
      <Typography component="h2" variant="h6">팀 공개 회신</Typography>
      {detail.replies.map(reply => <Typography key={reply.id} sx={{ whiteSpace: 'pre-wrap' }}>
        {reply.source === 'CODEX_AUTO' ? '서버 자동 회신 · ' : '회원 회신 · '}{reply.body}
      </Typography>)}
      {viewerId === detail.recipientId && <>
        {detail.job?.status === 'REVIEW_REQUIRED' && <Alert severity="info">자동 회신 대신 검토가 필요합니다. {detail.job.reviewReason}</Alert>}
        {detail.job?.reviewDraft && <Typography>비공개 검토 초안: {detail.job.reviewDraft}</Typography>}
        <TextField label="팀 공개 회신" value={body} multiline minRows={3} onChange={event => { setBody(event.target.value); setPreview(false); }} />
        <Button disabled={!body.trim() || busy} onClick={() => setPreview(true)}>공개 내용 미리보기</Button>
        {preview && <Stack spacing={1}>
          <Alert severity="warning">아래 내용은 프로젝트 팀원 모두에게 공개됩니다. 비공개 요청 내용을 포함할지 확인하세요.</Alert>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{body}</Typography>
          <Button variant="contained" disabled={busy} onClick={() => void post()}>팀에 게시</Button>
        </Stack>}
        {posted && <Alert severity="success">회신을 게시했습니다.</Alert>}
      </>}
    </>}
  </Stack>;
}
