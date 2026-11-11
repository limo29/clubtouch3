// Gemeinsame Kopfzeile der Seiten Clubscore und Werbung („das, was auf den Bildschirmen läuft“):
// links der Stand und auf welchem Bildschirm die Anzeige gerade läuft, rechts zuerst die Aktionen der Seite,
// dann immer in derselben Reihenfolge „Anzeige öffnen“ und „Bildschirme“, ganz rechts seltene Extras (⋮, Vollbild).
import React, { useState } from 'react';
import { Box, Button, Chip, Stack, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import TvIcon from '@mui/icons-material/Tv';
import ScreensDialog from './ScreensDialog';
import useScreenAssignment from '../../hooks/useScreenAssignment';

const PUBLIC_PATH = { highscore: '/public/highscore', ads: '/public/ads' };

/** Einheitlicher Knopf für die Kopfzeile: gleiche Höhe (Touch, mind. 40 px) auf beiden Seiten. */
export function BarButton({ sx, ...props }) {
  // Auf dem Handy füllen die Knöpfe die Zeile gleichmäßig statt rechtsbündig zu flattern
  return <Button variant="outlined" {...props} sx={{ minHeight: 40, whiteSpace: 'nowrap', flex: { xs: '1 1 150px', sm: '0 0 auto' }, ...sx }} />;
}

/** „Bildschirm 2“ / „Bildschirm 1 + 3“ / „auf keinem Bildschirm“ – aus der gespeicherten Belegung, live. */
export function OnScreensChip({ content, onClick }) {
  const { screens } = useScreenAssignment(true);
  if (!screens) return null;
  const nums = Object.keys(screens).filter((n) => screens[n] === content).map(Number).sort((a, b) => a - b);
  const label = nums.length ? `Bildschirm ${nums.join(' + ')}` : 'auf keinem Bildschirm';
  return (
    <Tooltip title="Belegung der Bildschirme ändern">
      <Chip icon={<TvIcon />} size="small" label={label} onClick={onClick}
        color={nums.length ? 'default' : 'warning'} variant="outlined" sx={{ flexShrink: 0 }} />
    </Tooltip>
  );
}

export default function DisplayPageBar({ content, status, children, extra, onScreensSaved, onDialogChange }) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const [screensOpen, setScreensOpen] = useState(false);
  const openScreens = () => { setScreensOpen(true); onDialogChange?.(true); };
  const closeScreens = () => { setScreensOpen(false); onDialogChange?.(false); };

  return (
    <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 1, minWidth: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flex: '1 1 220px', minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }}>{status}</Box>
        <OnScreensChip content={content} onClick={openScreens} />
        {isXs && extra && <Box sx={{ ml: 'auto', flexShrink: 0 }}>{extra}</Box>}
      </Stack>
      <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end', minWidth: 0, width: { xs: '100%', sm: 'auto' } }}>
        {children}
        <BarButton color="inherit" startIcon={<OpenInNewIcon />} href={PUBLIC_PATH[content]} target="_blank" rel="noopener noreferrer">
          Anzeige öffnen
        </BarButton>
        <BarButton color="inherit" startIcon={<TvIcon />} onClick={openScreens}>Bildschirme</BarButton>
        {!isXs && extra}
      </Stack>
      <ScreensDialog open={screensOpen} onClose={closeScreens} onSaved={onScreensSaved} />
    </Stack>
  );
}
