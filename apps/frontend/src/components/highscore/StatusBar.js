import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { dayMonth, timeHM } from './format';

/**
 * Status links in der Leiste: Punkt „Live“ / „Offline seit hh:mm“ / „Abfrage alle 60 s“,
 * darunter „Tag seit 06:00 · Jahr seit 01.01.“ aus period.
 */
export default function StatusBar({ status, offlineSince, lastUpdated, period, compact = false }) {
  const color = status === 'live' ? '#00e676' : status === 'offline' ? 'error.main' : 'warning.main';
  let text = 'Live';
  if (status === 'offline') text = `Offline seit ${timeHM(offlineSince || lastUpdated || new Date())}`;
  if (status === 'polling') text = 'Live-Verbindung getrennt';
  const dayTime = period?.dayStart ? timeHM(period.dayStart) : '06:00';
  const yearFrom = period?.yearStart ? dayMonth(period.yearStart) : '01.01.';
  const title = `${text}${lastUpdated ? ` · Stand ${timeHM(lastUpdated)}` : ''}`;

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }} title={title}>
      <Box aria-hidden sx={{
        width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0,
        boxShadow: status === 'live' ? '0 0 8px #00e676' : 'none',
      }} />
      <Box sx={{ minWidth: 0 }} role="status" aria-live="polite">
        <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.85rem', lineHeight: 1.2 }}>{text}</Typography>
        {!compact && (
          <Typography noWrap color="text.secondary" sx={{ fontSize: '0.72rem', lineHeight: 1.2 }}>
            Tag seit {dayTime} · Jahr seit {yearFrom}{period?.yearManualReset ? ' (zurückgesetzt)' : ''}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
