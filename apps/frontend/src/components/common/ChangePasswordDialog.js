import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Alert, Stack,
  InputAdornment, IconButton, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useMutation } from '@tanstack/react-query';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../config/api';

export const PASSWORD_HINT = 'Mindestens 8 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl';
export const passwordProblem = (pw) => {
  if (!pw || pw.length < 8) return 'Mindestens 8 Zeichen';
  if (!/[a-z]/.test(pw)) return 'Ein Kleinbuchstabe fehlt';
  if (!/[A-Z]/.test(pw)) return 'Ein Großbuchstabe fehlt';
  if (!/\d/.test(pw)) return 'Eine Zahl fehlt';
  return null;
};

/** Fehlertext aus einer Axios-Antwort (inkl. express-validator-Details) */
export const apiError = (err, fallback) => {
  const d = err?.response?.data;
  if (!d) return err?.message || fallback;
  if (Array.isArray(d.details) && d.details.length) return d.details.map((x) => x.msg).join(' · ');
  return d.error || d.message || fallback;
};

/**
 * Eigenes Passwort ändern: altes Passwort, neues Passwort, Wiederholung.
 * Erfolg wird im Dialog selbst bestätigt und zusätzlich per onSuccess (Snackbar) gemeldet.
 */
export default function ChangePasswordDialog({ open, onClose, onSuccess }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(null);

  const mutation = useMutation({
    mutationFn: async (payload) => (await api.post(API_ENDPOINTS.CHANGE_PASSWORD, payload)).data,
    onSuccess: (data) => setDone(data),
  });

  const newProblem = passwordProblem(form.newPassword);
  const confirmProblem = form.confirm !== form.newPassword ? 'Die Wiederholung stimmt nicht überein' : null;
  const sameAsOld = form.currentPassword && form.currentPassword === form.newPassword ? 'Das neue Passwort muss sich vom alten unterscheiden' : null;
  const canSubmit = form.currentPassword && !newProblem && !confirmProblem && !sameAsOld && !mutation.isPending;

  const reset = () => {
    setForm({ currentPassword: '', newPassword: '', confirm: '' });
    setShow(false); setTouched(false); setDone(null); mutation.reset();
  };
  // Snackbar erst beim Schließen melden, sonst verdeckt sie am Handy die Dialog-Buttons
  const close = () => { const wasDone = done; reset(); onClose(); if (wasDone) onSuccess?.(wasDone); };
  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    mutation.mutate({ currentPassword: form.currentPassword, newPassword: form.newPassword });
  };
  const eye = (
    <InputAdornment position="end">
      <IconButton onClick={() => setShow((s) => !s)} edge="end" aria-label={show ? 'Passwörter verbergen' : 'Passwörter anzeigen'}>
        {show ? <VisibilityOff /> : <Visibility />}
      </IconButton>
    </InputAdornment>
  );

  return (
    <Dialog open={open} onClose={close} fullScreen={fullScreen} maxWidth="xs" fullWidth PaperProps={{ component: 'form', onSubmit: submit }}>
      <DialogTitle>Passwort ändern</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Alert severity="success" data-testid="pw-success">
            Dein Passwort wurde geändert. Ab jetzt gilt das neue Passwort.
            {done.closedSessions > 0 && ` ${done.closedSessions} andere Anmeldung${done.closedSessions === 1 ? ' wurde' : 'en wurden'} beendet.`}
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {mutation.isError && <Alert severity="error">{apiError(mutation.error, 'Passwort konnte nicht geändert werden')}</Alert>}
            <TextField
              label="Aktuelles Passwort" type={show ? 'text' : 'password'} autoComplete="current-password" autoFocus required fullWidth
              value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              InputProps={{ endAdornment: eye }}
            />
            <TextField
              label="Neues Passwort" type={show ? 'text' : 'password'} autoComplete="new-password" required fullWidth
              value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              error={touched && Boolean(newProblem || sameAsOld)}
              helperText={(touched && (newProblem || sameAsOld)) || PASSWORD_HINT}
            />
            <TextField
              label="Neues Passwort wiederholen" type={show ? 'text' : 'password'} autoComplete="new-password" required fullWidth
              value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              error={touched && Boolean(confirmProblem)}
              helperText={touched && confirmProblem ? confirmProblem : ' '}
            />
            <Typography variant="caption" color="text.secondary">
              Andere Geräte, auf denen du angemeldet bist, werden abgemeldet. Diese Anmeldung bleibt bestehen.
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {done ? (
          <Button variant="contained" onClick={close}>Schließen</Button>
        ) : (
          <>
            <Button onClick={close}>Abbrechen</Button>
            <Button type="submit" variant="contained" disabled={!canSubmit}>
              {mutation.isPending ? 'Speichere…' : 'Passwort ändern'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
