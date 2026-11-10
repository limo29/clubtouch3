import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography,
} from '@mui/material';
import LockClockIcon from '@mui/icons-material/LockClock';
import { setClosedPeriodHandler } from '../../services/closedPeriodPrompt';

const fmtDate = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/**
 * Globaler Bestätigungsdialog für Änderungen in abgeschlossenen Geschäftsjahren.
 * Einmal in App.js eingehängt; services/api.js fragt bei 409 + code CLOSED_PERIOD hierüber nach
 * und wiederholt die Anfrage nach „Trotzdem ändern“ mit dem Header X-Confirm-Closed-Period.
 * Mehrere gleichzeitige Rückfragen werden nacheinander gezeigt.
 */
export default function ClosedPeriodDialog() {
  const [current, setCurrent] = useState(null); // { info, resolve }
  const currentRef = useRef(null);
  const queue = useRef([]);

  const show = (item) => { currentRef.current = item; setCurrent(item); };

  useEffect(() => setClosedPeriodHandler((info) => new Promise((resolve) => {
    const item = { info, resolve };
    if (currentRef.current) queue.current.push(item);
    else show(item);
  })), []);

  const answer = (confirmed) => {
    const cur = currentRef.current;
    if (!cur) return;
    cur.resolve(confirmed);
    show(queue.current.shift() || null);
  };

  const fy = current?.info?.fiscalYear || {};
  const period = fy.startDate ? `${fmtDate(fy.startDate)} – ${fmtDate(fy.endDate)}` : '';

  return (
    <Dialog
      open={!!current}
      onClose={() => answer(false)}
      fullWidth
      maxWidth="xs"
      // über allen anderen Dialogen (die Rückfrage kommt oft aus einem offenen Bearbeiten-Dialog)
      sx={{ zIndex: (theme) => theme.zIndex.modal + 150 }}
      aria-labelledby="closed-period-title"
    >
      <DialogTitle id="closed-period-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 2 }}>
        <LockClockIcon color="warning" />
        Geschäftsjahr {fy.name || ''} ist abgeschlossen
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Diese Änderung betrifft eine Buchung aus einem bereits abgeschlossenen und von der Kassenprüfung
          geprüften Zeitraum{period ? ` (${period})` : ''}.
        </Alert>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Wenn du fortfährst, wird die Änderung ausgeführt und im Kassenprüfungsbericht (Jahresabschluss)
          als nachträgliche Änderung mit Zeitpunkt, Benutzer und Betrag ausgewiesen.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Die Zahlen des Abschlusses selbst bleiben unverändert.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={() => answer(false)} autoFocus>Abbrechen</Button>
        <Button onClick={() => answer(true)} variant="contained" color="warning">Trotzdem ändern</Button>
      </DialogActions>
    </Dialog>
  );
}
