/**
 * Kassenzählung erfassen: 14 Nennwerte (Scheine/Münzen), live Ist/Soll/Differenz, Notiz, Speichern.
 * Genutzt auf /cash-count (Kasse-Tab) und im Schritt „Kasse" von CloseYearStepper, damit beim
 * Jahresabschluss direkt gezählt werden kann. Das Soll kommt aus /cash-counts/preview; Ist,
 * Soll und Differenz rechnet das Backend beim Speichern selbst (Zeitpunkt = jetzt).
 */
import React, { useMemo, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Button, TextField, Alert, Stack, Divider, useTheme, useMediaQuery,
} from '@mui/material';
import { Save } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { money, num } from '../../utils/format';
import { apiErrorMessage } from '../../utils/download';
import QuantityStepper from '../common/QuantityStepper';

export const CASH_COUNTS_QUERY_KEY = ['cash-counts'];

const BILLS = [200, 100, 50, 20, 10, 5];
const COINS = [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const ALL_DENOMS = [...BILLS, ...COINS];

const denomLabel = (d) => (d >= 1 ? `${d} €` : `${Math.round(d * 100)} ct`);
const emptyCounts = () => Object.fromEntries(ALL_DENOMS.map((d) => [String(d), 0]));
const roundCents = (v) => Math.round(num(v) * 100) / 100;

export const signed = (v) => (num(v) > 0 ? '+' : '') + money(v);
export const diffColor = (v) => (Math.abs(num(v)) < 0.005 ? 'success.main' : 'error.main');

/* ------------------------------ Stückelung ------------------------------ */

function DenomRow({ denom, count, onChange }) {
  const key = String(denom);
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
      <Typography sx={{ width: 56, fontWeight: 700, flexShrink: 0 }}>{denomLabel(denom)}</Typography>
      <QuantityStepper
        value={count}
        aria-label={denomLabel(denom)}
        showUnit={false}
        inputWidth={52}
        onDelta={(d) => onChange(key, Math.max(0, count + d))}
        onSet={(v) => onChange(key, v)}
      />
      <Typography sx={{ ml: 'auto', minWidth: 80, textAlign: 'right', color: count > 0 ? 'text.primary' : 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
        {money(count * denom)}
      </Typography>
    </Stack>
  );
}

function DenomGroup({ title, denoms, counts, onChange }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>{title}</Typography>
      <Divider sx={{ mb: 0.5 }} />
      {denoms.map((d) => (
        <DenomRow key={d} denom={d} count={counts[String(d)] || 0} onChange={onChange} />
      ))}
    </Box>
  );
}

export function TotalBox({ label, value, color = 'text.primary', big = false, small = false }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{label}</Typography>
      <Typography variant={big ? 'h4' : small ? 'h6' : 'h5'} sx={{ fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</Typography>
    </Box>
  );
}

/**
 * @param onSaved   (cashCount) => void, nach erfolgreichem Speichern (Formular ist dann schon geleert)
 * @param onCancel  optional; zeigt einen „Abbrechen"-Button
 * @param title     Überschrift der Karte
 * @param outlined  Karte als outlined (für den Einsatz in Dialogen)
 */
export default function CashCountForm({ onSaved, onCancel, title = 'Stückelung', outlined = false }) {
  const qc = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [counts, setCounts] = useState(emptyCounts);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const { data: preview } = useQuery({
    queryKey: [...CASH_COUNTS_QUERY_KEY, 'preview'],
    queryFn: async () => (await api.get('/cash-counts/preview')).data,
    staleTime: 0,
  });

  const countedTotal = useMemo(
    () => roundCents(ALL_DENOMS.reduce((s, d) => s + (counts[String(d)] || 0) * d, 0)),
    [counts]
  );
  const expectedTotal = num(preview?.expectedTotal);
  const difference = roundCents(countedTotal - expectedTotal);
  const pieces = ALL_DENOMS.reduce((s, d) => s + (counts[String(d)] || 0), 0);

  const setCount = (key, value) => setCounts((prev) => ({ ...prev, [key]: Math.max(0, Math.trunc(num(value))) }));

  const resetForm = () => {
    setCounts(emptyCounts());
    setNote('');
    setError(null);
  };

  const save = useMutation({
    mutationFn: async () => (await api.post('/cash-counts', { denominations: counts, note: note.trim() || undefined })).data,
    onSuccess: (data) => {
      resetForm();
      qc.invalidateQueries({ queryKey: CASH_COUNTS_QUERY_KEY });
      onSaved?.(data.cashCount);
    },
    onError: async (err) => setError(await apiErrorMessage(err, 'Zählung konnte nicht gespeichert werden.')),
  });

  return (
    <Card variant={outlined ? 'outlined' : 'elevation'}>
      <CardContent>
        <Typography variant="h6" gutterBottom>{title}</Typography>
        <Grid container spacing={{ xs: 2, sm: 4 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DenomGroup title="Scheine" denoms={BILLS} counts={counts} onChange={setCount} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <DenomGroup title="Münzen" denoms={COINS} counts={counts} onChange={setCount} />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TotalBox label="Ist gezählt" value={money(countedTotal)} big />
          <TotalBox label="Soll" value={preview ? money(expectedTotal) : '…'} />
          <TotalBox label="Differenz" value={preview ? signed(difference) : '…'} color={preview ? diffColor(difference) : 'text.disabled'} />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {pieces} Scheine/Münzen gezählt
        </Typography>

        <TextField
          label="Notiz (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          fullWidth
          multiline
          minRows={isMobile ? 2 : 1}
          sx={{ mb: 2 }}
        />

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
          {onCancel && <Button onClick={onCancel} disabled={save.isPending} sx={{ mr: { sm: 'auto' } }}>Abbrechen</Button>}
          <Button onClick={resetForm} disabled={save.isPending || pieces === 0}>Zurücksetzen</Button>
          <Button
            variant="contained"
            size="large"
            startIcon={<Save />}
            onClick={() => save.mutate()}
            disabled={save.isPending || !preview}
          >
            {save.isPending ? 'Speichert…' : 'Zählung speichern'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
