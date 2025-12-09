// src/pages/ProfitLoss.jsx
import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Button, TextField, Alert, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, IconButton, Stack, Tabs, Tab, InputAdornment,
  useTheme, useMediaQuery
} from '@mui/material';
import {
  Download, TrendingUp, TrendingDown, AccountBalance, Add, Delete, Close,
  Search
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { format } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import KPICard from '../components/common/KPICard';

/* ---------------- helpers ---------------- */
const asNum = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (amount) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(asNum(amount));

const PROFIT_LOSS_PATH = '/accounting/profit-loss';
const PROFIT_LOSS_FALLBACK = '/purchases/profit-loss';

/* ====== INVENTUR-KARTE ====== */
function QtyButton({ onClick, children }) {
  return (
    <Button
      onClick={onClick}
      sx={{
        minWidth: 44, minHeight: 44, borderRadius: '12px',
        fontSize: 24, fontWeight: 700, lineHeight: 1, px: 0
      }}
      variant="contained"
      color="primary"
    >
      {children}
    </Button>
  );
}

function ArticleCard({ article, qty, onSet }) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {article.imageSmall || article.imageThumbnail ? (
        <Box component="img"
          src={article.imageSmall || article.imageThumbnail}
          alt={article.name}
          sx={{ width: '100%', height: 120, objectFit: 'cover' }}
          loading="lazy"
        />
      ) : null}
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography noWrap fontWeight={700}>{article.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          Einheit: {article.unit}{article.purchaseUnit && ` • Einkaufs-Einheit: ${article.purchaseUnit}`}
          {article.unitsPerPurchase ? ` (Faktor ${article.unitsPerPurchase})` : ''}
        </Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 'auto' }}>
          <QtyButton onClick={() => onSet(Math.max(0, qty - 1))}>−</QtyButton>
          <TextField
            value={qty}
            onChange={(e) => onSet(Math.max(0, parseInt(e.target.value || '0', 10)))}
            type="number"
            inputProps={{ min: 0, style: { textAlign: 'center', fontWeight: 700 } }}
            sx={{ width: 90 }}
            size="small"
          />
          <QtyButton onClick={() => onSet(qty + 1)}>+</QtyButton>
        </Stack>
      </CardContent>
    </Card>
  );
}

