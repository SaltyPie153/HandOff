import {useEffect,useState} from 'react';import {Alert,Button,Link,Stack,Typography} from '@mui/material';
import {errorLabel,loadProposals,statusLabel,kindLabel,type ProposalItem} from './api';import {ContractNotifications} from './ContractNotifications';
export function ContractInboxPage({projectId}:{projectId:string}){
 const [rows,setRows]=useState<ProposalItem[]|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;setRows(null);setError('');loadProposals(projectId).then(r=>{if(live)setRows(r);}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,reload]);
 return <Stack spacing={2}><Link href={`/projects/${projectId}/contracts`}>계약 목록으로</Link><Typography component="h1" variant="h4">내 계약 검토</Typography>
  {error&&<Alert severity="error">{error}</Alert>}{rows?.length===0&&<Typography>참여한 계약 제안이 없습니다.</Typography>}
  {rows?.map(r=><Stack key={r.proposalId}><Link href={`/projects/${projectId}/contract-proposals/${r.proposalId}?version=${r.version}`}>{r.publicTitle} · {kindLabel[r.kind??'INITIAL']} · 버전 {r.version} · {statusLabel[r.status]}</Link><Typography variant="caption">전송 시각: {new Date(r.createdAt).toLocaleString()} · 제안 {r.proposalId}</Typography></Stack>)}
  <Button onClick={()=>setReload(n=>n+1)}>검토 목록 새로고침</Button><ContractNotifications projectId={projectId}/></Stack>;
}
