/**
 * Transaktionen: nach Tagen gruppierte Liste mit Tagessumme.
 * Leiste (sticky): Zeitraum-Chips (Heute · 7 Tage · 30 Tage · Alles · Zeitraum…) und Art-Chips (Bar · Kundenkonto · Auf den Wirt · Storniert).
 * Ein aktiver Chip lässt sich abwählen. Zeile antippen öffnet die Details, dort auch „Stornieren“.
 * Kontoaufladungen (eigene Tabelle, kein Umsatz) stehen mit in der Liste; antippen öffnet ihre Details.
 * Übernahme-Buchungen aus Clubtouch 2.0 nur über den Chip „Übernahme“.
 */
import React, { useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Skeleton, Stack,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  AccountBalance, AccountBalanceWallet, AttachMoney, Cancel, ChevronRight, DeleteOutline, EventBusy, LocalAtm, LocalBar,
  ReceiptLong, SettingsBackupRestore, Undo,
 CreditCard
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { DatePicker } from '../components/common/SafeDatePickers';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, subDays, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import KPICard from '../components/common/KPICard';
import StickyToolbar, { FilterChips } from '../components/common/StickyToolbar';
import { invalidate } from '../utils/invalidate';
import { useAuth } from '../context/AuthContext';
import { money, num } from '../utils/format';
import { businessDayStart } from '../utils/businessDay';

// Stornierbar sind Verkäufe und die geldlosen Buchungen (Eigenverbrauch, Abgelaufen).
// Ein REFUND ist selbst schon der Storno und wird nie storniert.
const CANCELLABLE_TYPES = ['SALE', 'OWNER_USE', 'EXPIRED'];

const cancelCopy = (t) => {
  if (t?.type === 'OWNER_USE') return { title: 'Eigenverbrauch stornieren', question: 'Diese „Auf den Wirt“-Buchung stornieren? Der Bestand wird zurückgebucht.' };
  if (t?.type === 'EXPIRED') return { title: 'Abschreibung stornieren', question: 'Diese Abschreibung (abgelaufen/Bruch) stornieren? Der Bestand wird zurückgebucht.' };
  return { title: 'Verkauf stornieren', question: 'Diesen Verkauf wirklich stornieren?' };
};

const PERIODS = [
  { key: 'today', label: 'Heute', days: 0 },
  { key: '7', label: '7 Tage', days: 6 },
  { key: '30', label: '30 Tage', days: 29 },
  { key: 'none', label: 'Alles' },
  { key: 'custom', label: 'Zeitraum…' },
];
const KINDS = [
  { key: 'CASH', label: 'Bar', test: (t) => t.type === 'SALE' && t.paymentMethod === 'CASH' },
  { key: 'ACCOUNT', label: 'Kundenkonto', test: (t) => t.type === 'SALE' && t.paymentMethod === 'ACCOUNT' },
  { key: 'CARD', label: 'Karte', test: (t) => t.type === 'SALE' && t.paymentMethod === 'CARD', hideEmpty: true },
  { key: 'OWNER_USE', label: 'Auf den Wirt', test: (t) => t.type === 'OWNER_USE' },
  { key: 'EXPIRED', label: 'Bruch', test: (t) => t.type === 'EXPIRED' },
  { key: 'TOPUP', label: 'Aufladung', test: (t) => t.type === 'TOPUP' && t.method !== 'MIGRATION' },
  { key: 'CANCELLED', label: 'Storniert', test: (t) => t.cancelled || t.type === 'REFUND' || (t.type === 'TOPUP' && t.storno), color: 'error' },
  { key: 'MIGRATION', label: 'Übernahme', test: (t) => t.type === 'TOPUP' && t.method === 'MIGRATION', hideEmpty: true },
];

const TOPUP_KIND = {
  CASH: { Icon: LocalAtm, title: 'Aufladung bar' },
  TRANSFER: { Icon: AccountBalance, title: 'Aufladung Überweisung' },
  CARD: { Icon: CreditCard, title: 'Aufladung Karte' },
  REIMBURSEMENT: { Icon: ReceiptLong, title: 'Auslage (Einkauf)' },
  MIGRATION: { Icon: SettingsBackupRestore, title: 'Übernahme Clubtouch 2.0' },
};
/** Aufladung in dieselbe Form wie eine Transaktion bringen */
const fromTopUp = (u) => ({
  // Storno nur über die Referenz erkennen: negative Übernahmen (Schulden aus Clubtouch 2.0) sind kein Storno
  ...u, type: 'TOPUP', storno: String(u.reference || '').startsWith('STORNO:'),
});

/** Darstellung je Buchung: Symbol, Titel, Farbe des Betrags */
const describe = (t) => {
  if (t.type === 'TOPUP') {
    if (t.storno) return { Icon: Undo, title: 'Storno einer Aufladung', who: t.customer?.name || 'Kunde' };
    const k = TOPUP_KIND[t.method] || TOPUP_KIND.CASH;
    return { Icon: k.Icon, title: k.title, who: t.customer?.name || 'Kunde' };
  }
  if (t.type === 'REFUND') return { Icon: Undo, title: 'Storno', who: t.customer?.name || 'Bar' };
  if (t.type === 'OWNER_USE') return { Icon: LocalBar, title: 'Auf den Wirt', who: 'Auf den Wirt' };
  if (t.type === 'EXPIRED') return { Icon: EventBusy, title: 'Abschreibung', who: 'Abgelaufen / Bruch' };
  if (t.paymentMethod === 'ACCOUNT') return { Icon: AccountBalanceWallet, title: 'Kundenkonto', who: t.customer?.name || 'Kundenkonto' };
  if (t.paymentMethod === 'CARD') return { Icon: CreditCard, title: 'Karte', who: 'Karte (SumUp)' };
  return { Icon: AttachMoney, title: 'Bar', who: t.customer?.name || 'Bar' };
};
const itemsText = (t, max = 3) => {
  if (t.type === 'TOPUP') {
    const ref = t.storno ? '' : String(t.reference || '').replace(/^Übernahme Clubtouch 2\.0 /, 'Altsystem ');
    return [describe(t).title, ref].filter(Boolean).join(' · ');
  }
  const parts = (t.items || []).map((i) => `${num(i.quantity)}× ${i.article?.name || 'Artikel'}`);
  return parts.length ? parts.slice(0, max).join(', ') + (parts.length > max ? ` +${parts.length - max}` : '') : '–';
};
const moneyFlows = (t) => t.type === 'SALE' && !t.cancelled; // zählt zum Umsatz
const topUpFlows = (t) => t.type === 'TOPUP' && t.method !== 'MIGRATION'; // echte Aufladungen (inkl. Storno)
// Gruppiert wird nach Geschäftstag (06:00 bis 06:00), damit „Heute“ zur Kennzahl „Umsatz heute“ passt.
// `d` ist der Beginn des Geschäftstags (06:00).
const dayLabel = (d) => {
  const today = businessDayStart();
  if (isSameDay(d, today)) return 'Heute';
  if (isSameDay(d, subDays(today, 1))) return 'Gestern';
  return format(d, 'EEEE, d. MMMM yyyy', { locale: de });
};

const COLS = '64px minmax(160px, 1.2fr) minmax(200px, 2fr) 120px 110px 24px';

function Row({ t, onOpen, compact }) {
  const d = describe(t);
  const crossed = t.cancelled;
  const isTopUp = t.type === 'TOPUP';
  const amount = isTopUp ? num(t.amount) : t.type === 'REFUND' ? -Math.abs(num(t.totalAmount)) : num(t.totalAmount);
  const amountColor = crossed ? 'text.disabled'
    : isTopUp ? (amount < 0 ? 'error.main' : 'success.main')
    : t.type === 'REFUND' ? 'error.main' : t.type === 'SALE' ? 'text.primary' : 'text.secondary';
  const shown = isTopUp && amount > 0 ? `+${money(amount)}` : money(amount);
  const status = crossed ? <Chip size="small" color="error" variant="outlined" label="storniert" /> : null;
  const rowSx = {
    cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' },
    '&:hover': { bgcolor: 'action.hover' }, outline: 'none', '&:focus-visible': { bgcolor: 'action.focus' },
  };
  const avatar = <Avatar sx={{ width: 36, height: 36, bgcolor: 'action.hover', color: 'text.secondary' }}><d.Icon fontSize="small" /></Avatar>;
  if (compact) {
    return (
      <Box onClick={() => onOpen(t)} role="button" tabIndex={0} sx={{ ...rowSx, display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.25 }}>
        {avatar}
        <Box sx={{ flex: 1, minWidth: 0, opacity: crossed ? 0.6 : 1 }}>
          <Typography fontWeight={700} noWrap>{d.who}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{format(new Date(t.createdAt), 'HH:mm')} · {itemsText(t, 2)}</Typography>
        </Box>
        <Stack alignItems="flex-end" spacing={0.25}>
          <Typography fontWeight={800} sx={{ color: amountColor, textDecoration: crossed ? 'line-through' : 'none', whiteSpace: 'nowrap' }}>{shown}</Typography>
          {status}
        </Stack>
      </Box>
    );
  }
  return (
    <Box onClick={() => onOpen(t)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(t)}
      sx={{ ...rowSx, display: 'grid', gridTemplateColumns: COLS, gap: 2, alignItems: 'center', px: 2, py: 1.25 }}>
      <Typography color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{format(new Date(t.createdAt), 'HH:mm')}</Typography>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, opacity: crossed ? 0.6 : 1 }}>
        {avatar}
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>{d.who}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{[d.title !== d.who && d.title, t.user?.name].filter(Boolean).join(' · ') || ' '}</Typography>
        </Box>
      </Stack>
      <Typography noWrap color={crossed || isTopUp ? 'text.secondary' : 'text.primary'}>
        {isTopUp ? (t.storno ? 'Gegenbuchung' : String(t.reference || '').replace(/^Übernahme Clubtouch 2\.0 /, 'Altsystem ') || '–') : itemsText(t)}
      </Typography>
      <Typography fontWeight={800} sx={{ textAlign: 'right', color: amountColor, textDecoration: crossed ? 'line-through' : 'none' }}>{shown}</Typography>
      <Box>{status}</Box>
      <ChevronRight sx={{ color: 'text.disabled' }} />
    </Box>
  );
}

