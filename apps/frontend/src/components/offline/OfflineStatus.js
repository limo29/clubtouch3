/**
 * Kopfzeilen-Anzeige des Offline-Betriebs: „Offline“, „n warten“, „n fehlgeschlagen“.
 * Antippen öffnet die Warteschlange (OfflineQueueDialog). Ohne Netz und ohne offene Einträge
 * bleibt sie unsichtbar.
 */
import React, { useState } from 'react';
import { ButtonBase, Stack, Typography, CircularProgress } from '@mui/material';
import { WifiOff, CloudSync, ErrorOutline } from '@mui/icons-material';
import { useOffline } from '../../context/OfflineContext';
import OfflineQueueDialog from './OfflineQueueDialog';

const Pill = ({ color, icon, long, short }) => (
  <Stack direction="row" alignItems="center" spacing={0.5}
    sx={{ px: 1, py: 0.5, borderRadius: 2, bgcolor: `${color}.main`, color: `${color}.contrastText`, whiteSpace: 'nowrap' }}>
    {icon}
    <Typography variant="subtitle2" fontWeight={800} sx={{ display: { xs: 'none', sm: 'block' } }}>{long}</Typography>
    {short != null && <Typography variant="subtitle2" fontWeight={800} sx={{ display: { xs: 'block', sm: 'none' } }}>{short}</Typography>}
  </Stack>
);

export default function OfflineStatus() {
  const { isOnline, queue, failed, isSyncing } = useOffline();
  const [open, setOpen] = useState(false);
  const waiting = queue.length;
  if (isOnline && !waiting && !failed.length && !open) return null;

  const label = [
    !isOnline && 'offline',
    waiting && `${waiting} ${waiting === 1 ? 'Buchung wartet' : 'Buchungen warten'}`,
    failed.length && `${failed.length} fehlgeschlagen`,
  ].filter(Boolean).join(', ');

  return (
    <>
      <ButtonBase onClick={() => setOpen(true)} aria-label={`Offline-Buchungen: ${label || 'keine'}`} sx={{ mr: 1, borderRadius: 2, gap: 0.5, flexShrink: 0 }}>
        {!isOnline && <Pill color="error" icon={<WifiOff sx={{ fontSize: 20 }} />} long="Offline" />}
        {waiting > 0 && (
          <Pill color="warning"
            icon={isSyncing && isOnline ? <CircularProgress size={16} color="inherit" /> : <CloudSync sx={{ fontSize: 20 }} />}
            long={`${waiting} warten`} short={waiting} />
        )}
        {failed.length > 0 && (
          <Pill color="error" icon={<ErrorOutline sx={{ fontSize: 20 }} />} long={`${failed.length} fehlgeschlagen`} short={failed.length} />
        )}
      </ButtonBase>
      <OfflineQueueDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
