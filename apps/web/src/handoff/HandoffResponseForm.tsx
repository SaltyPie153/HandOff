import {useRef,useState} from 'react';
import {Alert,Button,Stack,TextField,Typography} from '@mui/material';
import {HandoffApiError,respondToRequest} from './api';

export function HandoffResponseForm({projectId,requestId,version,comment,onCommentChange,onSaved}:{projectId:string;requestId:string;version:number;comment:string;onCommentChange:(value:string)=>void;onSaved:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const retry=useRef<{payload:string;key:string}|null>(null);
 async function submit(action:'ACKNOWLEDGE'|'REQUEST_CHANGES'){
  if(busy||saved)return;
  const values={version,action,...(action==='REQUEST_CHANGES'?{comment:comment.trim()}:{})};
  const payload=JSON.stringify(values);
  if(retry.current?.payload!==payload)retry.current={payload,key:crypto.randomUUID()};
  setBusy(true);setError('');
  try{await respondToRequest(projectId,requestId,{...values,idempotencyKey:retry.current.key});setSaved(true);onSaved();}
  catch(cause){setError(cause instanceof HandoffApiError&&cause.status===409?'요청 상태가 바뀌었습니다. 최신 버전을 다시 확인해 주세요.':'요청을 처리하지 못했습니다. 입력한 내용으로 다시 시도할 수 있습니다.');}
  finally{setBusy(false);}
 }
 return <Stack spacing={2}>
  <Typography component="h2" variant="h6">내 확인</Typography>
  <Typography>내용 확인은 이 버전을 읽고 검토했다는 뜻입니다. 후속 개발 완료나 계약 동의로 기록되지 않습니다.</Typography>
  {error&&<Alert severity="error">{error}</Alert>}
  <Button variant="contained" disabled={busy||saved} onClick={()=>void submit('ACKNOWLEDGE')}>내용 확인 완료</Button>
  <TextField label="비공개 수정 의견" multiline minRows={2} value={comment} disabled={busy||saved} onChange={e=>onCommentChange(e.target.value)} helperText="송신자와 수신자만 볼 수 있습니다. 최대 10,000자."/>
  <Button disabled={!comment.trim()||comment.length>10000||busy||saved} onClick={()=>void submit('REQUEST_CHANGES')}>수정 요청</Button>
 </Stack>;
}
