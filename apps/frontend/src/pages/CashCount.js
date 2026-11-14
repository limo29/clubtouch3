/**
 * Kasse & Bank (Route /cash-count) – eine Seite:
 *   oben Kasse (Soll, „Kasse zählen“) und Bank (Bank-Soll, „Kontostand abgleichen“) nebeneinander,
 *   darunter die Kassenbewegungen als Knöpfe, die kompakte Soll-Herleitung und das Kassenbuch
 *   (Zeitraum, Standard „seit letzter Zählung“), unten aufklappbar die Bank-Details.
 * „Zur Bank gebracht“ ändert Kasse und Bank – beide Karten zeigen die Wirkung sofort.
 * ?tab=bank (alte Links) klappt die Bank-Details auf und scrollt dorthin.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Link, Skeleton, Stack,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  AccountBalance, ChevronRight, DeleteOutline, ExpandLess, ExpandMore, MenuBook, PictureAsPdf, PointOfSale, Savings, Undo,
} from '@mui/icons-material';
import { DatePicker } from '../components/common/SafeDatePickers';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfDay, format, isToday, isYesterday, startOfDay, subDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { money, num } from '../utils/format';
import { downloadFile, apiErrorMessage } from '../utils/download';
import { useAuth } from '../context/AuthContext';
import BankDetails, { BankStatusCard, useBankData } from '../components/finance/BankOverview';
import { CASH_COUNTS_QUERY_KEY } from '../components/finance/CashCountForm';
import CountDialog from '../components/finance/CountDialog';
import MovementDialog, { MOVEMENT_ACTIONS } from '../components/finance/MovementDialog';
import BankBalanceDialog from '../components/finance/BankBalanceDialog';
import { FilterChips } from '../components/common/StickyToolbar';

export { CASH_COUNTS_QUERY_KEY };

const signed = (v) => (num(v) > 0.004 ? '+' : '') + money(v);
const dayLabel = (d) => (isToday(d) ? 'Heute' : isYesterday(d) ? 'Gestern' : format(d, 'EEEE, d. MMMM yyyy', { locale: de }));

/* ------------------------------ Soll-Herleitung ------------------------------ */

function ExpectedBreakdown({ preview, onShowBook }) {
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  if (!preview) return <Skeleton variant="rounded" height={200} />;
  const c = preview.counts || {};
  const t = (x) => num(x?.total);
  const rows = [
    { label: `Bar-Verkäufe (${c.sales ?? 0})`, value: num(preview.cashSales), to: '/transactions' },
    { label: `Stornos bar (${c.refunds ?? 0})`, value: num(preview.cashRefunds), to: '/transactions' },
    { label: `Bar-Aufladungen (${c.topUps ?? 0})`, value: num(preview.cashTopUps), to: '/transactions' },
    { label: `Bar bezahlte Kundenrechnungen (${preview.cashInvoices?.count ?? 0})`, value: t(preview.cashInvoices), to: '/invoices' },
    { label: `Bar bezahlte Einkäufe (${c.expenses ?? 0})`, value: -num(preview.cashExpenses), to: '/purchases' },
    { label: `Zur Bank gebracht (${preview.bankDeposits?.count ?? 0})`, value: -t(preview.bankDeposits), book: true },
    { label: `Wechselgeld geholt (${preview.bankWithdrawals?.count ?? 0})`, value: t(preview.bankWithdrawals), book: true },
    { label: `Sonstige Einnahmen (${preview.otherIncome?.count ?? 0})`, value: t(preview.otherIncome), book: true },
    { label: `Sonstige Ausgaben (${preview.otherExpense?.count ?? 0})`, value: -t(preview.otherExpense), book: true },
  ];
  const nonzero = rows.filter((r) => Math.abs(r.value) >= 0.005);
  const shown = all ? rows : nonzero;
  const line = (labelNode, value, opts = {}) => (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75, ...(opts.rule ? { borderTop: '2px solid', borderColor: 'divider', mt: 0.5, pt: 1 } : {}) }}>
      <Box sx={{ minWidth: 0 }}>{labelNode}</Box>
      <Typography sx={{ fontWeight: opts.strong ? 800 : 500, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: opts.color }}>{opts.raw ? value : signed(value)}</Typography>
    </Stack>
  );
  return (
    <Box>
      {line(
        <Typography fontWeight={700}>{preview.hasBaseline ? `${preview.previousCount?.isOpening ? 'Anfangsbestand' : 'Letzte Zählung'} ${format(new Date(preview.previousCount?.countedAt || preview.since), 'dd.MM. HH:mm')}` : 'Kein Anfangsbestand'}</Typography>,
        money(preview.baseline), { raw: true, strong: true },
      )}
      {shown.map((r) => line(
        r.to ? <Link component="button" type="button" onClick={() => navigate(r.to)} underline="hover" color="inherit" sx={{ textAlign: 'left' }}>{r.label}</Link>
          : <Link component="button" type="button" onClick={onShowBook} underline="hover" color="inherit" sx={{ textAlign: 'left' }}>{r.label}</Link>,
        r.value, { color: Math.abs(r.value) < 0.005 ? 'text.disabled' : r.value > 0 ? 'success.main' : 'error.main' },
      ))}
      {shown.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 0.75 }}>Seitdem keine Bewegungen.</Typography>}
      {line(<Typography fontWeight={800}>= Soll in der Kasse</Typography>, money(preview.expectedTotal), { raw: true, strong: true, rule: true })}
      {rows.length > nonzero.length && (
        <Button size="small" onClick={() => setAll((a) => !a)} sx={{ mt: 0.5 }}>{all ? 'Nur Posten mit Betrag' : `Alle Posten zeigen (${rows.length - nonzero.length} ohne Betrag)`}</Button>
      )}
    </Box>
  );
}

