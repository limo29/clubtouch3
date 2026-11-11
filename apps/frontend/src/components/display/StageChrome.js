// Gemeinsamer Rahmen der öffentlichen Bildschirme (Clubscore und Werbung hängen nebeneinander über der Theke):
// derselbe Fortschrittsbalken an der Unterkante des Bildschirms und derselbe Vollbild-Knopf.
// Der Balken hängt am echten Bildschirmrand und misst sich an der Bildschirmhöhe, damit er auf zwei
// Monitoren mit unterschiedlicher Auflösung gleich aussieht. Bewusst keine Uhr.
import React from 'react';
import { Box, Fade, IconButton, Tooltip, keyframes } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

export const DISPLAY_ACCENT = '#00e676'; // Grün der Kasse, auch der „Live“-Punkt

const grow = keyframes`
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
`;

/** Balken an der Unterkante des Bildschirms: läuft in `seconds` voll, `cycleKey` startet ihn neu. */
export function ScreenProgress({ active = true, cycleKey, seconds }) {
  if (!active) return null;
  return (
    <Box aria-hidden sx={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, pointerEvents: 'none',
      height: 'max(4px, 0.65vh)', bgcolor: 'rgba(255,255,255,0.08)', overflow: 'hidden',
    }}>
      <Box key={cycleKey} sx={{
        height: '100%', bgcolor: DISPLAY_ACCENT, opacity: 0.85, transformOrigin: 'left',
        animation: `${grow} ${seconds}s linear both`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none', transform: 'scaleX(1)', opacity: 0.35 },
      }} />
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
