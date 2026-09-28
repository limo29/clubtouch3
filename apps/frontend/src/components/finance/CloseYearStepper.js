/**
 * Jahresabschluss als Stepper (ersetzt den 7-Tab-Fullscreen-Dialog):
 *   1 Zeitraum & Kennzahlen · 2 Kasse · 3 Bank · 4 Inventur · 5 Prüfen & abschließen
 * Handy: Fullscreen-Dialog, sonst großer Dialog. Die Barkasse kommt ausschließlich aus einer
 * gespeicherten Kassenzählung (Backend erzwingt das); `cashOnHand` wird nicht mehr gesendet.
 * Inventur in Kisten UND Stück, Payload bleibt `physicalInventory: [{articleId, physicalStock}]`
 * in Basiseinheit.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogActions, Box, Typography, IconButton, Button, Stepper, Step, StepLabel,
  LinearProgress, Alert, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, InputAdornment,
  Chip, Radio, RadioGroup, FormControlLabel, Skeleton, Tabs, Tab, Divider, useTheme, useMediaQuery, Grid,
} from '@mui/material';
import { Close, Add, Delete, Search, PictureAsPdf, Refresh, OpenInNew, DoneAll, Replay } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../../services/api';
import { useArticles } from '../../hooks/useArticles';
import { money, num, qty, qtyShort, unitLabel } from '../../utils/format';
import { crateFactor, hasCrate, fromBaseUnits, toBaseUnits } from '../../utils/units';
import { downloadFile, apiErrorMessage } from '../../utils/download';
import QuantityStepper from '../common/QuantityStepper';

const STEPS = ['Zeitraum & Kennzahlen', 'Kasse', 'Bank', 'Inventur', 'Prüfen & abschließen'];

const fmtDate = (d) => (d ? format(new Date(d), 'dd.MM.yyyy') : '—');
const fmtDateTime = (d) => (d ? format(new Date(d), 'dd.MM.yyyy HH:mm') : '—');
const signedMoney = (v) => (num(v) > 0 ? '+' : '') + money(v);
const emptyBank = () => ({ name: '', iban: '', balance: '' });

/** "3 Kisten + 5 Glas (65)" bzw. "65 Gläser" */
export const describeBase = (total, article) => {
  const t = Math.max(0, num(total));
  if (!hasCrate(article)) return qty(t, article.unit);
  const { crateQty, baseQty } = fromBaseUnits(t, crateFactor(article));
  if (crateQty === 0) return qty(t, article.unit);
  const crates = `${crateQty} ${unitLabel(article.purchaseUnit, crateQty)}`;
  return `${crates}${baseQty > 0 ? ` + ${qtyShort(baseQty, article.unit)}` : ''} (${t})`;
};

/** Differenz in Kisten+Stück mit Vorzeichen: "−2 Kisten + 3 Fl. (−43)" */
const describeDiff = (diff, article) => {
  if (diff === 0) return '±0';
  const sign = diff > 0 ? '+' : '−';
  return `${sign}${describeBase(Math.abs(diff), article)}`;
};

/* ------------------------------- Kennzahlen ------------------------------- */

