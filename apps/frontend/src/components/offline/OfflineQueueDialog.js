/**
 * Warteschlange der Offline-Buchungen ansehen: wartende und fehlgeschlagene Einträge,
 * „Jetzt synchronisieren“, je fehlgeschlagenem Eintrag „Erneut versuchen“ / „Verwerfen“.
 */
import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Stack, Box,
  Alert, Chip, Divider, useMediaQuery, CircularProgress, IconButton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Close, CloudSync, WifiOff, Replay, DeleteOutline } from '@mui/icons-material';
import { useOffline } from '../../context/OfflineContext';
import { money, fmtNumber } from '../../utils/format';

const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const methodLabel = { CASH: 'bar', CARD: 'Karte', TRANSFER: 'Überweisung' };

function EntryRow({ entry, failed, onRetry, onDiscard }) {
  const s = entry.summary || {};
  const title = entry.kind === 'TOPUP'
    ? `Aufladung${s.method ? ` (${methodLabel[s.method] || s.method})` : ''}`
    : s.label || 'Verkauf';
  return (
    <Box sx={{ py: 1.25 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(entry.clientCreatedAt)}</Typography>
            <Typography fontWeight={700}>{title}</Typography>
            {s.customerName && <Chip size="small" label={s.customerName} />}
          </Stack>
          {s.items?.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {s.items.map((i) => `${fmtNumber(i.quantity)}× ${i.name}`).join(', ')}
            </Typography>
          )}
          {entry.lastError && (
            <Typography variant="body2" color={failed ? 'error' : 'warning.main'} sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
              {failed ? entry.lastError : `Letzter Versuch: ${entry.lastError}${entry.attempts ? ` (${entry.attempts}×)` : ''}`}
            </Typography>
          )}
        </Box>
        <Typography fontWeight={800} sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {s.amount == null ? '–' : money(s.amount)}
        </Typography>
      </Stack>
      {failed && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button size="small" color="error" startIcon={<DeleteOutline />} onClick={() => onDiscard(entry)}>Verwerfen</Button>
          <Button size="small" variant="outlined" startIcon={<Replay />} onClick={() => onRetry(entry)}>Erneut versuchen</Button>
        </Stack>
      )}
    </Box>
  );
}

export default function OfflineQueueDialog({ open, onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { isOnline, queue, failed, isSyncing, lastSyncAt, syncQueue, retryFailed, discardFailed } = useOffline();
  const [confirm, setConfirm] = useState(null);

  return (
    <>
      <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
          <Box sx={{ flex: 1 }}>Offline-Buchungen</Box>
          <IconButton aria-label="Schließen" onClick={onClose}><Close /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {isOnline ? (
            <Alert severity={queue.length ? 'info' : 'success'} icon={isSyncing ? <CircularProgress size={18} /> : <CloudSync />} sx={{ mb: 2 }}>
              {queue.length
                ? (isSyncing ? 'Verbunden – Buchungen werden übertragen …' : 'Verbunden – wartende Buchungen werden automatisch übertragen.')
                : 'Verbunden – alle Buchungen sind beim Server.'}
              {lastSyncAt && <Box component="span" sx={{ display: 'block', opacity: 0.8 }}>Zuletzt übertragen: {fmtTime(lastSyncAt)}</Box>}
            </Alert>
          ) : (
            <Alert severity="warning" icon={<WifiOff />} sx={{ mb: 2 }}>
              Keine Verbindung zum Server. Verkäufe und Aufladungen werden auf diesem Gerät gespeichert und
              automatisch übertragen, sobald die Verbindung wieder da ist. Gerät nicht zurücksetzen und Browserdaten nicht löschen.
            </Alert>
          )}

          <Typography variant="overline" color="text.secondary" fontWeight={800}>Warten auf Übertragung ({queue.length})</Typography>
          {queue.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>Keine wartenden Buchungen.</Typography>}
          {queue.map((e, i) => (
            <React.Fragment key={e.clientId}>
              {i > 0 && <Divider />}
              <EntryRow entry={e} />
            </React.Fragment>
          ))}

          {failed.length > 0 && (
            <>
              <Typography variant="overline" color="error" fontWeight={800} sx={{ display: 'block', mt: 2 }}>Fehlgeschlagen ({failed.length})</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                Der Server hat diese Buchungen abgelehnt, sie sind nicht gebucht. Nach dem Beheben (z.&nbsp;B. Guthaben aufladen)
                erneut versuchen oder verwerfen und von Hand neu buchen.
              </Typography>
              {failed.map((e, i) => (
                <React.Fragment key={e.clientId}>
                  {i > 0 && <Divider />}
                  <EntryRow entry={e} failed onRetry={(x) => retryFailed(x.clientId)} onDiscard={setConfirm} />
                </React.Fragment>
              ))}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Schließen</Button>
          <Button variant="contained" startIcon={<CloudSync />} disabled={!navigator.onLine || !queue.length || isSyncing} onClick={syncQueue}>
            Jetzt synchronisieren
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Buchung verwerfen?</DialogTitle>
        <DialogContent>
          <Typography>
            Die Buchung {confirm?.summary?.amount != null ? `über ${money(confirm.summary.amount)} ` : ''}
            {confirm?.summary?.customerName ? `für ${confirm.summary.customerName} ` : ''}
            wird endgültig gelöscht und nicht mehr übertragen.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Abbrechen</Button>
          <Button color="error" variant="contained" onClick={() => { discardFailed(confirm.clientId); setConfirm(null); }}>Verwerfen</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
