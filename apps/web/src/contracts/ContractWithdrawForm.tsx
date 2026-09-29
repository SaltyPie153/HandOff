import {useRef,useState} from 'react';
import {Alert,Button,Stack,TextField} from '@mui/material';
import {ContractApiError,type WithdrawContractInput} from './api';
export function ContractWithdrawForm({version,onSubmit,disabled=false}:{version:number;onSubmit:(input:WithdrawContractInput)=>Promise<void>;disabled?:boolean}){
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const retry=useRef<{fingerprint:string;key:string}|null>(null),submitting=useRef(false);
 const submit=async()=>{
  if(disabled||submitting.current||!reason.trim()||reason.length>10000)return;
  const input={expectedVersion:version,reason:reason.trim()},fingerprint=JSON.stringify(input);
  if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,key:crypto.randomUUID()};
  submitting.current=true;setBusy(true);setError('');
  try{await onSubmit({...input,idempotencyKey:retry.current.key});setReason('');retry.current=null;}
  catch(e){if(!(e instanceof ContractApiError&&e.status===409))setError('철회하지 못했습니다. 같은 사유로 다시 시도할 수 있습니다.');}
  finally{submitting.current=false;setBusy(false);}
 };
 return <Stack spacing={1}><Alert severity="warning">철회하면 이 제안에 더 이상 응답하거나 재전송할 수 없습니다. 기존 확정 계약은 유지됩니다.</Alert>
  <TextField label="철회 사유" multiline value={reason} onChange={e=>setReason(e.target.value)} disabled={busy||disabled} slotProps={{htmlInput:{maxLength:10000}}}/>
  {error&&<Alert severity="error">{error}</Alert>}<Button color="warning" disabled={busy||disabled||!reason.trim()||reason.length>10000} onClick={()=>void submit()}>사유를 확인하고 제안 철회</Button></Stack>;
}
