import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import { Box, Container } from '@mui/material';

export default function Layout() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: (theme) => theme.palette.background.default,
        color: (theme) => theme.palette.text.primary,
      }}
    >
      <Box sx={{ flex: 0, flexDirection: 'column' }}>
        <Navbar />
      </Box>
      <Container
        maxWidth={false}
        sx={{
          position:'relative',
          flex: 1,
          display:'flex',
          flexDirection: 'column',
          height:'100%',
          overflowY:'hidden',
          maxWidth: (theme) => theme.breakpoints.values.laptop,
          width: '100%'
        }}
      >
        <Outlet />
      </Container>
      <Box
        sx={{
          position: 'absolute',
          bottom: 8,
          right: 16,
          fontSize: '0.75rem',
          color: (theme) => theme.palette.text.secondary,
          opacity: 0.7,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        v1.0.4
      </Box>
    </Box>
  );
}
