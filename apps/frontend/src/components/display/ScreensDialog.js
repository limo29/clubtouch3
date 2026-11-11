// „Bildschirme“: was auf welchem Monitor über der Theke läuft und wie man die Monitore am Thekenrechner startet.
// Jeder Monitor öffnet fest /screen/<Nummer> (Startskript am PC), die Belegung hier wirkt sofort auf allen
// Bildschirmen. Nach einem Monitortausch reicht es, sie hier umzustellen. Erreichbar von Clubscore und Werbung
// über DisplayPageBar.
import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack,
  TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadIcon from '@mui/icons-material/Download';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { downloadKioskScript, kioskOrigin } from './kioskScripts';

const OPTIONS = [
  { value: 'highscore', label: 'Clubscore' },
  { value: 'ads', label: 'Werbung' },
  { value: 'sales', label: 'Verkauf (normales Fenster, kein Vollbild)' },
  { value: 'none', label: 'nichts' },
];
const NUMBERS = [1, 2, 3, 4];

function Step({ no, title, children }) {
  return (
    <Box>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.25 }}>
        <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', fontWeight: 800, flexShrink: 0 }}>{no}</Box>
        <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      </Stack>
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  );
}

export default function ScreensDialog({ open, onClose, onSaved }) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const { can } = useAuth();
  const canEdit = can('screens');
  const [screens, setScreens] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(''); setHint(''); setScreens(null);
    api.get('/public/screens')
      .then((res) => { const s = res.data?.screens || {}; setScreens(s); setSaved(s); })
      .catch(() => { setScreens({}); setError('Belegung konnte nicht geladen werden.'); });
  }, [open]);

  const dirty = !!screens && !!saved && NUMBERS.some((n) => (screens[n] || 'none') !== (saved[n] || 'none'));

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

  const download = async (os) => {
    setError('');
    try { await downloadKioskScript(os); }
    catch { setError('Startskript konnte nicht geladen werden. Ist die Kasse gerade erreichbar?'); }
  };

  const origin = kioskOrigin();

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm" fullScreen={isXs}>
      <DialogTitle>Bildschirme über der Theke</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {error && <Alert severity="error">{error}</Alert>}

          <Step no={1} title="Was läuft auf welchem Bildschirm?">
            <Typography variant="body2" color="text.secondary">
              Jeder Monitor am Thekenrechner hat eine feste Nummer, von links nach rechts. Nach dem Speichern schalten
              die Bildschirme sofort um – am Thekenrechner muss dafür nichts geändert werden.
            </Typography>
            {!canEdit && <Alert severity="info">Nur Admin und Kasse können die Belegung ändern.</Alert>}
            {hint && <Alert severity="info">{hint}</Alert>}
            {screens && NUMBERS.map((n) => (
              <Stack key={n} direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 44, height: 44, borderRadius: 1.5, border: 2, borderColor: 'primary.main', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '1.3rem', flexShrink: 0 }}>{n}</Box>
                <TextField select size="small" fullWidth label={`Bildschirm ${n}`} value={screens[n] || 'none'} disabled={!canEdit}
                  onChange={(e) => setScreens({ ...screens, [n]: e.target.value })}>
                  {OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
                <Tooltip title={`Bildschirm ${n} in einem neuen Tab dieses Browsers öffnen`}>
                  <IconButton component="a" href={`/screen/${n}`} target="_blank" rel="noopener noreferrer"
                    aria-label={`Bildschirm ${n} in diesem Browser öffnen`} sx={{ width: 44, height: 44, flexShrink: 0 }}>
                    <OpenInNewIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
            <Typography variant="caption" color="text.secondary">
              <OpenInNewIcon sx={{ fontSize: 14, verticalAlign: 'text-bottom' }} /> öffnet den Bildschirm in diesem Browser –
              zum Ausprobieren ohne Startskript (gespeicherte Belegung).
            </Typography>
            {canEdit && (
              <Box>
                <Button variant="outlined" color="inherit" startIcon={<VisibilityIcon />} onClick={identify} sx={{ minHeight: 40 }}>
                  Nummern auf den Bildschirmen einblenden
                </Button>
              </Box>
            )}
          </Step>

          <Step no={2} title="Am Thekenrechner starten">
            <Typography variant="body2" color="text.secondary">
              Eine Webseite kann am PC kein Programm starten. Dafür gibt es ein Startskript: Es öffnet auf jedem Monitor
              ein Fenster – Clubscore und Werbung im Vollbild, den Verkauf als normales Fenster.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => download('windows')} sx={{ minHeight: 40 }}>
                Startskript für Windows
              </Button>
              <Button variant="outlined" color="inherit" startIcon={<DownloadIcon />} onClick={() => download('linux')} sx={{ minHeight: 40 }}>
                für Linux
              </Button>
            </Stack>
            <Box component="ol" sx={{ m: 0, pl: 2.5, typography: 'body2', '& li': { mb: 0.5 } }}>
              <li>Datei auf dem Thekenrechner speichern, z. B. auf dem Desktop.</li>
              <li>Doppelklick auf „Bildschirme starten“. Fragt Windows beim ersten Mal nach: „Weitere Informationen“ → „Trotzdem ausführen“.</li>
              <li>Automatisch beim Hochfahren: <b>Win+R</b>, <b>shell:startup</b> eingeben und eine Verknüpfung zur Datei in den Ordner legen.</li>
            </Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
              Eingetragene Adresse: <b>{origin}</b><br />
              Gebraucht wird Chrome oder Edge, beenden mit Alt+F4. Linux: <code>bash bildschirme-starten.sh</code> (braucht
              Chrome/Chromium und xrandr). Wird die Belegung später umgestellt, wechselt der Inhalt sofort; ob ein Fenster
              im Vollbild läuft, ändert sich erst beim nächsten Start des Skripts. Mehr im Benutzerhandbuch, Kapitel
              „Bildschirme über der Theke“.
            </Typography>
          </Step>
        </Stack>
      </DialogContent>
      <DialogActions>
        {canEdit ? (
          <>
            <Button onClick={onClose} disabled={saving}>{dirty ? 'Abbrechen' : 'Schließen'}</Button>
            <Button variant="contained" onClick={save} disabled={saving || !screens || !dirty}>Belegung speichern</Button>
          </>
        ) : (
          <Button onClick={onClose}>Schließen</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
