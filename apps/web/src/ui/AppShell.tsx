import {useEffect, useState, type ReactNode} from 'react';
import {Box, Button, Drawer, IconButton, Link, Stack, Typography} from '@mui/material';

type IconName='grid'|'home'|'feed'|'inbox'|'contract'|'review'|'people'|'settings'|'menu'|'close';
const paths:Record<IconName,string>={
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  home:'M3 10l9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
  feed:'M4 5h16 M4 12h16 M4 19h10',
  inbox:'M4 4h16v16H4z M4 14h5l2 3h2l2-3h5',
  contract:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
  review:'M4 4h16v16H4z M8 12l3 3 6-6',
  people:'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M16 4a4 4 0 0 1 0 8 M17 16a5 5 0 0 1 5 5',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  menu:'M4 6h16 M4 12h16 M4 18h16', close:'M6 6l12 12 M18 6L6 18'
};
export function UiIcon({name}:{name:IconName}) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}

export function AppShell({path,isServiceAdmin,children}:{path:string;isServiceAdmin:boolean;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  const [hash,setHash]=useState(window.location.hash);
  useEffect(()=>{
    const update=()=>setHash(window.location.hash);
    window.addEventListener('hashchange',update);
    return()=>window.removeEventListener('hashchange',update);
  },[]);
  const projectId=path.match(/^\/projects\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  const base=projectId?`/projects/${projectId}`:'';
  const projectLinks=projectId?[
    {label:'프로젝트 개요',href:base,icon:'home' as const,active:path===base&&hash!=='#members'},
    {label:'팀 피드',href:`${base}/feed`,icon:'feed' as const,active:path===`${base}/feed`},
    {label:'내 요청',href:`${base}/inbox`,icon:'inbox' as const,active:path===`${base}/inbox`||path.startsWith(`${base}/requests/`)},
    {label:'확정 계약',href:`${base}/contracts`,icon:'contract' as const,active:path.startsWith(`${base}/contracts`)},
    {label:'계약 검토',href:`${base}/contract-inbox`,icon:'review' as const,active:path===`${base}/contract-inbox`||path.startsWith(`${base}/contract-proposals/`)},
    {label:'멤버',href:`${base}#members`,icon:'people' as const,active:path===`${base}/members`||(path===base&&hash==='#members')}
  ]:[];
  const globalLinks=[{label:'모든 프로젝트',href:'/projects',icon:'grid' as const,active:!projectId&&!path.startsWith('/admin')&&path!=='/settings'}];
  const adminLinks=isServiceAdmin?[
    {label:'가입 승인',href:'/admin/pending',icon:'people' as const,active:path==='/admin/pending'},
    {label:'전체 프로젝트 관리',href:'/admin/projects',icon:'grid' as const,active:path==='/admin/projects'}
  ]:[];
  const current=[...globalLinks,...projectLinks,...adminLinks].find(item=>item.active)?.label??'설정';
  function group(items:{label:string;href:string;icon:IconName;active:boolean}[]) {
    return items.map(item=><Link key={item.href} href={item.href} underline="none" aria-current={item.active?'page':undefined} onClick={()=>setOpen(false)} sx={{display:'flex',alignItems:'center',gap:1.5,px:1.5,py:1.15,borderRadius:2,fontSize:14,fontWeight:item.active?650:500,color:item.active?'primary.main':'text.secondary',bgcolor:item.active?'#eaf0ff':'transparent','&:hover':{bgcolor:item.active?'#e1eaff':'#f0f2f6'}}}><UiIcon name={item.icon}/>{item.label}</Link>);
  }
  function navigation(mobile=false) {
    return <Stack sx={{height:'100%',p:2.5,overflowY:'auto'}} spacing={3}>
      <Stack direction="row" sx={{alignItems:'center',justifyContent:'space-between'}}>
        <Link href="/projects" underline="none" color="text.primary" sx={{display:'flex',alignItems:'center',gap:1.2,fontWeight:750,fontSize:22,letterSpacing:'-.8px'}}><Box aria-hidden sx={{bgcolor:'primary.main',color:'white',width:31,height:31,borderRadius:1.7,display:'grid',placeItems:'center',fontSize:18}}>H</Box>HandOff</Link>
        {mobile&&<IconButton aria-label="메뉴 닫기" onClick={()=>setOpen(false)}><UiIcon name="close"/></IconButton>}
      </Stack>
      <Stack component="nav" aria-label={mobile?'모바일 메뉴':'주 메뉴'} spacing={3} sx={{flex:1}}>
        <Stack spacing={.5}>{group(globalLinks)}</Stack>
        {projectId&&<Stack spacing={.5}><Typography variant="overline" color="text.secondary" sx={{px:1.5,mb:.5}}>프로젝트 공간</Typography>{group(projectLinks)}</Stack>}
        {adminLinks.length>0&&<Stack spacing={.5}><Typography variant="overline" color="text.secondary" sx={{px:1.5,mb:.5}}>서비스 관리</Typography>{group(adminLinks)}</Stack>}
        <Box sx={{flex:1}}/>
        {group([{label:'설정',href:'/settings',icon:'settings',active:path==='/settings'}])}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{px:1.5}}>함께 정하고, 정확히 전달하세요.</Typography>
    </Stack>;
  }
  return <Box sx={{minHeight:'100vh'}}>
    <Link href="#main-content" sx={{position:'fixed',left:16,top:-60,zIndex:1400,bgcolor:'background.paper',p:1.5,'&:focus':{top:12}}}>본문 바로가기</Link>
    <Box sx={{display:{xs:'none',md:'block'},position:'fixed',inset:'0 auto 0 0',width:236,bgcolor:'background.paper',borderRight:'1px solid',borderColor:'divider'}}>{navigation()}</Box>
    <Drawer open={open} onClose={()=>setOpen(false)} slotProps={{paper:{role:'dialog','aria-label':'탐색 메뉴',sx:{width:276,maxWidth:'90vw'}}}}>{navigation(true)}</Drawer>
    <Box sx={{ml:{md:'236px'}}}>
      <Stack component="header" direction="row" spacing={1.5} sx={{alignItems:'center',height:68,px:{xs:2,sm:3,lg:5},bgcolor:'background.paper',borderBottom:'1px solid',borderColor:'divider'}}>
        <IconButton aria-label="메뉴 열기" aria-expanded={open} onClick={()=>setOpen(true)} sx={{display:{md:'none'}}}><UiIcon name="menu"/></IconButton>
        <Typography variant="body2" color="text.secondary">{projectId?'프로젝트':'워크스페이스'}</Typography><Typography color="text.disabled">/</Typography><Typography variant="body2" sx={{fontWeight:600}}>{current}</Typography>
        <Box sx={{flex:1}}/><Button href="/settings" size="small" color="inherit" sx={{color:'text.secondary',minWidth:0}} aria-label="계정 설정"><UiIcon name="settings"/></Button>
      </Stack>
      <Box component="main" id="main-content" tabIndex={-1} sx={{maxWidth:1240,mx:'auto',p:{xs:2,sm:3,lg:5},outline:'none'}}>{children}</Box>
    </Box>
  </Box>;
}
