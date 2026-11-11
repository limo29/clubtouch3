// Gemeinsamer Rahmen der öffentlichen Bildschirme (Clubscore und Werbung hängen nebeneinander über der Theke):
// derselbe Fortschrittsbalken an der Unterkante des Bildschirms und derselbe Vollbild-Knopf.
// Der Balken hängt am echten Bildschirmrand und misst sich an der Bildschirmhöhe, damit er auf zwei
// Monitoren mit unterschiedlicher Auflösung gleich aussieht. Bewusst keine Uhr.
import React from 'react';
import { Box, Fade, IconButton, Tooltip, Typography, keyframes } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

// Eine Palette für beide Bildschirme über der Theke (Clubscore und Werbefolien, auch die Vorlagen im Editor)
export const DISPLAY_COLORS = {
  black: '#000000',
  white: '#f2f2f2',     // bewusst kein reines Weiß, das überstrahlt auf dem Fernseher
  dim: '#8d949c',
  green: '#00e676',     // Grün der Kasse
  greenDeep: '#0b2818', // dunkler Grund für grüne Schrift (statt heller Flächen)
  red: '#ff3b30',       // Rot aus dem Clubraum-Logo
  amber: '#ffc400',
};
export const DISPLAY_ACCENT = DISPLAY_COLORS.green; // auch der „Live“-Punkt

// Mitgelieferte Schriften (src/fonts.js): Plakatschrift für Überschriften, Inter für alles andere
export const DISPLAY_FONTS = {
  headline: '"Bebas Neue", "Oswald", Impact, "Arial Narrow", sans-serif',
  text: '"Inter", "Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif',
};

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

/**
 * Überschrift auf den öffentlichen Bildschirmen, wie auf den Werbefolien: Plakatschrift, kurzer grüner Strich
 * darunter. Der Untertitel steht klein in derselben Zeile, damit die Rangliste darunter keinen Platz verliert.
 */
export function DisplayHeading({ title, subtitle, lg = true }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: lg ? 2 : 1, minWidth: 0 }}>
        <Typography component="h2" noWrap sx={{
          fontFamily: DISPLAY_FONTS.headline, fontWeight: 400, letterSpacing: '0.02em',
          fontSize: lg ? '3rem' : '1.6rem', lineHeight: 1, flexShrink: 0,
        }}>{title}</Typography>
        {subtitle && (
          <Typography noWrap color="text.secondary" sx={{ fontSize: lg ? '1.15rem' : '0.78rem', minWidth: 0 }}>{subtitle}</Typography>
        )}
      </Box>
      <Box aria-hidden sx={{ width: lg ? 120 : 64, height: lg ? 5 : 3, borderRadius: 3, bgcolor: DISPLAY_ACCENT, mt: lg ? 0.75 : 0.5 }} />
    </Box>
  );
}