// << NEU: KASSEN-ZÄHLHILFE >>
function CashCounter({ value, onChange }) {
  const denoms = [
    { label: '500 €', val: 500 },
    { label: '200 €', val: 200 },
    { label: '100 €', val: 100 },
    { label: '50 €', val: 50 },
    { label: '20 €', val: 20 },
    { label: '10 €', val: 10 },
    { label: '5 €', val: 5 },
    { label: '2 €', val: 2 },
    { label: '1 €', val: 1 },
    { label: '50 ct', val: 0.5 },
    { label: '20 ct', val: 0.2 },
    { label: '10 ct', val: 0.1 },
    { label: '5 ct', val: 0.05 },
  ];
  const [counts, setCounts] = React.useState(Object.fromEntries(denoms.map(d => [d.val, 0])));
  const total = denoms.reduce((s, d) => s + (counts[d.val] || 0) * d.val, 0);

  useEffect(() => {
    onChange(Number(total.toFixed(2))); // schreibt nach außen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const setCount = (d, c) => {
    const n = Math.max(0, parseInt(c || '0', 10));
    setCounts(prev => ({ ...prev, [d.val]: n }));
  };

  return (
    <Box>
      <Grid container spacing={1}>
        {denoms.map(d => (
          <Grid item xs={6} key={d.val}>
            <TextField
              label={`${d.label} Anzahl`}
              type="number"
              size="small"
              value={counts[d.val]}
              onChange={(e) => setCount(d, e.target.value)}
              inputProps={{ min: 0 }}
              fullWidth
            />
          </Grid>
        ))}
      </Grid>
      <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2">Summe gezählt:</Typography>
        <Typography variant="h6">
          {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(total)}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Die Summe wird automatisch in das Feld „Bestand (€)“ übernommen — du kannst es trotzdem manuell überschreiben.
      </Typography>
    </Box>
  );
}

/* ====== FULLSCREEN-ABSCHLUSS ====== */
function CloseYearDialog({ open, onClose, fy, onSubmit }) {
  const [cashOnHand, setCashOnHand] = useState('');
  const [banks, setBanks] = useState([{ name: '', iban: '', balance: '' }]);

  const [articlesSearch, setArticlesSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [counts, setCounts] = useState({}); // { [articleId]: qty }
  const [tab, setTab] = useState('incomeArticles'); // << NEU: Tabs-State

  const { data: articlesData } = useQuery({
    queryKey: ['articles-for-inventory'],
    queryFn: async () => (await api.get('/articles')).data,
    enabled: open,
  });
  const articles = (articlesData?.articles || []).filter(a => a.active !== false);
  const categories = useMemo(() => ['all', ...new Set(articles.map(a => a.category).filter(Boolean))], [articles]);

  // << GEÄNDERT: Preview-Query stabilisiert >>
  const { data: previewData, isLoading: prevLoading, error: prevError, refetch: refetchPreview } = useQuery({
    queryKey: ['fy-preview', fy?.id, open],         // open Teil des Keys
    queryFn: async () => (await api.get(`/accounting/fiscal-years/${fy.id}/preview`)).data.preview,
    enabled: !!open && !!fy?.id,                    // nur wenn offen + id
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (open && fy?.id) { refetchPreview(); }
  }, [open, fy?.id, refetchPreview]);
  // << ENDE: Preview-Query >>

  useEffect(() => {
    if (!open) {
      setCashOnHand(''); setBanks([{ name: '', iban: '', balance: '' }]);
      setCounts({}); setArticlesSearch(''); setCategory('all');
      setTab('incomeArticles'); // Reset tab
    }
  }, [open]);

  const filtered = articles.filter(a =>
    (category === 'all' || a.category === category) &&
    (a.name.toLowerCase().includes(articlesSearch.toLowerCase()))
  );

  const changeBank = (idx, key, val) =>
    setBanks((b) => b.map((x, i) => (i === idx ? { ...x, [key]: val } : x)));
  const addBank = () => setBanks((b) => [...b, { name: '', iban: '', balance: '' }]);
  const removeBank = (idx) => setBanks((b) => b.filter((_, i) => i !== idx));

  const physicalInventory = Object.entries(counts)
    .map(([articleId, qty]) => ({ articleId, physicalStock: Number(qty) || 0 }))
    .filter(x => x.physicalStock >= 0);

  return (
    <Dialog fullScreen open={open} onClose={onClose}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton onClick={onClose}><Close /></IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Geschäftsjahr abschließen – {fy?.name}{' '}
          <Typography component="span" variant="body2" color="text.secondary">
            ({fy && `${format(new Date(fy.startDate), 'dd.MM.yyyy')} – ${format(new Date(fy.endDate), 'dd.MM.yyyy')}`})
          </Typography>
        </Typography>
        <Button
          variant="contained"
          onClick={() => onSubmit({
            cashOnHand: Number(cashOnHand) || 0,
            bankAccounts: banks.filter(b => b.name || b.iban || b.balance)
              .map(b => ({ ...b, balance: Number(b.balance) || 0 })),
            physicalInventory,
          })}
        >
          Abschließen
        </Button>
      </Box>

      <Box sx={{ p: 2 }}>
        <Grid container spacing={2}>
          {/* linke Spalte: Kasse + Banken */}
          <Grid item xs={12} md={4}>

            {/* << GEÄNDERT: Barkasse mit Zählhilfe >> */}
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>Barkasse</Typography>

                {/* Zählhilfe */}
                <CashCounter
                  value={Number(cashOnHand || 0)}
                  onChange={(sum) => setCashOnHand(String(sum))}
                />

                {/* Manuelle Korrektur / Direkt-Eingabe */}
                <TextField
                  sx={{ mt: 2 }}
                  label="Bestand (€) (manuell)"
                  value={cashOnHand}
                  onChange={(e) => setCashOnHand(e.target.value)}
                  fullWidth
                  type="number"
                  InputProps={{ startAdornment: <InputAdornment position="start">€</InputAdornment>, inputProps: { step: '0.01' } }}
                />
              </CardContent>
            </Card>
            {/* << ENDE: Barkasse >> */}


            <Card>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>Bankkonten</Typography>
                <Stack spacing={1}>
                  {banks.map((b, idx) => (
                    <Grid container spacing={1} key={idx}>
                      <Grid item xs={12}><TextField label="Name" value={b.name} onChange={(e) => changeBank(idx, 'name', e.target.value)} fullWidth /></Grid>
                      <Grid item xs={12}><TextField label="IBAN (optional)" value={b.iban} onChange={(e) => changeBank(idx, 'iban', e.target.value)} fullWidth /></Grid>
                      <Grid item xs={10}>
                        <TextField
                          label="Kontostand (€)"
                          value={b.balance}
                          onChange={(e) => changeBank(idx, 'balance', e.target.value)}
                          fullWidth type="number"
                          InputProps={{ startAdornment: <InputAdornment position="start">€</InputAdornment>, inputProps: { step: '0.01' } }}
                        />
                      </Grid>
                      <Grid item xs={2} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <IconButton onClick={() => removeBank(idx)}><Delete /></IconButton>
                      </Grid>
                    </Grid>
                  ))}
                  <Button size="small" startIcon={<Add />} onClick={addBank}>Konto hinzufügen</Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* rechte Spalte: Inventur */}
          <Grid item xs={12} md={8}>
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <TextField
                placeholder="Artikel suchen…"
                size="small"
                value={articlesSearch}
                onChange={(e) => setArticlesSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
              />
              <Tabs
                value={category}
                onChange={(_, v) => setCategory(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
              >
                {categories.map(c => <Tab key={c} value={c} label={c === 'all' ? 'Alle' : c} />)}
              </Tabs>
            </Stack>

            <Grid container spacing={1.5}>
              {filtered.map(a => {
                const q = counts[a.id] || 0;
                return (
                  <Grid item xs={12} sm={6} md={4} key={a.id}>
                    <ArticleCard
                      article={a}
                      qty={q}
                      onSet={(val) => setCounts(s => ({ ...s, [a.id]: val }))}
                    />
                  </Grid>
                );
              })}
            </Grid>

            {/* << NEU: Fehlerhinweis Preview >> */}
            {prevError && <Alert severity="warning" sx={{ mt: 2, mb: 1 }}>Vorschau konnte nicht geladen werden.</Alert>}

            {/* << NEUER BLOCK: PREVIEW TABS >> */}
            <Box sx={{ mt: 2 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
                <Tab label="Einnahmen (Artikel)" value="incomeArticles" />
                <Tab label="Bezahlte Rechnungen" value="paidInv" />
                <Tab label="Ausgaben (Einkäufe)" value="expenses" />
                <Tab label="Systembestand" value="systemInv" />
                <Tab label="Offene Rechnungen" value="unpaidInv" />
                <Tab label="Abgelaufen" value="expired" />
                <Tab label="Eigenverbrauch" value="ownerUse" />
              </Tabs>

              <Paper sx={{ mt: 1, p: 1 }}>
                {prevLoading ? (
                  <Typography variant="body2">Lade Daten…</Typography>
                ) : (
                  <>
                    {tab === 'incomeArticles' && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Artikel</TableCell>
                            <TableCell>Kategorie</TableCell>
                            <TableCell align="right">Menge</TableCell>
                            <TableCell align="right">Betrag</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(previewData?.soldArticles || []).map((r, i) => (
                            <TableRow key={i}>
                              <TableCell>{r.article}</TableCell>
                              <TableCell>{r.category || '—'}</TableCell>
                              <TableCell align="right">{Number(r.quantity || 0).toFixed(0)}</TableCell>
                              <TableCell align="right">{fmt(r.amount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {tab === 'paidInv' && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Empfänger</TableCell>
                            <TableCell>Beschreibung</TableCell>
                            <TableCell>Bezahlt am</TableCell>
                            <TableCell align="right">Betrag</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(previewData?.paidInvoices || []).map((r, i) => (
                            <TableRow key={i}>
                              <TableCell>{r.customerName || '—'}</TableCell>
                              <TableCell>{r.description || '—'}</TableCell>
                              <TableCell>{r.paidAt ? new Date(r.paidAt).toLocaleDateString('de-DE') : '—'}</TableCell>
                              <TableCell align="right">{fmt(r.totalAmount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {tab === 'expenses' && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Datum</TableCell>
                            <TableCell>Lieferant</TableCell>
                            <TableCell>Belegnr.</TableCell>
                            <TableCell align="right">Betrag</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(previewData?.expenseDocs || []).map((r, i) => (
                            <TableRow key={i}>
                              <TableCell>{new Date(r.documentDate).toLocaleDateString('de-DE')}</TableCell>
                              <TableCell>{r.supplier || '—'}</TableCell>
                              <TableCell>{r.documentNumber || '—'}</TableCell>
                              <TableCell align="right">{fmt(r.totalAmount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {tab === 'systemInv' && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Artikel</TableCell>
                            <TableCell>Kategorie</TableCell>
                            <TableCell>Einheit</TableCell>
                            <TableCell align="right">System-Bestand</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(previewData?.inventorySystem || []).map((r) => (
                            <TableRow key={r.articleId}>
                              <TableCell>{r.name}</TableCell>
                              <TableCell>{r.category || '—'}</TableCell>
                              <TableCell>{r.unit || '—'}</TableCell>
                              <TableCell align="right">{Number(r.stock || 0).toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {tab === 'unpaidInv' && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Empfänger</TableCell>
                            <TableCell>Beschreibung</TableCell>
                            <TableCell>Erstellt am</TableCell>
                            <TableCell>Fällig am</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Betrag</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(previewData?.unpaidInvoices || []).map((r, i) => (
                            <TableRow key={i}>
                              <TableCell>{r.customerName || '—'}</TableCell>
                              <TableCell>{r.description || '—'}</TableCell>
                              <TableCell>{new Date(r.createdAt).toLocaleDateString('de-DE')}</TableCell>
                              <TableCell>{r.dueDate ? new Date(r.dueDate).toLocaleDateString('de-DE') : '—'}</TableCell>
                              <TableCell>{r.status}</TableCell>
                              <TableCell align="right">{fmt(r.totalAmount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {tab === 'expired' && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Artikel</TableCell>
                            <TableCell align="right">Menge</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(previewData?.expiredArticles || []).map((r, i) => (
                            <TableRow key={i}>
                              <TableCell>{r.article}</TableCell>
                              <TableCell align="right">{Number(r.quantity || 0)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {tab === 'ownerUse' && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Artikel</TableCell>
                            <TableCell align="right">Menge</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(previewData?.ownerUseArticles || []).map((r, i) => (
                            <TableRow key={i}>
                              <TableCell>{r.article}</TableCell>
                              <TableCell align="right">{Number(r.quantity || 0)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </>
                )}
              </Paper>
            </Box>
            {/* << ENDE: PREVIEW TABS >> */}

          </Grid>
        </Grid>
      </Box>
    </Dialog>
  );
}

/* ==================== Hauptseite: EÜR + Geschäftsjahre ==================== */
export default function ProfitLoss() {
  const qc = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  /* Zeitraum */
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().getFullYear(), 0, 1),
    endDate: new Date(),
  });

  /* EÜR laden (mit bezahlten Rechnungen) */
  const { data: plData, error: plError } = useQuery({
    queryKey: ['profit-loss', dateRange.startDate?.toISOString(), dateRange.endDate?.toISOString()],
    queryFn: async () => {
      try {
        const res = await api.get(PROFIT_LOSS_PATH, {
          params: {
            startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
            endDate: format(dateRange.endDate, 'yyyy-MM-dd'),
            includeInvoices: true,
          },
        });
        return res.data;
      } catch {
        const res = await api.get(PROFIT_LOSS_FALLBACK, {
          params: {
            startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
            endDate: format(dateRange.endDate, 'yyyy-MM-dd'),
            includeInvoices: true,
          },
        });
        return res.data;
      }
    },
    enabled: !!dateRange.startDate && !!dateRange.endDate,
  });

  const summary = {
    totalIncome: asNum(plData?.summary?.totalIncome),
    totalExpenses: asNum(plData?.summary?.totalExpenses),
    profit: asNum(plData?.summary?.profit),
    expiredItems: plData?.details?.expiredItems || [],
    ownerUseItems: plData?.details?.ownerUseItems || [],
  };

  const incomeByCategory = (plData?.details?.incomeByCategory || []).map(x => ({
    category: x.category || '—',
    amount: asNum(x.amount),
  }));
  const expensesBySupplier = (plData?.details?.expensesBySupplier || []).map(x => ({
    supplier: x.supplier || '—',
    count: asNum(x.count),
    amount: asNum(x.amount),
  }));

  /* Einnahmen pro Artikel (falls vorhanden), sonst leer */
  const incomeByArticle = (plData?.details?.incomeByArticle || []).map(x => ({
    article: x.article || x.name || '—',
    amount: asNum(x.amount),
    quantity: asNum(x.quantity),
  }));
  const top10 = incomeByArticle.slice(0, 10);

  const incomeByType = plData?.details?.incomeByType || { transactions: 0, invoices: 0, ownerUse: 0 };

  const chartTop = top10.map((a) => ({ artikel: a.article, Einnahmen: a.amount }));

  const downloadEUR = async () => {
    const res = await api.get('/exports/eur', {
      params: {
        startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
        endDate: format(dateRange.endDate, 'yyyy-MM-dd'),
      },
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EUR_${format(dateRange.startDate, 'yyyy-MM-dd')}_${format(dateRange.endDate, 'yyyy-MM-dd')}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  /* Geschäftsjahre */
  const { data: fyData, error: fyError } = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: async () => (await api.get('/accounting/fiscal-years')).data,
  });
  const fiscalYears = fyData?.fiscalYears || [];

  /* Neues Geschäftsjahr */
  const [openNew, setOpenNew] = useState(false);
  const [newFy, setNewFy] = useState({ name: '', startDate: null, endDate: null });

  // << GEÄNDERTER BLOCK: createFY >>
  const createFY = useMutation({
    mutationFn: async () => api.post('/accounting/fiscal-years', {
      name: newFy.name,
      startDate: newFy.startDate ? format(newFy.startDate, 'yyyy-MM-dd') : null,
      endDate: newFy.endDate ? format(newFy.endDate, 'yyyy-MM-dd') : null,
    }),
    onSuccess: (res) => {
      const fy = res?.data?.fiscalYear;
      setOpenNew(false);
      setNewFy({ name: '', startDate: null, endDate: null });
      qc.invalidateQueries(['fiscal-years']);
      if (fy) setCloseTarget(fy); // << direkt in den Abschluss
    },
  });
  // << ENDE: createFY >>

  /* Abschluss */
  const [closeTarget, setCloseTarget] = useState(null);
  const closeFY = useMutation({
    mutationFn: async ({ id, payload }) => api.post(`/accounting/fiscal-years/${id}/close`, payload),
    onSuccess: () => {
      setCloseTarget(null);
      qc.invalidateQueries(['fiscal-years']);
    },
  });

  const downloadFYReport = async (id, name) => {
    const res = await api.get(`/accounting/fiscal-years/${id}/report`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Jahresabschluss_${name || id}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Einnahmen-Überschuss-Rechnung (EÜR)</Typography>

      {/* Zeitraum + Export */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item><DatePicker label="Von" value={dateRange.startDate} onChange={(d) => d && setDateRange(r => ({ ...r, startDate: d }))} /></Grid>
          <Grid item><DatePicker label="Bis" value={dateRange.endDate} onChange={(d) => d && setDateRange(r => ({ ...r, endDate: d }))} /></Grid>
          <Grid item><Button variant="contained" startIcon={<Download />} onClick={downloadEUR}>PDF Export</Button></Grid>
        </Grid>
      </Paper>

      {plError && <Alert severity="error" sx={{ mb: 2 }}>Fehler beim Laden der EÜR.</Alert>}

      {/* Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <KPICard
            title="Einnahmen"
            value={fmt(summary.totalIncome)}
            icon={TrendingUp}
            color="success"
            loading={!plData}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <KPICard
            title="Ausgaben"
            value={fmt(summary.totalExpenses)}
            icon={TrendingDown}
            color="error"
            loading={!plData}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <KPICard
            title="Gewinn/Verlust"
            value={(summary.profit > 0 ? '+' : '') + fmt(summary.profit)}
            icon={AccountBalance}
            color={summary.profit >= 0 ? "info" : "warning"}
            loading={!plData}
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Einnahmen nach Kategorie */}
        <Grid item xs={12} md={6} lg={4}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6" gutterBottom>Einnahmen nach Kategorie</Typography>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow><TableCell>Kategorie</TableCell><TableCell align="right">Betrag</TableCell></TableRow></TableHead>
                  <TableBody>
                    {incomeByCategory.map((cat) => (
                      <TableRow key={cat.category}><TableCell>{cat.category}</TableCell><TableCell align="right">{fmt(cat.amount)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell><strong>Gesamt</strong></TableCell><TableCell align="right"><strong>{fmt(summary.totalIncome)}</strong></TableCell></TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Ausgaben nach Lieferant */}
        <Grid item xs={12} md={6} lg={4}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6" gutterBottom>Ausgaben nach Lieferant</Typography>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow><TableCell>Lieferant</TableCell><TableCell align="right">Anzahl</TableCell><TableCell align="right">Betrag</TableCell></TableRow></TableHead>
                  <TableBody>
                    {expensesBySupplier.map((row) => (
                      <TableRow key={row.supplier}><TableCell>{row.supplier}</TableCell><TableCell align="right">{row.count}</TableCell><TableCell align="right">{fmt(row.amount)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell colSpan={2}><strong>Gesamt</strong></TableCell><TableCell align="right"><strong>{fmt(summary.totalExpenses)}</strong></TableCell></TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Einnahmen nach Typ */}
        <Grid item xs={12} md={6} lg={4}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6" gutterBottom>Einnahmen nach Typ</Typography>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow><TableCell>Typ</TableCell><TableCell align="right">Betrag</TableCell></TableRow></TableHead>
                  <TableBody>
                    <TableRow><TableCell>Barverkäufe & Kundenkonto</TableCell><TableCell align="right">{fmt(incomeByType.transactions)}</TableCell></TableRow>
                    <TableRow><TableCell>Bezahlte Rechnungen</TableCell><TableCell align="right">{fmt(incomeByType.invoices)}</TableCell></TableRow>
                    <TableRow><TableCell>Eigenverbrauch (Sachentnahme)</TableCell><TableCell align="right">{fmt(incomeByType.ownerUse || 0)}</TableCell></TableRow>
                    <TableRow><TableCell><strong>Gesamt</strong></TableCell><TableCell align="right"><strong>{fmt(summary.totalIncome)}</strong></TableCell></TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Einnahmen nach Artikel (Top 10) */}
        <Grid item xs={12} md={12} lg={6}>
          <Card sx={{ height: '100%', minHeight: 400 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Einnahmen nach Artikel (Top 10)</Typography>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartTop} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                  <defs>
                    <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis
                    dataKey="artikel"
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
                  <Tooltip
                    formatter={(v) => fmt(v)}
                    cursor={{ fill: theme.palette.action.hover }}
                    contentStyle={{
                      backgroundColor: theme.palette.background.paper,
                      color: theme.palette.text.primary,
                      borderRadius: 8,
                      border: `1px solid ${theme.palette.divider}`,
                      boxShadow: theme.shadows[4]
                    }}
                    itemStyle={{ color: theme.palette.text.primary }}
                    labelStyle={{ color: theme.palette.text.secondary, marginBottom: '4px' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar
                    dataKey="Einnahmen"
                    fill="url(#colorIncome)"
                    radius={[4, 4, 0, 0]}
                    barSize={isMobile ? 20 : 40}
                  />
                </BarChart>
              </ResponsiveContainer>
              {incomeByArticle.length === 0 && (
                <Typography variant="body2" color="text.secondary">Keine Artikeldaten verfügbar.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>



        {/* Abgelaufen & Eigenverbrauch */}
        {/* Abgelaufen & Eigenverbrauch */}
        <Grid item xs={12} md={6} lg={3}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6" gutterBottom>Abgelaufene Artikel</Typography>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow><TableCell>Artikel</TableCell><TableCell align="right">Menge</TableCell><TableCell align="right">Betrag</TableCell></TableRow></TableHead>
                  <TableBody>
                    {summary.expiredItems.length === 0 ? (
                      <TableRow><TableCell colSpan={3}>Keine Einträge</TableCell></TableRow>
                    ) : summary.expiredItems.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.article}</TableCell>
                        <TableCell align="right">{row.quantity}</TableCell>
                        <TableCell align="right">{fmt(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6} lg={3}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Typography variant="h6" gutterBottom>Eigenverbrauch</Typography>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow><TableCell>Artikel</TableCell><TableCell align="right">Menge</TableCell><TableCell align="right">Betrag</TableCell></TableRow></TableHead>
                  <TableBody>
                    {summary.ownerUseItems.length === 0 ? (
                      <TableRow><TableCell colSpan={3}>Keine Einträge</TableCell></TableRow>
                    ) : summary.ownerUseItems.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.article}</TableCell>
                        <TableCell align="right">{row.quantity}</TableCell>
                        <TableCell align="right">{fmt(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>


      </Grid>

      {/* ============= Geschäftsjahre ============= */}
      <Box sx={{ mt: 5 }}>
        <Grid container spacing={2} alignItems="center" sx={{ mb: 1 }}>
          <Grid item><Typography variant="h4">Geschäftsjahre</Typography></Grid>
          <Grid item><Button variant="contained" startIcon={<Add />} onClick={() => setOpenNew(true)}>Neu</Button></Grid>
        </Grid>

        {fyError && <Alert severity="error" sx={{ mb: 2 }}>Fehler beim Laden der Geschäftsjahre.</Alert>}

        {isMobile ? (
          <Stack spacing={2}>
            {fiscalYears.length === 0 ? (
              <Typography color="text.secondary" align="center">Noch keine Geschäftsjahre.</Typography>
            ) : fiscalYears.map((fy) => (
              <Card key={fy.id} variant="outlined">
                <CardContent sx={{ pb: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="h6">{fy.name}</Typography>
                    {fy.closed ? <Chip color="success" label="Abgeschlossen" size="small" /> : <Chip label="Offen" size="small" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {format(new Date(fy.startDate), 'dd.MM.yyyy')} – {format(new Date(fy.endDate), 'dd.MM.yyyy')}
                  </Typography>
                  <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                    {!fy.closed ? (
                      <Button size="small" variant="contained" onClick={() => setCloseTarget(fy)}>Abschließen</Button>
                    ) : (
                      <Button size="small" variant="outlined" startIcon={<Download />} onClick={() => downloadFYReport(fy.id, fy.name)}>PDF</Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Stack>
        ) : (
          <Card>
            <CardContent>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Zeitraum</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fiscalYears.length === 0 ? (
                    <TableRow><TableCell colSpan={4}>Noch keine Geschäftsjahre.</TableCell></TableRow>
                  ) : fiscalYears.map((fy) => (
                    <TableRow key={fy.id}>
                      <TableCell>{fy.name}</TableCell>
                      <TableCell>{format(new Date(fy.startDate), 'dd.MM.yyyy')} – {format(new Date(fy.endDate), 'dd.MM.yyyy')}</TableCell>
                      <TableCell>{fy.closed ? <Chip color="success" label="Abgeschlossen" size="small" /> : <Chip label="Offen" size="small" />}</TableCell>
                      <TableCell align="right">
                        {!fy.closed ? (
                          <Button size="small" onClick={() => setCloseTarget(fy)}>Abschließen</Button>
                        ) : (
                          <Button size="small" variant="outlined" startIcon={<Download />} onClick={() => downloadFYReport(fy.id, fy.name)}>PDF</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Dialog: Neues Geschäftsjahr */}
      <Dialog open={openNew} onClose={() => setOpenNew(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Geschäftsjahr anlegen</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            fullWidth
            sx={{ mt: 2 }}
            value={newFy.name}
            onChange={(e) => setNewFy((f) => ({ ...f, name: e.target.value }))}
          />
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <DatePicker label="Start" value={newFy.startDate} onChange={(d) => setNewFy(f => ({ ...f, startDate: d }))} />
            <DatePicker label="Ende" value={newFy.endDate} onChange={(d) => setNewFy(f => ({ ...f, endDate: d }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNew(false)}>Abbrechen</Button>
          <Button
            onClick={() => createFY.mutate()}
            disabled={!newFy.name || !newFy.startDate || !newFy.endDate || createFY.isLoading}
            variant="contained"
          >
            {createFY.isLoading ? 'Speichert…' : 'Speichern'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Fullscreen-Abschluss mit Inventur-UI */}
      <CloseYearDialog
        open={!!closeTarget}
        fy={closeTarget}
        onClose={() => setCloseTarget(null)}
        onSubmit={(payload) => closeFY.mutate({ id: closeTarget.id, payload })}
      />
    </Box>
  );
}