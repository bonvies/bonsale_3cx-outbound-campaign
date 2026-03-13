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
import { useAuth } from '../context/AuthContext';
import { FEATURES } from '../config/features';

function Navbar() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { config } = useAuth();

  const enabledFeatures = useMemo(
    () => FEATURES.filter(f => config?.[f.key]),
    [config]
  );

  const showNav = enabledFeatures.length > 1;

  const pageTitle = useMemo(() => {
    return enabledFeatures.find(f => f.path === location.pathname)?.label || '監控面板';
  }, [enabledFeatures, location.pathname]);

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

        {showNav && (
          <Stack direction='row' spacing={1}>
            {enabledFeatures.map(({ key, path, label, icon: Icon }) => (
              <Button
                key={key}
                variant='text'
                startIcon={<Icon />}
                onClick={() => navigate(path)}
                sx={{
                  color: 'white',
                  px: 2,
                  bgcolor: isActive(path) ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
                  '&:hover': {
                    bgcolor: isActive(path) ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                  },
                }}
              >
                {label}
              </Button>
            ))}
          </Stack>
        )}
      </Container>
    </Box>
  );
}
export default Navbar;