function KeyValueTable({ rows }) {
  return (
    <Table size="small">
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label}>
            <TableCell sx={{ border: 0, py: 0.75, fontWeight: r.strong ? 800 : 400 }}>{r.label}</TableCell>
            <TableCell align="right" sx={{ border: 0, py: 0.75, whiteSpace: 'nowrap', fontWeight: r.strong ? 800 : 400, color: r.color }}>{r.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StepOverview({ fy, preview, isLoading, error, onRefetch }) {
  if (isLoading) return <Skeleton variant="rounded" height={260} />;
  if (error) return <Alert severity="error">Vorschau konnte nicht geladen werden.</Alert>;
  if (!preview) return null;
  const s = preview.summary || {};
  const profit = num(s.profit);
  const liq = preview.liquidity || {};
  const nr = preview.nonRevenue || {};
  const unpaidPurchase = (preview.unpaidPurchaseDocs || []).reduce((a, d) => a + num(d.totalAmount), 0);
  const unpaidInvoices = (preview.unpaidInvoices || []).reduce((a, d) => a + num(d.totalAmount), 0);
  const needsCount = preview.cashCountRequired && !preview.cashCount;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Zeitraum {fmtDate(fy.startDate)} – {fmtDate(fy.endDate)}
      </Typography>
      {needsCount && (
        <Alert severity="warning">
          <strong>Keine Kassenzählung im Abschlussfenster.</strong> Für den Abschluss muss die Kasse zwischen dem {fmtDate(preview.cashCountWindow?.start || preview.cashCountWindow?.from)} und dem {fmtDate(preview.cashCountWindow?.end || preview.cashCountWindow?.to)} gezählt werden. Danach hier „Neu laden".
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
            <Button color="inherit" size="small" variant="outlined" startIcon={<OpenInNew />} onClick={() => window.open('/cash-count', '_blank', 'noopener')}>Jetzt Kasse zählen</Button>
            <Button color="inherit" size="small" variant="outlined" startIcon={<Refresh />} onClick={onRefetch}>Neu laden</Button>
          </Stack>
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>Einnahmen-Überschuss-Rechnung</Typography>
          <KeyValueTable rows={[
            { label: 'Einnahmen', value: money(s.totalIncome) },
            { label: 'Ausgaben', value: money(s.totalExpenses) },
            { label: profit >= 0 ? 'Überschuss' : 'Verlust', value: signedMoney(profit), strong: true, color: profit >= 0 ? 'success.main' : 'error.main' },
          ]} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>Liquidität & offene Posten</Typography>
          <KeyValueTable rows={[
            { label: `Aufladungen (${liq.topUps?.count ?? 0})`, value: money(liq.topUps?.total) },
            { label: 'Gästeguthaben (Stand Ende)', value: money(liq.guestBalanceEnd) },
            { label: `Offene Eingangsrechnungen (${(preview.unpaidPurchaseDocs || []).length})`, value: money(unpaidPurchase) },
            { label: `Offene Ausgangsrechnungen (${(preview.unpaidInvoices || []).length})`, value: money(unpaidInvoices) },
          ]} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>Nachrichtlich (kein Ertrag)</Typography>
          <KeyValueTable rows={[
            { label: `Eigenverbrauch (${num(nr.ownerUse?.quantity)} Stk.)`, value: money(nr.ownerUse?.value) },
            { label: `Abgelaufen / Schwund (${num(nr.expired?.quantity)} Stk.)`, value: money(nr.expired?.value) },
          ]} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>Kasse</Typography>
          {preview.cashCount ? (
            <KeyValueTable rows={[
              { label: `Zählung vom ${fmtDateTime(preview.cashCount.countedAt)}`, value: money(preview.cashCount.countedTotal) },
              { label: 'Soll laut Herleitung', value: money(preview.cashCount.expectedTotal) },
              { label: 'Differenz', value: signedMoney(preview.cashCount.difference), color: Math.abs(num(preview.cashCount.difference)) < 0.005 ? 'success.main' : 'error.main', strong: true },
            ]} />
          ) : (
            <Typography variant="body2" color="text.secondary">Noch keine Zählung.</Typography>
          )}
        </Grid>
      </Grid>
    </Stack>
  );
}

/* ---------------------------------- Kasse --------------------------------- */

function StepCash({ preview, candidates, selectedId, onSelect }) {
  if (!preview) return <Skeleton variant="rounded" height={160} />;
  const chosen = candidates.find((c) => c.id === selectedId) || preview.cashCount;
  if (!chosen) {
    return (
      <Alert severity="warning">
        Keine Kassenzählung im Abschlussfenster. Bitte zuerst unter „Kasse zählen" zählen und dann in Schritt 1 „Neu laden".
      </Alert>
    );
  }
  const diff = num(chosen.difference);
  return (
    <Stack spacing={2}>
      {candidates.length > 1 && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>Mehrere Zählungen im Fenster – welche gilt für den Abschluss?</Typography>
          <RadioGroup value={selectedId || preview.cashCount?.id || ''} onChange={(e) => onSelect(e.target.value)}>
            {candidates.map((c) => (
              <FormControlLabel
                key={c.id}
                value={c.id}
                control={<Radio />}
                label={`${fmtDateTime(c.countedAt)} · ${money(c.countedTotal)} gezählt · Differenz ${signedMoney(c.difference)}${c.user?.name ? ` · ${c.user.name}` : ''}`}
              />
            ))}
          </RadioGroup>
        </Box>
      )}
      <Box sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
        <Typography variant="overline" color="text.secondary">Kassenzählung (aus dem Vorgang, nicht änderbar)</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {fmtDateTime(chosen.countedAt)} · gezählt von {chosen.countedBy || chosen.user?.name || '—'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mt: 1 }}>
          <Box><Typography variant="caption" color="text.secondary">IST GEZÄHLT</Typography><Typography variant="h5" fontWeight={800}>{money(chosen.countedTotal)}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">SOLL</Typography><Typography variant="h5" fontWeight={800}>{money(chosen.expectedTotal)}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">DIFFERENZ</Typography><Typography variant="h5" fontWeight={800} color={Math.abs(diff) < 0.005 ? 'success.main' : 'error.main'}>{signedMoney(diff)}</Typography></Box>
        </Stack>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Der Kassenbestand des Abschlusses ist immer der Ist-Wert dieser Zählung. Eine Korrektur ist nur über eine neue Zählung möglich.
      </Typography>
    </Stack>
  );
}

/* ---------------------------------- Bank ---------------------------------- */

function StepBank({ banks, setBanks }) {
  const change = (idx, key, val) => setBanks((b) => b.map((x, i) => (i === idx ? { ...x, [key]: val } : x)));
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">Kontostände zum Stichtag. IBAN ist optional; leere Zeilen werden ignoriert.</Typography>
      {banks.map((b, idx) => (
        <Grid container spacing={1.5} key={idx} alignItems="center">
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Name" value={b.name} onChange={(e) => change(idx, 'name', e.target.value)} fullWidth size="small" /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="IBAN (optional)" value={b.iban} onChange={(e) => change(idx, 'iban', e.target.value)} fullWidth size="small" /></Grid>
          <Grid size={{ xs: 9, sm: 3 }}>
            <TextField
              label="Kontostand" value={b.balance} onChange={(e) => change(idx, 'balance', e.target.value)} fullWidth size="small"
              inputMode="decimal"
              InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment> }}
            />
          </Grid>
          <Grid size={{ xs: 3, sm: 1 }} sx={{ textAlign: 'right' }}>
            <IconButton onClick={() => setBanks((list) => list.filter((_, i) => i !== idx))} aria-label="Konto entfernen" disabled={banks.length === 1 && !b.name && !b.iban && !b.balance}><Delete /></IconButton>
          </Grid>
        </Grid>
      ))}
      <Box><Button size="small" startIcon={<Add />} onClick={() => setBanks((b) => [...b, emptyBank()])}>Konto hinzufügen</Button></Box>
    </Stack>
  );
}

