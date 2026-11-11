// Gemeinsamer Rahmen der öffentlichen Bildschirme (Clubscore und Werbung hängen nebeneinander über der Theke):
// dieselbe Uhr oben rechts, derselbe Fortschrittsbalken an der Unterkante, derselbe Vollbild-Knopf.
// Alle Maße gelten auf der festen 1920×1080-Bühne (TvStage). Dadurch sitzen Uhr und Balken auf beiden
// Bildschirmen an derselben Stelle und skalieren mit, egal welche Auflösung der Monitor hat.
import React, { useEffect, useState } from 'react';
import { Box, Fade, IconButton, Tooltip, Typography, keyframes } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import TvStage from '../highscore/TvStage';

export const STAGE_PAD = 24;        // Rand der Bühne (px auf 1920×1080)
export const STAGE_HEADER_H = 64;   // Höhe der Kopfzeile, in der die Uhr sitzt
export const DISPLAY_ACCENT = '#00e676'; // Grün der Kasse, auch der „Live“-Punkt
const BAR_H = 8;

const grow = keyframes`
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
`;

const timeHM = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Uhr. `overlay` setzt sie absolut oben rechts auf die Bühne (Werbung); sonst steht sie im Fluss der Kopfzeile (Clubscore). */
export function StageClock({ overlay = false }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <Box sx={{
      height: STAGE_HEADER_H, display: 'flex', alignItems: 'center', flexShrink: 0,
      ...(overlay && { position: 'absolute', top: STAGE_PAD, right: STAGE_PAD }),
    }}>
      <Typography component="span" sx={{
        fontWeight: 800, fontSize: '2.4rem', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: '#fff',
        // dunkle Plakette: bleibt auch über hellen Werbefolien lesbar, auf schwarzem Grund unsichtbar
        bgcolor: 'rgba(0,0,0,0.55)', px: 1.5, py: 1, borderRadius: 2,
      }}>
        {timeHM(now)}
      </Typography>
    </Box>
  );
}

/** Balken an der Unterkante der Bühne: läuft in `seconds` voll, `cycleKey` startet ihn neu. */
export function StageProgress({ active = true, cycleKey, seconds }) {
  if (!active) return null;
  return (
    <Box aria-hidden sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: BAR_H, bgcolor: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
      <Box key={cycleKey} sx={{
        height: '100%', bgcolor: DISPLAY_ACCENT, transformOrigin: 'left',
        animation: `${grow} ${seconds}s linear both`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none', transform: 'scaleX(1)', opacity: 0.4 },
      }} />
    </Box>
  );
}

/** Legt Uhr/Balken als durchklickbare Bühne über einen Bildschirm, dessen Inhalt nicht selbst in einer TvStage liegt. */
export function StageOverlay({ children }) {
  return (
    <Box sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      <TvStage background="transparent">
        <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>{children}</Box>
      </TvStage>
    </Box>
  );
}

/** Vollbild-Knopf oben rechts, blendet sich nach kurzer Zeit ohne Maus aus (fs = useFullscreen()). */
export function FullscreenButton({ fs }) {
  if (!fs.supported) return null;
  return (
    <Fade in={fs.controlsVisible}>
      <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 1300 }}>
        <Tooltip title={fs.isFull ? 'Vollbild verlassen (Esc)' : 'Vollbild'}>
          <IconButton onClick={fs.toggle} aria-label={fs.isFull ? 'Vollbild verlassen' : 'Vollbild'}
            sx={{ color: 'rgba(255,255,255,0.85)', bgcolor: 'rgba(0,0,0,0.55)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' } }}>
            {fs.isFull ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
        </Tooltip>
      </Box>
    </Fade>
  );
}