/* --------------------------------- Kassenbuch -------------------------------- */

function bookDays(counts, movements, start, end) {
  const inRange = (d) => (!start || d >= start) && (!end || d <= end);
  const list = [
    ...counts.map((cc) => ({ kind: 'COUNT', id: cc.id, date: new Date(cc.countedAt), data: cc })),
    ...movements.map((m) => ({ kind: 'MOVE', id: m.id, date: new Date(m.occurredAt), data: m })),
  ].filter((e) => inRange(e.date)).sort((a, b) => b.date - a.date);
  const days = [];
  for (const e of list) {
    const key = format(e.date, 'yyyy-MM-dd');
    if (!days.length || days[days.length - 1].key !== key) days.push({ key, date: startOfDay(e.date), items: [] });
    days[days.length - 1].items.push(e);
  }
  return { days, count: list.length };
}

function BookRow({ e, onOpen }) {
  let Icon; let title; let sub; let right;
  if (e.kind === 'COUNT') {
    const cc = e.data;
    Icon = Savings;
    title = cc.isOpening ? 'Anfangsbestand' : 'Kassenzählung';
    sub = `Ist ${money(cc.countedTotal)}${cc.user?.name ? ` · ${cc.user.name}` : ''}`;
    const ok = Math.abs(num(cc.difference)) < 0.005;
    right = cc.isOpening ? <Chip size="small" label="Start" variant="outlined" />
      : <Chip size="small" color={ok ? 'success' : 'error'} variant={ok ? 'outlined' : 'filled'} label={ok ? 'stimmt' : signed(cc.difference)} />;
  } else {
    const m = e.data;
    const meta = MOVEMENT_ACTIONS[m.type] || MOVEMENT_ACTIONS.OTHER_INCOME;
    Icon = m.cancelled ? Undo : meta.Icon;
    title = meta.title;
    sub = [m.note, m.bankAccount, m.user?.name].filter(Boolean).join(' · ') || ' ';
    right = (
      <Typography fontWeight={800} sx={{ whiteSpace: 'nowrap', textDecoration: m.cancelled ? 'line-through' : 'none', color: m.cancelled ? 'text.disabled' : meta.sign > 0 ? 'success.main' : 'error.main' }}>
        {meta.sign > 0 ? '+' : '−'}{money(m.amount)}
      </Typography>
    );
  }
  return (
    <Box onClick={() => onOpen(e)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e)}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.1, cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' }, '&:hover': { bgcolor: 'action.hover' }, opacity: e.data.cancelled ? 0.6 : 1 }}>
      <Avatar sx={{ width: 34, height: 34, bgcolor: 'action.hover', color: 'text.secondary' }}><Icon fontSize="small" /></Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={700} noWrap>{title}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{format(e.date, 'HH:mm')} · {sub}</Typography>
      </Box>
      {right}
      <ChevronRight sx={{ color: 'text.disabled' }} />
    </Box>
  );
}

const PERIODS = [
  { key: 'since', label: 'Seit letzter Zählung' },
  { key: 'today', label: 'Heute', days: 0 },
  { key: '7', label: '7 Tage', days: 6 },
  { key: '30', label: '30 Tage', days: 29 },
  { key: 'custom', label: 'Zeitraum…' },
];

