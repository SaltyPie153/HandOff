import {useEffect,useState} from 'react';import {Alert,Button,Link,Stack,Typography} from '@mui/material';
import {errorLabel,loadContract,type ContractDetail} from './api';
export function ContractDetailPage({projectId,contractId}:{projectId:string;contractId:string}){
 const [detail,setDetail]=useState<ContractDetail|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;setDetail(null);setError('');loadContract(projectId,contractId).then(r=>{if(live)setDetail(r);}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,contractId,reload]);
 return <Stack spacing={2}><Link href={`/projects/${projectId}/contracts`}>계약 목록으로</Link>{error&&<Alert severity="error">{error}</Alert>}{!error&&!detail&&<Typography>불러오는 중…</Typography>}
  {detail&&<><Typography component="h1" variant="h4">{detail.publicTitle}</Typography><Typography>팀 공개 확정 계약 · 버전 {detail.version}</Typography><Typography>확정 시각: {detail.confirmedAt&&new Date(detail.confirmedAt).toLocaleString()}</Typography><Typography sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.body}</Typography></>}
  <Button onClick={()=>setReload(n=>n+1)}>새로고침</Button></Stack>;
}
