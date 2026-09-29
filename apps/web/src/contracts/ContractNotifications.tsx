import {useEffect,useState} from 'react';import {Alert,Button,Link,Stack,Typography} from '@mui/material';
import {errorLabel,loadNotifications,loadSummary,markRead,type ContractNotification,type ContractSummary} from './api';
const kinds={PROPOSAL_RECEIVED:'계약 제안 도착',REVISION_RECEIVED:'새 버전 도착',CHANGES_REQUESTED:'수정 요청',CONFIRMED:'계약 확정'};
export function ContractNotifications({projectId}:{projectId:string}){
 const [data,setData]=useState<{summary:ContractSummary;notes:ContractNotification[]}|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;setError('');setData(null);Promise.all([loadSummary(projectId),loadNotifications(projectId)]).then(([summary,notes])=>{if(live)setData({summary,notes});}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,reload]);
 const read=async(id:string)=>{setBusy(true);try{await markRead(projectId,id);setReload(n=>n+1);}catch(e){setError(errorLabel(e));}finally{setBusy(false);}};
 return <Stack spacing={1}><Typography component="h2" variant="h6">계약 알림</Typography>{error&&<Alert severity="error">{error}</Alert>}
  {data&&<><Typography>동의 검토 필요 {data.summary.needsReview} · 수정 필요 {data.summary.needsChanges} · 읽지 않은 알림 {data.summary.unreadNotifications}</Typography>
   {data.notes.map(n=><Stack key={n.id}><Link href={`/projects/${projectId}/contract-proposals/${n.proposalId}?version=${n.version}`}>{n.publicTitle} · 버전 {n.version} · {kinds[n.kind]}</Link>{!n.readAt&&<Button disabled={busy} onClick={()=>void read(n.id)}>계약 알림 읽음</Button>}</Stack>)}</>}
  <Button onClick={()=>setReload(n=>n+1)}>계약 알림 새로고침</Button></Stack>;
}
