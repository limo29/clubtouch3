// „Bildschirme“: welcher Monitor zeigt was. Jeder Monitor öffnet fest /screen/<Nummer> (Startskript am PC),
// die Zuordnung hier wirkt sofort auf allen Bildschirmen. Nach einem Monitortausch reicht es, sie hier umzustellen.
import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import api from '../../services/api';

const OPTIONS = [
  { value: 'highscore', label: 'Clubscore' },
  { value: 'ads', label: 'Werbung' },
  { value: 'sales', label: 'Verkauf (Kasse)' },
  { value: 'none', label: 'nichts' },
];
const NUMBERS = [1, 2, 3, 4];

export default function ScreensDialog({ open, onClose, onSaved }) {
  const [screens, setScreens] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(''); setHint(''); setScreens(null);
    api.get('/public/screens')
      .then((res) => setScreens(res.data?.screens || {}))
      .catch(() => { setScreens({}); setError('Belegung konnte nicht geladen werden.'); });
  }, [open]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.put('/screens', { screens });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const identify = async () => {
    try { await api.post('/screens/identify'); setHint('Die Nummern stehen jetzt für 8 Sekunden auf den Bildschirmen.'); }
    catch { setError('Nummern konnten nicht eingeblendet werden.'); }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Bildschirme</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Jeder Monitor hat eine feste Nummer. Hier legst du fest, was auf welcher Nummer läuft.
            Die Bildschirme schalten sofort um – am PC muss nichts geändert werden.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {hint && <Alert severity="info">{hint}</Alert>}
          {screens && NUMBERS.map((n) => (
            <Stack key={n} direction="row" spacing={2} alignItems="center">
              <Box sx={{ width: 44, height: 44, borderRadius: 1.5, border: 2, borderColor: 'primary.main', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '1.3rem', flexShrink: 0 }}>{n}</Box>
              <TextField select size="small" fullWidth label={`Bildschirm ${n}`} value={screens[n] || 'none'}
                onChange={(e) => setScreens({ ...screens, [n]: e.target.value })}>
                {OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </Stack>
          ))}
          <Box>
            <Button startIcon={<VisibilityIcon />} onClick={identify}>Nummern auf den Bildschirmen einblenden</Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            Adresse je Monitor: {origin}/screen/1, …/screen/2, …/screen/3. Das Startskript (Ordner „scripts/kiosk“) öffnet
            sie mit einem Doppelklick im Vollbild auf allen angeschlossenen Monitoren.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Abbrechen</Button>
        <Button variant="contained" onClick={save} disabled={saving || !screens}>Speichern</Button>
      </DialogActions>
    </Dialog>
  );
}
