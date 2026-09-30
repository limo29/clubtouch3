/**
 * Berichte & Exporte: Liste links, Parameter + Vorschau rechts (Handy: untereinander).
 * Parameter werden je Bericht getrennt gehalten (State-Objekt pro Report-ID), Validierung je Bericht.
 * Die Berichtsliste kommt vom Backend (/exports, inkl. EÜR); "Kassenzählung (PDF)" ergänzt das
 * Frontend, weil sie kein Export-Endpunkt ist, sondern /cash-counts/:id/pdf.
 * „Einnahmen & Ausgaben“ (eur) zeigt unter der Auswahl die Live-Vorschau (EurOverview) für den
 * gewählten Zeitraum. ?report=<id> wählt einen Bericht vor (z. B. Umleitung von /profit-loss?tab=eur).
 */
import React, { useState, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Button, Alert, List, ListItemButton, ListItemText, ListItemIcon,
  Chip, Paper, CircularProgress, Autocomplete, TextField, IconButton, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Download, Description, TableChart, PictureAsPdf, Receipt, Inventory, People, Assessment, AccountBalance,
  CalendarToday, EuroSymbol, ChevronLeft, ChevronRight, PointOfSale, AddCard,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format, addMonths, subMonths, startOfMonth } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import KPICard from '../components/common/KPICard';
import EurOverview from '../components/finance/EurOverview';
import { money, num } from '../utils/format';
import { downloadFile, apiErrorMessage } from '../utils/download';

const CASH_COUNT_REPORT = {
  id: 'cash-count',
  name: 'Kassenzählung',
  description: 'Protokoll einer gespeicherten Kassenzählung (Stückelung, Soll/Ist, Differenz) als PDF',
  format: 'PDF',
};

const fmtDateTime = (iso) => (iso ? format(new Date(iso), 'dd.MM.yyyy HH:mm') : '—');
const fmtTime = (iso) => (iso ? format(new Date(iso), 'HH:mm') : '—');
const ymd = (d) => format(d, 'yyyy-MM-dd');
/** "2026-09-28" (lokaler Geschäftstag vom Backend) → lokales Date */
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
};

const ICONS = {
  transactions: <Receipt color="primary" />,
  inventory: <Inventory color="primary" />,
  customers: <People color="primary" />,
  'daily-summary': <CalendarToday color="primary" />,
  'monthly-summary': <Assessment color="primary" />,
  'customer-statement': <AccountBalance color="primary" />,
  eur: <EuroSymbol color="primary" />,
  'cash-count': <PointOfSale color="primary" />,
};

/* Standard-Parameter je Bericht; der Tagesabschluss bekommt den aktuellen Geschäftstag (06:00-Regel) */
const defaultParams = (id, businessDay) => {
  const today = new Date();
  switch (id) {
    case 'daily-summary': return { date: businessDay || today };
    case 'monthly-summary': return { month: startOfMonth(subMonths(today, 1)) };
    case 'customer-statement': return { customer: null, startDate: null, endDate: null };
    case 'eur': return { startDate: new Date(today.getFullYear(), 0, 1), endDate: today };
    case 'cash-count': return { cashCount: null };
    default: return { startDate: null, endDate: null };
  }
};

/* ------------------------------ Vorschau Tagesabschluss ------------------------------ */

