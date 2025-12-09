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
  setMode: (_m) => { },
  toggleMode: () => { },
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

    // Neon Brand Colors
    const neonGreen = '#00e676';
    const neonRed = '#ff1a1a';
    const deepBlack = '#050505';
    const darkPaper = '#101010';

    // Light Brand Colors (Readable)
    const brandGreen = '#00c853'; // A darker green for white backgrounds
    const brandRed = '#d50000';

    return createTheme({
      palette: {
        mode: resolvedMode,
        primary: {
          main: isDark ? neonGreen : brandGreen,
          contrastText: isDark ? '#000000' : '#ffffff'
        },
        secondary: {
          main: isDark ? neonRed : brandRed
        },
        success: { main: isDark ? '#00e676' : '#2e7d32' },
        warning: { main: '#ffea00' }, // Neon Yellow/Amber
        error: { main: isDark ? '#ff1744' : '#d32f2f' },
        background: {
          default: isDark ? deepBlack : '#f7f8fa',
          paper: isDark ? darkPaper : '#ffffff',
        },
        divider: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
        text: {
          primary: isDark ? '#ffffff' : '#121212',
          secondary: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
        }
      },
      shape: { borderRadius: 12 },
      typography: {
        fontFamily: `"Inter","Roboto","Helvetica","Arial",sans-serif`,
        h1: { fontWeight: 700 },
        h2: { fontWeight: 700 },
        h3: { fontWeight: 700 },
        h4: { fontWeight: 700 },
        h5: { fontWeight: 700 },
        h6: { fontWeight: 700 },
        button: { fontWeight: 700 },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            ':root': { colorScheme: resolvedMode },
            '::selection': {
              backgroundColor: isDark ? neonGreen : '#cbe3ff',
              color: isDark ? '#000000' : 'inherit',
            },
            body: {
              backgroundColor: isDark ? deepBlack : '#f7f8fa',
            }
          },
        },
        MuiPaper: {
          defaultProps: { elevation: 0 },
          styleOverrides: {
            root: {
              backgroundImage: 'none',
              border: isDark
                ? '1px solid rgba(255,255,255,0.1)' // Neon/Cyberpunk border
                : '1px solid rgba(0,0,0,0.06)',
            },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            colorPrimary: {
              backgroundImage: 'none',
              backgroundColor: isDark ? darkPaper : '#1976d2', // Keep blue header for light mode or make it white? Let's check user preference. Standard is Blue or White. Let's stick to standard blue for light mode for now to not break it.
              borderBottom: isDark ? '1px solid rgba(255,255,255,0.1)' : 'none',
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 8,
            },
            containedPrimary: {
              boxShadow: isDark ? '0 0 10px rgba(57, 255, 20, 0.4)' : undefined, // Neon Glow
            }
          },
        },
        MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
        MuiCard: { styleOverrides: { root: { overflow: 'hidden' } } },
        MuiListItemIcon: {
          styleOverrides: {
            root: {
              color: isDark ? neonGreen : 'inherit', // Icons get the neon color
            }
          }
        }
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
