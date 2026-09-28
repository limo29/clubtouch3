/**
 * Kassenprüfung (Route /profit-loss): drei Abschnitte als Tabs
 *   EÜR (frei wählbarer Zeitraum, PDF) · Kasse & Bank (letzte Zählung, Konten laut letztem Abschluss)
 *   · Geschäftsjahre (Liste, Anlegen, Abschluss-Stepper).
 * Zahlen kommen ausschließlich aus /accounting/profit-loss (eine Service-Funktion im Backend).
 */
import React, { useMemo, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Button, TextField, Alert, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, Stack, Tabs, Tab, Skeleton, useTheme, useMediaQuery,
} from '@mui/material';
import {
  Download, TrendingUp, TrendingDown, AccountBalance, Add, PointOfSale, PictureAsPdf, Lock,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../services/api';
import KPICard from '../components/common/KPICard';
import CloseYearStepper from '../components/finance/CloseYearStepper';
import { money, num } from '../utils/format';
import { downloadFile, apiErrorMessage } from '../utils/download';

const fmtDate = (d) => (d ? format(new Date(d), 'dd.MM.yyyy') : '—');
const fmtDateTime = (d) => (d ? format(new Date(d), 'dd.MM.yyyy HH:mm') : '—');
const signedMoney = (v) => (num(v) > 0 ? '+' : '') + money(v);
const TABS = ['eur', 'kasse', 'jahre'];

/* ------------------------------ kleine Bausteine ------------------------------ */

function SectionCard({ title, action, children, sx }) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6">{title}</Typography>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, sub, color = 'text.primary', dense = false }) {
  return (
    <Paper sx={{ p: 2, height: '100%', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, display: 'block', overflowWrap: 'anywhere' }}>{label}</Typography>
      <Typography variant={dense ? 'h6' : 'h5'} sx={{ fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

function SimpleTable({ head, rows, empty = 'Keine Einträge', footer, maxHeight = 300 }) {
  return (
    <TableContainer sx={{ maxHeight }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>{head.map((h, i) => <TableCell key={i} align={i === 0 ? 'left' : 'right'}>{h}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={head.length} sx={{ color: 'text.secondary' }}>{empty}</TableCell></TableRow>
          ) : rows.map((r, ri) => (
            <TableRow key={ri}>
              {r.map((c, ci) => <TableCell key={ci} align={ci === 0 ? 'left' : 'right'} sx={{ whiteSpace: ci === 0 ? 'normal' : 'nowrap' }}>{c}</TableCell>)}
            </TableRow>
          ))}
          {footer && (
            <TableRow>
              {footer.map((c, ci) => <TableCell key={ci} align={ci === 0 ? 'left' : 'right'} sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{c}</TableCell>)}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ---------------------------------- EÜR ---------------------------------- */

function EurSection() {
  const theme = useTheme();
  const [dateRange, setDateRange] = useState({ startDate: new Date(new Date().getFullYear(), 0, 1), endDate: new Date() });
  const [downloadError, setDownloadError] = useState(null);
  const params = {
    startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
    endDate: format(dateRange.endDate, 'yyyy-MM-dd'),
  };

  const { data, error, isLoading } = useQuery({
    queryKey: ['profit-loss', params.startDate, params.endDate],
    queryFn: async () => (await api.get('/accounting/profit-loss', { params })).data,
    enabled: !!dateRange.startDate && !!dateRange.endDate,
  });

  const summary = data?.summary || {};
  const profit = num(summary.profit);
  const details = data?.details || {};
  const incomeByType = details.incomeByType || {};
  const nonRevenue = data?.nonRevenue || {};
  const liquidity = data?.liquidity || {};
  const unpaidPurchase = data?.liabilities?.unpaidPurchaseDocuments || {};
  const unpaidInvoices = data?.receivables?.unpaidInvoices || {};

  const top10 = useMemo(
    () => (details.incomeByArticle || []).slice(0, 10).map((a) => ({ name: a.article || a.name || '—', Einnahmen: num(a.amount) })),
    [details.incomeByArticle]
  );

  const downloadEUR = async () => {
    try {
      setDownloadError(null);
      await downloadFile('/exports/eur', { params, filename: `EUR_${params.startDate}_${params.endDate}.pdf` });
    } catch (err) {
      setDownloadError(await apiErrorMessage(err, 'PDF konnte nicht erstellt werden.'));
    }
  };

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <DatePicker label="Von" value={dateRange.startDate} onChange={(d) => d && setDateRange((r) => ({ ...r, startDate: d }))} slotProps={{ textField: { size: 'small' } }} />
          <DatePicker label="Bis" value={dateRange.endDate} onChange={(d) => d && setDateRange((r) => ({ ...r, endDate: d }))} slotProps={{ textField: { size: 'small' } }} />
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<Download />} onClick={downloadEUR}>PDF Export</Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error">Fehler beim Laden der EÜR{error?.response?.data?.error ? `: ${error.response.data.error}` : '.'}</Alert>}
      {downloadError && <Alert severity="error" onClose={() => setDownloadError(null)}>{downloadError}</Alert>}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <KPICard title="Einnahmen" value={money(summary.totalIncome)} icon={TrendingUp} color="success" loading={isLoading} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <KPICard title="Ausgaben" value={money(summary.totalExpenses)} icon={TrendingDown} color="error" loading={isLoading} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <KPICard title={profit >= 0 ? 'Überschuss' : 'Verlust'} value={signedMoney(profit)} icon={AccountBalance} color={profit >= 0 ? 'success' : 'error'} loading={isLoading} />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 4 }}>
          <SectionCard title="Einnahmen nach Typ">
            <SimpleTable
              head={['Typ', 'Betrag']}
              rows={[
                [`Barverkäufe (${details.transactionCounts?.cash ?? 0})`, money(incomeByType.cash)],
                [`Kundenkonto (${details.transactionCounts?.account ?? 0})`, money(incomeByType.account)],
                ['Bezahlte Ausgangsrechnungen', money(incomeByType.invoices)],
              ]}
              footer={['Gesamt', money(summary.totalIncome)]}
            />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <SectionCard title="Einnahmen nach Kategorie">
            <SimpleTable
              head={['Kategorie', 'Betrag']}
              rows={(details.incomeByCategory || []).map((c) => [c.category || '—', money(c.amount)])}
              footer={['Gesamt', money(incomeByType.transactions)]}
            />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <SectionCard title="Ausgaben nach Lieferant">
            <SimpleTable
              head={['Lieferant', 'Belege', 'Betrag']}
              rows={(details.expensesBySupplier || []).map((s) => [s.supplier || '—', num(s.count), money(s.amount)])}
              footer={['Gesamt', '', money(summary.totalExpenses)]}
            />
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Einnahmen nach Artikel (Top 10)">
            {top10.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Keine Artikeldaten im Zeitraum.</Typography>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, top10.length * 36 + 30)}>
                <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: theme.palette.text.secondary }} tickFormatter={(v) => money(v)} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: theme.palette.text.primary }} interval={0} />
                  <Tooltip
                    formatter={(v) => money(v)}
                    cursor={{ fill: theme.palette.action.hover }}
                    contentStyle={{ backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary, borderRadius: 8, border: `1px solid ${theme.palette.divider}` }}
                    itemStyle={{ color: theme.palette.text.primary }}
                  />
                  <Bar dataKey="Einnahmen" fill={theme.palette.primary.main} radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Nachrichtlich (kein Ertrag)">
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Eigenverbrauch („Auf den Wirt") und Schwund mindern den Bestand, sind aber keine Einnahme. Bewertung zum Verkaufspreis.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" gutterBottom>Eigenverbrauch · {money(nonRevenue.ownerUse?.value)}</Typography>
                <SimpleTable head={['Artikel', 'Menge', 'Wert']} rows={(nonRevenue.ownerUse?.items || []).map((r) => [r.article, num(r.quantity), money(r.value ?? r.amount)])} maxHeight={220} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" gutterBottom>Abgelaufen / Schwund · {money(nonRevenue.expired?.value)}</Typography>
                <SimpleTable head={['Artikel', 'Menge', 'Wert']} rows={(nonRevenue.expired?.items || []).map((r) => [r.article, num(r.quantity), money(r.value ?? r.amount)])} maxHeight={220} />
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Typography variant="h6" sx={{ mt: 1 }}>Liquidität & offene Posten</Typography>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MiniStat label="Aufladungen" value={money(liquidity.topUps?.total)} sub={`${liquidity.topUps?.count ?? 0} Vorgänge · bar ${money(liquidity.topUps?.cash)} · Überweisung ${money(liquidity.topUps?.transfer)}`} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MiniStat label="Gästeguthaben" value={money(liquidity.guestBalanceEnd)} sub="Stand Ende des Zeitraums (Verbindlichkeit)" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MiniStat label="Offene Eingangsrechnungen" value={money(unpaidPurchase.total)} sub={`${unpaidPurchase.count ?? 0} Belege (Verbindlichkeit)`} color={num(unpaidPurchase.total) > 0 ? 'error.main' : 'text.primary'} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MiniStat label="Offene Ausgangsrechnungen" value={money(unpaidInvoices.total)} sub={`${unpaidInvoices.count ?? 0} Rechnungen (Forderung)`} color={num(unpaidInvoices.total) > 0 ? 'warning.main' : 'text.primary'} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="Offene Eingangsrechnungen">
            <SimpleTable
              head={['Beleg', 'Datum', 'Betrag']}
              rows={(unpaidPurchase.items || []).map((d) => [`${d.supplier || '—'}${d.documentNumber ? ` · ${d.documentNumber}` : ''}`, fmtDate(d.documentDate), money(d.totalAmount)])}
              empty="Keine offenen Eingangsrechnungen"
            />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="Offene Ausgangsrechnungen">
            <SimpleTable
              head={['Rechnung', 'Fällig', 'Betrag']}
              rows={(unpaidInvoices.items || []).map((d) => [`${d.customerName || '—'}${d.invoiceNumber ? ` · ${d.invoiceNumber}` : ''}`, fmtDate(d.dueDate), money(d.totalAmount)])}
              empty="Keine offenen Ausgangsrechnungen"
            />
          </SectionCard>
        </Grid>
      </Grid>
    </Stack>
  );
}

/* ------------------------------- Kasse & Bank ------------------------------- */

function CashBankSection({ fiscalYears }) {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['cash-counts', 'latest'],
    queryFn: async () => (await api.get('/cash-counts/latest')).data,
  });
  const cc = data?.cashCount;
  const lastClosed = (fiscalYears || []).filter((f) => f.closed && f.report).sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
  const banks = lastClosed?.report?.bankAccountsJson || [];

  const pdf = async () => {
    try { await downloadFile(`/cash-counts/${cc.id}/pdf`, { filename: 'Kassenzaehlung.pdf' }); }
    catch (err) { setError(await apiErrorMessage(err, 'PDF konnte nicht geladen werden.')); }
  };

  return (
    <Grid container spacing={3}>
      {error && <Grid size={{ xs: 12 }}><Alert severity="error" onClose={() => setError(null)}>{error}</Alert></Grid>}
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard
          title="Letzte Kassenzählung"
          action={<Button variant="contained" size="small" startIcon={<PointOfSale />} onClick={() => navigate('/cash-count')} sx={{ whiteSpace: 'nowrap', ml: 1 }}>Kasse zählen</Button>}
        >
          {isLoading ? <Skeleton variant="rounded" height={140} /> : !cc ? (
            <Typography color="text.secondary">Noch keine Zählung vorhanden. Die Kasse wird nicht täglich gezählt; spätestens vor dem Jahresabschluss muss gezählt werden.</Typography>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">{fmtDateTime(cc.countedAt)} · gezählt von {cc.user?.name || '—'}</Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 4 }}><MiniStat dense label="Soll" value={money(cc.expectedTotal)} /></Grid>
                <Grid size={{ xs: 12, sm: 4 }}><MiniStat dense label="Ist" value={money(cc.countedTotal)} /></Grid>
                <Grid size={{ xs: 12, sm: 4 }}><MiniStat dense label="Differenz" value={signedMoney(cc.difference)} color={Math.abs(num(cc.difference)) < 0.005 ? 'success.main' : 'error.main'} /></Grid>
              </Grid>
              {cc.note && <Typography variant="body2" color="text.secondary">Notiz: {cc.note}</Typography>}
              <Box><Button size="small" startIcon={<PictureAsPdf />} onClick={pdf}>PDF der Zählung</Button></Box>
            </Stack>
          )}
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Bankkonten">
          {banks.length === 0 ? (
            <Typography color="text.secondary">Bankkonten werden beim Jahresabschluss erfasst. Noch kein abgeschlossenes Geschäftsjahr mit Konten.</Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" gutterBottom>Stand laut Abschluss „{lastClosed.name}" ({fmtDate(lastClosed.endDate)})</Typography>
              <SimpleTable
                head={['Konto', 'Saldo']}
                rows={banks.map((b) => [`${b.name || 'Konto'}${b.iban ? ` · ${b.iban}` : ''}`, money(b.balance)])}
                footer={['Gesamt', money(banks.reduce((a, b) => a + num(b.balance), 0))]}
              />
            </>
          )}
        </SectionCard>
      </Grid>
    </Grid>
  );
}

