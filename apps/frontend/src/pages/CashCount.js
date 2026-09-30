/**
 * Kasse & Bank (Route /cash-count), zwei Tabs:
 *   Kasse (Standard): freie Kassenzählung als eigener Vorgang (jederzeit, nicht täglich) + Kassenbewegungen.
 *   Bank (?tab=bank): components/finance/BankOverview (Kontostände, Bank-Abstimmung, Bewegungen im Zeitraum).
 * Kasse-Tab:
 * Oben die Soll-Herleitung aus /cash-counts/preview, in der Mitte der Stückelungszähler
 * (14 Nennwerte), unten die bisherigen Zählungen. Das Backend rechnet Ist/Soll/Differenz
 * selbst; hier wird nur live vorgerechnet.
 */
import React, { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Table, TableBody, TableCell, TableHead, TableRow,
  Button, TextField, Alert, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton, Chip, Skeleton, Tooltip, useTheme, useMediaQuery,
  ToggleButtonGroup, ToggleButton, Autocomplete, Snackbar, Tabs, Tab,
} from '@mui/material';
import {
  Save, PictureAsPdf, Refresh, PointOfSale,
  AccountBalance, ArrowUpward, ArrowDownward, AddCircleOutline, RemoveCircleOutline, Undo,
} from '@mui/icons-material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { money, num } from '../utils/format';
import { downloadFile, apiErrorMessage } from '../utils/download';
import { useAuth } from '../context/AuthContext';
import CashMovementList from '../components/finance/CashMovementList';
import BankOverview from '../components/finance/BankOverview';
import CashCountForm, { CASH_COUNTS_QUERY_KEY, TotalBox, signed, diffColor } from '../components/finance/CashCountForm';

export { CASH_COUNTS_QUERY_KEY };

const fmtDateTime = (iso) => (iso ? format(new Date(iso), 'dd.MM.yyyy HH:mm') : '—');
const fmtDate = (iso) => (iso ? format(new Date(iso), 'dd.MM.yyyy') : '—');

/* ------------------------------ Soll-Herleitung ------------------------------ */

