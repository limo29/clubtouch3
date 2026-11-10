/**
 * Guthaben aufladen: Schnellbeträge, Eingabe mit Komma, Vorschau des neuen Guthabens.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../config/api';
import { invalidate } from '../../utils/invalidate';
import { money, num } from '../../utils/format';

const QUICK = [5, 10, 20, 50];
const MAX = 500;

export default function TopUpDialog({ customer, open, onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (open) { setAmount(''); setMethod('CASH'); setReference(''); }
  }, [open]);

  const value = Math.round(num(amount) * 100) / 100;
  const valid = value >= 0.01 && value <= MAX;
  const balance = num(customer?.balance);

  const mutation = useMutation({
    mutationFn: async () => (await api.post(`${API_ENDPOINTS.CUSTOMERS}/${customer.id}/topup`, {
      amount: value, method, reference: reference.trim() || null,
    })).data,
    onSuccess: () => { invalidate(queryClient, 'customers', 'finance'); onClose(true); },
  });

  return (
    <Dialog open={open} onClose={() => onClose(false)} maxWidth="xs" fullWidth fullScreen={fullScreen}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
      // stopPropagation: der Dialog hängt im React-Baum im Kunden-Panel (selbst ein Formular) – sonst
      // würde das Absenden dort ankommen, die Kundendaten erneut speichern und das Panel schließen
      PaperProps={{ component: 'form', onSubmit: (e) => { e.preventDefault(); e.stopPropagation(); if (valid) mutation.mutate(); } }}>
      <DialogTitle sx={{ pb: 0.5 }}>
        Guthaben aufladen
        <Typography variant="body2" color="text.secondary">{customer?.name} · aktuell {money(balance)}</Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1.5 }}>
          <Stack direction="row" spacing={1}>
            {QUICK.map((q) => (
              <Chip key={q} label={`${q} €`} clickable onClick={() => setAmount(String(q))}
                color={value === q ? 'primary' : 'default'} variant={value === q ? 'filled' : 'outlined'}
                sx={{ flex: 1, fontWeight: 700, height: 40, fontSize: '1rem' }} />
            ))}
          </Stack>
          <TextField label="Betrag" value={amount} autoFocus inputMode="decimal" placeholder="0,00"
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            error={!!amount && !valid} helperText={amount && !valid ? `Zwischen 0,01 und ${MAX} €` : ' '}
            InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment>, sx: { fontSize: '1.25rem', fontWeight: 700 } }} />
          <ToggleButtonGroup exclusive fullWidth value={method} onChange={(e, v) => v && setMethod(v)} color="primary">
            <ToggleButton value="CASH" sx={{ fontWeight: 700 }}>Bar</ToggleButton>
            <ToggleButton value="TRANSFER" sx={{ fontWeight: 700 }}>Überweisung</ToggleButton>
          </ToggleButtonGroup>
          <TextField label="Bemerkung (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
          <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography color="text.secondary">Neues Guthaben</Typography>
            <Typography variant="h6" color={valid ? 'primary.main' : 'text.secondary'}>{money(balance + (valid ? value : 0))}</Typography>
          </Box>
          {mutation.isError && <Alert severity="error">{mutation.error?.response?.data?.error || mutation.error?.response?.data?.errors?.[0]?.msg || 'Aufladen fehlgeschlagen'}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 } }}>
        <Button color="inherit" onClick={() => onClose(false)}>Abbrechen</Button>
        <Button type="submit" variant="contained" size="large" disabled={!valid || mutation.isPending} sx={{ px: 3 }}>
          {mutation.isPending ? 'Bucht…' : valid ? `${money(value)} aufladen` : 'Aufladen'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
