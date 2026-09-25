import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#285d73" },
    background: { default: "#f4f7f7", paper: "#ffffff" }
  },
  typography: {
    fontFamily: '"Segoe UI", "Noto Sans KR", sans-serif'
  },
  shape: { borderRadius: 12 }
});

export default theme;
