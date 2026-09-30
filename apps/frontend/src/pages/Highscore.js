import React, { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, CircularProgress, IconButton, Snackbar, Stack, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography, useMediaQuery, useTheme,
} from '@mui/material';
import FlagIcon from '@mui/icons-material/Flag';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import useHighscoreLogic, { HS_DISPLAY_PUT_URL } from '../hooks/useHighscoreLogic';
import useClubscoreEvents from '../hooks/useClubscoreEvents';
import useFullscreen from '../hooks/useFullscreen';
import { useNow, useRankChanges } from '../components/highscore/useRankChanges';
import useRotatingView from '../components/highscore/useRotatingView';
import Board from '../components/highscore/Board';
import TeamBoard from '../components/highscore/TeamBoard';
import GoalsSection from '../components/highscore/GoalsSection';
import GoalOverlay from '../components/highscore/GoalOverlay';
import Ticker from '../components/highscore/Ticker';
import StatusBar from '../components/highscore/StatusBar';
import RotateProgress from '../components/highscore/RotateProgress';
import DisplayMenu from '../components/highscore/DisplayMenu';
import DisplaySettingsDialog from '../components/highscore/DisplaySettingsDialog';
import GoalsDialog, { goalsApiError } from '../components/highscore/GoalsDialog';
import ArchiveDialog from '../components/highscore/ArchiveDialog';
import ResetYearDialog from '../components/highscore/ResetYearDialog';
import { buildTickerItems } from '../components/highscore/tickerItems';
import { VIEW_LABELS, dateDE, timeHM } from '../components/highscore/format';

const DAY_EMPTY = 'Heute noch keine Wertung – der erste Kauf zählt!';
const YEAR_EMPTY = 'In diesem Jahr noch keine Wertung – der erste Kauf zählt!';
const TEAM_EMPTY = 'Noch keine Team-Wertung – Kunden einem Team zuordnen und los geht’s!';
// über AppBar (1100) und Drawer (1200), unter Dialogen/Menüs (1300)
const FULLSCREEN_Z = 1210;

