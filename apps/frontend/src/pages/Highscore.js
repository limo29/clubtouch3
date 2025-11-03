// src/pages/Highscore.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Card, CardContent, Chip, CssBaseline, Divider, Grid, IconButton, Stack,
  Switch, Tooltip, Typography, LinearProgress, alpha, GlobalStyles, ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech';
import Lightning from '@mui/icons-material/FlashOn';
import TimerIcon from '@mui/icons-material/AccessTime';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import BoltIcon from '@mui/icons-material/Bolt';
import EuroIcon from '@mui/icons-material/Euro';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { io } from 'socket.io-client';

import api, { getToken } from '../services/api';
import { API_ENDPOINTS, WS_URL } from '../config/api';

/* ---------- helpers ---------- */
const clamp = (min, preferred, max) => `clamp(${min}, ${preferred}, ${max})`;
const formatMoney = (v) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);

const useLocalBool = (key, initial) => {
  const [val, setVal] = useState(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    return raw === 'true';
  });
  useEffect(() => localStorage.setItem(key, String(val)), [key, val]);
  return [val, setVal];
};

const qs = new URLSearchParams(window.location.search);
const KIOSK_PARAM = qs.get('kiosk') === '1';

/* ---------- main ---------- */
export default function Highscore() {
  // dark mode
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const [dark, setDark] = useLocalBool('hs_dark', prefersDark);
  const [autoRotate, setAutoRotate] = useLocalBool('hs_autoRotate', true);

  // COUNT <-> AMOUNT rotation
  const [mode, setMode] = useState('AMOUNT'); // 'AMOUNT'|'COUNT'
  useEffect(() => {
    if (!autoRotate) return;
    const id = setInterval(() => {
      setMode((m) => (m === 'AMOUNT' ? 'COUNT' : 'AMOUNT'));
    }, 10000);
    return () => clearInterval(id);
  }, [autoRotate]);

  // fullscreen
  const [isFull, setIsFull] = useState(!!document.fullscreenElement);
  const enterFull = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {}
  };
  const toggleFull = async () => {
    try {
      if (!document.fullscreenElement) {
        await enterFull();
      } else {
        await document.exitFullscreen();
      }
    } catch {}
  };
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  // Kiosk: auto-enter fullscreen on mount
  useEffect(() => {
    if (KIOSK_PARAM) enterFull();
  }, []);

  // theme
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: dark ? 'dark' : 'light',
          background: {
            default: dark ? '#0b0f15' : '#f4f6fb',
            paper: dark ? '#111824' : '#ffffff',
          },
          primary: { main: dark ? '#71a7ff' : '#1976d2' },
          secondary: { main: dark ? '#b792ff' : '#8e24aa' }
        },
        typography: { fontSize: 14 },
        shape: { borderRadius: 14 },
      }),
    [dark]
  );

  // data
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [startDate, setStartDate] = useState(null);

  const [daily, setDaily] = useState({ entries: [] });
  const [yearly, setYearly] = useState({ entries: [] });

  // „celebration“ wenn Top-1 sich ändert
  const topDailyRef = useRef(null);
  const [pulseDaily, setPulseDaily] = useState(false);
  const topYearlyRef = useRef(null);
  const [pulseYearly, setPulseYearly] = useState(false);

  const fetchAll = async (m = mode) => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        api.get(API_ENDPOINTS.HIGHSCORE, { params: { type: 'DAILY', mode: m } }),
        api.get(API_ENDPOINTS.HIGHSCORE, { params: { type: 'YEARLY', mode: m } }),
      ]);
      // pulse bei Top-1 Wechsel
      const newTopDaily = r1?.data?.entries?.[0]?.customerId ?? null;
      if (topDailyRef.current !== null && topDailyRef.current !== newTopDaily) {
        setPulseDaily(true);
        setTimeout(() => setPulseDaily(false), 1800);
      }
      topDailyRef.current = newTopDaily;

      const newTopYearly = r2?.data?.entries?.[0]?.customerId ?? null;
      if (topYearlyRef.current !== null && topYearlyRef.current !== newTopYearly) {
        setPulseYearly(true);
        setTimeout(() => setPulseYearly(false), 1800);
      }
      topYearlyRef.current = newTopYearly;

      setDaily(r1.data || { entries: [] });
      setYearly(r2.data || { entries: [] });
      setStartDate(r1?.data?.startDate || null);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(mode); /* eslint-disable-next-line */ }, [mode]);

  const manualRefresh = () => fetchAll(mode);

  // socket live
  useEffect(() => {
    const s = io(WS_URL, { auth: { token: getToken() } });
    s.on('connect', () => setLive(true));
    s.on('disconnect', () => setLive(false));
    s.on('highscore:update', () => fetchAll(mode));
    s.on('sale:new', () => fetchAll(mode));
    return () => s.close();
    // eslint-disable-next-line
  }, []);

  /* ---------- UI helpers ---------- */
  const ModeToggle = () => (
    <ToggleButtonGroup
      size="small"
      color="primary"
      exclusive
      value={mode}
      onChange={(_, val) => val && setMode(val)}
      sx={{
        ml: 0.5,
        '& .MuiToggleButton-root': {
          fontWeight: 700,
          px: 1.2,
        },
      }}
    >
      <ToggleButton value="AMOUNT">
        <EuroIcon sx={{ fontSize: 18, mr: 0.6 }} /> Umsatz
      </ToggleButton>
      <ToggleButton value="COUNT">
        <ShoppingCartIcon sx={{ fontSize: 18, mr: 0.6 }} /> Anzahl
      </ToggleButton>
    </ToggleButtonGroup>
  );
  const ModeBadge = () => (
    <Chip
      size="small"
      icon={mode === 'AMOUNT' ? <EuroIcon /> : <ShoppingCartIcon />}
      label={`Modus: ${mode === 'AMOUNT' ? 'Umsatz' : 'Anzahl'}`}
      sx={{ fontWeight: 700 }}
    />
  );

  const LiveBadge = () =>
    live ? (
      <Chip
        size="small"
        color="success"
        icon={<CheckCircleIcon />}
        label="Live"
        sx={{ fontWeight: 700 }}
      />
    ) : (
      <Chip size="small" label="Offline" />
    );

  const SectionHeader = ({ icon, title }) => (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ pb: 1 }}>
      {icon}
      <Typography
        variant="h4"
        sx={{ fontWeight: 900, fontSize: clamp('18px', '2.4vw', '30px') }}
      >
        {title}
      </Typography>
    </Stack>
  );

  const rankAccent = (rank) => {
    if (rank === 1) return '#FFD700'; // gold
    if (rank === 2) return '#C0C0C0'; // silver
    if (rank === 3) return '#CD7F32'; // bronze
    return null;
  };

  const RankRow = ({ entry, isTop, pulse }) => (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        py: isTop ? 1.4 : 1.1,
        px: 0.2,
        gap: 1.5,
        borderRadius: 2,
        position: 'relative',
        background: (() => {
          const accent = rankAccent(entry.rank);
          if (isTop && pulse) return `linear-gradient(90deg, ${alpha(theme.palette.warning.main, 0.15)}, transparent)`;
          if (accent) return `linear-gradient(90deg, ${alpha(accent, 0.08)}, transparent)`;
          return 'transparent';
        })(),
        boxShadow: isTop ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}` : 'none',
        transition: 'background .4s ease, box-shadow .4s ease',
        '&:hover': { background: alpha(theme.palette.text.primary, 0.05) },
      }}
    >
      {rankAccent(entry.rank) && (
        <Box
          sx={{
            position: 'absolute', left: 0, top: 6, bottom: 6, width: 6,
            borderTopLeftRadius: 8, borderBottomLeftRadius: 8,
            bgcolor: rankAccent(entry.rank),
          }}
        />
      )}
      <Stack direction="row" alignItems="center" spacing={1.4} sx={{ minWidth: 0 }}>
        <Chip
          label={entry.rank}
          color={entry.rank === 1 ? 'warning' : entry.rank === 2 ? 'default' : 'primary'}
          size="small"
          sx={{ fontWeight: 800 }}
        />
        <Typography
          noWrap
          sx={{ fontWeight: isTop ? 800 : 700, fontSize: clamp('16px', isTop ? '2vw' : '1.7vw', '22px'), minWidth: 0 }}
        >
          {entry.customerNickname || entry.customerName}
        </Typography>
        {entry.rank === 1 ? (
          <TrophyIcon fontSize="small" color="warning" />
        ) : entry.rank === 2 ? (
          <MilitaryTechIcon fontSize="small" sx={{ color: '#C0C0C0' }} />
        ) : entry.rank === 3 ? (
          <MilitaryTechIcon fontSize="small" sx={{ color: '#CD7F32' }} />
        ) : null}
      </Stack>

      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        <Typography sx={{ opacity: 0.72 }}>
          {entry.transactionCount} Transaktion{entry.transactionCount === 1 ? '' : 'en'}
          {mode === 'AMOUNT' && entry.totalItems
            ? ` • ${entry.totalItems} Stück`
            : mode === 'COUNT' && entry.totalAmount
            ? ` • ${formatMoney(entry.totalAmount)}`
            : ''}
        </Typography>

        <Typography
          sx={{
            fontWeight: 900,
            fontSize: clamp('18px', isTop ? '2.4vw' : '2.1vw', '28px'),
            minWidth: { xs: '9ch', md: '11ch' },
            textAlign: 'right',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
          color="primary"
        >
          {mode === 'AMOUNT' ? formatMoney(entry.score) : `${entry.score} Stück`}
        </Typography>
      </Stack>
    </Stack>
  );

  const Board = ({ title, data, pulseTop }) => (
    <Card
      elevation={dark ? 0 : 1}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${alpha(theme.palette.divider, dark ? 0.6 : 1)}`,
        backgroundImage: 'none',
      }}
    >
      <CardContent sx={{ p: { xs: 2, md: 3.2 }, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <SectionHeader
            icon={<TrophyIcon color="primary" sx={{ fontSize: clamp('24px', '2.8vw', '36px') }} />}
            title={title}
          />
          <Chip
            size="small"
            color="secondary"
            icon={<Lightning sx={{ fontSize: 16 }} />}
            label={`Nach ${mode === 'AMOUNT' ? 'Umsatz' : 'Anzahl'}`}
            sx={{ fontWeight: 700, minWidth: 140, justifyContent: 'center' }}
          />
        </Stack>

        <Divider sx={{ my: 1.4 }} />

        {loading ? (
          <Box sx={{ py: 2 }}>
            <LinearProgress />
          </Box>
        ) : (data?.entries?.length ?? 0) === 0 ? (
          <Box sx={{ py: 3 }}>
            <Typography color="text.secondary">Keine Einträge vorhanden</Typography>
          </Box>
        ) : (
          <Stack spacing={0.5} sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 1 }}>
            {data.entries.map((e, idx) => (
              <React.Fragment key={e.customerId ?? idx}>
                <RankRow entry={e} isTop={idx === 0} pulse={idx === 0 && pulseTop} />
                {idx < data.entries.length - 1 && <Divider sx={{ opacity: 0.4 }} />}
              </React.Fragment>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );

  /* ---------- render ---------- */
  const hideChrome = KIOSK_PARAM || isFull; // -> Menü/Drawer verstecken

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Globale Styles: im Kiosk/Vollbild linkes Menü & überflüssige Ränder verstecken */}
      <GlobalStyles styles={{
        'body[data-kiosk="1"] .MuiDrawer-root, body[data-kiosk="1"] aside, body[data-kiosk="1"] nav': {
          display: 'none !important'
        },
        'body[data-kiosk="1"] #root, body[data-kiosk="1"] main': {
          marginLeft: '0 !important'
        }
      }} />
      {/* body-Flag umschalten */}
      <BodyFlag active={hideChrome} />

      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
          color: 'text.primary',
        }}
      >
        {/* Header / Controls */}
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            pt: { xs: 2, md: 3 },
            pb: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            width: '100%',
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <TrophyIcon color="primary" sx={{ fontSize: clamp('26px', '3.2vw', '40px') }} />
            <Typography
              variant="h3"
              sx={{ fontWeight: 900, fontSize: clamp('22px', '3.6vw', '44px') }}
            >
              Highscore
            </Typography>
            <ModeToggle />
            <LiveBadge />
          </Stack>

          {!hideChrome && (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <AutorenewIcon sx={{ opacity: 0.7 }} />
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                Auto-Rotate
              </Typography>
              <Switch
                size="small"
                checked={autoRotate}
                onChange={(e) => setAutoRotate(e.target.checked)}
              />
            </Stack>

            <Stack direction="row" alignItems="center" spacing={0.5}>
              {dark ? <DarkModeIcon /> : <LightModeIcon />}
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {dark ? 'Dark' : 'Light'}
              </Typography>
              <Switch
                size="small"
                checked={dark}
                onChange={(e) => setDark(e.target.checked)}
              />
            </Stack>

            <Tooltip title="Aktualisieren">
              <IconButton onClick={manualRefresh}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title={isFull ? 'Vollbild verlassen' : 'Vollbild'}>
              <IconButton onClick={toggleFull}>
                {isFull ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
          )}
        </Box>

        {/* Content – zwei Spalten, füllen den Screen */}
        <Box
          sx={{
            flex: 1,
            px: { xs: 2, md: 3 },
            pb: { xs: 2, md: 3 },
          }}
        >
          <Grid
            container
            spacing={2.5}
            sx={{
              height: '100%',
              width: '100%',
            }}
          >
            <Grid item xs={12} md={6} sx={{ height: { md: '100%' } }}>
              <Board title="Heute" data={daily} pulseTop={pulseDaily} />
            </Grid>
            <Grid item xs={12} md={6} sx={{ height: { md: '100%' } }}>
              <Board title="Saison" data={yearly} pulseTop={pulseYearly} />
            </Grid>
          </Grid>
        </Box>

        {/* Footer Info */}
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            pb: { xs: 2, md: 3 },
            display: 'flex',
            gap: 2,
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            opacity: 0.85,
            width: '100%',
          }}
        >
          {startDate && (
            <Chip
              size="small"
              icon={<TimerIcon />}
              label={`Seit ${new Date(startDate).toLocaleString('de-DE', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}`}
              variant="outlined"
            />
          )}
          <Chip
            size="small"
            icon={<EuroIcon />}
            label="Umsatz"
            variant={mode === 'AMOUNT' ? 'filled' : 'outlined'}
          />
          <Chip
            size="small"
            icon={<ShoppingCartIcon />}
            label="Anzahl"
            variant={mode === 'COUNT' ? 'filled' : 'outlined'}
          />
          {lastUpdated && (
            <Typography variant="caption" sx={{ ml: 1 }}>
              Aktualisiert: {lastUpdated.toLocaleTimeString('de-DE')}
            </Typography>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}

/** setzt/entfernt body data-flag für Kiosk/Fullscreen (zum verstecken des Menüs) */
function BodyFlag({ active }) {
  useEffect(() => {
    if (active) document.body.setAttribute('data-kiosk', '1');
    else document.body.removeAttribute('data-kiosk');
    return () => document.body.removeAttribute('data-kiosk');
  }, [active]);
  return null;
}
