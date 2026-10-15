import type {ReactNode} from 'react';
import {Box, Chip, Paper, Stack, Typography} from '@mui/material';

export function PageHeader({title,description,eyebrow,actions}:{title:string;description?:string;eyebrow?:string;actions?:ReactNode}) {
  return <Stack direction={{xs:'column',sm:'row'}} sx={{alignItems:{sm:'center'},justifyContent:'space-between',gap:2,mb:1}}>
    <Box sx={{minWidth:0}}>{eyebrow&&<Typography variant="overline" color="primary.main">{eyebrow}</Typography>}<Typography component="h1" variant="h4">{title}</Typography>{description&&<Typography color="text.secondary" sx={{mt:1}}>{description}</Typography>}</Box>{actions&&<Box sx={{flexShrink:0}}>{actions}</Box>}
  </Stack>;
}
export function Section({title,description,actions,children,id}:{title?:string;description?:string;actions?:ReactNode;children:ReactNode;id?:string}) {
  return <Paper variant="outlined" id={id} sx={{p:{xs:2.5,sm:3},minWidth:0}}>
    {(title||actions)&&<Stack direction="row" sx={{alignItems:'center',justifyContent:'space-between',gap:2,mb:2}}><Box>{title&&<Typography component="h2" variant="h6">{title}</Typography>}{description&&<Typography variant="body2" color="text.secondary" sx={{mt:.5}}>{description}</Typography>}</Box>{actions}</Stack>}
    {children}
  </Paper>;
}
export function StatusBadge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'info'|'success'|'warning'}) {
  const colors={neutral:['#edf0f4','#546174'],info:['#eaf0ff','#335db0'],success:['#e6f4ed','#246847'],warning:['#fff3dc','#926311']}[tone];
  return <Chip size="small" label={children} sx={{bgcolor:colors[0],color:colors[1],fontWeight:600,fontSize:12,borderRadius:1.3}}/>;
}
export const twoColumns={display:'grid',gridTemplateColumns:{xs:'minmax(0, 1fr)',lg:'minmax(0, 1fr) 340px'},gap:3,alignItems:'start'};
export function EmptyState({children}:{children:ReactNode}) {
  return <Box sx={{py:5,px:2,textAlign:'center',color:'text.secondary'}}><Typography>{children}</Typography></Box>;
}
