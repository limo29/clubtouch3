/**
 * Bank-Teil der Seite „Kasse & Bank“ (/cash-count):
 *  - useBankData: Bank-Soll jetzt, Kontostände (Anfangsstand + Abgleiche), letzter Jahresabschluss
 *  - BankStatusCard: Bank-Soll groß, letzter Abgleich, „Kontostand abgleichen“ (neben der Kassen-Karte)
 *  - BankDetails: Konten, Abgleiche mit Differenz, Herleitung des Bank-Solls für einen Zeitraum
 */
import React, { useState } from 'react';
import {
  Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Skeleton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { AccountBalance, DeleteOutline, FactCheck } from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../../services/api';
import BankReconciliation from './BankReconciliation';
import { fmtDate } from './FinanceBits';
import { money, num } from '../../utils/format';

const signed = (v) => (num(v) > 0.004 ? '+' : '') + money(v);

export function useBankData() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data: balances, isLoading: balLoading } = useQuery({
    queryKey: ['bank-balances'],
    queryFn: async () => (await api.get('/accounting/bank-balances')).data,
  });
  const { data: now } = useQuery({
    queryKey: ['bank-reconciliation', 'now', today],
    queryFn: async () => (await api.get('/accounting/bank-reconciliation', { params: { startDate: `${new Date().getFullYear()}-01-01`, endDate: today } })).data.bankReconciliation,
  });
  const { data: fyData } = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: async () => (await api.get('/accounting/fiscal-years')).data,
  });
  const lastClosed = (fyData?.fiscalYears || []).filter((f) => f.closed && f.report).sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
  const checks = balances?.checks || [];
  const opening = balances?.opening || null;
  const last = checks[0] || null;
  // Konten: letzter Abgleich, sonst Anfangsstand, sonst Jahresabschluss
  const accountsSource = last ? { label: `laut Abgleich vom ${fmtDate(last.date)}`, accounts: last.accounts }
    : opening ? { label: `laut Anfangsstand vom ${fmtDate(opening.date)}`, accounts: opening.accounts }
      : lastClosed ? { label: `laut Abschluss „${lastClosed.name}“`, accounts: lastClosed.report?.bankAccountsJson || [] } : null;
  return { now, checks, opening, last, lastClosed, accountsSource, knownAccounts: accountsSource?.accounts || [], balLoading };
}

export function BankStatusCard({ bank, canManage, onCheck }) {
  const { now, last } = bank;
  const sourceText = !now ? ' ' : now.openingSource === 'ANFANGSSTAND' ? `ab Anfangsstand vom ${fmtDate(now.openingBalance?.date)}`
    : now.openingSource === 'VORJAHRESABSCHLUSS' ? `ab Abschluss „${now.openingFiscalYear?.name}“`
      : 'ohne Anfangsstand – startet bei 0,00 €';
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <AccountBalance color="info" fontSize="small" />
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Bank-Soll laut App</Typography>
      </Stack>
      <Typography variant="h3" sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, fontSize: { xs: '2.4rem', md: '3rem' } }}>{now ? money(now.expected) : '…'}</Typography>
      <Typography variant="body2" color="text.secondary">{sourceText}</Typography>
      <Box sx={{ flex: 1, minHeight: 12 }} />
      {last && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="body2" color="text.secondary">Abgleich {fmtDate(last.date)}: Auszug {money(last.total)}</Typography>
          <Chip size="small" color={Math.abs(last.difference) < 0.005 ? 'success' : 'warning'} variant={Math.abs(last.difference) < 0.005 ? 'outlined' : 'filled'}
            label={Math.abs(last.difference) < 0.005 ? 'stimmt' : signed(last.difference)} />
        </Stack>
      )}
      {canManage && (
        <Button variant="outlined" color="info" size="large" startIcon={<FactCheck />} onClick={onCheck} sx={{ py: 1.25 }}>Kontostand abgleichen</Button>
      )}
    </Card>
  );
}

