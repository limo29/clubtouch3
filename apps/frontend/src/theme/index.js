// src/theme/index.js
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  useMediaQuery,
} from '@mui/material';

const STORAGE_KEY = 'ct3-color-mode'; // 'dark' | 'light' | 'system'

const ColorModeContext = createContext({
  mode: 'dark',
  resolvedMode: 'dark',
  setMode: (_m) => {},
  toggleMode: () => {},
});

export const useColorMode = () => useContext(ColorModeContext);

export default function ColorModeProvider({ children }) {
  // Standard: dark
  const [mode, setMode] = useState(
    () => window.localStorage.getItem(STORAGE_KEY) || 'dark'
  );

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolvedMode = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggleMode = useCallback(
    () => setMode((prev) => (prev === 'dark' ? 'light' : 'dark')),
    []
  );

  const theme = useMemo(() => {
    const isDark = resolvedMode === 'dark';
    return createTheme({
      palette: {
        mode: resolvedMode,
        primary: { main: isDark ? '#90caf9' : '#1976d2' },
        secondary: { main: isDark ? '#f48fb1' : '#9c27b0' },
        success: { main: '#2e7d32' },
        warning: { main: '#ed6c02' },
        error: { main: '#d32f2f' },
        background: {
          default: isDark ? '#0f1217' : '#f7f8fa',
          paper: isDark ? '#121821' : '#ffffff',
        },
        divider: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
      },
      shape: { borderRadius: 10 },
      typography: {
        fontFamily: `"Inter","Roboto","Helvetica","Arial",sans-serif`,
        h6: { fontWeight: 700 },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            ':root': { colorScheme: resolvedMode },
            '::selection': {
              backgroundColor: isDark ? '#294b6e' : '#cbe3ff',
            },
          },
        },
        MuiPaper: {
          defaultProps: { elevation: 0 },
          styleOverrides: {
            root: {
              backgroundImage: 'none',
              border: isDark
                ? '1px solid rgba(255,255,255,0.06)'
                : '1px solid rgba(0,0,0,0.06)',
            },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            colorPrimary: {
              backgroundImage: isDark
                ? 'linear-gradient(180deg,#121821 0%,#0f1217 100%)'
                : 'linear-gradient(180deg,#1976d2 0%,#1565c0 100%)',
            },
          },
        },
        MuiButton: {
          styleOverrides: { root: { textTransform: 'none', fontWeight: 700 } },
        },
        MuiDialog: { styleOverrides: { paper: { borderRadius: 14 } } },
        MuiCard: { styleOverrides: { root: { overflow: 'hidden' } } },
      },
    });
  }, [resolvedMode]);

  const value = useMemo(
    () => ({ mode, resolvedMode, setMode, toggleMode }),
    [mode, resolvedMode, toggleMode]
  );

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