/** Interner Clubscore (/highscore): Live-Wertungen, Ziele, Anzeige-Steuerung für alle Bildschirme. */
export default function Highscore() {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();
  const canEdit = ['ADMIN', 'CASHIER'].includes(user?.role);

  const hs = useHighscoreLogic();
  const { data, display, setDisplay } = hs;
  const marks = useRankChanges(data);
  const now = useNow(15000);
  const { view, rotating, cycle, seconds } = useRotatingView(display);
  const { overlay, dismissOverlay, tickerEvents } = useClubscoreEvents(data.events, {
    dayStart: data.period?.dayStart,
    enabled: !hs.loading && !!hs.lastUpdated,
  });

  const [dialog, setDialog] = useState(null); // 'goals' | 'display' | 'archive' | 'reset'
  const [menuOpen, setMenuOpen] = useState(false);
  const [snack, setSnack] = useState(null);
  const fs = useFullscreen({ hold: menuOpen || !!dialog });

  const { data: archive = [] } = useQuery({
    queryKey: ['clubscore-archive'],
    queryFn: async () => (await api.get('/highscore/archive')).data?.archive || [],
    staleTime: 10 * 60 * 1000,
  });

  const tickerItems = useMemo(
    () => buildTickerItems(data, tickerEvents, { lastArchive: archive[0] }),
    [data, tickerEvents, archive]
  );

  const saveDisplay = useMutation({
    mutationFn: async (next) => (await api.put(HS_DISPLAY_PUT_URL, next)).data,
    onMutate: (next) => {
      const prev = display;
      setDisplay(next);
      return { prev };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.prev) setDisplay(ctx.prev);
      setSnack({ severity: 'error', msg: goalsApiError(err, 'Anzeige konnte nicht gespeichert werden.') });
    },
    onSuccess: (res) => {
      if (res && typeof res === 'object' && res.view) setDisplay((d) => ({ ...d, ...res }));
    },
  });

  const closeDialog = useCallback(() => setDialog(null), []);

  const onViewChange = (_, v) => {
    if (!v || !canEdit || v === display.view) return;
    saveDisplay.mutate({ ...display, view: v });
  };

  const period = data.period || {};
  const mode = view === 'count' ? 'COUNT' : 'AMOUNT';
  const boardKinds = display.board === 'day' ? ['day'] : display.board === 'year' ? ['year'] : ['day', 'year'];
  const fill = isMdUp;
  const single = boardKinds.length === 1;

  const renderBoard = (kind) => {
    const isDay = kind === 'day';
    const title = isDay ? 'Tageswertung' : 'Jahreswertung';
    const subtitle = isDay
      ? `seit ${period.dayStart ? timeHM(period.dayStart) : '06:00'} Uhr`
      : `seit ${period.yearStart ? dateDE(period.yearStart) : '01.01.'}${period.yearManualReset ? ' (zurückgesetzt)' : ''}`;
    if (view === 'teams') {
      const tb = isDay ? data.teams?.daily?.amount : data.teams?.yearly?.amount;
      return (
        <TeamBoard key={kind} title={`${title} · Teams`} subtitle={subtitle} board={tb} mode="AMOUNT"
          fill={fill} emptyText={TEAM_EMPTY} />
      );
    }
    const scope = isDay ? 'daily' : 'yearly';
    const key = `${scope}.${view === 'count' ? 'count' : 'amount'}`;
    return (
      <Board key={kind} title={title} subtitle={subtitle} board={data[scope]?.[view === 'count' ? 'count' : 'amount']}
        mode={mode} marks={marks} marksKey={key} now={now} fill={fill}
        columns={single ? 3 : 2} podiumHeight={single ? 200 : 160} minRow={30} dense={fill} emptyText={isDay ? DAY_EMPTY : YEAR_EMPTY} />
    );
  };

  const toolbarHidden = fs.isFull && !fs.controlsVisible;

  const viewToggle = (
    <ToggleButtonGroup exclusive size="small" value={display.view} onChange={onViewChange}
      disabled={!canEdit || saveDisplay.isPending} aria-label="Ansicht für alle Bildschirme"
      sx={{ flexShrink: 0, '& .MuiToggleButton-root': { px: { xs: 1.1, sm: 1.5 }, py: 0.5, textTransform: 'none', fontWeight: 700 } }}>
      {['amount', 'count', 'teams', 'rotate'].map((v) => (
        <ToggleButton key={v} value={v} aria-label={VIEW_LABELS[v]}>{VIEW_LABELS[v]}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  );

  return (
    <Box sx={fs.isFull
      ? { position: 'fixed', inset: 0, zIndex: FULLSCREEN_Z, bgcolor: 'background.default', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, overflow: 'auto' }
      : { display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0, height: isMdUp ? 'calc(100dvh - 80px)' : 'auto' }}>

      {/* Leiste */}
      <Box sx={{ flexShrink: 0, opacity: toolbarHidden ? 0 : 1, transition: 'opacity 0.4s', pointerEvents: toolbarHidden ? 'none' : 'auto' }}>
        <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 1 }}>
          <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
            <StatusBar status={hs.status} offlineSince={hs.offlineSince} lastUpdated={hs.lastUpdated} period={period} />
          </Box>
          <Box sx={{ order: { xs: 3, md: 0 }, width: { xs: '100%', md: 'auto' }, display: 'flex', justifyContent: { xs: 'center', md: 'flex-start' } }}>
            {canEdit ? viewToggle : (
              <Tooltip title="Nur Admin und Kasse können die Ansicht ändern">
                <span>{viewToggle}</span>
              </Tooltip>
            )}
          </Box>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
            {canEdit && (isXs ? (
              <Tooltip title="Ziele">
                <IconButton onClick={() => setDialog('goals')} aria-label="Ziele"><FlagIcon /></IconButton>
              </Tooltip>
            ) : (
              <Button variant="outlined" size="small" startIcon={<FlagIcon />} onClick={() => setDialog('goals')}>Ziele</Button>
            ))}
            {fs.supported && (
              <Tooltip title={fs.isFull ? 'Vollbild beenden' : 'Vollbild'}>
                <IconButton onClick={fs.toggle} aria-label={fs.isFull ? 'Vollbild beenden' : 'Vollbild'}>
                  {fs.isFull ? <FullscreenExitIcon /> : <FullscreenIcon />}
                </IconButton>
              </Tooltip>
            )}
            <DisplayMenu canEditDisplay={canEdit} isAdmin={isAdmin} onOpenChange={setMenuOpen}
              onDisplay={() => setDialog('display')} onArchive={() => setDialog('archive')} onReset={() => setDialog('reset')} />
          </Stack>
        </Stack>
        <Box sx={{ mt: 1 }}>
          <RotateProgress active={rotating} cycle={cycle} seconds={seconds} />
        </Box>
      </Box>

      {hs.loading ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 8 }}>
          <Stack alignItems="center" spacing={2}>
            <CircularProgress />
            <Typography color="text.secondary">Clubscore wird geladen …</Typography>
          </Stack>
        </Box>
      ) : (
        <>
          {hs.error && !hs.lastUpdated && (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={hs.refresh}>Erneut versuchen</Button>}>
              Clubscore konnte nicht geladen werden.
            </Alert>
          )}
          <GoalsSection goals={data.goals} columnsMax={4} />
          <Box sx={{
            flex: fill ? 1 : 'none', minHeight: 0, display: 'grid', gap: 1.5,
            gridTemplateColumns: { xs: '1fr', md: single ? '1fr' : 'repeat(2, minmax(0, 1fr))' },
          }}>
            {boardKinds.map(renderBoard)}
          </Box>
          {display.ticker && <Ticker items={tickerItems} />}
        </>
      )}

      <GoalOverlay event={overlay} onDone={dismissOverlay} />

      <GoalsDialog open={dialog === 'goals'} onClose={closeDialog} goalsProgress={data.goals} canEdit={canEdit}
        onSaved={(res) => {
          if (res && Array.isArray(res.goals)) hs.patchData({ goals: res });
          setSnack({ severity: 'success', msg: 'Tagesziele gespeichert.' });
        }} />
      <DisplaySettingsDialog open={dialog === 'display'} onClose={closeDialog} display={display} canEdit={canEdit}
        saving={saveDisplay.isPending}
        error={saveDisplay.isError ? goalsApiError(saveDisplay.error, 'Anzeige konnte nicht gespeichert werden.') : ''}
        onSave={(next) => saveDisplay.mutate(next, {
          onSuccess: () => { closeDialog(); setSnack({ severity: 'success', msg: 'Anzeige für alle Bildschirme gespeichert.' }); },
        })} />
      <ArchiveDialog open={dialog === 'archive'} onClose={closeDialog} />
      {isAdmin && (
        <ResetYearDialog open={dialog === 'reset'} onClose={closeDialog} yearlyEntries={data.yearly?.amount?.entries || []}
          period={period}
          onDone={(msg) => {
            setSnack({ severity: 'success', msg });
            hs.refresh();
            queryClient.invalidateQueries({ queryKey: ['clubscore-archive'] });
          }} />
      )}

      <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ zIndex: 1400 }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : <span />}
      </Snackbar>
    </Box>
  );
}