function DailyPreview({ data, isLoading, error }) {
  if (isLoading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">Vorschau konnte nicht geladen werden.</Alert>;
  if (!data) return null;
  const s = data.summary || {};
  const topArticles = data.topArticles || [];
  const hours = data.hourlyDistribution || [];
  const topUps = data.topUps || [];
  const cancellations = data.cancellations || [];
  const maxHour = Math.max(1, ...hours.map((h) => num(h.revenue)));
  // Vier Kacheln nebeneinander: kleinere Zahl als die h3 der KPICard, sonst wird "86,00 €" abgeschnitten
  const kpiSx = { minHeight: 110, '& .MuiTypography-h3': { fontSize: { xs: '1.5rem', lg: '1.75rem' } } };

  return (
    <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6" gutterBottom>
        Vorschau Tagesabschluss {data.date ? format(parseYmd(data.date), 'dd.MM.yyyy') : ''}
      </Typography>
      {data.window && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Geschäftstag {fmtDateTime(data.window.start)} – {fmtDateTime(data.window.end)}
        </Typography>
      )}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, lg: 3 }}><KPICard title="Umsatz" value={money(s.totalRevenue)} icon={EuroSymbol} color="primary" sx={kpiSx} /></Grid>
        <Grid size={{ xs: 6, lg: 3 }}><KPICard title="Bar" value={money(s.cashRevenue)} icon={EuroSymbol} color="success" sx={kpiSx} subTitle={`${s.cashTransactions ?? 0} Verkäufe`} /></Grid>
        <Grid size={{ xs: 6, lg: 3 }}><KPICard title="Konto" value={money(s.accountRevenue)} icon={AccountBalance} color="info" sx={kpiSx} subTitle={`${s.accountTransactions ?? 0} Verkäufe`} /></Grid>
        <Grid size={{ xs: 6, lg: 3 }}><KPICard title="Aufladungen" value={money(s.topUpsTotal)} icon={AddCard} color="warning" sx={kpiSx} subTitle={`bar ${money(s.topUpsCash)} · Überw. ${money(s.topUpsTransfer)}`} /></Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom color="text.secondary">Top Artikel</Typography>
          <Paper sx={{ overflow: 'hidden' }}>
            {topArticles.length === 0 ? <Box p={2}><Typography variant="caption">Keine Verkäufe</Typography></Box> :
              topArticles.slice(0, 5).map((a, i) => (
                <Box key={a.id || i} display="flex" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, borderBottom: i < Math.min(5, topArticles.length) - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
                  <Typography variant="body2">{a.name}</Typography>
                  <Box textAlign="right">
                    <Typography variant="body2" fontWeight="bold">{num(a.quantity_sold)}×</Typography>
                    <Typography variant="caption" color="text.secondary">{money(a.revenue)}</Typography>
                  </Box>
                </Box>
              ))}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom color="text.secondary">Verlauf nach Stunden</Typography>
          <Paper sx={{ p: 1.5, maxHeight: 260, overflowY: 'auto' }}>
            {hours.length === 0 ? <Typography variant="caption">Keine Daten</Typography> :
              hours.map((h, i) => (
                <Box key={i} display="flex" alignItems="center" sx={{ mb: 0.75 }}>
                  <Typography variant="caption" sx={{ width: 44 }}>{h.hour}:00</Typography>
                  <Box sx={{ flex: 1, mx: 1, height: 8, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
                    <Box sx={{ width: `${(num(h.revenue) / maxHour) * 100}%`, height: '100%', bgcolor: 'primary.main' }} />
                  </Box>
                  <Typography variant="caption" sx={{ minWidth: 64, textAlign: 'right' }}>{money(h.revenue)}</Typography>
                </Box>
              ))}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom color="text.secondary">Aufladungen ({topUps.length})</Typography>
          <Paper sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Zeit</TableCell><TableCell>Kunde</TableCell><TableCell>Art</TableCell><TableCell align="right">Betrag</TableCell></TableRow></TableHead>
              <TableBody>
                {topUps.length === 0 ? <TableRow><TableCell colSpan={4} sx={{ color: 'text.secondary' }}>Keine Aufladungen</TableCell></TableRow> :
                  topUps.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{fmtTime(t.createdAt)}</TableCell>
                      <TableCell>{t.customer || '—'}</TableCell>
                      <TableCell>{t.method === 'CASH' ? 'Bar' : t.method === 'TRANSFER' ? 'Überweisung' : t.method || '—'}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{money(t.amount)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom color="text.secondary">Stornos ({cancellations.length}) · {money(s.cancelledRevenue)}</Typography>
          <Paper sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Zeit</TableCell><TableCell>Kunde</TableCell><TableCell>Kassierer</TableCell><TableCell align="right">Betrag</TableCell></TableRow></TableHead>
              <TableBody>
                {cancellations.length === 0 ? <TableRow><TableCell colSpan={4} sx={{ color: 'text.secondary' }}>Keine Stornos</TableCell></TableRow> :
                  cancellations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{fmtTime(c.createdAt)}</TableCell>
                      <TableCell>{c.customer || '—'}</TableCell>
                      <TableCell>{c.cashier || '—'}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'error.main' }}>{money(c.amount)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

/* ------------------------------------- Seite ------------------------------------- */

const Reports = () => {
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(() => searchParams.get('report'));
  const [paramsById, setParamsById] = useState({});
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const { data: exportsData } = useQuery({
    queryKey: ['exports'],
    queryFn: async () => (await api.get(API_ENDPOINTS.EXPORTS)).data,
  });
  const { data: customersData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => (await api.get(API_ENDPOINTS.CUSTOMERS)).data,
  });
  const { data: businessDayData } = useQuery({
    queryKey: ['business-day'],
    queryFn: async () => (await api.get(API_ENDPOINTS.DAILY_SUMMARY)).data,
    staleTime: 60 * 1000,
  });
  const { data: cashCountsData } = useQuery({
    queryKey: ['cash-counts', 'list'],
    queryFn: async () => (await api.get('/cash-counts', { params: { limit: 50 } })).data,
    enabled: selectedId === 'cash-count',
  });

  const businessDay = businessDayData?.date ? parseYmd(businessDayData.date) : null;
  const exports = useMemo(() => [...(exportsData?.exports || []), CASH_COUNT_REPORT], [exportsData]);
  const customers = customersData?.customers || [];
  const cashCounts = cashCountsData?.cashCounts || [];
  const selected = exports.find((e) => e.id === selectedId) || null;

  const params = selected ? (paramsById[selected.id] || defaultParams(selected.id, businessDay)) : {};
  const setParam = (patch) => setParamsById((p) => ({ ...p, [selected.id]: { ...params, ...patch } }));

  const dailyDate = selectedId === 'daily-summary' && params.date ? ymd(params.date) : null;
  const { data: previewData, isLoading: previewLoading, error: previewError } = useQuery({
    queryKey: ['report-preview', 'daily-summary', dailyDate],
    queryFn: async () => (await api.get('/exports/daily-summary/preview', { params: { date: dailyDate } })).data,
    enabled: !!dailyDate,
    staleTime: 5000,
  });

  const runDownload = async () => {
    if (!selected) return;
    setDownloading(true);
    setError(null);
    try {
      let url = `${API_ENDPOINTS.EXPORTS}/${selected.id}`;
      const q = {};
      switch (selected.id) {
        case 'transactions':
          if (params.startDate) q.startDate = ymd(params.startDate);
          if (params.endDate) q.endDate = ymd(params.endDate);
          break;
        case 'daily-summary':
          q.date = ymd(params.date);
          break;
        case 'monthly-summary':
          q.year = params.month.getFullYear();
          q.month = params.month.getMonth() + 1;
          break;
        case 'customer-statement':
          url = `${API_ENDPOINTS.EXPORTS}/customer/${params.customer.id}/statement`;
          if (params.startDate) q.startDate = ymd(params.startDate);
          if (params.endDate) q.endDate = ymd(params.endDate);
          break;
        case 'eur':
          q.startDate = ymd(params.startDate);
          q.endDate = ymd(params.endDate);
          break;
        case 'cash-count':
          url = `/cash-counts/${params.cashCount.id}/pdf`;
          break;
        default:
          break;
      }
      await downloadFile(url, { params: q, filename: `${selected.id}_${Date.now()}.${(selected.format || 'pdf').toLowerCase()}` });
    } catch (err) {
      setError(await apiErrorMessage(err, 'Download fehlgeschlagen.'));
    } finally {
      setDownloading(false);
    }
  };

  /* Validierung je Bericht, liefert Fehlertext oder null */
  const validate = () => {
    switch (selected?.id) {
      case 'customer-statement':
        if (!params.customer) return 'Bitte einen Kunden wählen.';
        if (params.startDate && params.endDate && params.startDate > params.endDate) return 'Das Startdatum liegt nach dem Enddatum.';
        return null;
      case 'eur':
        if (!params.startDate || !params.endDate) return 'Bitte Start- und Enddatum wählen.';
        if (params.startDate > params.endDate) return 'Das Startdatum liegt nach dem Enddatum.';
        return null;
      case 'daily-summary':
        return params.date ? null : 'Bitte ein Datum wählen.';
      case 'cash-count':
        return params.cashCount ? null : 'Bitte eine Zählung wählen.';
      case 'transactions':
        if (params.startDate && params.endDate && params.startDate > params.endDate) return 'Das Startdatum liegt nach dem Enddatum.';
        return null;
      default:
        return null;
    }
  };

  const handleDownload = () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    if (selected.id === 'transactions' && !params.startDate && !params.endDate) { setConfirmAll(true); return; }
    runDownload();
  };

  const dateRange = (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DatePicker label="Von" value={params.startDate ?? null} onChange={(d) => setParam({ startDate: d })} slotProps={{ textField: { fullWidth: true, size: 'small' } }} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DatePicker label="Bis" value={params.endDate ?? null} onChange={(d) => setParam({ endDate: d })} slotProps={{ textField: { fullWidth: true, size: 'small' } }} />
      </Grid>
    </>
  );

  const renderParams = () => {
    if (!selected) return null;
    switch (selected.id) {
      case 'transactions':
        return (
          <Grid container spacing={2}>
            {dateRange}
            <Grid size={{ xs: 12 }}><Typography variant="caption" color="text.secondary">Ohne Zeitraum werden alle Transaktionen exportiert.</Typography></Grid>
          </Grid>
        );
      case 'eur':
        return <Grid container spacing={2}>{dateRange}</Grid>;
      case 'customer-statement':
        return (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                options={customers}
                value={params.customer}
                onChange={(e, v) => setParam({ customer: v })}
                getOptionLabel={(c) => (c ? `${c.name}${c.nickname ? ` (${c.nickname})` : ''}` : '')}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                noOptionsText="Kein Kunde gefunden"
                renderInput={(p) => <TextField {...p} label="Kunde" placeholder="Name oder Spitzname" size="small" required />}
              />
            </Grid>
            {dateRange}
            <Grid size={{ xs: 12 }}><Typography variant="caption" color="text.secondary">Ohne Zeitraum: alle Bewegungen des Kunden.</Typography></Grid>
          </Grid>
        );
      case 'daily-summary':
        return (
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, sm: 6 }}>
              <DatePicker label="Geschäftstag" value={params.date} onChange={(d) => d && setParam({ date: d })} slotProps={{ textField: { fullWidth: true, size: 'small' } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" color="text.secondary">Ein Geschäftstag läuft von 06:00 bis 06:00 des Folgetags. Vorgabe ist der aktuelle Geschäftstag.</Typography>
            </Grid>
          </Grid>
        );
      case 'monthly-summary':
        return (
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton onClick={() => setParam({ month: subMonths(params.month, 1) })} aria-label="Vormonat"><ChevronLeft /></IconButton>
            <Typography variant="h6" sx={{ minWidth: 180, textAlign: 'center', textTransform: 'capitalize' }}>
              {format(params.month, 'LLLL yyyy', { locale: de })}
            </Typography>
            <IconButton onClick={() => setParam({ month: addMonths(params.month, 1) })} aria-label="Folgemonat" disabled={addMonths(params.month, 1) > new Date()}><ChevronRight /></IconButton>
          </Stack>
        );
      case 'cash-count':
        return (
          <Autocomplete
            options={cashCounts}
            value={params.cashCount}
            onChange={(e, v) => setParam({ cashCount: v })}
            getOptionLabel={(c) => (c ? `${fmtDateTime(c.countedAt)} · ${money(c.countedTotal)} · Differenz ${num(c.difference) > 0 ? '+' : ''}${money(c.difference)}` : '')}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="Noch keine Zählung gespeichert"
            renderInput={(p) => <TextField {...p} label="Zählung" size="small" required />}
          />
        );
      default:
        return <Typography variant="body2" color="text.secondary">Keine Parameter erforderlich.</Typography>;
    }
  };

  return (
    <Box>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5, lg: 4 }}>
          <Card>
            <CardContent sx={{ p: { xs: 1, sm: 2 } }}>
              <Typography variant="h6" sx={{ px: 1, mb: 1 }}>Verfügbare Berichte</Typography>
              <List sx={{ p: 0 }}>
                {exports.map((ex) => (
                  <ListItemButton
                    key={ex.id}
                    selected={selectedId === ex.id}
                    onClick={() => {
                      setSelectedId(ex.id); setError(null);
                      // Handy: Parameter liegen unter der Liste, dorthin scrollen
                      if (window.innerWidth < 900) setTimeout(() => document.getElementById('report-params')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                    }}
                    sx={{ borderRadius: 2, mb: 0.5, borderLeft: '4px solid', borderLeftColor: selectedId === ex.id ? 'primary.main' : 'transparent' }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>{ICONS[ex.id] || <Description />}</ListItemIcon>
                    <ListItemText
                      primary={ex.name}
                      secondary={ex.description}
                      primaryTypographyProps={{ fontWeight: 600 }}
                      secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                    />
                    <Chip icon={ex.format === 'CSV' ? <TableChart fontSize="small" /> : <PictureAsPdf fontSize="small" />} label={ex.format} size="small" variant="outlined" sx={{ ml: 1 }} />
                  </ListItemButton>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 7, lg: 8 }}>
          <Card id="report-params" sx={{ minHeight: { md: 400 }, scrollMarginTop: 80 }}>
            <CardContent>
              {!selected ? (
                <Box sx={{ py: 8, textAlign: 'center', opacity: 0.6 }}>
                  <Description sx={{ fontSize: 64, mb: 2, color: 'text.secondary' }} />
                  <Typography variant="h6" color="text.secondary">Bitte einen Bericht auswählen</Typography>
                </Box>
              ) : (
                <>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    {ICONS[selected.id] || <Description />}
                    <Typography variant="h6">{selected.name}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{selected.description}</Typography>

                  <Box sx={{ mb: 3 }}>{renderParams()}</Box>

                  {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

                  <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    fullWidth
                    startIcon={downloading ? <CircularProgress size={20} color="inherit" /> : <Download />}
                    onClick={handleDownload}
                    disabled={downloading}
                    sx={{ py: 1.25 }}
                  >
                    {downloading ? 'Wird erstellt…' : `Exportieren als ${selected.format}`}
                  </Button>

                  {selected.id === 'daily-summary' && <DailyPreview data={previewData} isLoading={previewLoading} error={previewError} />}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Live-Vorschau Einnahmen & Ausgaben über die volle Breite */}
        {selected?.id === 'eur' && params.startDate && params.endDate && params.startDate <= params.endDate && (
          <Grid size={{ xs: 12 }}>
            <EurOverview startDate={ymd(params.startDate)} endDate={ymd(params.endDate)} />
          </Grid>
        )}
      </Grid>

      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Alle Transaktionen exportieren?</DialogTitle>
        <DialogContent>
          <Typography>Es ist kein Zeitraum gewählt. Wirklich alle Transaktionen seit Beginn exportieren?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAll(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={() => { setConfirmAll(false); runDownload(); }}>Alle exportieren</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Reports;
