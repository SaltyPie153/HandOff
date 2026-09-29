import {useEffect,useState} from 'react';import {Alert,Button,Link,Stack,Typography} from '@mui/material';
import {errorLabel,loadContracts,type ContractCard} from './api';
export function ContractListPage({projectId}:{projectId:string}){
 const [rows,setRows]=useState<ContractCard[]|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;setRows(null);setError('');loadContracts(projectId).then(r=>{if(live)setRows(r);}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,reload]);
 return <Stack spacing={2}><Link href={`/projects/${projectId}`}>프로젝트 룸으로</Link><Typography component="h1" variant="h4">개발 계약</Typography><Link href={`/projects/${projectId}/contract-inbox`}>내 계약 검토·알림</Link>
  {error&&<Alert severity="error">{error}</Alert>}{!error&&!rows&&<Typography>불러오는 중…</Typography>}{rows?.length===0&&<Typography>아직 계약이 없습니다.</Typography>}
  {rows?.map(r=><Stack key={r.id}><Typography>{r.publicTitle} · {r.status==='ACTIVE'?'확정':'미확정'}</Typography>{r.status==='ACTIVE'&&<Link href={`/projects/${projectId}/contracts/${r.id}`}>확정 본문 보기</Link>}{r.canOpenProposal&&<Link href={`/projects/${projectId}/contract-inbox`}>내 제안 검토에서 확인</Link>}</Stack>)}
  <Button onClick={()=>setReload(n=>n+1)}>새로고침</Button></Stack>;
}
