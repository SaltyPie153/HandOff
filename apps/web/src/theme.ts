import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#4469cc" },
    text: {primary:'#202b3d',secondary:'#647185'},
    divider:'#e5e9f0',
    background: { default: "#f6f7fb", paper: "#ffffff" }
  },
  typography: {
    fontFamily: '"Segoe UI", "Noto Sans KR", sans-serif'
  },
  shape: { borderRadius: 10 },
  components:{
    MuiButton:{defaultProps:{disableElevation:true},styleOverrides:{root:{padding:'8px 16px',borderRadius:8,textTransform:'none',fontWeight:600}}},
    MuiPaper:{styleOverrides:{root:{backgroundImage:'none'}}},
    MuiLink:{defaultProps:{underline:'hover'},styleOverrides:{root:{overflowWrap:'anywhere',fontWeight:500}}},
    MuiTextField:{defaultProps:{size:'small'}},
    MuiOutlinedInput:{styleOverrides:{root:{backgroundColor:'#fff',fontSize:14}}},
    MuiAlert:{styleOverrides:{root:{fontSize:13,lineHeight:1.7,borderRadius:8},message:{minWidth:0,overflowWrap:'anywhere'}}},
    MuiTab:{styleOverrides:{root:{minHeight:48,textTransform:'none',fontSize:14}}},
    MuiTypography:{styleOverrides:{h3:{fontSize:'2rem',fontWeight:700,letterSpacing:'-.8px'},h4:{fontSize:'1.7rem',fontWeight:700,letterSpacing:'-.6px',lineHeight:1.4},h6:{fontSize:'1rem',fontWeight:650,lineHeight:1.6},body1:{fontSize:14,lineHeight:1.8},body2:{fontSize:13,lineHeight:1.7},overline:{fontSize:11,letterSpacing:'.8px',fontWeight:650}}},
    MuiCssBaseline:{styleOverrides:{
      body:{margin:0},'h1,h2,h3,p':{overflowWrap:'anywhere'},
      'a:focus-visible,button:focus-visible,select:focus-visible':{outline:'2px solid #4469cc',outlineOffset:3},
      select:{font:'inherit',maxWidth:'100%',padding:'8px 32px 8px 12px',border:'1px solid #cbd3df',borderRadius:8,background:'#fff',color:'#202b3d',marginLeft:8},
      '[id]':{scrollMarginTop:24}
    }}
  }
});

export default theme;
