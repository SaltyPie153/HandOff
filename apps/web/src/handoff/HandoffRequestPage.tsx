import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
import { HandoffApiError, loadRequest, loadRequestVersion, publishReply, statusLabel, type RequestDetail } from './api';
import { HandoffResponseForm } from './HandoffResponseForm';
import {PageHeader,Section,StatusBadge,twoColumns} from '../ui/primitives';

export function HandoffRequestPage({ projectId, requestId, viewerId }: { projectId: string; requestId: string; viewerId: string }) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<'DENIED' | 'FAILED' | null>(null);
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const [selectedVersion,setSelectedVersion]=useState<number|undefined>(()=>{
    const value=Number(new URLSearchParams(window.location.search).get('version'));
    return Number.isSafeInteger(value)&&value>0?value:undefined;
  });
  const [reload,setReload]=useState(0);
  const retry=useRef<{body:string;version:number;key:string}|null>(null);
  useEffect(() => { setComment(''); }, [projectId, requestId, viewerId]);
  useEffect(() => {
    let active = true;
    setDetail(null);setError(null);
    void (selectedVersion===undefined?loadRequest(projectId, requestId):loadRequestVersion(projectId,requestId,selectedVersion)).then(value => { if (active) setDetail(value); })
      .catch(cause => { if (active) setError(cause instanceof HandoffApiError && [403, 404].includes(cause.status) ? 'DENIED' : 'FAILED'); });
    return () => { active = false; };
  }, [projectId, requestId, selectedVersion,reload]);
  async function post() {
    if (!body.trim() || busy || !detail) return;
    setBusy(true);
    setError(null);
    try {
      if(retry.current?.body!==body||retry.current?.version!==detail.version)retry.current={body,version:detail.version,key:crypto.randomUUID()};
      const reply = await publishReply(projectId, requestId, body, retry.current.key,detail.version);
      setDetail(value => value && { ...value, replies: value.replies.some(item => item.id === reply.id) ? value.replies : [...value.replies, reply] });
      retry.current = null;
      setPosted(true);
      setBody('');
      setPreview(false);
    } catch { setError('FAILED'); }
    finally { setBusy(false); }
  }
  return <Stack spacing={3}>
    <Link href={`/projects/${projectId}/feed`}>팀 피드로</Link>
    {!detail && !error && <CircularProgress aria-label="요청 불러오는 중" />}
    {error && <Alert severity={error === 'DENIED' ? 'warning' : 'error'}>{error === 'DENIED' ? '접근 권한이 없습니다.' : '요청을 처리하지 못했습니다.'}</Alert>}
    {detail && <>
      <PageHeader title={detail.publicTitle} eyebrow="PRIVATE REQUEST" description={`비공개 요청 · 버전 ${detail.version}`} actions={<StatusBadge tone={detail.status==='ACKNOWLEDGED'?'success':detail.status==='CHANGES_REQUESTED'?'warning':'info'}>처리 상태: {statusLabel[detail.status]}</StatusBadge>}/>
      <Stack direction={{xs:'column',sm:'row'}} spacing={2} sx={{alignItems:{sm:'center'}}}>
      <label>요청 버전 <select aria-label="요청 버전" value={detail.version} onChange={e=>{setSelectedVersion(Number(e.target.value));setBody('');setPreview(false);setPosted(false);}}>
        {detail.versions.map(v=><option key={v.version} value={v.version}>버전 {v.version} · {statusLabel[v.status]}</option>)}
      </select></label>
      <Button onClick={()=>{setSelectedVersion(undefined);setReload(n=>n+1);}}>최신 버전 새로고침</Button>
      </Stack>
      {detail.version!==detail.currentVersion&&<Alert severity="info">과거 버전입니다. 확인과 공개 회신은 최신 버전에서 처리하세요.</Alert>}
      <Box sx={twoColumns}>
      <Stack spacing={3}>
      <Section title="요청 내용" description="송신자와 수신자만 열람할 수 있습니다."><Stack spacing={2}>
      <Typography sx={{ whiteSpace: 'pre-wrap' }}>{detail.privateBody}</Typography>
      {detail.verificationClaim && <Typography>자동 확인 항목: {detail.verificationClaim}</Typography>}
      {detail.response&&<Stack spacing={1}>
        <Typography>사람의 응답: {detail.response.action==='ACKNOWLEDGE'?'내용 확인 완료':'수정 요청'} · {new Date(detail.response.createdAt).toLocaleString()}</Typography>
        {detail.response.comment&&<Typography sx={{whiteSpace:'pre-wrap'}}>비공개 수정 의견: {detail.response.comment}</Typography>}
      </Stack>}
      </Stack></Section>
      {viewerId===detail.senderId&&detail.version===detail.currentVersion&&<Alert severity="info">
        새 버전은 Codex에 재전송을 요청하세요. 요청 ID: {requestId}, 현재 버전: {detail.currentVersion}. 수정 의견과 최신 내용을 확인한 뒤 새 버전을 전송할 수 있습니다.
      </Alert>}
      <Section title="팀 공개 회신" actions={<StatusBadge tone="info">팀 전체 공개</StatusBadge>}><Stack spacing={2}>
      {detail.replies.length===0&&<Typography color="text.secondary">아직 공개 회신이 없습니다.</Typography>}
      {detail.replies.map(reply => <Box key={reply.id} sx={{borderLeft:'2px solid',borderColor:reply.source==='CODEX_AUTO'?'primary.light':'divider',pl:2}}><Typography sx={{ whiteSpace: 'pre-wrap' }}>
        버전 {reply.version} · {reply.source === 'CODEX_AUTO' ? '서버 자동 회신 · ' : '회원 회신 · '}{reply.body}
      </Typography></Box>)}
      </Stack></Section>
      </Stack>
      <Stack spacing={3}>
      {detail.canRespond&&viewerId===detail.recipientId&&<Section><HandoffResponseForm key={detail.versionId} projectId={projectId} requestId={requestId} version={detail.version} comment={comment} onCommentChange={setComment} onSaved={()=>{setComment('');setReload(n=>n+1);}}/></Section>}
      {viewerId === detail.recipientId && detail.version===detail.currentVersion && <>
        <Section title="공개 회신 작성" description="게시 전 팀에 공유할 내용을 확인하세요."><Stack spacing={2}>
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
        </Stack></Section>
      </>}
      </Stack>
      </Box>
    </>}
  </Stack>;
}
