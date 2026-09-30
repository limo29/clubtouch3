import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box, Chip, CircularProgress, CssBaseline, Fade, IconButton, Stack, ThemeProvider, Tooltip, Typography,
  createTheme, useMediaQuery,
} from '@mui/material';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import api from '../services/api';
import useHighscoreLogic from '../hooks/useHighscoreLogic';
import useClubscoreEvents from '../hooks/useClubscoreEvents';
import useFullscreen from '../hooks/useFullscreen';
import { useNow, useRankChanges } from '../components/highscore/useRankChanges';
import useRotatingView from '../components/highscore/useRotatingView';
import Board from '../components/highscore/Board';
import TeamBoard from '../components/highscore/TeamBoard';
import GoalsSection from '../components/highscore/GoalsSection';
import GoalOverlay from '../components/highscore/GoalOverlay';
import Ticker from '../components/highscore/Ticker';
import RotateProgress from '../components/highscore/RotateProgress';
import TvStage from '../components/highscore/TvStage';
import { buildTickerItems } from '../components/highscore/tickerItems';
import { VIEW_LABELS, dateDE, timeHM } from '../components/highscore/format';

const BG = '#0b0d12';
const DAY_EMPTY = 'Heute noch keine Wertung – der erste Kauf zählt!';
const YEAR_EMPTY = 'In diesem Jahr noch keine Wertung – der erste Kauf zählt!';
const TEAM_EMPTY = 'Noch keine Team-Wertung – der erste Kauf eines Teams zählt!';
const URL_VIEWS = ['amount', 'count', 'teams', 'rotate'];
const URL_BOARDS = ['both', 'day', 'year'];

// Die öffentliche Anzeige ist immer dunkel, egal welcher Farbmodus im Browser gespeichert ist.
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#90caf9' },
    background: { default: BG, paper: '#141821' },
  },
});

/** URL-Parameter (view, board, ticker=0|1) haben Vorrang; fehlende Werte kommen live vom Server. */
const useEffectiveDisplay = (serverDisplay) => {
  const [params] = useSearchParams();
  const view = params.get('view');
  const board = params.get('board');
  const ticker = params.get('ticker');
  return useMemo(() => ({
    ...serverDisplay,
    ...(URL_VIEWS.includes(view) ? { view } : {}),
    ...(URL_BOARDS.includes(board) ? { board } : {}),
    ...(ticker === '0' || ticker === '1' ? { ticker: ticker === '1' } : {}),
  }), [serverDisplay, view, board, ticker]);
};

