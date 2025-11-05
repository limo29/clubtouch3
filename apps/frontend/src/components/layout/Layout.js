// src/components/layout/Layout.js
import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
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
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import { useColorMode } from '../../theme';

const drawerWidth = 240;

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isAdmin } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [anchorThemeEl, setAnchorThemeEl] = useState(null);

  const { mode, resolvedMode, setMode, toggleMode } = useColorMode();

  const handleDrawerToggle = () => setMobileOpen(v => !v);
  const handleUserMenuOpen = (e) => setAnchorEl(e.currentTarget);
  const handleUserMenuClose = () => setAnchorEl(null);

  const handleThemeMenuOpen = (e) => setAnchorThemeEl(e.currentTarget);
  const handleThemeMenuClose = () => setAnchorThemeEl(null);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  const menuItems = [
    { text: 'Dashboard', icon: <Dashboard />, path: '/dashboard' },
    { text: 'Verkauf', icon: <ShoppingCart />, path: '/sales' },
    { text: 'Artikel', icon: <Inventory />, path: '/articles' },
    { text: 'Kunden', icon: <People />, path: '/customers' },
    { text: 'Transaktionen', icon: <Receipt />, path: '/transactions' },
    { text: 'Einkäufe', icon: <ShoppingBasket />, path: '/PurchaseDocuments' },
    { text: 'Rechnungen', icon: <Description />, path: '/invoices' },
    { text: 'Highscore', icon: <EmojiEvents />, path: '/highscore' },
    { text: 'EÜR', icon: <AccountBalance />, path: '/profit-loss' },
    { text: 'Berichte', icon: <Assessment />, path: '/reports' },
  ];
  if (isAdmin) menuItems.push({ text: 'Benutzer', icon: <ManageAccounts />, path: '/users' });

  const drawer = (
    <div>
      <Toolbar>
        <Typography variant="h6" noWrap>Clubtouch3</Typography>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => {
          const selected =
            location.pathname === item.path ||
            location.pathname.startsWith(item.path + '/');
          return (
            <ListItem key={item.text} disablePadding>
              <ListItemButton
                selected={selected}
                onClick={() => { navigate(item.path); setMobileOpen(false); }}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </div>
  );

  const currentTitle =
    menuItems.find((it) => location.pathname.startsWith(it.path))?.text || 'Clubtouch3';

  const ThemeIcon = resolvedMode === 'dark' ? DarkModeIcon : LightModeIcon;
  const showCenterSalesBtn = !location.pathname.startsWith('/sales');

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, ml: { lg: `${drawerWidth}px` } }}
      >
        <Toolbar sx={{ position: 'relative', minHeight: 64 }}>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { lg: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            {currentTitle}
          </Typography>

          {/* ZENTRALER „Verkauf öffnen“-Button (global, außer auf /sales) */}
          {showCenterSalesBtn && (
            <Box
              sx={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <Button
                variant="contained"
                color="secondary"
                startIcon={<ShoppingCart />}
                onClick={() => navigate('/sales')}
                sx={{ pointerEvents: 'auto', textTransform: 'none', fontWeight: 700 }}
              >
                Verkauf öffnen
              </Button>
            </Box>
          )}

          {/* Theme Toggle – Klick = toggle; Kontext/Middle = Modus-Menü */}
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

          {/* User-Menü */}
          <IconButton onClick={handleUserMenuOpen} color="inherit" aria-label="Benutzermenü">
            <Avatar sx={{ width: 32, height: 32 }}>
              <AccountCircle />
            </Avatar>
          </IconButton>
          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleUserMenuClose}>
            <MenuItem disabled>
              <Typography variant="body2">
                {user?.name} ({user?.role})
              </Typography>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { handleUserMenuClose(); handleLogout(); }}>
              <ListItemIcon><Logout fontSize="small" /></ListItemIcon>
              Abmelden
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Navigation – temporary < lg, permanent >= lg */}
      <Box component="nav" sx={{ width: { lg: drawerWidth }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', lg: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>

        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', lg: 'block' },
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

      {/* Main (ohne margin-left → kein Luftspalt) */}
      <Box component="main" sx={{ flexGrow: 1, mt: 8, px: 2, pb: 2 }}>
        <Outlet />
      </Box>
    </Box>
  );
};

export default Layout;
