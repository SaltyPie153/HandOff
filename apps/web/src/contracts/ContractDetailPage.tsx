import {useEffect,useState} from 'react';import {Alert,Button,Link,Stack,Typography} from '@mui/material';
import {errorLabel,loadContract,type ContractDetail} from './api';
export function ContractDetailPage({projectId,contractId}:{projectId:string;contractId:string}){
 const [detail,setDetail]=useState<ContractDetail|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;setDetail(null);setError('');loadContract(projectId,contractId).then(r=>{if(live)setDetail(r);}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,contractId,reload]);
 return <Stack spacing={2}><Link href={`/projects/${projectId}/contracts`}>계약 목록으로</Link>{error&&<Alert severity="error">{error}</Alert>}{!error&&!detail&&<Typography>불러오는 중…</Typography>}
  {detail&&<><Typography component="h1" variant="h4">{detail.publicTitle}</Typography>
   {detail.status==='ACTIVE'?<><Typography>팀 공개 확정 계약 · 버전 {detail.version}</Typography><Typography>확정 시각: {detail.confirmedAt&&new Date(detail.confirmedAt).toLocaleString()}</Typography><Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.body}</Typography></>:<><Alert severity="warning">현재 유효 계약 없음</Alert><Typography>폐기 시각: {detail.retiredAt&&new Date(detail.retiredAt).toLocaleString()}</Typography><Typography component="h2" variant="h6">합의된 폐기 이유</Typography><Typography sx={{whiteSpace:'pre-wrap'}}>{detail.retirement?.reason}</Typography></>}
   {detail.previousContractId&&<Link href={`/projects/${projectId}/contracts/${detail.previousContractId}`}>이전 폐기 계약 보기</Link>}
   {detail.canOpenProposal&&<Link href={`/projects/${projectId}/contract-inbox`}>내 제안 검토·진행 상태 보기</Link>}
   {!!detail.history?.length&&<Typography component="h2" variant="h6">확정 이력 (과거 기록 포함)</Typography>}
   {detail.history?.filter(v=>detail.status!=='ACTIVE'||v.versionId!==detail.lastConfirmed?.versionId).map(v=><Stack key={v.versionId}><Typography>제안 {v.proposalId} · 버전 {v.version} · {new Date(v.confirmedAt).toLocaleString()}</Typography><Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{v.body}</Typography></Stack>)}
  </>}
  <Button onClick={()=>setReload(n=>n+1)}>새로고침</Button></Stack>;
}
