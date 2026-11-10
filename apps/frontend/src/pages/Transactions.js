/**
 * Transaktionen: nach Tagen gruppierte Liste mit Tagessumme.
 * Leiste (sticky): Zeitraum-Chips (Heute · 7 Tage · 30 Tage · Alles · Zeitraum…) und Art-Chips (Bar · Kundenkonto · Auf den Wirt · Storniert).
 * Ein aktiver Chip lässt sich abwählen. Zeile antippen öffnet die Details, dort auch „Stornieren“.
 */
import React, { useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Skeleton, Stack,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  AccountBalanceWallet, AttachMoney, Cancel, ChevronRight, DeleteOutline, EventBusy, LocalBar, ReceiptLong, Undo,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfDay, subDays, isToday, isYesterday } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import KPICard from '../components/common/KPICard';
import StickyToolbar, { FilterChips } from '../components/common/StickyToolbar';
import { invalidate } from '../utils/invalidate';
import { useAuth } from '../context/AuthContext';
import { money, num } from '../utils/format';

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
  { key: 'OWNER_USE', label: 'Auf den Wirt', test: (t) => t.type === 'OWNER_USE' },
  { key: 'EXPIRED', label: 'Bruch', test: (t) => t.type === 'EXPIRED' },
  { key: 'CANCELLED', label: 'Storniert', test: (t) => t.cancelled || t.type === 'REFUND', color: 'error' },
];

/** Darstellung je Buchung: Symbol, Titel, Farbe des Betrags */
const describe = (t) => {
  if (t.type === 'REFUND') return { Icon: Undo, title: 'Storno', who: t.customer?.name || 'Bar' };
  if (t.type === 'OWNER_USE') return { Icon: LocalBar, title: 'Auf den Wirt', who: 'Auf den Wirt' };
  if (t.type === 'EXPIRED') return { Icon: EventBusy, title: 'Abschreibung', who: 'Abgelaufen / Bruch' };
  if (t.paymentMethod === 'ACCOUNT') return { Icon: AccountBalanceWallet, title: 'Kundenkonto', who: t.customer?.name || 'Kundenkonto' };
  return { Icon: AttachMoney, title: 'Bar', who: t.customer?.name || 'Bar' };
};
const itemsText = (t, max = 3) => {
  const parts = (t.items || []).map((i) => `${num(i.quantity)}× ${i.article?.name || 'Artikel'}`);
  return parts.length ? parts.slice(0, max).join(', ') + (parts.length > max ? ` +${parts.length - max}` : '') : '–';
};
const moneyFlows = (t) => t.type === 'SALE' && !t.cancelled; // zählt zum Umsatz
const dayLabel = (d) => (isToday(d) ? 'Heute' : isYesterday(d) ? 'Gestern' : format(d, 'EEEE, d. MMMM yyyy', { locale: de }));

const COLS = '64px minmax(160px, 1.2fr) minmax(200px, 2fr) 120px 110px 24px';

function Row({ t, onOpen, compact }) {
  const d = describe(t);
  const crossed = t.cancelled;
  const amount = t.type === 'REFUND' ? -Math.abs(num(t.totalAmount)) : num(t.totalAmount);
  const amountColor = crossed ? 'text.disabled' : t.type === 'REFUND' ? 'error.main' : t.type === 'SALE' ? 'text.primary' : 'text.secondary';
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
          <Typography fontWeight={800} sx={{ color: amountColor, textDecoration: crossed ? 'line-through' : 'none', whiteSpace: 'nowrap' }}>{money(amount)}</Typography>
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
      <Typography noWrap color={crossed ? 'text.secondary' : 'text.primary'}>{itemsText(t)}</Typography>
      <Typography fontWeight={800} sx={{ textAlign: 'right', color: amountColor, textDecoration: crossed ? 'line-through' : 'none' }}>{money(amount)}</Typography>
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
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Zeitraum -> Abfrage (ohne Auswahl: alles)
  const params = useMemo(() => {
    const p = { includeItems: true };
    const def = PERIODS.find((x) => x.key === period);
    if (def?.days !== undefined) p.startDate = format(subDays(startOfDay(new Date()), def.days), 'yyyy-MM-dd');
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

  const all = useMemo(() => data?.transactions || [], [data]);
  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k.key, all.filter(k.test).length])), [all]);
  const visible = useMemo(() => {
    const k = KINDS.find((x) => x.key === kind);
    return [...all].filter((t) => !k || k.test(t)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [all, kind]);
  const days = useMemo(() => {
    const m = new Map();
    for (const t of visible) {
      const key = format(new Date(t.createdAt), 'yyyy-MM-dd');
      if (!m.has(key)) m.set(key, { date: startOfDay(new Date(t.createdAt)), items: [], revenue: 0 });
      const g = m.get(key);
      g.items.push(t);
      if (moneyFlows(t)) g.revenue += num(t.totalAmount);
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

  return (
    <Box sx={{ pb: 6 }}>
      {s && (
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid size={{ xs: 6, md: 3 }}><KPICard title="Umsatz heute" value={money(s.totalRevenue)} icon={AttachMoney} color="primary" subTitle={`${s.totalTransactions} Verkäufe`} /></Grid>
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
            options={KINDS.map((k) => ({ key: k.key, label: k.label, count: counts[k.key], color: k.color }))} />
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
              <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
                <Typography fontWeight={800}>{dayLabel(g.date)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {g.items.length} {g.items.length === 1 ? 'Buchung' : 'Buchungen'} · Umsatz <Box component="strong" sx={{ color: 'text.primary' }}>{money(g.revenue)}</Box>
                </Typography>
              </Stack>
              {g.items.map((t) => <Row key={t.id} t={t} onOpen={setSelected} compact={compact} />)}
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