export default function BankDetails({ bank, canManage }) {
  const qc = useQueryClient();
  const { checks, opening, accountsSource, knownAccounts, balLoading } = bank;
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range, setRange] = useState({ from: format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'), to: today });
  const { data: recon, isLoading: reconLoading } = useQuery({
    queryKey: ['bank-reconciliation', range.from, range.to],
    queryFn: async () => (await api.get('/accounting/bank-reconciliation', { params: { startDate: range.from, endDate: range.to } })).data.bankReconciliation,
  });
  const { data: settings } = useQuery({
    queryKey: ['cash-counts', 'settings'],
    queryFn: async () => (await api.get('/cash-counts/settings')).data,
  });
  const [feeDraft, setFeeDraft] = useState(null);
  const fee = feeDraft ?? (settings ? String(settings.cardFeePercent || '').replace('.', ',') : '');
  const saveFee = useMutation({
    mutationFn: async () => (await api.put('/cash-counts/settings', { cardFeePercent: num(fee) })).data,
    onSuccess: () => { setFeeDraft(null); qc.invalidateQueries({ queryKey: ['cash-counts', 'settings'] }); qc.invalidateQueries({ queryKey: ['bank-reconciliation'] }); },
  });
  const [toDelete, setToDelete] = useState(null); // { id, opening, label }
  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/accounting/bank-balances/${id}`),
    onSuccess: () => { setToDelete(null); qc.invalidateQueries({ queryKey: ['bank-balances'] }); qc.invalidateQueries({ queryKey: ['bank-reconciliation'] }); },
  });

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr' }, gap: 2, alignItems: 'start' }}>
        {/* Konten */}
        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
            <Typography fontWeight={800} sx={{ flex: 1 }}>Konten</Typography>
            {accountsSource && <Typography variant="body2" color="text.secondary">{accountsSource.label}</Typography>}
          </Stack>
          {balLoading ? <Skeleton variant="rounded" height={80} /> : knownAccounts.length === 0 ? (
            <Typography color="text.secondary">Noch kein Kontostand erfasst.</Typography>
          ) : (
            <>
              {knownAccounts.map((a, i) => (
                <Stack key={i} direction="row" justifyContent="space-between" sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600} noWrap>{a.name || 'Konto'}</Typography>
                    {a.iban && <Typography variant="caption" color="text.secondary">{a.iban}</Typography>}
                  </Box>
                  <Typography fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(a.balance)}</Typography>
                </Stack>
              ))}
              <Stack direction="row" justifyContent="space-between" sx={{ pt: 1 }}>
                <Typography fontWeight={800}>Gesamt</Typography>
                <Typography fontWeight={800}>{money(knownAccounts.reduce((s, a) => s + num(a.balance), 0))}</Typography>
              </Stack>
            </>
          )}
        </Box>

        {/* Abgleiche */}
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Typography fontWeight={800} sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>Abgleiche mit dem Kontoauszug</Typography>
          {checks.length === 0 && !opening ? (
            <Typography color="text.secondary" sx={{ p: 2 }}>Noch keine Abgleiche.</Typography>
          ) : (
            <>
              {checks.map((c) => (
                <Stack key={c.id} direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.1, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight={700}>{fmtDate(c.date)}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>Auszug {money(c.total)} · Soll {money(c.expected)}{c.user?.name ? ` · ${c.user.name}` : ''}</Typography>
                  </Box>
                  <Chip size="small" color={Math.abs(c.difference) < 0.005 ? 'success' : 'warning'} variant={Math.abs(c.difference) < 0.005 ? 'outlined' : 'filled'}
                    label={Math.abs(c.difference) < 0.005 ? 'stimmt' : signed(c.difference)} />
                  {canManage && (
                    <Tooltip title="Abgleich löschen"><IconButton size="small" aria-label="Abgleich löschen" onClick={() => setToDelete({ id: c.id, opening: false, label: `Abgleich vom ${fmtDate(c.date)} (Auszug ${money(c.total)})` })}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                  )}
                </Stack>
              ))}
              {opening && (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight={700}>{fmtDate(opening.date)}</Typography>
                    <Typography variant="body2" color="text.secondary">Anfangsstand {money(opening.total)}{opening.user?.name ? ` · ${opening.user.name}` : ''}</Typography>
                  </Box>
                  <Chip size="small" variant="outlined" label="Start" />
                  {canManage && (
                    <Tooltip title="Anfangsstand löschen"><IconButton size="small" aria-label="Anfangsstand löschen" onClick={() => setToDelete({ id: opening.id, opening: true, label: `Anfangsstand vom ${fmtDate(opening.date)} (${money(opening.total)})` })}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                  )}
                </Stack>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* Herleitung Bank-Soll */}
      <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Typography fontWeight={800} sx={{ mb: 1.5 }}>So setzt sich das Bank-Soll zusammen</Typography>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
          <DatePicker label="Von" value={new Date(range.from)} onChange={(d) => d && setRange((r) => ({ ...r, from: format(d, 'yyyy-MM-dd') }))} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
          <DatePicker label="Bis" value={new Date(range.to)} onChange={(d) => d && setRange((r) => ({ ...r, to: format(d, 'yyyy-MM-dd') }))} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
        </Stack>
        <BankReconciliation data={recon} loading={reconLoading} />
      </Box>

      {/* SumUp-Gebühr */}
      <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Typography fontWeight={800}>Kartenzahlung (SumUp)</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          SumUp zahlt Kartenzahlungen abzüglich Gebühr aufs Konto aus. Mit dem Gebührensatz rechnet das Bank-Soll den ausgezahlten Betrag. Der Umsatz zählt voll.
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField size="small" label="Gebühr" value={fee} disabled={!canManage} inputMode="decimal" placeholder="1,39" sx={{ width: 140 }}
            onChange={(e) => setFeeDraft(e.target.value.replace(/[^0-9.,]/g, ''))}
            InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
          {canManage && (
            <Button variant="outlined" disabled={feeDraft === null || saveFee.isPending} onClick={() => saveFee.mutate()}>Speichern</Button>
          )}
        </Stack>
      </Box>

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{toDelete?.opening ? 'Anfangsstand löschen?' : 'Abgleich löschen?'}</DialogTitle>
        <DialogContent>
          <Typography>{toDelete?.label}</Typography>
          {toDelete?.opening && (
            <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
              Ohne Anfangsstand rechnet das Bank-Soll wieder ab dem letzten Jahresabschluss bzw. ab 0,00 €.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setToDelete(null)}>Abbrechen</Button>
          <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => remove.mutate(toDelete.id)}>Löschen</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
