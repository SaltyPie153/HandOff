import {useEffect,useState} from 'react';
import {Alert,Button,Link,List,ListItem,Stack,Typography} from '@mui/material';
import {loadHandoffSummary,loadNotifications,markNotificationRead,type HandoffNotification,type HandoffSummary} from './api';
const label={REQUEST_RECEIVED:'새 요청',REVISION_RECEIVED:'새 버전 재검토',ACKNOWLEDGED:'내용 확인 완료',CHANGES_REQUESTED:'수정 요청'};
export function HandoffNotifications({projectId}:{projectId:string}){
 const [summary,setSummary]=useState<HandoffSummary|null>(null),[notes,setNotes]=useState<HandoffNotification[]>([]),[error,setError]=useState(false),[busy,setBusy]=useState<string|null>(null);
 useEffect(()=>{let active=true;setSummary(null);setNotes([]);setError(false);
  void Promise.all([loadHandoffSummary(projectId),loadNotifications(projectId)]).then(([s,n])=>{if(active){setSummary(s);setNotes(n);}}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[projectId]);
 async function read(id:string){
  if(busy)return;setBusy(id);setError(false);
  try{const result=await markNotificationRead(projectId,id);setNotes(rows=>rows.map(n=>n.id===id?{...n,readAt:result.readAt}:n));setSummary(s=>s&&{...s,unreadNotifications:Math.max(0,s.unreadNotifications-1)});}
  catch{setError(true);}finally{setBusy(null);}
 }
 return <Stack spacing={1}>
  {error&&<Alert severity="error">개인 알림을 처리하지 못했습니다.</Alert>}
  {summary&&<Typography>확인 필요 {summary.needsReview} · 수정 필요 {summary.needsChanges} · 읽지 않은 알림 {summary.unreadNotifications}</Typography>}
  <Typography component="h2" variant="h6">내 알림</Typography>
  <List>{notes.map(n=><ListItem key={n.id} sx={{display:'block'}}>
    <Link href={`/projects/${projectId}/requests/${n.requestId}?version=${n.version}`}>{n.publicTitle} · 버전 {n.version} · {label[n.kind]}</Link>
    <Typography variant="caption">{new Date(n.createdAt).toLocaleString()} · {n.readAt?'읽음':'읽지 않음'}</Typography>
    {!n.readAt&&<Button disabled={!!busy} onClick={()=>void read(n.id)}>알림 읽음</Button>}
  </ListItem>)}</List>
 </Stack>;
}
