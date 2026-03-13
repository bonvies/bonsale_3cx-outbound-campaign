import {
  Box,
  Container,
  Typography,
  Button,
  Stack
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { Dashboard, Schedule } from '@mui/icons-material';

// 路由標題映射
const routeTitles: Record<string, string> = {
  '/': '專案自動外撥',
  '/call-schedule': '自動語音通知',
};

function Navbar() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // 根據當前路由獲取標題
  const pageTitle = useMemo(() => {
    return routeTitles[location.pathname] || '專案自動外撥監控面板';
  }, [location.pathname]);

  const isActive = (path: string) => location.pathname === path;

  return (
    <Box
      sx={{
        width: '100%',
        height:{ lg: '40px', md:'32px' },
        backgroundColor: theme.palette.primary.main,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Container
        maxWidth={false}
        sx={{
          maxWidth: (theme) => theme.breakpoints.values.laptop,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant='h5' fontWeight='400'>
          {pageTitle}
        </Typography>

        <Stack direction='row' spacing={1}>
          <Button
            variant='text'
            startIcon={<Dashboard />}
            onClick={() => navigate('/')}
            sx={{
              color: 'white',
              px: 2,
              bgcolor: isActive('/') ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
              '&:hover': {
                bgcolor: isActive('/') ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            專案自動外撥
          </Button>
          <Button
            variant='text'
            startIcon={<Schedule />}
            onClick={() => navigate('/call-schedule')}
            sx={{
              color: 'white',
              px: 2,
              bgcolor: isActive('/call-schedule') ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
              '&:hover': {
                bgcolor: isActive('/call-schedule') ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            自動語音通知
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
export default Navbar;