export default function Transactions() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const { can } = useAuth();
  const canCancel = can('sell'); // Storno wie Verkauf: Admin und Kasse
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState('7');
  const [range, setRange] = useState({ start: null, end: null });
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState(null);
  const [topUp, setTopUp] = useState(null); // gewählte Aufladung (Detail-Fenster)
  const [confirmTopUpCancel, setConfirmTopUpCancel] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const navigate = useNavigate();

  // Zeitraum -> Abfrage (ohne Auswahl: alles)
  const params = useMemo(() => {
    const p = { includeItems: true, includeTopUps: true, includeMigration: true };
    const def = PERIODS.find((x) => x.key === period);
    if (def?.days !== undefined) p.startDate = format(subDays(businessDayStart(), def.days), 'yyyy-MM-dd');
    if (period === 'custom') {
      if (range.start) p.startDate = format(range.start, 'yyyy-MM-dd');
      if (range.end) p.endDate = format(range.end, 'yyyy-MM-dd');
    }
    return p;
  }, [period, range]);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', params],
    queryFn: async () => (await api.get(API_ENDPOINTS.TRANSACTIONS, { params })).data,
  });
  const { data: dailySummary } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: async () => (await api.get(API_ENDPOINTS.DAILY_SUMMARY)).data,
  });

  const all = useMemo(() => [...(data?.transactions || []), ...(data?.topUps || []).map(fromTopUp)], [data]);
  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k.key, all.filter(k.test).length])), [all]);
  const visible = useMemo(() => {
    const k = KINDS.find((x) => x.key === kind);
    // ohne Filter keine Übernahme-Buchungen – sonst stünde der Importtag mit 151 Einträgen in der Liste
    const migration = KINDS.find((x) => x.key === 'MIGRATION');
    return [...all].filter((t) => (k ? k.test(t) : !migration.test(t))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [all, kind]);
  const days = useMemo(() => {
    const m = new Map();
    for (const t of visible) {
      const dayStart = businessDayStart(new Date(t.createdAt));
      const key = format(dayStart, 'yyyy-MM-dd');
      if (!m.has(key)) m.set(key, { date: dayStart, items: [], revenue: 0, topUps: 0, hasTopUps: false });
      const g = m.get(key);
      g.items.push(t);
      if (moneyFlows(t)) g.revenue += num(t.totalAmount);
      if (topUpFlows(t)) { g.topUps += num(t.amount); g.hasTopUps = true; }
    }
    return [...m.values()];
  }, [visible]);

  const cancelMutation = useMutation({
    mutationFn: async (id) => (await api.post(`${API_ENDPOINTS.TRANSACTIONS}/${id}/cancel`)).data,
    onSuccess: () => {
      invalidate(queryClient, 'sales', 'customers', 'stock', 'finance');
      setConfirmCancel(false);
      setSelected(null);
    },
  });

  const s = dailySummary?.summary;
  const sel = selected ? describe(selected) : null;
  const selCancellable = selected && canCancel && !selected.cancelled && CANCELLABLE_TYPES.includes(selected.type);

  // Aufladung stornieren: nur echte Bar-/Überweisungs-Aufladungen, die noch nicht storniert sind
  // (Übernahme und Auslagen sind gesperrt, Gegenbuchungen werden nicht erneut storniert)
  const topUpReversed = topUp && all.some((e) => e.type === 'TOPUP' && e.reference === `STORNO:${topUp.id}`);
  const topUpCancellable = topUp && canCancel && !topUp.storno && ['CASH', 'TRANSFER', 'CARD'].includes(topUp.method) && !topUpReversed;
  const cancelTopUp = useMutation({
    mutationFn: async (u) => (await api.post(`${API_ENDPOINTS.CUSTOMERS}/${u.customerId}/topup/${u.id}/cancel`)).data,
    onSuccess: () => {
      invalidate(queryClient, 'customers', 'finance', 'sales');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setConfirmTopUpCancel(false);
      setTopUp(null);
    },
  });

  return (
    <Box sx={{ pb: 6 }}>
      {s && (
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid size={{ xs: 6, md: 3 }}><KPICard title="Umsatz heute" value={money(s.totalRevenue)} icon={AttachMoney} color="primary" subTitle={`${s.totalTransactions} Verkäufe${num(s.cardRevenue) > 0 ? ` · Karte ${money(s.cardRevenue)}` : ''}`} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><KPICard title="Bar" value={money(s.cashRevenue)} icon={AttachMoney} color="success" subTitle={`${s.cashTransactions} Verkäufe`} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><KPICard title="Kundenkonto" value={money(s.accountRevenue)} icon={AccountBalanceWallet} color="info" subTitle={`${s.accountTransactions} Verkäufe`} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><KPICard title="Storniert" value={s.cancelledTransactions} icon={Cancel} color="error" subTitle={money(s.cancelledRevenue)} /></Grid>
        </Grid>
      )}

      <StickyToolbar>
        <Stack spacing={1.5}>
          <FilterChips value={period} onChange={setPeriod} fallback="none"
            options={PERIODS.map((p) => ({ key: p.key, label: p.key === 'custom' && period === 'custom' && (range.start || range.end)
              ? `${range.start ? format(range.start, 'd.M.') : '…'} – ${range.end ? format(range.end, 'd.M.yy') : 'heute'}` : p.label }))} />
          {period === 'custom' && (
            <Stack direction="row" spacing={1.5}>
              <DatePicker label="Von" value={range.start} onChange={(v) => setRange((r) => ({ ...r, start: v }))} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
              <DatePicker label="Bis" value={range.end} onChange={(v) => setRange((r) => ({ ...r, end: v }))} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
            </Stack>
          )}
          <FilterChips value={kind} onChange={setKind}
            options={KINDS.filter((k) => !k.hideEmpty || counts[k.key] > 0 || kind === k.key)
              .map((k) => ({ key: k.key, label: k.label, count: counts[k.key], color: k.color }))} />
        </Stack>
      </StickyToolbar>

      {isLoading ? (
        <Skeleton variant="rounded" height={300} />
      ) : days.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center' }}>
          <ReceiptLong sx={{ fontSize: 56, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">Keine Buchungen in diesem Zeitraum{kind !== 'all' ? ' für diesen Filter' : ''}.</Typography>
          {(period !== 'none' || kind !== 'all') && <Button sx={{ mt: 2 }} onClick={() => { setPeriod('none'); setKind('all'); }}>Alles zeigen</Button>}
        </Card>
      ) : (
        <Stack spacing={2}>
          {days.map((g) => (
            <Card key={g.date.toISOString()}>
              <Stack direction="row" alignItems="baseline" justifyContent="space-between"
                sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover', flexWrap: 'wrap', columnGap: 2, rowGap: 0.25 }}>
                <Typography fontWeight={800}>
                  {dayLabel(g.date)}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontWeight: 500 }}>06:00 – 06:00 Uhr</Typography>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{g.items.length} {g.items.length === 1 ? 'Buchung' : 'Buchungen'} · </Box>Umsatz <Box component="strong" sx={{ color: 'text.primary' }}>{money(g.revenue)}</Box>
                  {g.hasTopUps && <> · Aufladungen <Box component="strong" sx={{ color: 'success.main' }}>{money(g.topUps)}</Box></>}
                </Typography>
              </Stack>
              {g.items.map((t) => (
                <Row key={`${t.type}-${t.id}`} t={t} compact={compact}
                  onOpen={(x) => (x.type === 'TOPUP' ? setTopUp(x) : setSelected(x))} />
              ))}
            </Card>
          ))}
        </Stack>
      )}

      {/* Details */}
      <Dialog open={!!selected && !confirmCancel} onClose={() => setSelected(null)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        {selected && (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Avatar sx={{ bgcolor: 'action.hover', color: 'text.secondary' }}><sel.Icon /></Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h6" noWrap>{sel.who}</Typography>
                  <Typography variant="body2" color="text.secondary">{format(new Date(selected.createdAt), "EEEE, d. MMMM yyyy 'um' HH:mm", { locale: de })}</Typography>
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 800, textDecoration: selected.cancelled ? 'line-through' : 'none' }}>
                  {money(selected.type === 'REFUND' ? -Math.abs(num(selected.totalAmount)) : selected.totalAmount)}
                </Typography>
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
                <Chip size="small" label={sel.title} />
                {selected.user?.name && <Chip size="small" variant="outlined" label={`Kasse: ${selected.user.name}`} />}
                {selected.cancelled && <Chip size="small" color="error" label="storniert" />}
              </Stack>
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                {(selected.items || []).map((i) => (
                  <Stack key={i.id} direction="row" justifyContent="space-between" sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}>
                    <Box>
                      <Typography fontWeight={600}>{i.article?.name || 'Artikel'}</Typography>
                      <Typography variant="body2" color="text.secondary">{num(i.quantity)} × {money(i.pricePerUnit)}</Typography>
                    </Box>
                    <Typography fontWeight={700}>{money(i.totalPrice)}</Typography>
                  </Stack>
                ))}
              </Box>
              {selected.cancelled && selected.cancelledAt && (
                <Alert severity="error" sx={{ mt: 2 }}>Storniert am {format(new Date(selected.cancelledAt), 'dd.MM.yyyy HH:mm')}</Alert>
              )}
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 2 }}>Beleg-ID {selected.id}</Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 } }}>
              {selCancellable && (
                <Button color="error" startIcon={<DeleteOutline />} onClick={() => setConfirmCancel(true)} sx={{ mr: 'auto' }}>Stornieren</Button>
              )}
              <Button variant="contained" onClick={() => setSelected(null)}>Schließen</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Details einer Aufladung */}
      <Dialog open={!!topUp && !confirmTopUpCancel} onClose={() => setTopUp(null)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        {topUp && (() => {
          const d = describe(topUp);
          const amount = num(topUp.amount);
          const ref = topUp.storno ? null : String(topUp.reference || '').replace(/^Übernahme Clubtouch 2\.0 /, 'Altsystem ');
          const row = (label, value, color) => (
            <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}>
              <Typography color="text.secondary">{label}</Typography>
              <Typography fontWeight={600} sx={{ textAlign: 'right', color }}>{value}</Typography>
            </Stack>
          );
          return (
            <>
              <DialogTitle sx={{ pb: 1 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Avatar sx={{ bgcolor: 'action.hover', color: 'text.secondary' }}><d.Icon /></Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h6" noWrap>{d.who}</Typography>
                    <Typography variant="body2" color="text.secondary">{d.title}</Typography>
                  </Box>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: amount < 0 ? 'error.main' : 'success.main', whiteSpace: 'nowrap' }}>
                    {amount > 0 ? '+' : ''}{money(amount)}
                  </Typography>
                </Stack>
              </DialogTitle>
              <DialogContent>
                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2 }}>
                  {row('Zeitpunkt', format(new Date(topUp.createdAt), "EEEE, d. MMMM yyyy 'um' HH:mm", { locale: de }))}
                  {row('Art', d.title)}
                  {ref && row('Bemerkung', ref)}
                  {topUp.customer && row('Guthaben jetzt', money(topUp.customer.balance), num(topUp.customer.balance) < 0 ? 'error.main' : undefined)}
                </Box>
                {topUpReversed && <Alert severity="info" sx={{ mt: 2 }}>Diese Aufladung wurde bereits storniert.</Alert>}
                {topUp.method === 'MIGRATION' && <Alert severity="info" sx={{ mt: 2 }}>Startguthaben aus Clubtouch 2.0 – kann nicht storniert werden.</Alert>}
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Aufladungen sind kein Umsatz. Bar-Aufladungen zählen zum Kassenbestand.</Typography>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 }, flexWrap: 'wrap', gap: 1 }}>
                {topUpCancellable && (
                  <Button color="error" startIcon={<DeleteOutline />} onClick={() => setConfirmTopUpCancel(true)} sx={{ mr: 'auto' }}>Stornieren</Button>
                )}
                <Button color="inherit" onClick={() => navigate(`/customers?kunde=${topUp.customerId}`)}>Zum Kunden</Button>
                <Button variant="contained" onClick={() => setTopUp(null)}>Schließen</Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>

      {/* Aufladung stornieren bestätigen */}
      <Dialog open={confirmTopUpCancel} onClose={() => setConfirmTopUpCancel(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Aufladung stornieren</DialogTitle>
        <DialogContent>
          <Typography>
            {topUp ? `${money(topUp.amount)} bei ${topUp.customer?.name || 'diesem Kunden'} stornieren? Das Guthaben wird um diesen Betrag verringert.` : ''}
          </Typography>
          {cancelTopUp.isError && <Alert severity="error" sx={{ mt: 2 }}>{cancelTopUp.error?.response?.data?.error || 'Stornieren fehlgeschlagen'}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirmTopUpCancel(false)}>Zurück</Button>
          <Button color="error" variant="contained" disabled={cancelTopUp.isPending} onClick={() => cancelTopUp.mutate(topUp)}>
            {cancelTopUp.isPending ? 'Storniere…' : 'Stornieren'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Storno bestätigen */}
      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{cancelCopy(selected).title}</DialogTitle>
        <DialogContent>
          <Typography>{cancelCopy(selected).question}</Typography>
          {selected && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {selected.type === 'SALE'
                ? `${money(selected.totalAmount)} · ${selected.customer?.name || 'Bar'}${selected.paymentMethod === 'ACCOUNT' ? ' – der Betrag wird dem Konto gutgeschrieben' : ''}`
                : `${selected.items?.length || 0} Artikel werden wieder in den Bestand gebucht. Es fließt kein Geld.`}
            </Typography>
          )}
          {cancelMutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{cancelMutation.error?.response?.data?.error || 'Stornieren fehlgeschlagen'}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirmCancel(false)}>Zurück</Button>
          <Button color="error" variant="contained" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(selected.id)}>
            {cancelMutation.isPending ? 'Storniere…' : 'Stornieren'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
