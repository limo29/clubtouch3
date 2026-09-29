import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, Chip, IconButton, Stack,
  Typography, alpha, GlobalStyles, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Autocomplete, Grid, Tooltip, Switch, FormControlLabel, CssBaseline,
  Snackbar, Alert, CircularProgress
} from '@mui/material';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import FlagIcon from '@mui/icons-material/Flag';
import CloseIcon from '@mui/icons-material/Close';
import MonitorIcon from '@mui/icons-material/Monitor';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useAuth } from '../context/AuthContext';

import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import Podium from '../components/common/Podium';

import GoalOverlay from '../components/common/GoalOverlay';
import GoalBar from '../components/common/GoalBar';
import { useHighscoreLogic } from '../hooks/useHighscoreLogic';

/* ---------- Helpers ---------- */
const money = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);
const dateDE = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : '');
const RESET_WORD = 'RESET';
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

function GridList({ items, renderItem }) {
  const splitIndex = 9;
  const col1 = items.slice(0, splitIndex);
  const col2 = items.slice(splitIndex);

  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, height: '100%',
    }}>
      <Stack spacing={0} sx={{ height: '100%' }}>{col1.map(renderItem)}</Stack>
      <Stack spacing={0} sx={{ height: '100%' }}>{col2.map(renderItem)}</Stack>
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
  // USE THE HOOK
  const {
    boards, goalProgress, loading, live, startDate,
    overlay, setOverlay, refresh
  } = useHighscoreLogic();

  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [autoRotate] = useLocalBool('hs_autoRotate', true);
  const [forceKiosk, setForceKiosk] = useLocalBool('hs_forceKiosk', false);
  const [mode, setMode] = useState('AMOUNT');
  const [allArticles, setAllArticles] = useState([]);

  // Goal Settings
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState([]);
  const [movingTargetsDraft, setMovingTargetsDraft] = useState(false);

  // Jahres-Reset (nur Admin)
  const [resetOpen, setResetOpen] = useState(false);
  const [resetWord, setResetWord] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const yearlyStart = boards.yearly?.amount?.startDate ? new Date(boards.yearly.amount.startDate) : null;
  const yearlyIsReset = !!yearlyStart && (yearlyStart.getMonth() !== 0 || yearlyStart.getDate() !== 1 || yearlyStart.getHours() !== 0);
  const yearlyLabel = yearlyStart ? `seit ${dateDE(yearlyStart)}` : '';
  const yearlyEntries = boards.yearly?.amount?.entries || [];

  const doReset = async () => {
    if (resetWord.trim().toUpperCase() !== RESET_WORD) return;
    setResetBusy(true);
    try {
      const r = await api.post(API_ENDPOINTS.HIGHSCORE_RESET, { type: 'YEARLY' });
      const n = Number(r.data?.archivedEntries || 0);
      setSnack({ open: true, severity: 'success', msg: `Jahres-Clubscore zurückgesetzt (${n} ${n === 1 ? 'Eintrag' : 'Einträge'} archiviert). Die Wertung zählt ab jetzt neu.` });
      setResetOpen(false);
      setResetWord('');
      refresh();
    } catch (e) {
      setSnack({ open: true, severity: 'error', msg: e.response?.data?.error || 'Zurücksetzen fehlgeschlagen' });
    } finally {
      setResetBusy(false);
    }
  };

  const [isFull, setIsFull] = useState(!!document.fullscreenElement);
  const toggleFull = async () => { try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen(); } catch { } };

  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (KIOSK_PARAM && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    }
  }, []);

  // Fetch Articles for Config Dialog (only once)
  useEffect(() => {
    api.get('/articles?includeInactive=true').then(r => setAllArticles(r.data.articles || [])).catch(() => { });
  }, []);

  // Sync Draft when opening dialog
  useEffect(() => {
    if (goalsOpen && goalProgress.meta) {
      // Only if we have data, we init format
      const serverCfg = goalProgress.meta.goalsConfig || [];
      setGoalDraft(serverCfg.length ? serverCfg.map(g => ({ ...g, enabled: true })) : [{ enabled: true, articleId: '', label: '', targetUnits: 0 }]);
      setMovingTargetsDraft(goalProgress.meta.movingTargets || false);
    }
  }, [goalsOpen, goalProgress.meta]);

  // Auto-rotate mode
  useEffect(() => {
    if (!autoRotate) return;
    const t = setInterval(() => setMode(p => p === 'AMOUNT' ? 'COUNT' : 'AMOUNT'), 15000);
    return () => clearInterval(t);
  }, [autoRotate]);

  const saveGoals = async () => {
    const payload = goalDraft.filter(g => g.articleId && g.targetUnits > 0).map(g => ({ articleId: g.articleId, targetUnits: Number(g.targetUnits), label: g.label || '' })).slice(0, 4);
    await api.post(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS, { goals: payload, movingTargets: movingTargetsDraft });
    refresh(); // Use hook's refresh
    setGoalsOpen(false);
  };

  const handleKioskExit = async () => {
    setForceKiosk(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch { }
    if (KIOSK_PARAM) {
      navigate('/dashboard');
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

  const Board = ({ title, subtitle, data, icon }) => (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', overflow: 'hidden' }}>
      <CardContent sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha('#fff', 0.05), color: 'primary.main' }}>
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" fontWeight={800} noWrap>{title}</Typography>
            <Typography variant="caption" color="text.secondary">Top 20 • {mode === 'AMOUNT' ? 'Umsatz' : 'Anzahl'}{subtitle ? ` • ${subtitle}` : ''}</Typography>
          </Box>
        </Stack>

        <Box sx={{ mb: 2, flexShrink: 0 }}>
          <Podium entries={(data?.entries || []).slice(0, 3)} mode={mode} moneyFormatter={money} />
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 1 }}>
          <GridList
            items={(data?.entries || []).slice(3, 20)}
            renderItem={(e, i) => <RankRow key={e.customerId || i} entry={e} />}
          />
        </Box>
      </CardContent>
    </Card>
  );

  // Kiosk Overlay (Invisible click handler to exit)
  const renderKioskControls = () => {
    if (!forceKiosk && !KIOSK_PARAM) return null;
    return (
      <Box
        onDoubleClick={handleKioskExit}
        sx={{
          position: 'fixed', top: 0, right: 0, width: 100, height: 100, zIndex: 9999,
          cursor: 'none',
          '&:hover': { cursor: 'default' } // Show cursor only here
        }}
        title="Double click to exit Kiosk"
      />
    );
  };

  const handleMilestone = (goal, level) => {
    const target = Math.max(1, Number(goal.targetUnits));
    const total = target * (level);
    setOverlay({
      active: true,
      type: 'GOAL',
      message: `Ziel erreicht! ${goal.label}: ${total} ${goal.purchaseUnit || 'Stk'}!`
    });
  };

  if (loading && !goalProgress.goals.length) return (
    <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography>Lade Highscore...</Typography>
    </Box>
  );

  return (
    <Box sx={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      bgcolor: 'background.default', color: 'text.primary',
      overflow: 'hidden',
      ...((forceKiosk || KIOSK_PARAM || isFull) && {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999
      })
    }}>
      <CssBaseline />
      <BodyFlag active={forceKiosk || KIOSK_PARAM} />
      <GlobalStyles styles={{
        body: { overflow: 'hidden' },
        ...(forceKiosk || KIOSK_PARAM ? { '* ': { cursor: 'none !important' } } : {})
      }} />

      {renderKioskControls()}

      <GoalOverlay
        trigger={overlay.active}
        type={overlay.type}
        message={overlay.message}
        onComplete={() => setOverlay({ ...overlay, active: false })}
      />

      {/* Toolbar (Hidden in Kiosk unless hovered top, or completely hidden?) 
          Actually KIOSK_PARAM hides it usually. 
      */}
      {/* Toolbar */}
      {(!forceKiosk && !KIOSK_PARAM && !isFull) && (
        <Box sx={{
          p: 1.5, borderBottom: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, flexWrap: 'wrap'
        }}>
          <Button startIcon={<CloseIcon />} onClick={() => navigate('/dashboard')}>
            Dashboard
          </Button>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={2} alignItems="center">
            <Chip
              icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: live ? '#00e676' : 'error.main' }} />}
              label={live ? "LIVE" : "OFFLINE"}
              variant="outlined" size="small"
            />
            <Tooltip title="Tages-Challenge: Geschäftstag ab 06:00 Uhr">
              <Chip label={`Tag: ${startDate ? startDate.toLocaleDateString('de-DE') : 'Heute'}`} size="small" />
            </Tooltip>
            {yearlyStart && (
              <Tooltip title={yearlyIsReset ? 'Jahreswertung wurde manuell zurückgesetzt' : 'Jahreswertung seit Jahresbeginn'}>
                <Chip label={`Jahr: ${yearlyLabel}`} size="small" color={yearlyIsReset ? 'warning' : 'default'} variant="outlined" />
              </Tooltip>
            )}
          </Stack>
          <Button
            variant={goalProgress.goals.length ? 'contained' : 'outlined'}
            onClick={() => setGoalsOpen(true)}
            startIcon={<FlagIcon />}
          >
            Ziele
          </Button>
          <Tooltip title="Auto-Rotate">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption">Auto-Rotate</Typography>
            </Box>
          </Tooltip>
          <Tooltip title="Vollbild">
            <IconButton onClick={toggleFull}>
              {isFull ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Kiosk-Modus (gesperrt)">
            <IconButton onClick={() => { if (window.confirm('Kiosk-Modus aktivieren? (Doppelklick oben rechts zum Beenden)')) setForceKiosk(true); }}>
              <MonitorIcon />
            </IconButton>
          </Tooltip>
          {isAdmin && (
            <Tooltip title="Jahres-Clubscore zurücksetzen (nur Admin)">
              <Button color="warning" variant="outlined" size="small" startIcon={<RestartAltIcon />} onClick={() => { setResetWord(''); setResetOpen(true); }}>
                Jahr zurücksetzen
              </Button>
            </Tooltip>
          )}
        </Box>
      )}

      {/* Main Content */}
      <Box sx={{ flex: 1, p: 2, overflow: { xs: 'auto', md: 'hidden' }, display: 'flex', flexDirection: 'column', gap: 2 }}>

        {/* Top: Goals (if any) */}
        {/* Top: Goals (if any) */}
        {goalProgress.goals.filter(g => g.articleId).length > 0 && (
          <Card variant="outlined" sx={{ flexShrink: 0, bgcolor: 'background.paper' }}>
            <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <FlagIcon fontSize="small" color="primary" />
                <Typography variant="subtitle1" fontWeight={700}>Tagesziele</Typography>
              </Stack>
              <Grid container spacing={4}>
                {goalProgress.goals.filter(g => g.articleId).map((g, i, arr) => {
                  const count = arr.length;
                  // Dynamic sizing logic
                  // 1: Full width
                  // 2: Half width
                  // 3: Third width
                  // 4: Quarter width
                  const mdSize = count === 1 ? 12 : count === 2 ? 6 : count === 3 ? 4 : 3;


                  return (
                    <Grid size={{ xs: 12, md: mdSize }} key={g.articleId || i}>
                      <GoalBar
                        goal={g}
                        movingTargets={goalProgress.meta?.movingTargets}
                        onMilestone={handleMilestone}
                      />
                    </Grid>
                  );
                })}
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Bottom: Boards Split */}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0, minHeight: { xs: 520, md: 0 } }}>
            <Board
              title="Tages-Challenge"
              subtitle="ab 06:00 Uhr"
              icon={<TrophyIcon />}
              data={mode === 'AMOUNT' ? boards.daily.amount : boards.daily.count}
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, minHeight: { xs: 520, md: 0 } }}>
            <Board
              title="Jahres-Ranking"
              subtitle={yearlyLabel}
              icon={<TrophyIcon />}
              data={mode === 'AMOUNT' ? boards.yearly.amount : boards.yearly.count}
            />
          </Box>
        </Box>
      </Box>

      {/* Dialog */}
      <Dialog open={goalsOpen} onClose={() => setGoalsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Tagesziele konfigurieren</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
              <FormControlLabel
                control={<Switch checked={movingTargetsDraft} onChange={e => setMovingTargetsDraft(e.target.checked)} />}
                label={<Box><Typography variant="subtitle2" fontWeight={700}>Dynamische Ziele (Moving Targets)</Typography><Typography variant="caption" color="text.secondary">Ziele wachsen automatisch mit (z.B. 24 &rarr; 48 &rarr; 72)</Typography></Box>}
              />
            </Box>
            {goalDraft.map((g, idx) => (
              <Stack key={idx} spacing={1} sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle2" fontWeight={700}>Ziel #{idx + 1}</Typography>
                  <IconButton size="small" color="error" onClick={() => { const cp = [...goalDraft]; cp.splice(idx, 1); setGoalDraft(cp); }}><CloseIcon fontSize="small" /></IconButton>
                </Stack>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 8 }}>
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
                  <Grid size={{ xs: 4 }}>
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
        <DialogActions>
          <Button onClick={() => setGoalsOpen(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={saveGoals}>Speichern</Button>
        </DialogActions>
      </Dialog>

      {/* Jahres-Reset (Admin) */}
      <Dialog open={resetOpen} onClose={() => !resetBusy && setResetOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Jahres-Clubscore zurücksetzen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Alert severity="warning">
              Das Jahres-Ranking startet danach bei null. Diese Aktion lässt sich nicht rückgängig machen.
            </Alert>
            <Typography variant="body2"><strong>Was passiert:</strong></Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, m: 0 }}>
              <li>Der aktuelle Stand ({yearlyEntries.length} {yearlyEntries.length === 1 ? 'Eintrag' : 'Einträge'}{yearlyEntries[0] ? `, Platz 1: ${yearlyEntries[0].customerNickname || yearlyEntries[0].customerName} mit ${money(yearlyEntries[0].score)}` : ''}) wird im Protokoll archiviert (Umsatz und Anzahl).</li>
              <li>Die Jahreswertung zählt ab dem Zeitpunkt des Zurücksetzens neu; ältere Verkäufe fließen nicht mehr ein.</li>
              <li>Tages-Challenge, Tagesziele, Buchungen und Kundenguthaben bleiben unverändert.</li>
              <li>Am 1. Januar beginnt die Wertung ohnehin automatisch neu.</li>
            </Typography>
            {yearlyIsReset && (
              <Typography variant="body2" color="text.secondary">
                Letzter Reset: {dateDE(yearlyStart)} um {yearlyStart.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.
              </Typography>
            )}
            <TextField
              label={`Zur Bestätigung „${RESET_WORD}“ eingeben`}
              value={resetWord}
              onChange={(e) => setResetWord(e.target.value)}
              autoFocus
              fullWidth
              inputProps={{ 'aria-label': 'Bestätigungswort' }}
              onKeyDown={(e) => { if (e.key === 'Enter') doReset(); }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)} disabled={resetBusy}>Abbrechen</Button>
          <Button
            variant="contained" color="warning" onClick={doReset}
            disabled={resetBusy || resetWord.trim().toUpperCase() !== RESET_WORD}
            startIcon={resetBusy ? <CircularProgress size={16} color="inherit" /> : <RestartAltIcon />}
          >
            {resetBusy ? 'Setze zurück…' : 'Jetzt zurücksetzen'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={6000} onClose={() => setSnack((x) => ({ ...x, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((x) => ({ ...x, open: false }))} variant="filled">{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