function ExpectedTable({ preview, isLoading, error }) {
  if (isLoading) return <Skeleton variant="rounded" height={180} />;
  if (error) return <Alert severity="error">Soll konnte nicht geladen werden.</Alert>;
  if (!preview) return null;
  const c = preview.counts || {};
  const bd = preview.bankDeposits || {};
  const bw = preview.bankWithdrawals || {};
  const oi = preview.otherIncome || {};
  const oe = preview.otherExpense || {};
  const ci = preview.cashInvoices || {};
  const rows = [
    preview.hasBaseline
      ? { label: `Vorzählung vom ${fmtDateTime(preview.previousCount?.countedAt)}`, value: preview.baseline }
      : { label: 'Anfangsbestand (keine Vorzählung)', value: 0 },
    { label: `+ Bar-Verkäufe (${c.sales ?? 0})`, value: preview.cashSales },
    { label: `+ Stornos bar (${c.refunds ?? 0})`, value: preview.cashRefunds },
    { label: `+ Bar-Aufladungen (${c.topUps ?? 0})`, value: preview.cashTopUps },
    { label: `− Bar-Ausgaben (${c.expenses ?? 0})`, value: num(preview.cashExpenses) > 0 ? -num(preview.cashExpenses) : 0 },
    { label: `+ Bar bezahlte Kundenrechnungen (${ci.count ?? 0})`, value: num(ci.total) },
    { label: `− Einzahlungen auf Bank (${bd.count ?? 0})`, value: num(bd.total) > 0 ? -num(bd.total) : 0 },
    { label: `+ Abhebungen von Bank (${bw.count ?? 0})`, value: num(bw.total) },
    { label: `+ Sonstige Bareinnahmen (${oi.count ?? 0})`, value: num(oi.total) },
    { label: `− Sonstige Barausgaben (${oe.count ?? 0})`, value: num(oe.total) > 0 ? -num(oe.total) : 0 },
  ];
  return (
    <>
      {!preview.hasBaseline && (
        <Alert severity="info" sx={{ mb: 2 }}>Erste Zählung: Soll ohne Anfangsbestand.</Alert>
      )}
      <Table size="small">
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell sx={{ border: 0, py: 0.75 }}>{r.label}</TableCell>
              <TableCell align="right" sx={{ border: 0, py: 0.75, whiteSpace: 'nowrap' }}>{money(r.value)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell sx={{ borderTop: '2px solid', borderColor: 'divider', fontWeight: 800 }}>= Soll</TableCell>
            <TableCell align="right" sx={{ borderTop: '2px solid', borderColor: 'divider', fontWeight: 800, whiteSpace: 'nowrap' }}>
              {money(preview.expectedTotal)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {preview.since && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Zeitraum: {fmtDateTime(preview.since)} bis jetzt
        </Typography>
      )}
    </>
  );
}

/* ------------------------------ Kassenbewegung ------------------------------ */

const MOVEMENT_TYPES = [
  { value: 'DEPOSIT_TO_BANK',      label: 'Einzahlung auf Bank', short: 'Einzahlung', icon: <AccountBalance />, subIcon: <ArrowUpward />,    bank: true,  noteReq: false },
  { value: 'WITHDRAWAL_FROM_BANK', label: 'Abhebung von Bank',   short: 'Abhebung',   icon: <AccountBalance />, subIcon: <ArrowDownward />,  bank: true,  noteReq: false },
  { value: 'OTHER_INCOME',         label: 'Sonstige Einnahme',   short: 'Einnahme',   icon: <AddCircleOutline />, subIcon: null,             bank: false, noteReq: true  },
  { value: 'OTHER_EXPENSE',        label: 'Sonstige Ausgabe',    short: 'Ausgabe',    icon: <RemoveCircleOutline />, subIcon: null,           bank: false, noteReq: true  },
];

const emptyForm = () => ({ type: 'DEPOSIT_TO_BANK', amountStr: '', occurredAt: new Date(), bankAccount: '', note: '' });

function CashMovementForm({ onSuccess }) {
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState({});
  const [apiError, setApiError] = useState(null);
  const [snack, setSnack] = useState(false);
  const qc = useQueryClient();

  const typeMeta = MOVEMENT_TYPES.find((t) => t.value === form.type) || MOVEMENT_TYPES[0];

  const { data: bankAccountsData } = useQuery({
    queryKey: ['cash-movements', 'bank-accounts'],
    queryFn: async () => (await api.get('/cash-movements/bank-accounts')).data,
    staleTime: 60 * 1000,
  });
  const bankAccountOptions = bankAccountsData?.bankAccounts || [];

  const validate = () => {
    const errs = {};
    const amt = num(form.amountStr.replace(',', '.'));
    if (!amt || amt <= 0) errs.amountStr = 'Betrag muss größer 0 sein.';
    if (typeMeta.noteReq && form.note.trim().length < 3) errs.note = 'Pflicht bei sonstigen Einnahmen/Ausgaben – wofür? (mind. 3 Zeichen)';
    return errs;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const errs = validate();
      if (Object.keys(errs).length > 0) { setFormError(errs); throw new Error('Validierungsfehler'); }
      setFormError({});
      const payload = {
        type: form.type,
        amount: num(form.amountStr.replace(',', '.')),
        note: form.note.trim() || undefined,
        occurredAt: form.occurredAt ? form.occurredAt.toISOString() : undefined,
      };
      if (typeMeta.bank && form.bankAccount.trim()) payload.bankAccount = form.bankAccount.trim();
      return (await api.post('/cash-movements', payload)).data;
    },
    onSuccess: () => {
      setApiError(null);
      setForm(emptyForm());
      setFormError({});
      setSnack(true);
      qc.invalidateQueries({ queryKey: ['cash-counts'] });
      qc.invalidateQueries({ queryKey: ['cash-movements'] });
      if (onSuccess) onSuccess();
    },
    onError: async (err) => {
      if (err.message !== 'Validierungsfehler') {
        setApiError(await apiErrorMessage(err, 'Kassenbewegung konnte nicht gebucht werden.'));
      }
    },
  });

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Kassenbewegung buchen</Typography>

        {apiError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setApiError(null)}>{apiError}</Alert>}

        {/* Typ-Auswahl */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Typ</Typography>
        <ToggleButtonGroup
          exclusive
          value={form.type}
          onChange={(e, v) => { if (v) setForm((f) => ({ ...f, type: v, bankAccount: '', note: '' })); }}
          sx={{ flexWrap: 'wrap', gap: 0.5, mb: 2 }}
        >
          {MOVEMENT_TYPES.map((t) => (
            <ToggleButton key={t.value} value={t.value} size="small" sx={{ gap: 0.5, fontSize: '0.8rem', lineHeight: 1.2, px: 1.5, py: 1 }}>
              {t.icon}{t.subIcon}
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t.label}</Box>
              <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{t.short}</Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Grid container spacing={2}>
          {/* Betrag */}
          <Grid size={{ xs: 12, md: 6, lg: 12 }}>
            <TextField
              label="Betrag"
              value={form.amountStr}
              onChange={(e) => setForm((f) => ({ ...f, amountStr: e.target.value }))}
              inputProps={{ inputMode: 'decimal' }}
              slotProps={{ input: { endAdornment: <Typography color="text.secondary">€</Typography> } }}
              fullWidth
              error={!!formError.amountStr}
              helperText={formError.amountStr || ' '}
            />
          </Grid>

          {/* Datum/Uhrzeit */}
          <Grid size={{ xs: 12, md: 6, lg: 12 }}>
            <DateTimePicker
              label="Datum/Uhrzeit"
              value={form.occurredAt}
              onChange={(d) => setForm((f) => ({ ...f, occurredAt: d }))}
              disableFuture
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Grid>

          {/* Konto (nur Bank-Typen) */}
          {typeMeta.bank && (
            <Grid size={{ xs: 12, md: 6, lg: 12 }}>
              <Autocomplete
                freeSolo
                options={bankAccountOptions}
                value={form.bankAccount}
                onInputChange={(e, v) => setForm((f) => ({ ...f, bankAccount: v }))}
                renderInput={(params) => (
                  <TextField {...params} label="Bankkonto (optional)" fullWidth />
                )}
              />
            </Grid>
          )}

          {/* Notiz */}
          <Grid size={{ xs: 12 }}>
            <TextField
              label={typeMeta.noteReq ? 'Notiz (Pflicht)' : 'Notiz (optional)'}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              fullWidth
              required={typeMeta.noteReq}
              error={!!formError.note}
              helperText={formError.note || (typeMeta.noteReq ? 'Pflicht bei sonstigen Einnahmen/Ausgaben – wofür?' : ' ')}
            />
          </Grid>
        </Grid>

        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button
            variant="contained"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            startIcon={<Save />}
          >
            {mutation.isPending ? 'Bucht…' : 'Buchen'}
          </Button>
        </Stack>

        <Snackbar
          open={snack}
          autoHideDuration={3500}
          onClose={() => setSnack(false)}
          message="Kassenbewegung gebucht"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Storno-Dialog ------------------------------ */

function CancelMovementDialog({ movement, open, onClose, onConfirm, loading }) {
  if (!movement) return null;
  const meta = MOVEMENT_TYPES.find((t) => t.value === movement.type) || {};
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Kassenbewegung stornieren?</DialogTitle>
      <DialogContent>
        <Typography>
          {meta.label || movement.type}: <strong>{money(movement.amount)}</strong>
          {movement.note ? ` – ${movement.note}` : ''}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Die Buchung wird als storniert markiert und fließt nicht mehr in die Soll-Herleitung ein.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Abbrechen</Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={loading} startIcon={<Undo />}>
          {loading ? 'Storniert…' : 'Stornieren'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* --------------------------------- Seite --------------------------------- */

export default function CashCount() {
  const qc = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { isAdmin, isAccountant } = useAuth();
  const canCancel = isAdmin || isAccountant;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'bank' ? 'bank' : 'kasse';
  const setTab = (v) => setSearchParams(v === 'bank' ? { tab: 'bank' } : {}, { replace: true });

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const { data: preview, isLoading: previewLoading, error: previewError, refetch: refetchPreview, isFetching } = useQuery({
    queryKey: [...CASH_COUNTS_QUERY_KEY, 'preview'],
    queryFn: async () => (await api.get('/cash-counts/preview')).data,
    staleTime: 0,
  });

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: [...CASH_COUNTS_QUERY_KEY, 'list'],
    queryFn: async () => (await api.get('/cash-counts', { params: { limit: 50 } })).data,
  });
  const cashCounts = listData?.cashCounts || [];

  const { data: movementsData, isLoading: movementsLoading } = useQuery({
    queryKey: ['cash-movements', 'recent'],
    queryFn: async () => (await api.get('/cash-movements', { params: { limit: 50 } })).data,
    staleTime: 0,
  });
  const movements = movementsData?.cashMovements || [];

  const cancelMovement = useMutation({
    mutationFn: async (id) => (await api.post(`/cash-movements/${id}/cancel`)).data,
    onSuccess: () => {
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ['cash-movements'] });
      qc.invalidateQueries({ queryKey: CASH_COUNTS_QUERY_KEY });
    },
    onError: async (err) => setError(await apiErrorMessage(err, 'Storno fehlgeschlagen.')),
  });

  const resetForm = () => setResult(null);

  const downloadPdf = async (cc) => {
    try {
      await downloadFile(`/cash-counts/${cc.id}/pdf`, { filename: `Kassenzaehlung_${format(new Date(cc.countedAt), 'yyyy-MM-dd_HHmm')}.pdf` });
    } catch (err) {
      setError(await apiErrorMessage(err, 'PDF konnte nicht geladen werden.'));
    }
  };

  return (
    <Box>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: { xs: 2, md: 3 }, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="kasse" label="Kasse" icon={<PointOfSale />} iconPosition="start" sx={{ minHeight: 48 }} />
        <Tab value="bank" label="Bank" icon={<AccountBalance />} iconPosition="start" sx={{ minHeight: 48 }} />
      </Tabs>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {tab === 'bank' ? <BankOverview /> : (
      <Grid container spacing={{ xs: 2, md: 3 }}>
        {/* Soll-Herleitung + Kassenbewegung buchen (linke Spalte) */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={{ xs: 2, md: 3 }}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="h6">Soll-Herleitung</Typography>
                <Tooltip title="Soll neu berechnen">
                  <span>
                    <IconButton size="small" onClick={() => refetchPreview()} disabled={isFetching} aria-label="Soll neu berechnen"><Refresh /></IconButton>
                  </span>
                </Tooltip>
              </Stack>
              <ExpectedTable preview={preview} isLoading={previewLoading} error={previewError} />
              {preview?.expenseDocs?.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>Bar bezahlte Eingangsrechnungen</Typography>
                  <Table size="small">
                    <TableBody>
                      {preview.expenseDocs.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell sx={{ border: 0, py: 0.5 }}>{fmtDate(d.paidAt || d.documentDate)} · {d.supplier || d.documentNumber || 'Beleg'}</TableCell>
                          <TableCell align="right" sx={{ border: 0, py: 0.5, whiteSpace: 'nowrap' }}>{money(d.totalAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </CardContent>
          </Card>
          <CashMovementForm />
          </Stack>
        </Grid>

        {/* Stückelung */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <CashCountForm onSaved={setResult} />
        </Grid>

        {/* Kassenbewegungen Liste */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Kassenbewegungen (letzte 50)</Typography>
              <CashMovementList
                movements={movements}
                loading={movementsLoading}
                onCancel={canCancel ? (m) => setCancelTarget(m) : undefined}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Bisherige Zählungen */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Bisherige Zählungen</Typography>
              {listLoading ? (
                <Skeleton variant="rounded" height={120} />
              ) : cashCounts.length === 0 ? (
                <Typography color="text.secondary">Noch keine Zählung gespeichert.</Typography>
              ) : isMobile ? (
                <Stack spacing={1.5}>
                  {cashCounts.map((cc) => (
                    <Card key={cc.id} variant="outlined">
                      <CardContent sx={{ '&:last-child': { pb: 1.5 } }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography fontWeight={700}>{fmtDateTime(cc.countedAt)}</Typography>
                          <IconButton size="small" onClick={() => downloadPdf(cc)} aria-label="PDF herunterladen"><PictureAsPdf /></IconButton>
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{cc.user?.name || '—'}</Typography>
                        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                          <TotalBox small label="Soll" value={money(cc.expectedTotal)} />
                          <TotalBox small label="Ist" value={money(cc.countedTotal)} />
                          <TotalBox small label="Differenz" value={signed(cc.difference)} color={diffColor(cc.difference)} />
                        </Stack>
                        {cc.note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{cc.note}</Typography>}
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Datum</TableCell>
                      <TableCell>Gezählt von</TableCell>
                      <TableCell align="right">Soll</TableCell>
                      <TableCell align="right">Ist</TableCell>
                      <TableCell align="right">Differenz</TableCell>
                      <TableCell>Notiz</TableCell>
                      <TableCell align="right">PDF</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cashCounts.map((cc) => (
                      <TableRow key={cc.id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDateTime(cc.countedAt)}</TableCell>
                        <TableCell>{cc.user?.name || '—'}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{money(cc.expectedTotal)}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{money(cc.countedTotal)}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: diffColor(cc.difference), fontWeight: 700 }}>{signed(cc.difference)}</TableCell>
                        <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cc.note || ''}</TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={() => downloadPdf(cc)} aria-label="PDF herunterladen"><PictureAsPdf /></IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      )}

      {/* Storno-Dialog */}
      <CancelMovementDialog
        movement={cancelTarget}
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => cancelMovement.mutate(cancelTarget.id)}
        loading={cancelMovement.isPending}
      />

      {/* Ergebnisdialog */}
      <Dialog open={!!result} onClose={resetForm} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><PointOfSale /> Zählung gespeichert</DialogTitle>
        <DialogContent>
          {result && (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">{fmtDateTime(result.countedAt)} · {result.user?.name}</Typography>
              <Stack direction="row" spacing={2}>
                <TotalBox label="Soll" value={money(result.expectedTotal)} />
                <TotalBox label="Ist" value={money(result.countedTotal)} />
              </Stack>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>Differenz</Typography>
                <Typography variant="h3" sx={{ fontWeight: 900, color: diffColor(result.difference) }}>{signed(result.difference)}</Typography>
                <Chip
                  size="small"
                  sx={{ mt: 1 }}
                  color={Math.abs(num(result.difference)) < 0.005 ? 'success' : 'error'}
                  label={Math.abs(num(result.difference)) < 0.005 ? 'Kasse stimmt' : num(result.difference) > 0 ? 'Überschuss' : 'Fehlbetrag'}
                />
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button startIcon={<PictureAsPdf />} onClick={() => result && downloadPdf(result)}>PDF</Button>
          <Button variant="contained" onClick={resetForm}>Neue Zählung</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