/* ------------------------------- Geschäftsjahre ------------------------------- */

function FiscalYearsSection({ fiscalYears, error, onClose, onNew }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [dlError, setDlError] = useState(null);

  const downloadReport = async (fy) => {
    try {
      setDlError(null);
      await downloadFile(`/accounting/fiscal-years/${fy.id}/report`, { filename: `Jahresabschluss_${fy.name || fy.id}.pdf` });
    } catch (err) {
      setDlError(await apiErrorMessage(err, 'PDF konnte nicht geladen werden.'));
    }
  };

  const actions = (fy) => (
    <Stack direction="row" spacing={1} justifyContent="flex-end">
      {!fy.closed && <Button size="small" variant="contained" startIcon={<Lock />} onClick={() => onClose(fy)}>Abschließen</Button>}
      <Button size="small" variant="outlined" startIcon={<PictureAsPdf />} onClick={() => downloadReport(fy)}>{fy.closed ? 'PDF' : 'Entwurf-PDF'}</Button>
    </Stack>
  );
  const status = (fy) => (fy.closed ? <Chip color="success" size="small" label="Abgeschlossen" /> : <Chip size="small" label="Offen" />);

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">Ein Geschäftsjahr wird mit Kassenzählung, Bankständen und Inventur abgeschlossen und eingefroren.</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={onNew} sx={{ whiteSpace: 'nowrap', ml: 2 }}>Neu</Button>
      </Stack>
      {error && <Alert severity="error">Fehler beim Laden der Geschäftsjahre.</Alert>}
      {dlError && <Alert severity="error" onClose={() => setDlError(null)}>{dlError}</Alert>}
      {fiscalYears.length === 0 ? (
        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>Noch keine Geschäftsjahre.</Typography>
      ) : isMobile ? (
        <Stack spacing={1.5}>
          {fiscalYears.map((fy) => (
            <Card key={fy.id} variant="outlined">
              <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="h6">{fy.name}</Typography>
                  {status(fy)}
                </Stack>
                <Typography variant="body2" color="text.secondary" gutterBottom>{fmtDate(fy.startDate)} – {fmtDate(fy.endDate)}</Typography>
                {fy.closed && fy.report && (
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Überschuss {signedMoney(fy.report.profit)} · Kasse {money(fy.report.cashOnHand)}
                  </Typography>
                )}
                {actions(fy)}
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Zeitraum</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Überschuss</TableCell>
                <TableCell align="right">Kasse</TableCell>
                <TableCell align="right">Aktionen</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fiscalYears.map((fy) => (
                <TableRow key={fy.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{fy.name}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(fy.startDate)} – {fmtDate(fy.endDate)}</TableCell>
                  <TableCell>{status(fy)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: fy.report ? (num(fy.report.profit) >= 0 ? 'success.main' : 'error.main') : 'text.disabled' }}>
                    {fy.report ? signedMoney(fy.report.profit) : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{fy.report ? money(fy.report.cashOnHand) : '—'}</TableCell>
                  <TableCell align="right">{actions(fy)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}

/* ---------------------------------- Seite ---------------------------------- */

export default function ProfitLoss() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab = TABS.includes(tabParam) ? tabParam : 'eur';
  const setTab = (v) => setSearchParams(v === 'eur' ? {} : { tab: v }, { replace: true });

  const { data: fyData, error: fyError } = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: async () => (await api.get('/accounting/fiscal-years')).data,
  });
  const fiscalYears = fyData?.fiscalYears || [];

  const [openNew, setOpenNew] = useState(false);
  const [newFy, setNewFy] = useState({ name: '', startDate: null, endDate: null });
  const [createError, setCreateError] = useState(null);
  const [closeTarget, setCloseTarget] = useState(null);

  const createFY = useMutation({
    mutationFn: async () => (await api.post('/accounting/fiscal-years', {
      name: newFy.name,
      startDate: newFy.startDate ? format(newFy.startDate, 'yyyy-MM-dd') : null,
      endDate: newFy.endDate ? format(newFy.endDate, 'yyyy-MM-dd') : null,
    })).data,
    onSuccess: (data) => {
      setOpenNew(false);
      setCreateError(null);
      setNewFy({ name: '', startDate: null, endDate: null });
      qc.invalidateQueries({ queryKey: ['fiscal-years'] });
      if (data?.fiscalYear) setCloseTarget(data.fiscalYear);
    },
    onError: async (err) => setCreateError(await apiErrorMessage(err, 'Geschäftsjahr konnte nicht angelegt werden.')),
  });

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Kassenprüfung</Typography>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="eur" label="EÜR" />
        <Tab value="kasse" label="Kasse & Bank" />
        <Tab value="jahre" label="Geschäftsjahre" />
      </Tabs>

      {tab === 'eur' && <EurSection />}
      {tab === 'kasse' && <CashBankSection fiscalYears={fiscalYears} />}
      {tab === 'jahre' && (
        <FiscalYearsSection fiscalYears={fiscalYears} error={fyError} onClose={setCloseTarget} onNew={() => setOpenNew(true)} />
      )}

      <Dialog open={openNew} onClose={() => setOpenNew(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Geschäftsjahr anlegen</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mt: 1 }}>{createError}</Alert>}
          <TextField label="Name" fullWidth sx={{ mt: 2 }} value={newFy.name} onChange={(e) => setNewFy((f) => ({ ...f, name: e.target.value }))} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
            <DatePicker label="Start" value={newFy.startDate} onChange={(d) => setNewFy((f) => ({ ...f, startDate: d }))} slotProps={{ textField: { fullWidth: true } }} />
            <DatePicker label="Ende" value={newFy.endDate} onChange={(d) => setNewFy((f) => ({ ...f, endDate: d }))} slotProps={{ textField: { fullWidth: true } }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNew(false)}>Abbrechen</Button>
          <Button onClick={() => createFY.mutate()} disabled={!newFy.name || !newFy.startDate || !newFy.endDate || createFY.isPending} variant="contained">
            {createFY.isPending ? 'Speichert…' : 'Anlegen'}
          </Button>
        </DialogActions>
      </Dialog>

      <CloseYearStepper open={!!closeTarget} fy={closeTarget} onClose={() => setCloseTarget(null)} />
    </Box>
  );
}
