/**
 * Kontostände laut Kontoauszug erfassen – zwei Modi:
 *  - mode="opening": Anfangsstände beim Start mit ClubTouch3 (Bargeld in der Kasse + je Bankkonto).
 *  - mode="check":   Abgleich unterm Jahr; zeigt live das Bank-Soll der App zum Stichtag und die Differenz.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, Stack,
  TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Add, DeleteOutline } from '@mui/icons-material';
import { DatePicker } from '../common/SafeDatePickers';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfDay, format, isToday } from 'date-fns';
import api from '../../services/api';
import { money, num } from '../../utils/format';
import { apiErrorMessage } from '../../utils/download';

const ymd = (d) => format(d, 'yyyy-MM-dd');
const blank = (name = '') => ({ name, iban: '', balance: '' });

export default function BankBalanceDialog({ open, mode = 'check', onClose, knownAccounts = [], cashHasBaseline = true }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const qc = useQueryClient();
  const opening = mode === 'opening';
  const [date, setDate] = useState(new Date());
  const [accounts, setAccounts] = useState([blank()]);
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [cashSaved, setCashSaved] = useState(false); // Kassen-Anfangsbestand schon gespeichert (Wiederholung nach Fehler)

  useEffect(() => {
    if (!open) return;
    setDate(new Date());
    setAccounts(knownAccounts.length ? knownAccounts.map((a) => ({ name: a.name || '', iban: a.iban || '', balance: '' })) : [blank('Girokonto')]);
    setCash('');
    setNote('');
    setError(null);
    setCashSaved(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nur Konten mit eingetragenem Stand zählen. Ein Konto mit Namen, aber ohne Stand, wird nicht als 0 € gespeichert.
  const filled = accounts.filter((a) => a.balance !== '');
  const missing = filled.length > 0 ? accounts.filter((a) => a.balance === '' && a.name.trim()) : [];
  const total = filled.reduce((s, a) => s + num(a.balance), 0);
  const stamp = useMemo(() => (date && isToday(date) ? new Date() : endOfDay(date || new Date())), [date]);

  // Abgleich: Bank-Soll der App zum gewählten Tag
  const { data: recon } = useQuery({
    queryKey: ['bank-reconciliation', 'check', date ? ymd(date) : ''],
    queryFn: async () => (await api.get('/accounting/bank-reconciliation', { params: { startDate: `${date.getFullYear()}-01-01`, endDate: ymd(date) } })).data.bankReconciliation,
    enabled: open && !opening && !!date,
  });
  const diff = recon ? Math.round((total - num(recon.expected)) * 100) / 100 : null;

  const save = useMutation({
    mutationFn: async () => {
      if (opening && cash !== '' && !cashHasBaseline && !cashSaved) {
        await api.post('/cash-counts', { isOpening: true, amount: num(cash), note: 'Anfangsbestand beim Start mit ClubTouch3' });
        setCashSaved(true);
        qc.invalidateQueries({ queryKey: ['cash-counts'] });
      }
      if (filled.length) {
        await api.post('/accounting/bank-balances', {
          isOpening: opening, date: stamp.toISOString(), note: note.trim() || undefined,
          accounts: filled.map((a) => ({ name: a.name.trim() || 'Konto', iban: a.iban.trim() || undefined, balance: num(a.balance) })),
        });
      }
    },
    onSuccess: () => {
      ['bank-balances', 'bank-reconciliation', 'cash-counts', 'cash-movements'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose(true);
    },
    onError: async (err) => {
      ['cash-counts', 'cash-movements'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setError(await apiErrorMessage(err, 'Speichern fehlgeschlagen.'));
    },
  });

  const nothing = (!filled.length && !(opening && cash !== '' && !cashHasBaseline && !cashSaved)) || missing.length > 0;
  const setAcc = (i, patch) => setAccounts((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <Dialog open={open} onClose={() => onClose(false)} maxWidth="sm" fullWidth fullScreen={fullScreen}
      PaperProps={{ component: 'form', noValidate: true, onSubmit: (e) => { e.preventDefault(); e.stopPropagation(); if (!nothing) save.mutate(); } }}>
      <DialogTitle sx={{ pb: 0.5 }}>{opening ? 'Anfangsstände erfassen' : 'Kontostand abgleichen'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {opening
            ? 'Einmalig beim Start mit ClubTouch3: Was liegt in der Kasse, was ist auf den Konten? Ab diesem Stand rechnen Kassen-Soll, Bank-Soll und Dashboard.'
            : 'Stand laut Kontoauszug eintragen. Die App vergleicht ihn mit dem, was nach den Buchungen in der App auf dem Konto sein müsste.'}
        </Typography>

        {opening && (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Kasse</Typography>
            {cashHasBaseline || cashSaved ? (
              <Alert severity="success" variant="outlined">Für die Kasse gibt es schon eine Zählung bzw. einen Anfangsbestand.</Alert>
            ) : (
              <TextField fullWidth label="Bargeld in der Kasse jetzt" value={cash} inputMode="decimal" placeholder="0,00"
                onChange={(e) => setCash(e.target.value.replace(/[^0-9.,]/g, ''))}
                helperText="Genauer: leer lassen und stattdessen „Kasse zählen“ – die erste Zählung wird zum Anfangsbestand."
                InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment> }} />
            )}
          </Box>
        )}

        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Bank</Typography>
        <DatePicker label="Stand am" value={date} onChange={(d) => setDate(d)} disableFuture
          slotProps={{ textField: { fullWidth: true, size: 'small', sx: { mt: 0.5, mb: 2 } } }} />
        <Stack spacing={1.5} divider={<Divider flexItem />}>
          {accounts.map((a, i) => (
            <Box key={i} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 120px 40px', sm: '1fr 1fr 130px 40px' }, gap: 1, alignItems: 'center' }}>
              <TextField size="small" label="Konto" value={a.name} onChange={(e) => setAcc(i, { name: e.target.value })} placeholder="Girokonto" />
              <TextField size="small" label="IBAN (optional)" value={a.iban} onChange={(e) => setAcc(i, { iban: e.target.value })}
                sx={{ display: { xs: 'none', sm: 'flex' } }} />
              <TextField size="small" label="Stand" value={a.balance} inputMode="decimal" placeholder="0,00"
                onChange={(e) => setAcc(i, { balance: e.target.value.replace(/[^0-9.,-]/g, '') })}
                InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment> }} />
              <IconButton aria-label="Konto entfernen" onClick={() => setAccounts((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [blank()]))}>
                <DeleteOutline />
              </IconButton>
            </Box>
          ))}
        </Stack>
        <Button startIcon={<Add />} onClick={() => setAccounts((l) => [...l, blank()])} sx={{ mt: 1 }}>Weiteres Konto</Button>

        {!opening && (
          <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Stand laut Auszug</Typography><Typography fontWeight={700}>{money(total)}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Soll laut App</Typography><Typography fontWeight={700}>{recon ? money(recon.expected) : '…'}</Typography></Stack>
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
              <Typography fontWeight={700}>Differenz</Typography>
              <Typography fontWeight={800} sx={{ color: diff === null || !filled.length ? 'text.disabled' : Math.abs(diff) < 0.005 ? 'success.main' : 'warning.main' }}>
                {diff === null || !filled.length ? '–' : `${diff > 0.004 ? '+' : ''}${money(diff)}`}
              </Typography>
            </Stack>
            {recon?.openingSource === 'KEIN_VORJAHR' && (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>Ohne Anfangsstand startet das Soll bei 0,00 € – die Differenz ist dann nicht aussagekräftig.</Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Differenzen entstehen durch alles, was nicht über die App läuft: Gebühren, Zinsen, Beiträge, Spenden.
            </Typography>
          </Box>
        )}
        {!opening && (
          <TextField fullWidth size="small" label="Notiz (optional)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ mt: 2 }} />
        )}
        {missing.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Für {missing.map((a) => `„${a.name.trim()}“`).join(', ')} fehlt der Stand. Bitte eintragen oder das Konto entfernen.
          </Alert>
        )}
        {cashSaved && <Alert severity="success" sx={{ mt: 2 }}>Der Kassen-Anfangsbestand ist gespeichert. Es fehlt nur noch die Bank.</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 } }}>
        <Button color="inherit" onClick={() => onClose(false)}>Abbrechen</Button>
        <Button type="submit" variant="contained" size="large" disabled={nothing || save.isPending}>{save.isPending ? 'Speichert…' : 'Speichern'}</Button>
      </DialogActions>
    </Dialog>
  );
}