/* --------------------------------- Seite --------------------------------- */

export default function CashCount() {
  const qc = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { can } = useAuth();
  const canCount = can('countCash');
  const canCancel = can('cancelCashMovements');
  const canManage = can('manageBank');
  const [searchParams, setSearchParams] = useSearchParams();

  const [counting, setCounting] = useState(false);
  const [movement, setMovement] = useState(null); // { type, preset }
  const [bankDialog, setBankDialog] = useState(null); // 'opening' | 'check'
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('since');
  const [range, setRange] = useState({ start: null, end: null });
  const [bankOpen, setBankOpen] = useState(false);
  const bookRef = useRef(null);
  const bankRef = useRef(null);

  // alte Links ?tab=bank: Bank-Details aufklappen und hinscrollen
  useEffect(() => {
    if (searchParams.get('tab') !== 'bank') return;
    setBankOpen(true);
    setSearchParams({}, { replace: true });
    setTimeout(() => bankRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
  }, [searchParams, setSearchParams]);

  const { data: preview } = useQuery({
    queryKey: [...CASH_COUNTS_QUERY_KEY, 'preview'],
    queryFn: async () => (await api.get('/cash-counts/preview')).data,
    staleTime: 0,
  });
  const { data: settings } = useQuery({
    queryKey: [...CASH_COUNTS_QUERY_KEY, 'settings'],
    queryFn: async () => (await api.get('/cash-counts/settings')).data,
  });
  const bank = useBankData();

  // Zeitraum des Kassenbuchs (Standard: seit letzter Zählung, ohne Zählung: alles)
  const { start, end } = useMemo(() => {
    const today0 = startOfDay(new Date());
    const p = PERIODS.find((x) => x.key === period);
    if (period === 'since') return { start: preview?.since ? new Date(preview.since) : null, end: null };
    if (period === 'custom') return { start: range.start ? startOfDay(range.start) : null, end: range.end ? endOfDay(range.end) : null };
    return { start: subDays(today0, p.days), end: null };
  }, [period, range, preview]);

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: [...CASH_COUNTS_QUERY_KEY, 'list', 200],
    queryFn: async () => (await api.get('/cash-counts', { params: { limit: 200 } })).data,
  });
  const fromParam = start ? format(start, 'yyyy-MM-dd') : undefined;
  const toParam = end ? format(end, 'yyyy-MM-dd') : undefined;
  const { data: movementsData, isLoading: movLoading } = useQuery({
    queryKey: ['cash-movements', 'book', fromParam || '', toParam || ''],
    queryFn: async () => (await api.get('/cash-movements', { params: { from: fromParam, to: toParam, limit: 500 } })).data,
    staleTime: 0,
  });
  const book = useMemo(() => bookDays(listData?.cashCounts || [], movementsData?.cashMovements || [], start, end), [listData, movementsData, start, end]);

  const cancelMovement = useMutation({
    mutationFn: async (id) => (await api.post(`/cash-movements/${id}/cancel`)).data,
    onSuccess: () => {
      setDetail(null);
      qc.invalidateQueries({ queryKey: ['cash-movements'] });
      qc.invalidateQueries({ queryKey: CASH_COUNTS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['bank-balances'] });
    },
    onError: async (err) => setError(await apiErrorMessage(err, 'Storno fehlgeschlagen.')),
  });

  const pdf = async (cc) => {
    try {
      await downloadFile(`/cash-counts/${cc.id}/pdf`, { filename: `Kassenzaehlung_${format(new Date(cc.countedAt), 'yyyy-MM-dd_HHmm')}.pdf` });
    } catch (err) {
      setError(await apiErrorMessage(err, 'PDF konnte nicht geladen werden.'));
    }
  };

  const noBaseline = preview && !preview.hasBaseline;
  const noBankOpening = !bank.opening && !bank.lastClosed && !bank.balLoading;
  const float = num(settings?.float);
  const periodOptions = PERIODS.map((p) => ({
    key: p.key,
    label: p.key === 'since' && !preview?.hasBaseline ? 'Alles'
      : p.key === 'custom' && period === 'custom' && (range.start || range.end)
        ? `${range.start ? format(range.start, 'd.M.') : '…'} – ${range.end ? format(range.end, 'd.M.yy') : 'heute'}` : p.label,
  }));

  return (
    <Box sx={{ pb: 6 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack spacing={{ xs: 2, md: 3 }}>
        {/* Kasse | Bank */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 2, md: 3 } }}>
          <Card sx={{ p: { xs: 2, sm: 2.5 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <PointOfSale color="primary" fontSize="small" />
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Soll in der Kasse</Typography>
            </Stack>
            <Typography variant="h3" sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, fontSize: { xs: '2.4rem', md: '3rem' } }}>
              {preview ? money(preview.expectedTotal) : '…'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {!preview ? ' ' : preview.hasBaseline
                ? `seit ${preview.previousCount?.isOpening ? 'Anfangsbestand' : 'Zählung'} am ${format(new Date(preview.previousCount?.countedAt || preview.since), 'dd.MM.yyyy HH:mm')}`
                : 'noch kein Anfangsbestand – startet bei 0,00 €'}
              {float > 0 && <> · Sockel {money(float)}</>}
            </Typography>
            <Box sx={{ flex: 1, minHeight: 12 }} />
            {canCount && (
              <Button variant="contained" size="large" startIcon={<Savings />} onClick={() => setCounting(true)} sx={{ py: 1.25 }}>Kasse zählen</Button>
            )}
          </Card>
          <BankStatusCard bank={bank} canManage={canManage} onCheck={() => setBankDialog('check')} />
        </Box>

        {/* Kassenbewegungen */}
        {canCount && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1 }}>
            {Object.entries(MOVEMENT_ACTIONS).map(([type, m]) => (
              <Button key={type} variant="outlined" color={m.color} startIcon={<m.Icon />} onClick={() => setMovement({ type })}
                sx={{ justifyContent: 'flex-start', py: 1, lineHeight: 1.2, textAlign: 'left', bgcolor: 'background.paper' }}>
                {m.label}
              </Button>
            ))}
          </Box>
        )}

        {(noBaseline || noBankOpening) && canManage && (
          <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => setBankDialog('opening')} sx={{ whiteSpace: 'nowrap' }}>Anfangsstände erfassen</Button>}>
            {noBaseline && noBankOpening ? 'Noch keine Anfangsstände für Kasse und Bank.' : noBaseline ? 'Noch kein Anfangsbestand für die Kasse.' : 'Noch kein Anfangsstand für die Bank.'}
            {' '}Ohne sie stimmen Kassen-Soll und Bank-Soll erst ab der ersten Zählung bzw. dem ersten Jahresabschluss.
          </Alert>
        )}

        {/* Herleitung | Kassenbuch */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr', lg: '1fr 1.6fr' }, gap: { xs: 2, md: 3 }, alignItems: 'start' }}>
          <Card sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ fontSize: '1.05rem', mb: 1 }}>So setzt sich das Kassen-Soll zusammen</Typography>
            <ExpectedBreakdown preview={preview} onShowBook={() => { setPeriod('since'); bookRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
          </Card>

          <Card ref={bookRef}>
            <Box sx={{ px: 2, pt: 1.5, pb: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <MenuBook color="action" />
                <Typography variant="h6" sx={{ fontSize: '1.05rem', flex: 1 }}>Kassenbuch</Typography>
                <Typography variant="body2" color="text.secondary">{book.count} {book.count === 1 ? 'Eintrag' : 'Einträge'}</Typography>
              </Stack>
              <FilterChips value={period} onChange={setPeriod} fallback="since" options={periodOptions} />
              {period === 'custom' && (
                <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
                  <DatePicker label="Von" value={range.start} onChange={(v) => setRange((r) => ({ ...r, start: v }))} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
                  <DatePicker label="Bis" value={range.end} onChange={(v) => setRange((r) => ({ ...r, end: v }))} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
                </Stack>
              )}
            </Box>
            {listLoading || movLoading ? <Skeleton variant="rectangular" height={160} /> : book.days.length === 0 ? (
              <Typography color="text.secondary" sx={{ p: 2 }}>Keine Zählungen oder Kassenbewegungen in diesem Zeitraum.</Typography>
            ) : book.days.map((d) => (
              <Box key={d.key}>
                <Typography variant="body2" sx={{ px: 2, py: 0.75, fontWeight: 800, bgcolor: 'action.hover' }}>{dayLabel(d.date)}</Typography>
                {d.items.map((e) => <BookRow key={`${e.kind}-${e.id}`} e={e} onOpen={setDetail} />)}
              </Box>
            ))}
          </Card>
        </Box>

        {/* Bank-Details (aufklappbar) */}
        <Card ref={bankRef}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.5, cursor: 'pointer' }} onClick={() => setBankOpen((o) => !o)}>
            <AccountBalance color="action" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontSize: '1.05rem' }}>Bank-Details</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>Konten, Abgleiche mit dem Kontoauszug, Herleitung des Bank-Solls</Typography>
            </Box>
            {bankOpen ? <ExpandLess /> : <ExpandMore />}
          </Stack>
          <Collapse in={bankOpen} unmountOnExit>
            <Box sx={{ px: 2, pb: 2 }}><BankDetails bank={bank} canManage={canManage} /></Box>
          </Collapse>
        </Card>
      </Stack>

      {/* Details aus dem Kassenbuch */}
      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        {detail && detail.kind === 'COUNT' && (() => {
          const cc = detail.data;
          return (
            <>
              <DialogTitle>{cc.isOpening ? 'Anfangsbestand' : 'Kassenzählung'}<Typography variant="body2" color="text.secondary">{format(new Date(cc.countedAt), "EEEE, d. MMMM yyyy 'um' HH:mm", { locale: de })}{cc.user?.name ? ` · ${cc.user.name}` : ''}</Typography></DialogTitle>
              <DialogContent>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Ist gezählt</Typography><Typography fontWeight={700}>{money(cc.countedTotal)}</Typography></Stack>
                  {!cc.isOpening && <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Soll</Typography><Typography fontWeight={700}>{money(cc.expectedTotal)}</Typography></Stack>}
                  {!cc.isOpening && <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Differenz</Typography><Typography fontWeight={800} color={Math.abs(num(cc.difference)) < 0.005 ? 'success.main' : 'error.main'}>{signed(cc.difference)}</Typography></Stack>}
                  {cc.note && <Alert severity="info" icon={false}>{cc.note}</Alert>}
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button startIcon={<PictureAsPdf />} onClick={() => pdf(cc)} sx={{ mr: 'auto' }}>PDF</Button>
                <Button variant="contained" onClick={() => setDetail(null)}>Schließen</Button>
              </DialogActions>
            </>
          );
        })()}
        {detail && detail.kind === 'MOVE' && (() => {
          const m = detail.data;
          const meta = MOVEMENT_ACTIONS[m.type] || MOVEMENT_ACTIONS.OTHER_INCOME;
          return (
            <>
              <DialogTitle>{meta.title}<Typography variant="body2" color="text.secondary">{format(new Date(m.occurredAt), "EEEE, d. MMMM yyyy 'um' HH:mm", { locale: de })}{m.user?.name ? ` · ${m.user.name}` : ''}</Typography></DialogTitle>
              <DialogContent>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Betrag</Typography>
                    <Typography fontWeight={800} sx={{ textDecoration: m.cancelled ? 'line-through' : 'none' }} color={meta.sign > 0 ? 'success.main' : 'error.main'}>{meta.sign > 0 ? '+' : '−'}{money(m.amount)}</Typography></Stack>
                  {meta.bank && <Typography variant="body2" color="text.secondary">Wirkt auf Kasse und Bank.</Typography>}
                  {m.bankAccount && <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Bankkonto</Typography><Typography fontWeight={600}>{m.bankAccount}</Typography></Stack>}
                  {m.note && <Stack direction="row" justifyContent="space-between" spacing={2}><Typography color="text.secondary">Notiz</Typography><Typography fontWeight={600} sx={{ textAlign: 'right' }}>{m.note}</Typography></Stack>}
                  {m.cancelled && <Alert severity="warning">Storniert{m.cancelledAt ? ` am ${format(new Date(m.cancelledAt), 'dd.MM.yyyy HH:mm')}` : ''} – zählt nicht mehr zum Soll.</Alert>}
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                {canCancel && !m.cancelled && (
                  <Button color="error" startIcon={<DeleteOutline />} disabled={cancelMovement.isPending} onClick={() => cancelMovement.mutate(m.id)} sx={{ mr: 'auto' }}>
                    {cancelMovement.isPending ? 'Storniert…' : 'Stornieren'}
                  </Button>
                )}
                <Button variant="contained" onClick={() => setDetail(null)}>Schließen</Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>

      <CountDialog open={counting} preview={preview} float={float} canSetFloat={canManage}
        onClose={() => setCounting(false)}
        onBookDeposit={(preset) => { setCounting(false); setMovement({ type: 'DEPOSIT_TO_BANK', preset }); }} />
      <MovementDialog open={!!movement} type={movement?.type} preset={movement?.preset} onClose={() => setMovement(null)} />
      <BankBalanceDialog open={!!bankDialog} mode={bankDialog || 'check'} cashHasBaseline={!noBaseline}
        knownAccounts={bank.knownAccounts} onClose={() => setBankDialog(null)} />
    </Box>
  );
}
