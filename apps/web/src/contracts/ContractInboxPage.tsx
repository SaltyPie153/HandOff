import {useEffect,useState} from 'react';import {Alert,Box,Button,Link,Stack,Typography} from '@mui/material';
import {errorLabel,loadProposals,statusLabel,kindLabel,type ProposalItem} from './api';import {ContractNotifications} from './ContractNotifications';
import {EmptyState,PageHeader,Section,StatusBadge,twoColumns} from '../ui/primitives';
export function ContractInboxPage({projectId}:{projectId:string}){
 const [rows,setRows]=useState<ProposalItem[]|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;setRows(null);setError('');loadProposals(projectId).then(r=>{if(live)setRows(r);}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,reload]);
 return <Stack spacing={3}><PageHeader title="내 계약 검토" description="참여한 제안을 읽고, 해당 버전에 동의하거나 수정 의견을 남기세요." actions={<Button variant="outlined" onClick={()=>setReload(n=>n+1)}>검토 목록 새로고침</Button>}/><Link href={`/projects/${projectId}/contracts`}>계약 목록으로</Link>
  <Box sx={twoColumns}><Section><Stack spacing={2}>
  {error&&<Alert severity="error">{error}</Alert>}{rows?.length===0&&<EmptyState>참여한 계약 제안이 없습니다.</EmptyState>}
  {rows?.map(r=><Stack key={r.proposalId} spacing={1} sx={{py:2,borderBottom:'1px solid',borderColor:'divider'}}><Stack direction="row" spacing={2} sx={{alignItems:'start',justifyContent:'space-between'}}><Link href={`/projects/${projectId}/contract-proposals/${r.proposalId}?version=${r.version}`}>{r.publicTitle} · {kindLabel[r.kind??'INITIAL']} · 버전 {r.version} · {statusLabel[r.status]}</Link><StatusBadge tone={r.status==='CONFIRMED'?'success':r.status==='CHANGES_REQUESTED'?'warning':'neutral'}>{kindLabel[r.kind??'INITIAL']}</StatusBadge></Stack><Typography variant="caption" color="text.secondary">전송 시각: {new Date(r.createdAt).toLocaleString()}</Typography></Stack>)}
  </Stack></Section><Section><ContractNotifications projectId={projectId}/></Section></Box></Stack>;
}
