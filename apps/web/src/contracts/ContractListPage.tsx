import {useEffect,useState} from 'react';import {Alert,Button,Link,Stack,Typography} from '@mui/material';
import {errorLabel,loadContracts,type ContractCard} from './api';
import {EmptyState,PageHeader,Section,StatusBadge} from '../ui/primitives';
export function ContractListPage({projectId}:{projectId:string}){
 const [rows,setRows]=useState<ContractCard[]|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;setRows(null);setError('');loadContracts(projectId).then(r=>{if(live)setRows(r);}).catch(e=>{if(live)setError(errorLabel(e));});return()=>{live=false;};},[projectId,reload]);
 return <Stack spacing={3}><PageHeader title="개발 계약" description="확정된 계약은 팀에 공개됩니다. 검토 중인 제안은 참여자만 볼 수 있습니다." actions={<Button variant="outlined" onClick={()=>setReload(n=>n+1)}>새로고침</Button>}/><Link href={`/projects/${projectId}/contract-inbox`}>내 계약 검토·알림</Link>
  {error&&<Alert severity="error">{error}</Alert>}{!error&&!rows&&<Typography>불러오는 중…</Typography>}{rows?.length===0&&<Section><EmptyState>아직 계약이 없습니다.</EmptyState></Section>}
  {rows?.map(r=><Section key={r.id}><Stack spacing={2}><Stack direction="row" spacing={2} sx={{justifyContent:'space-between',alignItems:'start'}}><Typography sx={{fontWeight:650}}>{r.publicTitle} · {r.status==='ACTIVE'?'확정':r.status==='RETIRED'?'폐기됨':'미확정'}</Typography><StatusBadge tone={r.status==='ACTIVE'?'success':r.status==='RETIRED'?'neutral':'warning'}>{r.status==='ACTIVE'?'팀 공개':r.status==='RETIRED'?'과거 기록':'검토 중'}</StatusBadge></Stack><Stack direction="row" spacing={3} sx={{flexWrap:'wrap'}}>{r.status!=='UNCONFIRMED'&&<Link href={`/projects/${projectId}/contracts/${r.id}`}>{r.status==='RETIRED'?'폐기 이력 보기':'확정 본문 보기'}</Link>}{r.canOpenProposal&&<Link href={`/projects/${projectId}/contract-inbox`}>내 제안 검토에서 확인</Link>}</Stack></Stack></Section>)}
  </Stack>;
}