/* --------------------------------- Inventur -------------------------------- */

function InventoryRow({ article, systemStock, counted, onChange, onSystem }) {
  const factor = crateFactor(article);
  const crate = hasCrate(article);
  const c = counted || { crateQty: 0, baseQty: 0 };
  const total = counted ? toBaseUnits(c.crateQty, c.baseQty, factor) : null;
  const diff = counted ? total - systemStock : null;
  const diffValue = diff === null ? 0 : diff * num(article.price);
  const diffColor = diff === null ? 'text.disabled' : diff === 0 ? 'success.main' : 'error.main';
  const set = (patch) => onChange({ crateQty: c.crateQty, baseQty: c.baseQty, ...patch });

  return (
    <Box sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1, md: 2 }} alignItems={{ md: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} sx={{ lineHeight: 1.25 }}>{article.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            System: {describeBase(systemStock, article)}{crate && ` · 1 ${article.purchaseUnit} = ${qty(factor, article.unit)}`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {crate && (
            <QuantityStepper
              value={c.crateQty} unit={article.purchaseUnit} aria-label={`${article.name} ${article.purchaseUnit}`}
              onDelta={(d) => set({ crateQty: Math.max(0, c.crateQty + d) })}
              onSet={(v) => set({ crateQty: v })}
            />
          )}
          <QuantityStepper
            value={c.baseQty} unit={article.unit} aria-label={`${article.name} ${article.unit}`}
            onDelta={(d) => set({ baseQty: Math.max(0, c.baseQty + d) })}
            onSet={(v) => set({ baseQty: v })}
          />
          <Button size="small" onClick={onSystem} startIcon={<Replay fontSize="small" />} sx={{ whiteSpace: 'nowrap' }}>wie System</Button>
        </Stack>
        <Box sx={{ minWidth: { md: 200 }, textAlign: { md: 'right' } }}>
          {counted ? (
            <>
              <Typography variant="body2" fontWeight={700} color={diffColor}>{describeDiff(diff, article)}</Typography>
              <Typography variant="caption" color={diffColor}>{signedMoney(diffValue)} · gezählt {total}</Typography>
            </>
          ) : (
            <Chip size="small" variant="outlined" label="nicht gezählt" />
          )}
        </Box>
      </Stack>
    </Box>
  );
}

function StepInventory({ articles, systemStockById, counts, setCounts }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const categories = useMemo(() => ['all', ...new Set(articles.map((a) => a.category).filter(Boolean))], [articles]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return articles.filter((a) => (category === 'all' || a.category === category) && (!s || a.name.toLowerCase().includes(s)));
  }, [articles, search, category]);
  const countedN = articles.filter((a) => counts[a.id]).length;

  const takeSystem = (list) => setCounts((prev) => {
    const next = { ...prev };
    for (const a of list) next[a.id] = fromBaseUnits(systemStockById.get(a.id) ?? a.stock, crateFactor(a));
    return next;
  });

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <TextField
          placeholder="Artikel suchen…" size="small" value={search} onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
          sx={{ flex: 1 }}
        />
        <Button variant="outlined" startIcon={<DoneAll />} onClick={() => takeSystem(articles)} sx={{ whiteSpace: 'nowrap' }}>Alle wie System übernehmen</Button>
      </Stack>
      <Tabs value={categories.includes(category) ? category : 'all'} onChange={(e, v) => setCategory(v)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}>
        {categories.map((c) => <Tab key={c} value={c} label={c === 'all' ? 'Alle' : c} />)}
      </Tabs>
      <Typography variant="caption" color="text.secondary">{countedN} von {articles.length} Artikeln gezählt. Nicht gezählte Artikel werden im Abschluss nicht bewertet.</Typography>
      <Box>
        {filtered.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Keine Artikel gefunden.</Typography>
        ) : filtered.map((a) => (
          <InventoryRow
            key={a.id}
            article={a}
            systemStock={systemStockById.get(a.id) ?? a.stock}
            counted={counts[a.id]}
            onChange={(v) => setCounts((prev) => ({ ...prev, [a.id]: v }))}
            onSystem={() => takeSystem([a])}
          />
        ))}
      </Box>
    </Stack>
  );
}