function Clock({ now, lg }) {
  return (
    <Typography sx={{ fontWeight: 800, fontSize: lg ? '2.4rem' : '1.1rem', fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
      {timeHM(now)}
    </Typography>
  );
}

function StatusChip({ hs, lg }) {
  if (hs.status === 'live') {
    return (
      <Stack direction="row" spacing={1} alignItems="center" role="status" aria-live="polite">
        <Box aria-hidden sx={{ width: lg ? 16 : 10, height: lg ? 16 : 10, borderRadius: '50%', bgcolor: '#00e676', boxShadow: '0 0 10px #00e676' }} />
        <Typography sx={{ fontWeight: 800, fontSize: lg ? '1.5rem' : '0.9rem', letterSpacing: 1 }}>Live</Typography>
      </Stack>
    );
  }
  const stand = hs.lastUpdated ? timeHM(hs.lastUpdated) : timeHM(hs.offlineSince || new Date());
  return (
    <Chip role="status" aria-live="polite" color="warning" icon={<WifiOffIcon />}
      label={`Verbindung weg – Stand ${stand}`}
      sx={lg ? { height: 48, fontSize: '1.3rem', fontWeight: 700, px: 1, '& .MuiChip-icon': { fontSize: 28 } } : { fontWeight: 700 }} />
  );
}

function Content() {
  const isMdUp = useMediaQuery(darkTheme.breakpoints.up('md'));
  const hs = useHighscoreLogic();
  const { data } = hs;
  const display = useEffectiveDisplay(hs.display);
  const marks = useRankChanges(data);
  const now = useNow(15000);
  const { view, rotating, cycle, seconds } = useRotatingView(display);
  const { overlay, dismissOverlay, tickerEvents } = useClubscoreEvents(data.events, {
    dayStart: data.period?.dayStart,
    enabled: !hs.loading && !!hs.lastUpdated,
  });
  const fs = useFullscreen({ alwaysAutoHide: true });

  const { data: archive = [] } = useQuery({
    queryKey: ['clubscore-public-archive'],
    queryFn: async () => (await api.get('/public/highscore/archive')).data?.archive || [],
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
  const tickerItems = useMemo(
    () => buildTickerItems(data, tickerEvents, { lastArchive: archive[0] }),
    [data, tickerEvents, archive]
  );

  const period = data.period || {};
  const boardKinds = display.board === 'day' ? ['day'] : display.board === 'year' ? ['year'] : ['day', 'year'];
  const single = boardKinds.length === 1;
  const hasGoals = (data.goals?.goals || []).length > 0;
  const size = isMdUp ? 'lg' : 'md';
  const lg = isMdUp;

  const renderBoard = (kind) => {
    const isDay = kind === 'day';
    const title = isDay ? 'Tageswertung' : 'Jahreswertung';
    const subtitle = isDay
      ? `seit ${period.dayStart ? timeHM(period.dayStart) : '06:00'} Uhr`
      : `seit ${period.yearStart ? dateDE(period.yearStart) : '01.01.'}`;
    if (view === 'teams') {
      const tb = isDay ? data.teams?.daily?.amount : data.teams?.yearly?.amount;
      return <TeamBoard key={kind} title={`${title} · Teams`} subtitle={subtitle} board={tb} mode="AMOUNT" size={size} fill={lg} emptyText={TEAM_EMPTY} />;
    }
    const scope = isDay ? 'daily' : 'yearly';
    const m = view === 'count' ? 'count' : 'amount';
    return (
      <Board key={kind} title={title} subtitle={subtitle} board={data[scope]?.[m]} mode={m.toUpperCase()}
        marks={marks} marksKey={`${scope}.${m}`} now={now} size={size} fill={lg}
        columns={lg ? (single ? 3 : 2) : 1} podiumHeight={lg ? (hasGoals ? (single ? 240 : 178) : (single ? 320 : 270)) : 190} minRow={lg ? 34 : 36}
        emptyText={isDay ? DAY_EMPTY : YEAR_EMPTY} />
    );
  };

  const header = (
    <Stack direction="row" alignItems="center" spacing={lg ? 3 : 1.5} sx={{ flexShrink: 0 }}>
      <TrophyIcon sx={{ fontSize: lg ? 64 : 32, color: '#ffd54f' }} />
      <Typography component="h1" sx={{ fontWeight: 900, fontSize: lg ? '3.6rem' : '1.6rem', lineHeight: 1, letterSpacing: lg ? 1 : 0 }}>
        Clubscore
      </Typography>
      <Chip label={VIEW_LABELS[view] || 'Umsatz'} variant="outlined"
        sx={lg ? { height: 44, fontSize: '1.4rem', fontWeight: 700, px: 1 } : { fontWeight: 700 }} />
      <Box sx={{ flex: 1 }} />
      <StatusChip hs={hs} lg={lg} />
      {lg && <Clock now={now} lg />}
    </Stack>
  );

  const body = hs.loading ? (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: lg ? 0 : '60vh' }}>
      <Stack alignItems="center" spacing={3}>
        <CircularProgress size={lg ? 80 : 40} />
        <Typography sx={{ fontSize: lg ? '2rem' : '1.1rem' }} color="text.secondary">Clubscore wird geladen …</Typography>
      </Stack>
    </Box>
  ) : (
    <>
      <GoalsSection goals={data.goals} size={size} />
      <Box sx={{
        flex: lg ? 1 : 'none', minHeight: 0, display: 'grid', gap: lg ? 3 : 1.5,
        gridTemplateColumns: lg && !single ? 'repeat(2, minmax(0, 1fr))' : '1fr',
      }}>
        {boardKinds.map(renderBoard)}
      </Box>
      {display.ticker && <Ticker items={tickerItems} size={lg ? 'lg' : 'sm'} />}
    </>
  );

  return (
    <>
      {lg ? (
        <Box sx={{ position: 'fixed', inset: 0, bgcolor: BG }}>
          <TvStage background={BG}>
            <Box sx={{ width: '100%', height: '100%', p: 3, display: 'flex', flexDirection: 'column', gap: 2, color: 'text.primary' }}>
              {header}
              <RotateProgress active={rotating} cycle={cycle} seconds={seconds} height={6} />
              {body}
            </Box>
          </TvStage>
        </Box>
      ) : (
        <Box sx={{ minHeight: '100dvh', bgcolor: BG, px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {header}
          <RotateProgress active={rotating} cycle={cycle} seconds={seconds} />
          {body}
        </Box>
      )}

      {/* außerhalb der skalierten Bühne, sonst bezieht sich position:fixed auf die Bühne */}
      <GoalOverlay event={overlay} onDone={dismissOverlay} />

      {fs.supported && lg && (
        <Fade in={fs.controlsVisible}>
          <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 1300 }}>
            <Tooltip title={fs.isFull ? 'Vollbild verlassen (Esc)' : 'Vollbild'}>
              <IconButton onClick={fs.toggle} aria-label={fs.isFull ? 'Vollbild verlassen' : 'Vollbild'}
                sx={{ color: 'rgba(255,255,255,0.75)', bgcolor: 'rgba(255,255,255,0.08)', '&:hover': { bgcolor: 'rgba(255,255,255,0.16)' } }}>
                {fs.isFull ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Fade>
      )}
    </>
  );
}

/** Öffentliche Clubscore-Anzeige (/public/highscore) für Fernseher und Handy, ohne Login und ohne Ton. */
export default function PublicHighscore() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Content />
    </ThemeProvider>
  );
}
