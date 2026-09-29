import {useCallback,useEffect,useRef,useState} from 'react';
import {Alert,Button,CircularProgress,Link,Stack,Typography} from '@mui/material';
import {ContractApiError,errorLabel,loadProposal,loadContract,respond,withdrawProposal,statusLabel,kindLabel,type ProposalDetail,type ConfirmedSnapshot,type WithdrawContractInput} from './api';
import {ContractResponseForm} from './ContractResponseForm';
import {ContractWithdrawForm} from './ContractWithdrawForm';
const roles={SENDER:'송신자',RECIPIENT:'수신자',REQUIRED_PM:'필수 PM',REFERENCE_PM:'참조 PM'};
export function ContractProposalPage(props:{projectId:string;proposalId:string;viewerId:string}){return <ProposalPage key={`${props.projectId}:${props.proposalId}:${props.viewerId}`} {...props}/>;}
function ProposalPage({projectId,proposalId,viewerId}:{projectId:string;proposalId:string;viewerId:string}){
 const [detail,setDetail]=useState<ProposalDetail|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false);
 const sequence=useRef(0),retry=useRef<{fingerprint:string;key:string}|null>(null),submitting=useRef(false);
 const refresh=useCallback(async(version?:number)=>{
  const seq=++sequence.current;setLoading(true);setError('');setDetail(null);
  try{const d=await loadProposal(projectId,proposalId,version);if(seq===sequence.current){setDetail(d);setConflict(false);}}
  catch(e){if(seq===sequence.current)setError(errorLabel(e));}finally{if(seq===sequence.current)setLoading(false);}
 },[projectId,proposalId]);
 useEffect(()=>{const version=new URLSearchParams(window.location.search).get('version');void refresh(version===null?undefined:Number(version));return()=>{sequence.current++;};},[refresh]);
 const submit=async(action:'AGREE'|'REQUEST_CHANGES')=>{
  if(!detail?.canRespond||conflict||submitting.current)return;
  const input={version:detail.version,action,...(action==='REQUEST_CHANGES'?{comment:comment.trim()}:{})},fingerprint=JSON.stringify(input);
  if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,key:crypto.randomUUID()};
  submitting.current=true;setBusy(true);setMessage('');
  try{await respond(projectId,proposalId,{...input,idempotencyKey:retry.current.key});retry.current=null;setComment('');setMessage('응답을 저장했습니다.');await refresh();}
  catch(e){if(e instanceof ContractApiError&&e.status===409){setConflict(true);setMessage('최신 버전을 다시 확인한 뒤 응답해 주세요. 작성한 의견은 유지됩니다.');}else setMessage('처리하지 못했습니다. 같은 내용으로 다시 시도할 수 있습니다.');}
  finally{submitting.current=false;setBusy(false);}
 };
 const mine=detail?.responses.find(r=>r.actorId===viewerId);
 const withdraw=async(input:WithdrawContractInput)=>{
  if(!detail?.canWithdraw||conflict||submitting.current)return;
  submitting.current=true;setBusy(true);setMessage('');
  try{await withdrawProposal(projectId,proposalId,input);setMessage('제안을 철회했습니다.');await refresh();}
  catch(e){if(e instanceof ContractApiError&&e.status===409){setConflict(true);setMessage('최신 버전을 다시 확인한 뒤 철회해 주세요. 작성한 사유는 유지됩니다.');}throw e;}
  finally{submitting.current=false;setBusy(false);}
 };
 return <Stack spacing={2}>
  <Link href={`/projects/${projectId}/contract-inbox`}>내 계약 검토로</Link>
  <Button disabled={busy} onClick={()=>void refresh()}>최신 버전 새로고침</Button>
  {loading&&<CircularProgress aria-label="계약 제안 불러오는 중"/>}{error&&<Alert severity="error">{error}</Alert>}{message&&<Alert severity={conflict?'warning':'info'}>{message}</Alert>}
  {detail&&<>
   <Typography component="h1" variant="h4">{detail.publicTitle}</Typography>
   <Typography>비공개 계약 제안 · 버전 {detail.version} · {statusLabel[detail.status]}</Typography>
   <Typography>{kindLabel[detail.kind??'INITIAL']} 제안</Typography>
   {detail.baselineVersionId&&<Baseline projectId={projectId} contractId={detail.contractId} versionId={detail.baselineVersionId}/>}
   <label>제안 버전 <select aria-label="제안 버전" value={detail.version} disabled={busy} onChange={e=>void refresh(Number(e.target.value))}>{detail.versions.map(v=><option key={v.version} value={v.version}>버전 {v.version} · {statusLabel[v.status]}</option>)}</select></label>
   {detail.blocked&&<Alert severity="warning">담당자 변경 필요: 필수 참여자의 프로젝트 권한을 확인해 주세요.</Alert>}
   <Typography component="h2" variant="h6">{detail.kind==='RETIRE'?'폐기 이유':'검토할 제안 본문'}</Typography>
   <Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.proposedBody}</Typography>
   {detail.withdrawal&&<Alert severity="info">철회 사유: {detail.withdrawal.reason} · {new Date(detail.withdrawal.withdrawnAt).toLocaleString()}</Alert>}
   <Typography component="h2" variant="h6">이 버전의 참여자</Typography>
   {detail.participants.map(p=>{const response=detail.responses.find(r=>r.actorId===p.userId);return <Typography key={p.userId}>{p.displayName} · {roles[p.role]} · {response?(response.action==='AGREE'?'동의 완료':'수정 요청'):p.role==='REFERENCE_PM'?'열람 대상':'응답 대기'}</Typography>;})}
   {mine?.action==='AGREE'&&detail.status==='IN_REVIEW'&&<Alert severity="info">내 동의 완료 / 전체 검토 대기</Alert>}
   {detail.responses.filter(r=>r.comment).map(r=><Alert severity="info" key={r.actorId}>비공개 수정 의견: {r.comment}</Alert>)}
   {detail.canRespond&&<ContractResponseForm comment={comment} onComment={setComment} onRespond={a=>void submit(a)} busy={busy||conflict} retirement={detail.kind==='RETIRE'}/>}
   {!detail.canRespond&&comment&&<TextDraft value={comment}/>}
   {detail.canRevise&&<Alert severity="info">새 버전은 Codex에서 전송해 주세요. 제안 ID: {detail.proposalId}, 현재 버전: {detail.currentVersion}. 기존 동의는 새 버전에 승계되지 않습니다.</Alert>}
  </>}
  <Stack sx={{display:detail?.canWithdraw?'flex':'none'}}><ContractWithdrawForm version={detail?.version??0} disabled={!detail?.canWithdraw||busy||conflict} onSubmit={withdraw}/></Stack>
 </Stack>;
}
function TextDraft({value}:{value:string}){return <Alert severity="info">작성 중인 수정 의견 (미전송): {value}</Alert>;}
function Baseline({projectId,contractId,versionId}:{projectId:string;contractId:string;versionId:string}){
 const [snapshot,setSnapshot]=useState<ConfirmedSnapshot|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setSnapshot(null);setError('');loadContract(projectId,contractId).then(d=>{if(live){const found=d.history.find(v=>v.versionId===versionId);if(found)setSnapshot(found);else setError('기준 확정본을 찾을 수 없습니다.');}}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,contractId,versionId]);
 return <Stack spacing={1}><Typography component="h2" variant="h6">기준 확정본</Typography>{error&&<Alert severity="error">{error}</Alert>}{snapshot?<Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{snapshot.body}</Typography>:!error&&<Typography>불러오는 중…</Typography>}<Link href={`/projects/${projectId}/contracts/${contractId}`}>현재 계약과 확정 이력 보기</Link></Stack>;
}
