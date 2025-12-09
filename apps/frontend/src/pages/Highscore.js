import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, Chip, CssBaseline, IconButton, Stack,
  Typography, alpha, GlobalStyles, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Autocomplete, Grid, InputAdornment, Tooltip
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import FlagIcon from '@mui/icons-material/Flag';
import CloseIcon from '@mui/icons-material/Close';
import MonitorIcon from '@mui/icons-material/Monitor';
import HomeIcon from '@mui/icons-material/Home';

import { io } from 'socket.io-client';
import api, { getToken } from '../services/api';
import { API_ENDPOINTS, WS_URL } from '../config/api';
import Podium from '../components/common/Podium';

/* ---------- Helpers ---------- */
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

/* ---------- Components ---------- */

function ConfettiOverlay({ trigger }) {
  const [pieces, setPieces] = useState([]);
  useEffect(() => {
    if (!trigger) return;
    const colors = ['#f44336', '#ff9800', '#4caf50', '#2196f3', '#9c27b0'];
    setPieces(Array.from({ length: 60 }).map((_, i) => ({
      id: i, left: Math.random() * 100, delay: Math.random() * 200, dur: 1000 + Math.random() * 1000,
      color: colors[i % colors.length]
    })));
    const t = setTimeout(() => setPieces([]), 2200);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!pieces.length) return null;
  return (
    <Box sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      {pieces.map(p => (
        <Box key={p.id} sx={{
          position: 'absolute', top: '-2vh', left: `${p.left}vw`, width: 8, height: 8, bgcolor: p.color,
          animation: `confetti ${p.dur}ms linear ${p.delay}ms forwards`
        }} />
      ))}
    </Box>
  );
}

function GoalBar({ goal, onMilestone }) {
  const total = Number(goal.totalUnits || 0);
  const target = Math.max(1, Number(goal.targetUnits || 1));
  const step = Math.max(1, Number(goal.unitsPerPurchase || 1));
  const unit = goal.purchaseUnit || goal.unit || 'Stk';

  const pct = Math.min(100, (total / target) * 100);
  const reached = Math.floor(total / step);
  const milestones = Math.max(0, Math.floor(target / step));
  const color = pct < 33 ? '#ef5350' : pct < 66 ? '#ffb300' : '#4caf50';

  const lastRef = useRef(reached);
  useEffect(() => {
    if (reached > lastRef.current) onMilestone?.();
    lastRef.current = reached;
  }, [reached, onMilestone]);

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 0.5 }}>
        <Box sx={{ minWidth: 0, mr: 2 }}>
          <Typography variant="h6" noWrap sx={{ fontWeight: 800, lineHeight: 1.2, fontSize: '1rem' }}>
            {goal.label || goal.articleName}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6, fontWeight: 600, display: 'block', lineHeight: 1 }}>
            {step} {unit} pro Milestone
          </Typography>
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 800, color: color, whiteSpace: 'nowrap', lineHeight: 1.2, fontSize: '1.1rem' }}>
          {Math.floor(total)} <Typography component="span" variant="body2" sx={{ opacity: 0.7, fontWeight: 700 }}>/ {target} {unit}</Typography>
        </Typography>
      </Stack>
      <Box sx={{ height: 24, bgcolor: alpha('#fff', 0.1), borderRadius: 3, overflow: 'hidden', position: 'relative', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${pct}%`, bgcolor: color, transition: 'width 0.5s ease-out', boxShadow: `0 0 20px ${alpha(color, 0.6)}` }} />
        {Array.from({ length: milestones - 1 }).map((_, i) => (
          <Box key={i} sx={{ position: 'absolute', left: `${((i + 1) / milestones) * 100}%`, top: 0, bottom: 0, width: 2, bgcolor: 'rgba(0,0,0,0.2)' }} />
        ))}
      </Box>
    </Box>
  );
}

function GridList({ items, renderItem }) {
  // We want to fill the first column with up to 9 items (rank 4-12)
  // and the second column with the rest (rank 13-20).
  const splitIndex = 9;
  const col1 = items.slice(0, splitIndex);
  const col2 = items.slice(splitIndex);

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 3,
      height: '100%',
    }}>
      <Stack spacing={0} sx={{ height: '100%' }}>
        {col1.map(renderItem)}
      </Stack>
      <Stack spacing={0} sx={{ height: '100%' }}>
        {col2.map(renderItem)}
      </Stack>
    </Box>
  )
}


function BodyFlag({ active }) {
  useEffect(() => {
    if (active) {
      document.body.setAttribute('data-kiosk', '1');
    } else {
      document.body.removeAttribute('data-kiosk');
    }
    return () => document.body.removeAttribute('data-kiosk');
  }, [active]);
  return null;
}

export default function Highscore() {
  const navigate = useNavigate();
  // const [dark] = useLocalBool('hs_dark', true); // Removed local dark mode to use global theme
  const [autoRotate, setAutoRotate] = useLocalBool('hs_autoRotate', true);
  const [forceKiosk, setForceKiosk] = useLocalBool('hs_forceKiosk', false);
  const [mode, setMode] = useState('AMOUNT');

  const [isFull, setIsFull] = useState(!!document.fullscreenElement);
  const toggleFull = async () => { try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen(); } catch { } };

  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => { if (KIOSK_PARAM && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { }); }, []);

  /* Theme removed */

  const [boards, setBoards] = useState({ daily: { amount: { entries: [] }, count: { entries: [] } }, yearly: { amount: { entries: [] }, count: { entries: [] } } });
  const [goalProgress, setGoalProgress] = useState({ goals: [], meta: null, loading: true });
  const [allArticles, setAllArticles] = useState([]);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState([]);
  const [spark, setSpark] = useState(0);

  const fetchAll = useCallback(async () => {
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
      setAllArticles(arts?.data?.articles || []);
      const serverCfg = progress?.data?.meta?.goalsConfig || [];
      setGoalDraft(serverCfg.length ? serverCfg.map(g => ({ ...g, enabled: true })) : [{ enabled: true, articleId: '', label: '', targetUnits: 0 }]);
      setGoalProgress({ goals: progress?.data?.goals || [], meta: progress?.data?.meta || null, loading: false });
    } catch { }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const s = io(WS_URL, { auth: { token: getToken() } });
    const refresh = () => fetchAll();
    s.on('highscore:update', refresh);
    s.on('sale:new', refresh);
    return () => s.close();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRotate) return;
    const id = setInterval(() => {
      setMode(m => m === 'AMOUNT' ? 'COUNT' : 'AMOUNT');
    }, 15000);
    return () => clearInterval(id);
  }, [autoRotate]);

  const saveGoals = async () => {
    const payload = goalDraft.filter(g => g.articleId && g.targetUnits > 0).map(g => ({ articleId: g.articleId, targetUnits: Number(g.targetUnits), label: g.label || '' })).slice(0, 4);
    await api.post(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS, { goals: payload });
    fetchAll();
    setGoalsOpen(false);
  };

  const hideChrome = KIOSK_PARAM || isFull || forceKiosk;

  const handleKioskExit = async () => {
    setForceKiosk(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch { }
    if (KIOSK_PARAM) {
      navigate('/dashboard'); // If launched in kiosk mode, go to dashboard
    }
  };

  const RankRow = ({ entry }) => (
    <Stack direction="row" alignItems="center" justifyContent="space-between"
      sx={{
        py: 1, px: 2,
        borderBottom: '1px solid', borderColor: 'divider',
        transition: 'background-color 0.2s',
        flexGrow: 0,
        '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0 }}>
        <Box sx={{
          width: 28, height: 28,
          borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: '0.9rem', color: 'text.secondary'
        }}>
          {entry.rank}
        </Box>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: '1rem' }}>{entry.customerNickname || entry.customerName}</Typography>
      </Stack>
      <Typography sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: '1.1rem' }} color="primary">
        {mode === 'AMOUNT' ? money(entry.score) : `${entry.score}`}
      </Typography>
    </Stack>
  );

  /* 
     Removed local ThemeProvider to use global App theme (Neon). 
     We still want to enforce some specific layout stuff for Kiosk/TV mode if needed, 
     but visual style should come from global.
  */
  return (
    <>
      <GlobalStyles styles={{
        'body[data-kiosk="1"]': { overflow: 'hidden' },
        '#root': { height: '100vh', display: 'flex', flexDirection: 'column' },
        '::-webkit-scrollbar': { width: 0, height: 0 }
      }} />
      <BodyFlag active={hideChrome} />
      <ConfettiOverlay trigger={spark} />

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {!hideChrome && (
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper', zIndex: 10 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 10px rgba(0, 230, 118, 0.5)' }}>
                <TrophyIcon sx={{ color: '#000' }} />
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: -0.5 }}>Clubscore</Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<FlagIcon />} onClick={() => setGoalsOpen(true)}>Ziele</Button>
              <Button onClick={() => setMode(m => m === 'AMOUNT' ? 'COUNT' : 'AMOUNT')} variant="outlined">{mode === 'AMOUNT' ? 'UMSATZ' : 'ANZAHL'}</Button>
              <Tooltip title="TV Modus (Versteckt Menü)">
                <IconButton onClick={() => setForceKiosk(true)} color="primary"><MonitorIcon /></IconButton>
              </Tooltip>
              <IconButton onClick={toggleFull}><FullscreenIcon /></IconButton>
            </Stack>
          </Box>
        )}

        {hideChrome && (
          <Box sx={{
            position: 'absolute', top: 16, right: 16, zIndex: 9000,
            display: 'flex', gap: 1,
            opacity: 0.15, // Slightly visible by default
            transition: 'opacity 0.3s',
            '&:hover': { opacity: 1 }
          }}>
            <Button variant="contained" color="error" size="small" onClick={handleKioskExit} startIcon={<CloseIcon />}>
              Exit
            </Button>
            {/* Optional: Home button depending on workflow, sticking to simple Exit for now which handles navigate */}
            <IconButton onClick={toggleFull} sx={{ bgcolor: 'background.paper', boxShadow: 3 }}><FullscreenExitIcon /></IconButton>
          </Box>
        )}

        <Box sx={{ flex: 1, minHeight: 0, p: 2, pb: hideChrome ? 2 : 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {!goalProgress.loading && (goalProgress.goals || []).length > 0 && (
            <Card sx={{ flexShrink: 0 }}>
              <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
                  <FlagIcon color="primary" sx={{ fontSize: 24 }} />
                  <Typography variant="caption" sx={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.9rem' }}>TAGESZIELE</Typography>
                </Stack>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
                  {goalProgress.goals.map((g, i) => (
                    <Box key={i} sx={{ flex: 1, minWidth: 0 }}>
                      <GoalBar goal={g} onMilestone={() => setSpark(n => n + 1)} />
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}

          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3 }}>
            {['Heute', 'Saison'].map((label, i) => {
              const data = i === 0
                ? (mode === 'AMOUNT' ? boards.daily.amount : boards.daily.count)
                : (mode === 'AMOUNT' ? boards.yearly.amount : boards.yearly.count);
              const top3 = (data?.entries || []).slice(0, 3);
              const rest = (data?.entries || []).slice(3, 20);

              return (
                <Card key={label} sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 1.5, pb: 1, overflow: 'hidden' }}>
                    <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <TrophyIcon color="primary" sx={{ fontSize: 28 }} />
                        <Typography variant="h5" sx={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
                      </Stack>
                      <Chip
                        label={mode === 'AMOUNT' ? 'UMSATZ' : 'ANZAHL'}
                        color="primary"
                        size="small"
                        sx={{ fontWeight: 800, borderRadius: 1.5, height: 24, fontSize: '0.75rem' }}
                      />
                    </Stack>

                    <Box sx={{ flexShrink: 0, mb: 0.5 }}>
                      <Podium topThree={top3} mode={mode} moneyFormatter={money} />
                    </Box>

                    <Grid container spacing={2} sx={{ px: 1, mb: 0.5, opacity: 0.5 }}>
                      <Grid item xs={6} display="flex" justifyContent="space-between">
                        <Typography variant="caption" fontWeight={800} fontSize="0.7rem"># NAME</Typography>
                        <Typography variant="caption" fontWeight={800} fontSize="0.7rem">{mode === 'AMOUNT' ? 'UMSATZ' : 'ANZAHL'}</Typography>
                      </Grid>
                      <Grid item xs={6} display="flex" justifyContent="space-between">
                        <Typography variant="caption" fontWeight={800} fontSize="0.7rem"># NAME</Typography>
                        <Typography variant="caption" fontWeight={800} fontSize="0.7rem">{mode === 'AMOUNT' ? 'UMSATZ' : 'ANZAHL'}</Typography>
                      </Grid>
                    </Grid>

                    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'hidden' }}>
                      <GridList
                        items={rest}
                        renderItem={(e) => <RankRow key={e.rank} entry={e} />}
                      />
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        </Box>
      </Box>

      <Dialog open={goalsOpen} onClose={() => setGoalsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Stack direction="row" spacing={1} alignItems="center"><FlagIcon /> <Typography variant="h6" fontWeight={700}>Ziele konfigurieren</Typography></Stack>
          <IconButton onClick={() => setGoalsOpen(false)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} sx={{ mt: 1 }}>
            {goalDraft.map((g, idx) => (
              <Stack key={idx} spacing={1} sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle2" fontWeight={700}>Ziel #{idx + 1}</Typography>
                  <IconButton size="small" color="error" onClick={() => { const cp = [...goalDraft]; cp.splice(idx, 1); setGoalDraft(cp); }}><CloseIcon fontSize="small" /></IconButton>
                </Stack>
                <Grid container spacing={2}>
                  <Grid item xs={8}>
                    <Autocomplete
                      size="small" options={allArticles} getOptionLabel={o => o.name || ''}
                      value={allArticles.find(a => a.id === g.articleId) || null}
                      onChange={(_, v) => {
                        const cp = [...goalDraft];
                        cp[idx].articleId = v?.id || '';
                        cp[idx].label = v?.name || '';
                        setGoalDraft(cp);
                      }}
                      renderInput={params => <TextField {...params} label="Artikel wählen" />}
                    />
                  </Grid>
                  <Grid item xs={4}>
                    <TextField
                      size="small" type="number" label="Zielmenge" fullWidth
                      value={g.targetUnits}
                      onChange={e => { const cp = [...goalDraft]; cp[idx].targetUnits = e.target.value; setGoalDraft(cp); }}
                    />
                  </Grid>
                </Grid>
              </Stack>
            ))}
            {goalDraft.length < 4 && <Button variant="dashed" startIcon={<FlagIcon />} onClick={() => setGoalDraft([...goalDraft, { articleId: '', targetUnits: 0 }])} sx={{ border: '1px dashed', borderColor: 'divider', py: 2 }}>Ziel hinzufügen</Button>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setGoalsOpen(false)}>Abbrechen</Button>
          <Button onClick={saveGoals} variant="contained" disabled={goalProgress.loading}>Speichern</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
