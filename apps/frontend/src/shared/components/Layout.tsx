import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Navbar from './Navbar';
import { Box, Container, CircularProgress } from '@mui/material';
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { FEATURES } from '../config/features';

export default function Layout() {
  const { config, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || !config) return;

    const currentFeature = FEATURES.find(f => f.path === location.pathname);
    const firstEnabled = FEATURES.find(f => config[f.key]);

    // 當前路由是被停用的功能，或停在根路由 / → 導向第一個可用功能
    const shouldRedirect =
      !currentFeature ||
      (currentFeature && !config[currentFeature.key]);

    if (shouldRedirect && firstEnabled) {
      navigate(firstEnabled.path, { replace: true });
    }
  }, [isLoading, config, location.pathname, navigate]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

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
        v1.0.6
      </Box>
    </Box>
  );
}
