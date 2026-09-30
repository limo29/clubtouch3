import React, { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, FormGroup, FormLabel, Slider, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import { VIEWS } from '../../hooks/useHighscoreLogic';
import { VIEW_LABELS } from './format';

/** Entwurf aus `display`, nur beim Öffnen initialisiert. */
function Body({ display, canEdit, saving, error, onSave, onClose }) {
  const [draft, setDraft] = useState(display);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleRotate = (v) => {
    const has = draft.rotateViews.includes(v);
    const next = has ? draft.rotateViews.filter((x) => x !== v) : VIEWS.filter((x) => x === v || draft.rotateViews.includes(x));
    if (next.length) set({ rotateViews: next });
  };

  return (
    <>
      <DialogTitle>Anzeige</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {!canEdit && <Alert severity="info">Nur Admin und Kasse können die Anzeige ändern.</Alert>}
          <Typography variant="body2" color="text.secondary">
            Gilt für alle Bildschirme (auch die öffentliche Anzeige), sofort nach dem Speichern.
          </Typography>
          <Box>
            <FormLabel component="legend">Ansicht</FormLabel>
            <ToggleButtonGroup exclusive size="small" value={draft.view} disabled={!canEdit}
              onChange={(_, v) => v && set({ view: v })} sx={{ mt: 1, flexWrap: 'wrap' }}>
              {['amount', 'count', 'teams', 'rotate'].map((v) => <ToggleButton key={v} value={v}>{VIEW_LABELS[v]}</ToggleButton>)}
            </ToggleButtonGroup>
          </Box>
          <Box>
            <FormLabel component="legend">Beim Wechseln zeigen</FormLabel>
            <FormGroup row>
              {VIEWS.map((v) => (
                <FormControlLabel key={v} disabled={!canEdit}
                  control={<Checkbox checked={draft.rotateViews.includes(v)} onChange={() => toggleRotate(v)} />}
                  label={VIEW_LABELS[v]} />
              ))}
            </FormGroup>
          </Box>
          <Box>
            <FormLabel component="legend">Wechsel alle {draft.rotateSeconds} Sekunden</FormLabel>
            <Slider value={draft.rotateSeconds} min={5} max={120} step={5} disabled={!canEdit}
              onChange={(_, v) => set({ rotateSeconds: v })} valueLabelDisplay="auto"
              aria-label="Wechseldauer in Sekunden" marks={[{ value: 15, label: '15 s' }, { value: 60, label: '60 s' }, { value: 120, label: '120 s' }]} />
          </Box>
          <Box>
            <FormLabel component="legend">Wertungen</FormLabel>
            <ToggleButtonGroup exclusive size="small" value={draft.board} disabled={!canEdit}
              onChange={(_, v) => v && set({ board: v })} sx={{ mt: 1 }}>
              <ToggleButton value="both">Tag und Jahr</ToggleButton>
              <ToggleButton value="day">Nur Tag</ToggleButton>
              <ToggleButton value="year">Nur Jahr</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <FormControlLabel disabled={!canEdit}
            control={<Switch checked={draft.ticker} onChange={(e) => set({ ticker: e.target.checked })} />}
            label="Laufband mit Meldungen anzeigen" />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{canEdit ? 'Abbrechen' : 'Schließen'}</Button>
        {canEdit && (
          <Button type="submit" variant="contained" disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
            onClick={(e) => { e.preventDefault(); onSave(draft); }}>
            Speichern
          </Button>
        )}
      </DialogActions>
    </>
  );
}

export default function DisplaySettingsDialog({ open, onClose, ...rest }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={() => !rest.saving && onClose()} maxWidth="sm" fullWidth fullScreen={fullScreen}
      PaperProps={{ component: 'form', onSubmit: (e) => e.preventDefault() }}>
      {/* Modal hängt den Inhalt nach dem Schließen aus → Entwurf wird beim Öffnen neu initialisiert */}
      <Body {...rest} onClose={onClose} />
    </Dialog>
  );
}
