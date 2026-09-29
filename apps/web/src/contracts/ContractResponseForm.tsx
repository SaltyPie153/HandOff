import {Alert,Button,Stack,TextField} from '@mui/material';
export function ContractResponseForm({comment,onComment,onRespond,busy,retirement=false}:{comment:string;onComment:(value:string)=>void;onRespond:(action:'AGREE'|'REQUEST_CHANGES')=>void;busy:boolean;retirement?:boolean}){
 return <Stack spacing={2}>
  <Alert severity="info">{retirement?'전원 동의 시 계약이 폐기되고 이 버전의 폐기 이유가 팀 전체에 공개됩니다.':'전원 동의 시 이 버전의 본문이 프로젝트 팀 전체에 공개됩니다.'}</Alert>
  <Button variant="contained" disabled={busy} onClick={()=>onRespond('AGREE')}>{retirement?'이 계약의 폐기에 동의':'이 버전에 동의'}</Button>
  <TextField label="비공개 수정 의견" multiline minRows={3} value={comment} onChange={e=>onComment(e.target.value)} disabled={busy} slotProps={{htmlInput:{maxLength:10000}}}/>
  <Button disabled={busy||!comment.trim()||comment.length>10000} onClick={()=>onRespond('REQUEST_CHANGES')}>수정 요청</Button>
 </Stack>;
}
