/**
 * Kassenbewegung buchen – ein Fenster je Vorgang (kein vorausgewählter Typ im Formular).
 * Zeitpunkt standardmäßig „jetzt“, nur bei Bedarf änderbar. Kann mit Betrag/Notiz vorbelegt werden
 * (z. B. „Bargeld zur Bank bringen“ nach dem Zählen).
 */
import React, { useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Link, Stack,
  TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AccountBalance, AddCircleOutline, ArrowDownward, ArrowUpward, RemoveCircleOutline } from '@mui/icons-material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../../services/api';
import { money, num } from '../../utils/format';
import { apiErrorMessage } from '../../utils/download';

export const MOVEMENT_ACTIONS = {
  DEPOSIT_TO_BANK: {
    label: 'Zur Bank gebracht', title: 'Bargeld zur Bank gebracht', Icon: ArrowUpward, BankIcon: AccountBalance, color: 'info',
    hint: 'Geld aus der Kasse auf das Bankkonto eingezahlt – die Kasse wird weniger, die Bank mehr.', bank: true, noteReq: false, sign: -1,
  },
  WITHDRAWAL_FROM_BANK: {
    label: 'Wechselgeld geholt', title: 'Wechselgeld von der Bank geholt', Icon: ArrowDownward, BankIcon: AccountBalance, color: 'primary',
    hint: 'Bargeld vom Konto abgehoben und in die Kasse gelegt – die Kasse wird mehr, die Bank weniger.', bank: true, noteReq: false, sign: 1,
  },
  OTHER_INCOME: {
    label: 'Einnahme', title: 'Sonstige Bareinnahme', Icon: AddCircleOutline, color: 'success',
    hint: 'Bargeld, das nicht über den Verkauf kommt, z. B. Spende, Pfand, Eintritt.', bank: false, noteReq: true, sign: 1,
  },
  OTHER_EXPENSE: {
    label: 'Ausgabe', title: 'Sonstige Barausgabe', Icon: RemoveCircleOutline, color: 'error',
    hint: 'Bar bezahlt ohne Lieferantenrechnung, z. B. Kleinmaterial. Einkäufe mit Beleg besser unter „Einkauf“ erfassen.', bank: false, noteReq: true, sign: -1,
  },
};

export default function MovementDialog({ type, open, onClose, preset }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const qc = useQueryClient();
  const meta = MOVEMENT_ACTIONS[type] || MOVEMENT_ACTIONS.DEPOSIT_TO_BANK;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [when, setWhen] = useState(null); // null = jetzt
  const [touched, setTouched] = useState(false);
  const [apiError, setApiError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setAmount(preset?.amount ? num(preset.amount).toFixed(2).replace('.', ',') : '');
    setNote(preset?.note || '');
    setBankAccount('');
    setWhen(null);
    setTouched(false);
    setApiError(null);
  }, [open, preset]);

  const { data: accountsData } = useQuery({
    queryKey: ['cash-movements', 'bank-accounts'],
    queryFn: async () => (await api.get('/cash-movements/bank-accounts')).data,
    staleTime: 60_000,
    enabled: open && meta.bank,
  });

  const value = Math.round(num(amount) * 100) / 100;
  const errors = {
    amount: value > 0 ? null : 'Betrag angeben, z. B. 50,00',
    note: meta.noteReq && note.trim().length < 3 ? 'Wofür? (mindestens 3 Zeichen)' : null,
  };
  const valid = !errors.amount && !errors.note;

  const save = useMutation({
    mutationFn: async () => (await api.post('/cash-movements', {
      type, amount: value, note: note.trim() || undefined,
      occurredAt: (when || new Date()).toISOString(),
      ...(meta.bank && bankAccount.trim() ? { bankAccount: bankAccount.trim() } : {}),
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-counts'] });
      qc.invalidateQueries({ queryKey: ['cash-movements'] });
      qc.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['bank-balances'] });
      onClose(true);
    },
    onError: async (err) => setApiError(await apiErrorMessage(err, 'Buchung fehlgeschlagen.')),
  });

  const submit = (e) => { e.preventDefault(); e.stopPropagation(); setTouched(true); if (valid) save.mutate(); };

  return (
    <Dialog open={open} onClose={() => onClose(false)} maxWidth="xs" fullWidth fullScreen={fullScreen}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }} PaperProps={{ component: 'form', onSubmit: submit, noValidate: true }}>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {meta.BankIcon && <meta.BankIcon color={meta.color} />}<meta.Icon color={meta.color} />
          <span>{meta.title}</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{meta.hint}</Typography>
        <Stack spacing={2}>
          <TextField label="Betrag" value={amount} autoFocus inputMode="decimal" placeholder="0,00"
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            error={touched && !!errors.amount} helperText={touched && errors.amount ? errors.amount : ' '}
            InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment>, sx: { fontSize: '1.25rem', fontWeight: 700 } }} />
          {meta.bank && (
            <Autocomplete freeSolo options={accountsData?.bankAccounts || []} value={bankAccount}
              onInputChange={(e, v) => setBankAccount(v)}
              renderInput={(params) => <TextField {...params} label="Bankkonto (optional)" />} />
          )}
          <TextField label={meta.noteReq ? 'Wofür?' : 'Notiz (optional)'} value={note} onChange={(e) => setNote(e.target.value)}
            error={touched && !!errors.note} helperText={touched && errors.note ? errors.note : ' '} />
          {when === null ? (
            <Typography variant="body2" color="text.secondary">
              Zeitpunkt: jetzt · <Link component="button" type="button" onClick={() => setWhen(new Date())}>ändern</Link>
            </Typography>
          ) : (
            <DateTimePicker label="Zeitpunkt" value={when} onChange={(d) => setWhen(d)} disableFuture slotProps={{ textField: { fullWidth: true } }} />
          )}
          {value > 0 && (
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="body2">
                Kasse {meta.sign < 0 ? '−' : '+'}{money(value)}
                {meta.bank && <> · Bank {meta.sign < 0 ? '+' : '−'}{money(value)}</>}
                {when && <> · {format(when, 'dd.MM.yyyy HH:mm')}</>}
              </Typography>
            </Box>
          )}
          {apiError && <Alert severity="error">{apiError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 } }}>
        <Button color="inherit" onClick={() => onClose(false)}>Abbrechen</Button>
        <Button type="submit" variant="contained" size="large" disabled={save.isPending}>{save.isPending ? 'Bucht…' : 'Buchen'}</Button>
      </DialogActions>
    </Dialog>
  );
}
