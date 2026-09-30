import React, { useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import api from '../../services/api';
import { money } from '../../utils/format';
import { dateDE, displayName, timeHM } from './format';

const RESET_WORD = 'RESET';

/** Jahres-Clubscore zurücksetzen (nur Admin), Bestätigung per Wort „RESET“. */
export default function ResetYearDialog({ open, onClose, yearlyEntries = [], period, onDone }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = word.trim().toUpperCase() === RESET_WORD;
  const lastReset = period?.yearManualReset && period?.yearStart ? period.yearStart : null;

  const close = () => { if (!busy) { setWord(''); setError(''); onClose(); } };
  const doReset = async (e) => {
    e?.preventDefault?.();
    if (!ok || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/highscore/reset', { type: 'YEARLY' });
      const n = Number(r.data?.archivedEntries || 0);
      setWord('');
      onDone?.(`Jahres-Clubscore zurückgesetzt (${n} ${n === 1 ? 'Eintrag' : 'Einträge'} archiviert). Die Wertung zählt ab jetzt neu.`);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Zurücksetzen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth fullScreen={fullScreen}
      PaperProps={{ component: 'form', onSubmit: doReset }}>
      <DialogTitle>Jahres-Clubscore zurücksetzen</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="warning">
            Die Jahreswertung startet danach bei null. Diese Aktion lässt sich nicht rückgängig machen.
          </Alert>
          <Typography variant="body2"><strong>Was passiert:</strong></Typography>
          <Typography variant="body2" component="ul" sx={{ pl: 2.5, m: 0 }}>
            <li>Der aktuelle Stand ({yearlyEntries.length} {yearlyEntries.length === 1 ? 'Eintrag' : 'Einträge'}{yearlyEntries[0] ? `, Platz 1: ${displayName(yearlyEntries[0])} mit ${money(yearlyEntries[0].score)}` : ''}) wird archiviert (Umsatz, Anzahl und Teams).</li>
            <li>Die Jahreswertung zählt ab dem Zeitpunkt des Zurücksetzens neu; ältere Verkäufe fließen nicht mehr ein.</li>
            <li>Tageswertung, Tagesziele, Buchungen und Kundenguthaben bleiben unverändert.</li>
            <li>Am 1. Januar beginnt die Wertung ohnehin automatisch neu.</li>
          </Typography>
          {lastReset && (
            <Typography variant="body2" color="text.secondary">
              Letzter Reset: {dateDE(lastReset)} um {timeHM(lastReset)} Uhr.
            </Typography>
          )}
          <TextField
            label={`Zur Bestätigung „${RESET_WORD}“ eingeben`}
            value={word}
            onChange={(e) => setWord(e.target.value)}
            autoFocus
            fullWidth
            inputProps={{ 'aria-label': 'Bestätigungswort' }}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>Abbrechen</Button>
        <Button type="submit" variant="contained" color="warning" disabled={busy || !ok}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <RestartAltIcon />}>
          {busy ? 'Setze zurück…' : 'Jetzt zurücksetzen'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
