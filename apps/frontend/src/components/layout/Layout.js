// src/components/layout/Layout.js
import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Menu,
  MenuItem,
  Button,
  Collapse,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard,
  ShoppingCart,
  Inventory,
  People,
  Receipt,
  EmojiEvents,
  Assessment,
  ManageAccounts,
  Logout,
  AccountCircle,
  ShoppingBasket,
  Description,
  AccountBalance,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  SettingsBrightness as SystemModeIcon,
  Campaign,
  PointOfSale,
  ExpandLess,
  ExpandMore,
  WifiOff,
  CloudSync
} from '@mui/icons-material';
import { useOffline } from '../../context/OfflineContext';
import { useAuth } from '../../context/AuthContext';
import { useColorMode } from '../../theme';
import { Snackbar, Alert } from '@mui/material';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import ChangePasswordDialog from '../common/ChangePasswordDialog';

import LogoNeon from '../../logo_neon_v2.png';

const drawerWidth = 240;

const Layout = () => {
  const { isOnline, queue } = useOffline();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const { user, logout, isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwSnack, setPwSnack] = useState(false);
  const [anchorThemeEl, setAnchorThemeEl] = useState(null);

  const { mode, resolvedMode, setMode, toggleMode } = useColorMode();

  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleUserMenuOpen = (event) => setAnchorEl(event.currentTarget);
  const handleUserMenuClose = () => setAnchorEl(null);
  const handleThemeMenuOpen = (event) => setAnchorThemeEl(event.currentTarget);
  const handleThemeMenuClose = () => setAnchorThemeEl(null);

  /* 
     State for collapsible menus.
  */
  const [openFinances, setOpenFinances] = useState(false);
  const [openManagement, setOpenManagement] = useState(false);

  /* Helper to check active state for groups */
  const isActive = (path) => location.pathname.startsWith(path);

  // Auto-expand groups if active child
  useEffect(() => {
    if (['/invoices', '/purchases', '/transactions', '/cash-count', '/profit-loss', '/reports'].some(p => location.pathname.startsWith(p))) {
      setOpenFinances(true);
    }
    if (['/articles', '/customers', '/users'].some(p => location.pathname.startsWith(p))) {
      setOpenManagement(true);
    }
  }, [location.pathname]);

  const handleLogout = async () => { await logout(); navigate('/login'); };
  const drawer = (
    <div>
      <Toolbar sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
        <img src={LogoNeon} alt="Clubraum" style={{ maxHeight: 60, width: 'auto' }} />
      </Toolbar>
      <Divider />
      <List component="nav">
        {/* TOP LEVEL: Most Used */}
        <ListItem disablePadding>
          <ListItemButton selected={location.pathname === '/sales'} onClick={() => { navigate('/sales'); setMobileOpen(false); }}>
            <ListItemIcon><ShoppingCart /></ListItemIcon>
            <ListItemText primary="Verkauf" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton selected={location.pathname === '/dashboard'} onClick={() => { navigate('/dashboard'); setMobileOpen(false); }}>
            <ListItemIcon><Dashboard /></ListItemIcon>
            <ListItemText primary="Dashboard" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton selected={location.pathname === '/highscore'} onClick={() => { navigate('/highscore'); setMobileOpen(false); }}>
            <ListItemIcon><EmojiEvents /></ListItemIcon>
            <ListItemText primary="Clubscore" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton selected={location.pathname === '/ads'} onClick={() => { navigate('/ads'); setMobileOpen(false); }}>
            <ListItemIcon><Campaign /></ListItemIcon>
            <ListItemText primary="Werbung" />
          </ListItemButton>
        </ListItem>

        <Divider sx={{ my: 1 }} />

        {/* GROUP: Finanzen */}
        <ListItemButton onClick={() => setOpenFinances(!openFinances)}>
          <ListItemIcon><AccountBalance /></ListItemIcon>
          <ListItemText primary="Finanzen" />
          {openFinances ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
        <Collapse in={openFinances} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            <ListItemButton sx={{ pl: 4 }} selected={isActive('/purchases')} onClick={() => { navigate('/purchases'); setMobileOpen(false); }}>
              <ListItemIcon><ShoppingBasket /></ListItemIcon>
              <ListItemText primary="Einkauf" />
            </ListItemButton>
            <ListItemButton sx={{ pl: 4 }} selected={isActive('/invoices')} onClick={() => { navigate('/invoices'); setMobileOpen(false); }}>
              <ListItemIcon><Description /></ListItemIcon>
              <ListItemText primary="Kundenrechnungen" />
            </ListItemButton>

            <ListItemButton sx={{ pl: 4 }} selected={isActive('/transactions')} onClick={() => { navigate('/transactions'); setMobileOpen(false); }}>
              <ListItemIcon><Receipt /></ListItemIcon>
              <ListItemText primary="Transaktionen" />
            </ListItemButton>
            <ListItemButton sx={{ pl: 4 }} selected={isActive('/cash-count')} onClick={() => { navigate('/cash-count'); setMobileOpen(false); }}>
              <ListItemIcon><PointOfSale /></ListItemIcon>
              <ListItemText primary="Kasse & Bank" />
            </ListItemButton>
            <ListItemButton sx={{ pl: 4 }} selected={isActive('/profit-loss')} onClick={() => { navigate('/profit-loss'); setMobileOpen(false); }}>
              <ListItemIcon><AccountBalance /></ListItemIcon>
              <ListItemText primary="Kassenprüfung" />
            </ListItemButton>
            <ListItemButton sx={{ pl: 4 }} selected={isActive('/reports')} onClick={() => { navigate('/reports'); setMobileOpen(false); }}>
              <ListItemIcon><Assessment /></ListItemIcon>
              <ListItemText primary="Berichte" />
            </ListItemButton>
          </List>
        </Collapse>

        {/* GROUP: Verwaltung */}
        <ListItemButton onClick={() => setOpenManagement(!openManagement)}>
          <ListItemIcon><ManageAccounts /></ListItemIcon>
          <ListItemText primary="Verwaltung" />
          {openManagement ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
        <Collapse in={openManagement} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            <ListItemButton sx={{ pl: 4 }} selected={isActive('/articles')} onClick={() => { navigate('/articles'); setMobileOpen(false); }}>
              <ListItemIcon><Inventory /></ListItemIcon>
              <ListItemText primary="Artikel" />
            </ListItemButton>
            <ListItemButton sx={{ pl: 4 }} selected={isActive('/customers')} onClick={() => { navigate('/customers'); setMobileOpen(false); }}>
              <ListItemIcon><People /></ListItemIcon>
              <ListItemText primary="Kunden" />
            </ListItemButton>
            {isAdmin && (
              <ListItemButton sx={{ pl: 4 }} selected={isActive('/users')} onClick={() => { navigate('/users'); setMobileOpen(false); }}>
                <ListItemIcon><ManageAccounts /></ListItemIcon>
                <ListItemText primary="Benutzer" />
              </ListItemButton>
            )}
          </List>
        </Collapse>

      </List>
    </div>
  );

  const currentTitle = (() => {
    const p = location.pathname;
    if (p.startsWith('/sales')) return 'Verkauf';
    if (p.startsWith('/dashboard')) return 'Dashboard';
    if (p.startsWith('/highscore')) return 'Clubscore';
    if (p.startsWith('/ads')) return 'Werbung';
    if (p.startsWith('/invoices')) return 'Kundenrechnungen';
    if (p.startsWith('/purchases')) return 'Einkauf';
    if (p.startsWith('/transactions')) return 'Transaktionen';
    if (p.startsWith('/cash-count')) return 'Kasse & Bank';
    if (p.startsWith('/profit-loss')) return 'Kassenprüfung';
    if (p.startsWith('/reports')) return 'Berichte';
    if (p.startsWith('/articles')) return 'Artikel';
    if (p.startsWith('/customers')) return 'Kunden';
    if (p.startsWith('/users')) return 'Benutzer';
    return 'Clubtouch3';
  })();

  const ThemeIcon = resolvedMode === 'dark' ? DarkModeIcon : LightModeIcon;
  const showCenterSalesBtn = !location.pathname.startsWith('/sales');

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <AppBar
          position="fixed"
          sx={{
            zIndex: (t) => t.zIndex.drawer + 1,
            ml: { lg: location.pathname.startsWith('/sales') ? 0 : `${drawerWidth}px` },
            width: { lg: location.pathname.startsWith('/sales') ? '100%' : `calc(100% - ${drawerWidth}px)` },
            bgcolor: !isOnline ? 'error.light' : 'background.default',
            color: 'text.primary',
            transition: 'background-color 0.3s'
          }}
        >
          <Toolbar sx={{ position: 'relative', minHeight: 64 }}>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2, display: location.pathname.startsWith('/sales') ? 'flex' : { lg: 'none' } }}
            >
              <MenuIcon />
            </IconButton>

            <Typography variant="h6" noWrap sx={{ flexGrow: 1, minWidth: 0, mr: 1 }}>
              {currentTitle}
            </Typography>

            {showCenterSalesBtn && (
              <Box
                sx={{
                  // Handy: im Fluss rechts neben dem Titel (sonst überdeckt der zentrierte Button den Titel)
                  position: { xs: 'static', sm: 'absolute' },
                  left: '50%',
                  transform: { xs: 'none', sm: 'translateX(-50%)' },
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'none',
                  mr: { xs: 1, sm: 0 },
                }}
              >
                <Button
                  variant="contained"
                  color="secondary"
                  startIcon={<ShoppingCart />}
                  onClick={() => navigate('/sales')}
                  aria-label="Verkauf öffnen"
                  sx={{
                    pointerEvents: 'auto', textTransform: 'none', fontWeight: 700,
                    // Handy: nur Icon, sonst überdeckt der Button den Seitentitel
                    minWidth: 0, px: { xs: 1, sm: 2 },
                    '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } },
                  }}
                >
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Verkauf öffnen</Box>
                </Button>
              </Box>
            )}

            {/* Offline Indicator */}
            {!isOnline && (
              <Box sx={{ mr: 2, display: 'flex', alignItems: 'center', color: 'primary.contrastText', bgcolor: 'error.lighter', px: 1.5, py: 0.5, borderRadius: 2 }}>
                <WifiOff sx={{ mr: 1, fontSize: 20 }} />
                <Typography variant="subtitle2" fontWeight={800} sx={{ display: { xs: 'none', sm: 'block' } }}>
                  OFFLINE {queue.length > 0 && `(${queue.length})`}
                </Typography>
                {queue.length > 0 && <Typography variant="subtitle2" fontWeight={800} sx={{ display: { xs: 'block', sm: 'none' } }}>
                  ({queue.length})
                </Typography>}
              </Box>
            )}
            {isOnline && queue.length > 0 && (
              <Box sx={{ mr: 2, display: 'flex', alignItems: 'center', color: 'warning.main', bgcolor: 'warning.lighter', px: 1.5, py: 0.5, borderRadius: 2 }}>
                <CloudSync sx={{ mr: 1, fontSize: 20, animation: 'spin 2s linear infinite' }} />
                <Typography variant="subtitle2" fontWeight={800}>
                  SYNC ({queue.length})
                </Typography>
              </Box>
            )}

            <IconButton
              color="inherit"
              aria-label="Darstellung umschalten"
              onClick={toggleMode}
              onContextMenu={(e) => { e.preventDefault(); handleThemeMenuOpen(e); }}
              onAuxClick={(e) => { if (e.button === 1) handleThemeMenuOpen(e); }}
              title={`Darstellung: ${resolvedMode}`}
              sx={{ mr: 1 }}
            >
              <ThemeIcon />
            </IconButton>
            <Menu anchorEl={anchorThemeEl} open={Boolean(anchorThemeEl)} onClose={handleThemeMenuClose}>
              <MenuItem selected={mode === 'dark'} onClick={() => { setMode('dark'); handleThemeMenuClose(); }}>
                <DarkModeIcon fontSize="small" style={{ marginRight: 8 }} /> Dunkel
              </MenuItem>
              <MenuItem selected={mode === 'light'} onClick={() => { setMode('light'); handleThemeMenuClose(); }}>
                <LightModeIcon fontSize="small" style={{ marginRight: 8 }} /> Hell
              </MenuItem>
              <MenuItem selected={mode === 'system'} onClick={() => { setMode('system'); handleThemeMenuClose(); }}>
                <SystemModeIcon fontSize="small" style={{ marginRight: 8 }} /> System
              </MenuItem>
            </Menu>

            <IconButton onClick={handleUserMenuOpen} color="inherit" aria-label="Benutzermenü">
              <Avatar sx={{ width: 32, height: 32 }}>
                <AccountCircle />
              </Avatar>
            </IconButton>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleUserMenuClose}>
              <MenuItem disabled>
                <Typography variant="body2">
                  {user?.name}{user?.username ? ` · ${user.username}` : ''} ({user?.role})
                </Typography>
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => { handleUserMenuClose(); setPwOpen(true); }}>
                <ListItemIcon><VpnKeyIcon fontSize="small" /></ListItemIcon>
                Passwort ändern
              </MenuItem>
              <MenuItem onClick={() => { handleUserMenuClose(); handleLogout(); }}>
                <ListItemIcon><Logout fontSize="small" /></ListItemIcon>
                Abmelden
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>
        <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} onSuccess={() => setPwSnack(true)} />
        <Snackbar open={pwSnack} autoHideDuration={5000} onClose={() => setPwSnack(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert severity="success" variant="filled" onClose={() => setPwSnack(false)}>Passwort geändert</Alert>
        </Snackbar>

        <Box component="nav" sx={{ width: { lg: location.pathname.startsWith('/sales') ? 0 : drawerWidth }, flexShrink: { lg: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: 'block', lg: location.pathname.startsWith('/sales') ? 'block' : 'none' },
              '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
            }}
          >
            {drawer}
          </Drawer>

          <Drawer
            variant="permanent"
            sx={{
              display: location.pathname.startsWith('/sales') || isMobile ? 'none' : { xs: 'none', lg: 'block' },
              '& .MuiDrawer-paper': {
                boxSizing: 'border-box',
                width: drawerWidth,
                borderRight: (t) => `1px solid ${t.palette.divider}`,
              },
            }}
            open
          >
            {drawer}
          </Drawer>
        </Box>

      {/* Main Content Area: Added display flex column to allow full height children */}
      <Box component="main" sx={{
        flexGrow: 1,
        minWidth: 0, // sonst treiben Tabs/Tabellen die Min-Content-Breite über den Viewport (Handy)
        display: 'flex',
        flexDirection: 'column',
        mt: 8,
        px: location.pathname.startsWith('/sales') ? 0 : 2,
        pb: 2,
        width: !location.pathname.startsWith('/sales') ? { lg: `calc(100% - ${drawerWidth}px)` } : '100%',
        ml: 0
      }}>
        <Outlet />
      </Box>
    </Box>
  );
};

export default Layout;