/* --------------------------------- Prüfen --------------------------------- */

function StepReview({ fy, preview, chosenCount, banks, articles, systemStockById, counts, error }) {
  const s = preview?.summary || {};
  const profit = num(s.profit);
  const validBanks = banks.filter((b) => b.name || b.iban || b.balance);
  const bankTotal = validBanks.reduce((a, b) => a + num(b.balance), 0);
  const inventoryRows = articles
    .filter((a) => counts[a.id])
    .map((a) => {
      const system = systemStockById.get(a.id) ?? a.stock;
      const counted = toBaseUnits(counts[a.id].crateQty, counts[a.id].baseQty, crateFactor(a));
      return { a, system, counted, diff: counted - system, value: (counted - system) * num(a.price) };
    });
  const deviations = inventoryRows.filter((r) => r.diff !== 0);
  const deviationValue = deviations.reduce((x, r) => x + r.value, 0);
  const uncounted = articles.length - inventoryRows.length;

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {!chosenCount && <Alert severity="error">Ohne Kassenzählung im Abschlussfenster kann das Geschäftsjahr nicht abgeschlossen werden.</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>Geschäftsjahr</Typography>
          <KeyValueTable rows={[
            { label: 'Name', value: fy.name },
            { label: 'Zeitraum', value: `${fmtDate(fy.startDate)} – ${fmtDate(fy.endDate)}` },
            { label: 'Einnahmen', value: money(s.totalIncome) },
            { label: 'Ausgaben', value: money(s.totalExpenses) },
            { label: profit >= 0 ? 'Überschuss' : 'Verlust', value: signedMoney(profit), strong: true, color: profit >= 0 ? 'success.main' : 'error.main' },
          ]} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>Kasse & Bank</Typography>
          <KeyValueTable rows={[
            { label: chosenCount ? `Kasse gezählt am ${fmtDateTime(chosenCount.countedAt)}` : 'Kasse', value: chosenCount ? money(chosenCount.countedTotal) : '—' },
            { label: 'Kassendifferenz', value: chosenCount ? signedMoney(chosenCount.difference) : '—', color: chosenCount && Math.abs(num(chosenCount.difference)) >= 0.005 ? 'error.main' : undefined },
            { label: `Bankkonten (${validBanks.length})`, value: money(bankTotal) },
            ...validBanks.map((b) => ({ label: `· ${b.name || b.iban || 'Konto'}`, value: money(b.balance) })),
          ]} />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" gutterBottom>
            Inventur: {inventoryRows.length} gezählt, {deviations.length} Abweichung{deviations.length === 1 ? '' : 'en'}{uncounted > 0 ? `, ${uncounted} nicht gezählt` : ''}
          </Typography>
          {deviations.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Keine Abweichungen zum Systembestand.</Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Artikel</TableCell>
                    <TableCell align="right">System</TableCell>
                    <TableCell align="right">Gezählt</TableCell>
                    <TableCell align="right">Differenz</TableCell>
                    <TableCell align="right">Wert (VK)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deviations.map((r) => (
                    <TableRow key={r.a.id} sx={{ '& td': { color: 'error.main', fontWeight: 600 } }}>
                      <TableCell>{r.a.name}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{describeBase(r.system, r.a)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{describeBase(r.counted, r.a)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{describeDiff(r.diff, r.a)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{signedMoney(r.value)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} sx={{ fontWeight: 800 }}>Summe Abweichungen</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{signedMoney(deviationValue)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
          )}
        </Grid>
      </Grid>
    </Stack>
  );
}

/* ---------------------------------- Dialog --------------------------------- */

export default function CloseYearStepper({ open, fy, onClose, onClosed }) {
  const qc = useQueryClient();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));

  const [activeStep, setActiveStep] = useState(0);
  const [banks, setBanks] = useState([emptyBank()]);
  const [counts, setCounts] = useState({});
  const [selectedCountId, setSelectedCountId] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) {
      setActiveStep(0); setBanks([emptyBank()]); setCounts({}); setSelectedCountId(null); setError(null); setResult(null);
    }
  }, [open]);

  const { data: preview, isLoading: previewLoading, error: previewError, refetch } = useQuery({
    queryKey: ['fy-preview', fy?.id],
    queryFn: async () => (await api.get(`/accounting/fiscal-years/${fy.id}/preview`)).data.preview,
    enabled: open && !!fy?.id,
    staleTime: 0,
  });

  const { data: countsData } = useQuery({
    queryKey: ['cash-counts', 'list'],
    queryFn: async () => (await api.get('/cash-counts', { params: { limit: 50 } })).data,
    enabled: open,
  });

  const { articles } = useArticles();
  const systemStockById = useMemo(
    () => new Map((preview?.inventorySystem || []).map((r) => [r.articleId, num(r.systemStock ?? r.stock)])),
    [preview]
  );

  const candidates = useMemo(() => {
    const w = preview?.cashCountWindow;
    if (!w) return [];
    const start = new Date(w.start || w.from).getTime();
    const end = new Date(w.end || w.to).getTime();
    return (countsData?.cashCounts || []).filter((c) => {
      const t = new Date(c.countedAt).getTime();
      return t >= start && t <= end;
    });
  }, [preview, countsData]);

  const chosenCount = candidates.find((c) => c.id === selectedCountId) || preview?.cashCount || null;

  const closeMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        bankAccounts: banks.filter((b) => b.name || b.iban || b.balance).map((b) => ({ name: b.name, iban: b.iban, balance: num(b.balance) })),
        physicalInventory: articles
          .filter((a) => counts[a.id])
          .map((a) => ({ articleId: a.id, physicalStock: toBaseUnits(counts[a.id].crateQty, counts[a.id].baseQty, crateFactor(a)) })),
      };
      if (chosenCount?.id) payload.cashCountId = chosenCount.id;
      return (await api.post(`/accounting/fiscal-years/${fy.id}/close`, payload)).data;
    },
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      qc.invalidateQueries({ queryKey: ['fiscal-years'] });
      qc.invalidateQueries({ queryKey: ['fy-preview', fy?.id] });
      onClosed?.(data);
    },
    onError: async (err) => setError(await apiErrorMessage(err, 'Abschluss fehlgeschlagen.')),
  });

  const downloadReport = async () => {
    try {
      await downloadFile(`/accounting/fiscal-years/${fy.id}/report`, { filename: `Jahresabschluss_${fy.name || fy.id}.pdf` });
    } catch (err) {
      setError(await apiErrorMessage(err, 'PDF konnte nicht geladen werden.'));
    }
  };

  if (!fy) return null;
  const last = activeStep === STEPS.length - 1;
  const nextDisabled = activeStep === 0 && (previewLoading || !!previewError);

  return (
    <Dialog open={open} onClose={closeMutation.isPending ? undefined : onClose} fullScreen={fullScreen} maxWidth="lg" fullWidth
      PaperProps={{ sx: fullScreen ? {} : { height: '90vh' } }}>
      <Box sx={{ px: { xs: 1.5, sm: 3 }, pt: { xs: 1, sm: 2 }, pb: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" noWrap>Geschäftsjahr abschließen – {fy.name}</Typography>
          <Typography variant="body2" color="text.secondary">{fmtDate(fy.startDate)} – {fmtDate(fy.endDate)}</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Schließen" disabled={closeMutation.isPending}><Close /></IconButton>
      </Box>

      {!result && (
        <Box sx={{ px: { xs: 1.5, sm: 3 }, pt: 2 }}>
          {fullScreen ? (
            <Box>
              <Typography variant="subtitle2">Schritt {activeStep + 1} von {STEPS.length} · {STEPS[activeStep]}</Typography>
              <LinearProgress variant="determinate" value={((activeStep + 1) / STEPS.length) * 100} sx={{ mt: 1, borderRadius: 1 }} />
            </Box>
          ) : (
            <Stepper activeStep={activeStep} alternativeLabel>
              {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
            </Stepper>
          )}
        </Box>
      )}

      <DialogContent sx={{ px: { xs: 1.5, sm: 3 } }}>
        {result ? (
          <Stack spacing={2} alignItems="center" sx={{ py: 4, textAlign: 'center' }}>
            <Chip color="success" label="Abgeschlossen" />
            <Typography variant="h5" fontWeight={800}>Geschäftsjahr „{fy.name}" ist abgeschlossen.</Typography>
            <Typography color="text.secondary">Der Jahresabschluss ist eingefroren; das PDF wird aus dem gespeicherten Snapshot erzeugt.</Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <Button variant="contained" startIcon={<PictureAsPdf />} onClick={downloadReport}>PDF Jahresabschluss</Button>
          </Stack>
        ) : (
          <>
            {activeStep === 0 && <StepOverview fy={fy} preview={preview} isLoading={previewLoading} error={previewError} onRefetch={() => refetch()} />}
            {activeStep === 1 && <StepCash preview={preview} candidates={candidates} selectedId={selectedCountId} onSelect={setSelectedCountId} />}
            {activeStep === 2 && <StepBank banks={banks} setBanks={setBanks} />}
            {activeStep === 3 && <StepInventory articles={articles} systemStockById={systemStockById} counts={counts} setCounts={setCounts} />}
            {activeStep === 4 && (
              <StepReview fy={fy} preview={preview} chosenCount={chosenCount} banks={banks} articles={articles} systemStockById={systemStockById} counts={counts} error={error} />
            )}
          </>
        )}
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: { xs: 1.5, sm: 3 }, py: 1.5, gap: 1 }}>
        {result ? (
          <Button variant="contained" onClick={onClose}>Schließen</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={closeMutation.isPending} sx={{ mr: 'auto' }}>Abbrechen</Button>
            <Button onClick={() => setActiveStep((s) => Math.max(0, s - 1))} disabled={activeStep === 0 || closeMutation.isPending}>Zurück</Button>
            {last ? (
              <Button
                variant="contained"
                color="primary"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending || !preview || !chosenCount}
              >
                {closeMutation.isPending ? 'Schließt ab…' : 'Geschäftsjahr abschließen'}
              </Button>
            ) : (
              <Button variant="contained" onClick={() => setActiveStep((s) => s + 1)} disabled={nextDisabled}>Weiter</Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
