import Router from "./router/Router.tsx";
import { createTheme, ThemeProvider } from '@mui/material/styles';
import theme from './theme/theme.ts';
import custom from "./theme/custom.ts";

const muiTheme = createTheme(theme, custom);

// 取得本機 IP domain
const { hostname } = window.location;
const api_protocol = import.meta.env.VITE_API_PROTOCOL;
const port = import.meta.env.VITE_API_PORT;
const domain = import.meta.env.VITE_DOMAIN;
const HTTP_HOST = domain === 'localhost'? `${api_protocol}://${hostname}:${port}` :`${api_protocol}://${domain}:${port}`;
console.log('HTTP_HOST:', HTTP_HOST);
const VITE_ENV = import.meta.env.VITE_ENV;
console.log('VITE_ENV:', VITE_ENV);

function App() {
  return (
    <ThemeProvider theme={muiTheme}>
      <Router />
    </ThemeProvider>
  )
}

export default App
