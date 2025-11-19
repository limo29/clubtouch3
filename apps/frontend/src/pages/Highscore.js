import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Box, Card, CardContent, Chip, CssBaseline, Divider, IconButton, Stack,
  Switch, Tooltip, Typography, alpha, GlobalStyles, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Checkbox, FormControlLabel, Autocomplete
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech';
import TimerIcon from '@mui/icons-material/AccessTime';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import EuroIcon from '@mui/icons-material/Euro';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FlagIcon from '@mui/icons-material/Flag';
import SettingsIcon from '@mui/icons-material/Settings';
import CelebrationIcon from '@mui/icons-material/Celebration';

import { io } from 'socket.io-client';
import api, { getToken } from '../services/api';
import { API_ENDPOINTS, WS_URL } from '../config/api';

/* ---------- helpers ---------- */
const clamp = (min, preferred, max) => `clamp(${min}, ${preferred}, ${max})`;
const money = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);
const KIOSK_PARAM = new URLSearchParams(window.location.search).get('kiosk') === '1';

const useLocalBool = (key, initial) => {
  const [val, setVal] = useState(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    return raw === 'true';
  });
  useEffect(() => localStorage.setItem(key, String(val)), [key, val]);
  return [val, setVal];
};

/* ---------- Fullscreen Confetti (ohne externe Lib) ---------- */
function ConfettiOverlay({ trigger }) {
  const [pieces, setPieces] = useState([]);

  useEffect(() => {
    if (!trigger) return;
    // erzeugt 80 Konfetti mit zufälligen Parametern
    const colors = ['#ff5252', '#ffb300', '#66bb6a', '#42a5f5', '#ab47bc', '#ef5350'];
    const arr = Array.from({ length: 80 }).map((_, i) => ({
      id: `${trigger}-${i}`,
      left: Math.random() * 100,         // vw
      delay: Math.random() * 120,        // ms
      dur: 700 + Math.random() * 900,    // ms
      size: 6 + Math.random() * 10,      // px
      rot: (Math.random() * 360) | 0,
      color: colors[i % colors.length]
    }));
    setPieces(arr);
    const t = setTimeout(() => setPieces([]), 1800);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!pieces.length) return null;

  return (
    <Box
      aria-hidden
      sx={{
        position: 'fixed', inset: 0, zIndex: 2000, pointerEvents: 'none',
        overflow: 'hidden'
      }}
    >
      {/* softer Flash */}
      <Box sx={{
        position: 'absolute', inset: 0, background:
          'radial-gradient(60% 60% at 50% 50%, rgba(255,255,255,0.15), rgba(255,255,255,0))',
        animation: 'flash 900ms ease-out'
      }} />
      {pieces.map(p => (
        <Box key={p.id}
          sx={{
            position: 'absolute',
            top: '-10vh',
            left: `${p.left}vw`,
            width: p.size, height: p.size,
            bgcolor: p.color,
            transform: `rotate(${p.rot}deg)`,
            borderRadius: 0.5,
            animation: `confettiFall ${p.dur}ms ease-out ${p.delay}ms forwards`,
            boxShadow: `0 0 8px ${alpha(p.color, 0.4)}`
          }}
        />
      ))}
    </Box>
  );
}

/* ---------- Milestone Progress Bar ---------- */
function GoalBar({ goal, onMilestone }) {
  // goal liefert vom Backend: totalUnits, targetUnits, unitsPerPurchase, purchaseUnit, articleName, label
  const total = Number(goal.totalUnits || 0);
  const target = Math.max(1, Number(goal.targetUnits || 1));
  const step = Math.max(1, Number(goal.unitsPerPurchase || 1));
  const unit = goal.purchaseUnit || goal.unit || 'Stück';
  const pct = Math.max(0, Math.min(100, (total / target) * 100));
  const reached = Math.floor(total / step);
  const milestones = Math.max(0, Math.floor(target / step));

  // Farbe: rot -> gelb -> grün
  const color =
    pct < 33 ? '#ef5350' : pct < 66 ? '#ffb300' : '#4caf50';

  // Milestone-Event
  const lastRef = useRef(reached);
  useEffect(() => {
    if (reached > lastRef.current) onMilestone?.();
    lastRef.current = reached;
  }, [reached, onMilestone]);

  // Labels „1. Kiste“, „2. Kiste“ etc.
  const milestoneLabel = (i) => `${i}. ${unit}`;

  return (
    <Box sx={{ mb: 1.7 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.6 }}>
        <Typography sx={{ fontWeight: 800 }}>
          {goal.label || goal.articleName || 'Ziel'}
        </Typography>
        {/* Zwischenstand: 49/100 Flaschen */}
        <Typography variant="body2" sx={{ opacity: 0.9, fontWeight: 700 }}>
          {Math.floor(total)}/{target} {unit}
        </Typography>
      </Stack>

      <Box sx={{ position: 'relative', pt: 3 /* Platz für Marker-Labels */ }}>
        {/* Marker-Labels */}
        {Array.from({ length: milestones }).map((_, idx) => {
          const i = idx + 1;
          const left = (i * step / target) * 100;
          const isReached = i <= reached;
          return (
            <Typography
              key={`lbl-${i}`}
              variant="caption"
              sx={{
                position: 'absolute',
                top: 0,
                left: `${left}%`,
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontWeight: 700,
                color: isReached ? color : 'text.secondary',
                opacity: isReached ? 1 : 0.7,
                transition: 'color .3s ease, opacity .3s ease'
              }}
            >
              {milestoneLabel(i)}
            </Typography>
          );
        })}

        {/* Track */}
        <Box
          sx={{
            position: 'relative',
            height: 16,
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: (t) => alpha(t.palette.text.primary, 0.08)
          }}
        >
          {/* Striche (Marker) */}
          {Array.from({ length: milestones }).map((_, idx) => {
            const i = idx + 1;
            const left = (i * step / target) * 100;
            const isReached = i <= reached;
            return (
              <Box
                key={`mk-${i}`}
                sx={{
                  position: 'absolute',
                  left: `${left}%`,
                  top: 0,
                  bottom: 0,
                  width: 4,
                  bgcolor: isReached ? color : 'divider',
                  opacity: isReached ? 0.95 : 0.6,
                  transform: 'translateX(-2px)',
                  zIndex: 2,
                  borderRadius: 1,
                  transition: 'background-color .25s ease, opacity .25s ease'
                }}
              />
            );
          })}

          {/* Füllung */}
          <Box
            sx={{
              position: 'absolute', top: 0, bottom: 0, left: 0,
              width: `${pct}%`,
              bgcolor: color,
              transition: 'width .35s ease, background-color .25s ease',
              boxShadow: pct > 0 ? `0 0 14px ${alpha(color, 0.4)}` : 'none',
              zIndex: 1
            }}
          />
        </Box>
      </Box>
    </Box>
  );
}

/* ---------- main ---------- */
export default function Highscore() {
  // Dark
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const [dark, setDark] = useLocalBool('hs_dark', prefersDark);
  const [autoRotate, setAutoRotate] = useLocalBool('hs_autoRotate', true);
  const [mode, setMode] = useState('AMOUNT'); // 'AMOUNT' | 'COUNT'

  // Fullscreen
  const [isFull, setIsFull] = useState(!!document.fullscreenElement);
  const enterFull = async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch { } };
  const toggleFull = async () => { try { document.fullscreenElement ? await document.exitFullscreen() : await enterFull(); } catch { } };
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => { if (KIOSK_PARAM) enterFull(); }, []); // eslint-disable-line

  // Theme
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: dark ? 'dark' : 'light',
          background: { default: dark ? '#0b0f15' : '#f4f6fb', paper: dark ? '#111824' : '#ffffff' },
          primary: { main: dark ? '#71a7ff' : '#1976d2' },
          secondary: { main: dark ? '#b792ff' : '#8e24aa' }
        },
        typography: { fontSize: 14 },
        shape: { borderRadius: 14 },
        transitions: { duration: { enteringScreen: 220, leavingScreen: 180 } },
      }),
    [dark]
  );

  // Data
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [startDate, setStartDate] = useState(null);

  const [boards, setBoards] = useState({
    daily: { amount: { entries: [] }, count: { entries: [] } },
    yearly: { amount: { entries: [] }, count: { entries: [] } }
  });

  const [allArticles, setAllArticles] = useState([]);
  const [goalProgress, setGoalProgress] = useState({ goals: [], meta: null, loading: true });

  // Goals dialog
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState(
    new Array(4).fill(0).map(() => ({ enabled: false, articleId: '', label: '', targetUnits: 0 }))
  );

  // Auto-Rotate
  useEffect(() => {
    if (!autoRotate) return;
    const id = setInterval(() => setMode((m) => (m === 'AMOUNT' ? 'COUNT' : 'AMOUNT')), 10000);
    return () => clearInterval(id);
  }, [autoRotate]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [allHs, arts, progress] = await Promise.all([
        api.get(API_ENDPOINTS.HIGHSCORE_ALL),
        api.get('/articles?includeInactive=true'),
        api.get(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS)
      ]);

      const hs = allHs.data || {};
      setBoards({
        daily: { amount: hs?.daily?.amount || { entries: [] }, count: hs?.daily?.count || { entries: [] } },
        yearly: { amount: hs?.yearly?.amount || { entries: [] }, count: hs?.yearly?.count || { entries: [] } }
      });
      setStartDate(hs?.daily?.amount?.startDate || hs?.daily?.count?.startDate || null);

      setAllArticles(arts?.data?.articles || []);

      // Server-Config in Draft laden
      const serverCfg = progress?.data?.meta?.goalsConfig || null;
      if (serverCfg) {
        const arr = new Array(4).fill(0).map((_, i) => {
          const g = serverCfg[i];
          return g ? { enabled: true, articleId: g.articleId, label: g.label || '', targetUnits: Number(g.targetUnits) }
            : { enabled: false, articleId: '', label: '', targetUnits: 0 };
        });
        setGoalDraft(arr);
      }

      setGoalProgress({ goals: progress?.data?.goals || [], meta: progress?.data?.meta || null, loading: false });
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Live socket
  useEffect(() => {
    const s = io(WS_URL, { auth: { token: getToken() } });
    s.on('connect', () => setLive(true));
    s.on('disconnect', () => setLive(false));
    const refresh = async () => {
      try {
        const [allHs, progress] = await Promise.all([
          api.get(API_ENDPOINTS.HIGHSCORE_ALL),
          api.get(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS)
        ]);
        const hs = allHs.data || {};
        setBoards({
          daily: { amount: hs?.daily?.amount || { entries: [] }, count: hs?.daily?.count || { entries: [] } },
          yearly: { amount: hs?.yearly?.amount || { entries: [] }, count: hs?.yearly?.count || { entries: [] } }
        });
        setGoalProgress((gp) => ({ ...gp, goals: progress?.data?.goals || [], meta: progress?.data?.meta || gp.meta, loading: false }));
        setLastUpdated(new Date());
      } catch { }
    };
    s.on('highscore:update', refresh);
    s.on('sale:new', refresh);
    return () => s.close();
  }, []);

  const manualRefresh = () => fetchAll();

  const LiveBadge = () =>
    live ? <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Live" sx={{ fontWeight: 700 }} />
      : <Chip size="small" label="Offline" />;

  const SectionHeader = ({ icon, title, extra }) => (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ pb: 1 }}>
      {icon}
      <Typography variant="h4" sx={{ fontWeight: 900, fontSize: clamp('18px', '2.4vw', '30px') }}>{title}</Typography>
      {extra}
    </Stack>
  );

  const rankAccent = (rank) => (rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : null);

  const RankRow = ({ entry, isTop }) => (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        py: isTop ? 1.25 : 1.0,
        px: 0.2,
        gap: 1.5,
        borderRadius: 2,
        position: 'relative',
        background: rankAccent(entry.rank) ? `linear-gradient(90deg, ${alpha(rankAccent(entry.rank), 0.08)}, transparent)` : 'transparent',
        boxShadow: isTop ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}` : 'none',
        transition: 'opacity .25s ease, transform .25s ease, background .25s ease',
        '&:hover': { background: alpha(theme.palette.text.primary, 0.05) },
      }}
    >
      {rankAccent(entry.rank) && (
        <Box sx={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 6, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, bgcolor: rankAccent(entry.rank) }} />
      )}
      <Stack direction="row" alignItems="center" spacing={1.4} sx={{ minWidth: 0 }}>
        <Chip label={entry.rank} color={entry.rank === 1 ? 'warning' : entry.rank === 2 ? 'default' : 'primary'} size="small" sx={{ fontWeight: 800 }} />
        <Typography noWrap sx={{ fontWeight: isTop ? 800 : 700, fontSize: clamp('16px', isTop ? '2vw' : '1.7vw', '22px'), minWidth: 0 }}>
          {entry.customerNickname || entry.customerName}
        </Typography>
        {entry.rank <= 3 && <MilitaryTechIcon fontSize="small" sx={{ color: rankAccent(entry.rank) || 'inherit' }} />}
      </Stack>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        <Typography sx={{ opacity: 0.72 }}>
          {entry.transactionCount} Transaktion{entry.transactionCount === 1 ? '' : 'en'}
          {mode === 'AMOUNT' && entry.totalItems ? ` • ${entry.totalItems} Stück`
            : mode === 'COUNT' && entry.totalAmount ? ` • ${money(entry.totalAmount)}`
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
          {mode === 'AMOUNT' ? money(entry.score) : `${entry.score} Stück`}
        </Typography>
      </Stack>
    </Stack>
  );

  const Board = ({ title, data }) => (
    <Card
      variant="outlined"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        /* WICHTIG: */
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        backgroundImage: 'none'
      }}
    >
      <CardContent
        sx={{
          /* WICHTIG: */
          p: { xs: 2, md: 3 },
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          width: '100%',
          minWidth: 0,
          minHeight: 0
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <SectionHeader icon={<TrophyIcon color="primary" sx={{ fontSize: clamp('24px', '2.8vw', '36px') }} />} title={title} />
          <Chip size="small" icon={mode === 'AMOUNT' ? <EuroIcon /> : <ShoppingCartIcon />} label={`Nach ${mode === 'AMOUNT' ? 'Umsatz' : 'Anzahl'}`} sx={{ fontWeight: 700 }} />
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {loading ? (
          <Typography color="text.secondary">Lade…</Typography>
        ) : (data?.entries?.length ?? 0) === 0 ? (
          <Typography color="text.secondary">Keine Einträge vorhanden</Typography>
        ) : (
          <Stack spacing={0.5} sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 1 }}>
            {data.entries.map((e, idx) => (
              <React.Fragment key={e.customerId ?? idx}>
                <RankRow entry={e} isTop={idx === 0} />
                {idx < data.entries.length - 1 && <Divider sx={{ opacity: 0.4 }} />}
              </React.Fragment>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );



  /* ---------- Ziele ---------- */
  const openGoals = () => setGoalsOpen(true);
  const closeGoals = () => setGoalsOpen(false);

  const purchaseInfoFor = (articleId) => {
    const a = allArticles.find(x => x.id === articleId);
    if (!a) return { step: 1, unit: 'Stück', label: 'Stück' };
    const step = Number(a.unitsPerPurchase || 1) || 1;
    const unit = a.purchaseUnit || (a.unit || 'Stück');
    const label = step > 1 ? `${unit} (×${step})` : unit;
    return { step, unit, label };
  };

  const saveGoals = async () => {
    const payload = goalDraft
      .filter(g => g.enabled && g.articleId && Number(g.targetUnits) > 0)
      .slice(0, 4)
      .map(g => ({ articleId: g.articleId, targetUnits: Number(g.targetUnits), label: g.label || '' }));
    await api.post(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS, { goals: payload });
    const res = await api.get(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS);
    setGoalProgress({ goals: res?.data?.goals || [], meta: res?.data?.meta || null, loading: false });
    setGoalsOpen(false);
  };

  // Fullscreen-Konfetti triggern
  const [spark, setSpark] = useState(0);
  const triggerMilestone = () => setSpark(n => n + 1);

  const hideChrome = KIOSK_PARAM || isFull;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{
        '@keyframes confettiFall': { '0%': { transform: 'translateY(0) rotate(0deg)', opacity: 1 }, '100%': { transform: 'translateY(110vh) rotate(720deg)', opacity: 0.9 } },
        '@keyframes flash': { '0%': { opacity: 0 }, '30%': { opacity: 1 }, '100%': { opacity: 0 } },
        'body[data-kiosk="1"] .MuiDrawer-root, body[data-kiosk="1"] aside, body[data-kiosk="1"] nav': { display: 'none !important' },
        'body[data-kiosk="1"] #root, body[data-kiosk="1"] main': { marginLeft: '0 !important' }
      }} />
      <BodyFlag active={hideChrome} />

      {/* Vollbild-Konfetti bei Zwischenziel */}
      <ConfettiOverlay trigger={spark} />

      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', color: 'text.primary' }}>
        {/* Header */}
        <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 }, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <TrophyIcon color="primary" sx={{ fontSize: clamp('26px', '3.2vw', '40px') }} />
            <Typography variant="h3" sx={{ fontWeight: 900, fontSize: clamp('22px', '3.6vw', '44px') }}>Highscore</Typography>
            <Chip size="small" icon={<EuroIcon />} label="UMSATZ" onClick={() => setMode('AMOUNT')} variant={mode === 'AMOUNT' ? 'filled' : 'outlined'} />
            <Chip size="small" icon={<ShoppingCartIcon />} label="ANZAHL" onClick={() => setMode('COUNT')} variant={mode === 'COUNT' ? 'filled' : 'outlined'} />
            <LiveBadge />
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Button variant="outlined" startIcon={<FlagIcon />} onClick={openGoals}>Ziele</Button>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <AutorenewIcon sx={{ opacity: 0.7 }} />
              <Typography variant="body2" sx={{ opacity: 0.7 }}>Auto-Rotate</Typography>
              <Switch size="small" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              {dark ? <DarkModeIcon /> : <LightModeIcon />}
              <Typography variant="body2" sx={{ opacity: 0.7 }}>{dark ? 'Dark' : 'Light'}</Typography>
              <Switch size="small" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            </Stack>
            <Tooltip title="Aktualisieren"><IconButton onClick={manualRefresh}><RefreshIcon /></IconButton></Tooltip>
            <Tooltip title={isFull ? 'Vollbild verlassen' : 'Vollbild'}><IconButton onClick={toggleFull}>{isFull ? <FullscreenExitIcon /> : <FullscreenIcon />}</IconButton></Tooltip>

            {/* dezentes Icon, wenn gerade Konfetti lief */}
            <Box key={spark} sx={{ ml: 1, opacity: 0, animation: 'flash 800ms ease-out' }}>
              <CelebrationIcon color="secondary" />
            </Box>
          </Stack>
        </Box>

        {/* Ziele */}
        <Box sx={{ px: { xs: 2, md: 3 } }}>
          <Card variant="outlined">
            <CardContent sx={{ pb: 1 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <SectionHeader icon={<FlagIcon color="primary" />} title="Tagesziele" />
                {goalProgress?.meta?.dayLabel && (
                  <Chip variant="outlined" size="small" label={goalProgress.meta.dayLabel} />
                )}
              </Stack>

              {goalProgress.loading ? (
                <Typography color="text.secondary">Lade…</Typography>
              ) : (goalProgress.goals || []).length === 0 ? (
                <Typography color="text.secondary">Noch keine Ziele definiert.</Typography>
              ) : (
                <Box>
                  {goalProgress.goals.map((g, i) => (
                    <GoalBar key={`${g.articleId}-${i}`} goal={g} onMilestone={triggerMilestone} />
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>

        {/* Content – zwei Spalten füllen die Breite */}
        <Box sx={{ flex: 1, minHeight: 0, px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, // -> 2 gleich breite Spalten ab md
              gap: 2.5,
              alignItems: 'stretch',
              width: '100%',
              minHeight: 0,
            }}
          >
            <Box sx={{ minWidth: 0, minHeight: 0 }}>
              <Board title="Heute" data={mode === 'AMOUNT' ? boards.daily.amount : boards.daily.count} />
            </Box>

            <Box sx={{ minWidth: 0, minHeight: 0 }}>
              <Board title="Saison" data={mode === 'AMOUNT' ? boards.yearly.amount : boards.yearly.count} />
            </Box>
          </Box>
        </Box>




        {/* Footer */}
        <Box sx={{ px: { xs: 2, md: 3 }, pb: { xs: 2, md: 3 }, display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', opacity: 0.85 }}>
          {startDate && (
            <Chip size="small" icon={<TimerIcon />} label={`Seit ${new Date(startDate).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`} variant="outlined" />
          )}
          <Typography variant="caption" sx={{ ml: 1 }}>
            Aktualisiert: {lastUpdated ? lastUpdated.toLocaleTimeString('de-DE') : '–'}
          </Typography>
        </Box>
      </Box>

      {/* Ziele-Dialog */}
      <Dialog open={goalsOpen} onClose={closeGoals} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center"><SettingsIcon /> <span>Ziele einstellen</span></Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
            Bis zu 4 Artikel auswählen. Ziel in <b>Einheiten</b> (z. B. Flaschen/Kisten). Zwischenziele richten sich nach der <i>Einkaufseinheit</i> des Artikels (z. B. Kiste ×24).
            Der Tag läuft von <b>12:00</b> bis <b>12:00</b>.
          </Typography>

          <Stack spacing={1.5}>
            {goalDraft.map((g, idx) => {
              const info = purchaseInfoFor(g.articleId);
              return (
                <Card key={idx} variant="outlined" sx={{ p: 1.2 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <FormControlLabel
                      control={<Checkbox checked={g.enabled} onChange={(e) => { const cp = [...goalDraft]; cp[idx] = { ...cp[idx], enabled: e.target.checked }; setGoalDraft(cp); }} />}
                      label={`Ziel ${idx + 1}`}
                    />
                    <Autocomplete
                      size="small"
                      disabled={!g.enabled}
                      options={allArticles}
                      getOptionLabel={(o) => o.name || ''}
                      value={allArticles.find(a => a.id === g.articleId) || null}
                      onChange={(_, val) => {
                        const cp = [...goalDraft];
                        cp[idx] = { ...cp[idx], articleId: val?.id || '', label: cp[idx].label || (val?.name || '') };
                        setGoalDraft(cp);
                      }}
                      sx={{ flex: 1, minWidth: 220 }}
                      renderInput={(params) => <TextField {...params} label="Artikel" />}
                    />
                    <TextField
                      size="small"
                      disabled={!g.enabled}
                      label="Bezeichnung (optional)"
                      value={g.label}
                      onChange={(e) => { const cp = [...goalDraft]; cp[idx] = { ...cp[idx], label: e.target.value }; setGoalDraft(cp); }}
                      sx={{ flex: 1, minWidth: 100 }}
                    />
                    <TextField
                      size="small"
                      disabled={!g.enabled}
                      label="Ziel (Einheiten)"
                      type="number"
                      value={g.targetUnits}
                      onChange={(e) => {
                        const n = Math.max(0, Math.floor(Number(e.target.value || 0)));
                        const cp = [...goalDraft];
                        cp[idx] = { ...cp[idx], targetUnits: n };
                        setGoalDraft(cp);
                      }}
                      sx={{ width: 160 }}
                      helperText={g.articleId ? `Einkaufseinheit: ${info.label}` : ' '}
                    />
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeGoals}>Schließen</Button>
          <Button variant="contained" onClick={saveGoals}>Übernehmen</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

function BodyFlag({ active }) {
  useEffect(() => {
    if (active) document.body.setAttribute('data-kiosk', '1');
    else document.body.removeAttribute('data-kiosk');
    return () => document.body.removeAttribute('data-kiosk');
  }, [active]);
  return null;
}
