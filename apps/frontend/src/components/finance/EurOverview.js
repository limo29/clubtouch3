/**
 * Live-Vorschau „Einnahmen & Ausgaben“ (EÜR) für einen Zeitraum; sitzt unter dem Bericht in /reports.
 * Zeitraum und PDF-Export kommen von der Berichte-Seite, hier nur Zahlen und „Belege prüfen“.
 * Zahlen ausschließlich aus /accounting/profit-loss (accountingService.getProfitLoss).
 */
import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Grid, Button, IconButton, Alert, Dialog, Stack, useTheme, useMediaQuery,
} from '@mui/material';
import { Close, TrendingUp, TrendingDown, AccountBalance, ReceiptLong } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../services/api';
import KPICard from '../common/KPICard';
import ReceiptReview from './ReceiptReview';
import { SectionCard, MiniStat, SimpleTable, fmtDate, signedMoney } from './FinanceBits';
import { money, num } from '../../utils/format';

export default function EurOverview({ startDate, endDate }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const params = { startDate, endDate };

  const { data, error, isLoading } = useQuery({
    queryKey: ['profit-loss', params.startDate, params.endDate],
    queryFn: async () => (await api.get('/accounting/profit-loss', { params })).data,
    enabled: !!startDate && !!endDate,
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

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Vorschau {fmtDate(startDate)} – {fmtDate(endDate)}</Typography>
          <Typography variant="body2" color="text.secondary">
            Einnahmen-Überschuss-Rechnung (EÜR): was im Zeitraum eingenommen und ausgegeben wurde. Aufladungen sind keine Einnahme, sondern Guthaben der Gäste.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<ReceiptLong />} onClick={() => setReceiptsOpen(true)} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          Belege prüfen
        </Button>
      </Stack>

      <Dialog
        open={receiptsOpen}
        onClose={() => setReceiptsOpen(false)}
        maxWidth="xl"
        fullWidth
        fullScreen={isMobile}
      >
        <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', minHeight: isMobile ? '100vh' : '80vh' }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>Belege prüfen (Zeitraum)</Typography>
            <IconButton onClick={() => setReceiptsOpen(false)} aria-label="Schließen"><Close /></IconButton>
          </Stack>
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            <ReceiptReview
              fetchUrl="/purchase-documents/receipts"
              zipUrl="/purchase-documents/receipts.zip"
              params={{ startDate: params.startDate, endDate: params.endDate }}
              title="Belege im Zeitraum"
            />
          </Box>
        </Box>
      </Dialog>

      {error && <Alert severity="error">Fehler beim Laden der EÜR{error?.response?.data?.error ? `: ${error.response.data.error}` : '.'}</Alert>}

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
                ['Bezahlte Kundenrechnungen', money(incomeByType.invoices)],
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
          <MiniStat label="Offene Lieferantenrechnungen" value={money(unpaidPurchase.total)} sub={`${unpaidPurchase.count ?? 0} Belege (Verbindlichkeit)`} color={num(unpaidPurchase.total) > 0 ? 'error.main' : 'text.primary'} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MiniStat label="Offene Kundenrechnungen" value={money(unpaidInvoices.total)} sub={`${unpaidInvoices.count ?? 0} Rechnungen (Forderung)`} color={num(unpaidInvoices.total) > 0 ? 'warning.main' : 'text.primary'} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="Offene Lieferantenrechnungen">
            <SimpleTable
              head={['Beleg', 'Datum', 'Betrag']}
              rows={(unpaidPurchase.items || []).map((d) => [`${d.supplier || '—'}${d.documentNumber ? ` · ${d.documentNumber}` : ''}`, fmtDate(d.documentDate), money(d.totalAmount)])}
              empty="Keine offenen Lieferantenrechnungen"
            />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="Offene Kundenrechnungen">
            <SimpleTable
              head={['Rechnung', 'Fällig', 'Betrag']}
              rows={(unpaidInvoices.items || []).map((d) => [`${d.customerName || '—'}${d.invoiceNumber ? ` · ${d.invoiceNumber}` : ''}`, fmtDate(d.dueDate), money(d.totalAmount)])}
              empty="Keine offenen Kundenrechnungen"
            />
          </SectionCard>
        </Grid>
      </Grid>
    </Stack>
  );
}
