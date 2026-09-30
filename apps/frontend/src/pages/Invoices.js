import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Grid, Card, CardContent, TextField, InputAdornment, Typography,
  Stack, IconButton, List, ListItemText, Button, Dialog, DialogTitle,
  DialogContent, MenuItem, Chip, Drawer, useMediaQuery,
  Tooltip, Divider, ListItemButton, ListItemIcon,
  TableBody, TableCell, TableRow, CircularProgress, Alert,
  ToggleButtonGroup, ToggleButton,
  Checkbox, FormControlLabel
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import {
  Search, Person, Add, Download, Edit, Settings,
  Close as CloseIcon, ExpandMore, ExpandLess,
  MarkEmailRead, Warning, CheckCircle, Drafts,
  Payments, AccountBalance
} from '@mui/icons-material';
import { DatePicker, MobileDatePicker, DesktopDatePicker } from '@mui/x-date-pickers';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import KPICard from '../components/common/KPICard';
import FilterBar from '../components/common/FilterBar';
import { DocumentTable, DocumentTableHead, documentRowSx, documentChildRowSx } from '../components/common/DocumentTable';
import MobileDocumentCard from '../components/common/MobileDocumentCard';
import ArticleLinePicker from '../components/articles/ArticleLinePicker';
import { useArticleLines, toInvoicePayload, linesFromInvoiceItems } from '../hooks/useArticleLines';
import { useArticles } from '../hooks/useArticles';
import { num, money, fmtNumber } from '../utils/format';
import { invalidate } from '../utils/invalidate';

/* ----------------------- kleine Helfer ----------------------- */

/** Debounced TextField (für Suchfelder) */
function DebouncedTextField({ value, onChange, delay = 250, ...props }) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  useEffect(() => {
    const t = setTimeout(() => onChange?.(local), delay);
    return () => clearTimeout(t);
  }, [local, delay]); // eslint-disable-line
  return <TextField value={local} onChange={(e) => setLocal(e.target.value)} {...props} />;
}

const STATUS = {
  DRAFT: { label: 'Entwurf', color: 'default', strip: 'text.disabled' },
  SENT: { label: 'Versendet', color: 'info', strip: 'info.main' },
  PAID: { label: 'Bezahlt', color: 'success', strip: 'success.main' },
  CANCELLED: { label: 'Storniert', color: 'error', strip: 'error.main' },
};
const statusOf = (s) => STATUS[s] || STATUS.DRAFT;
const isOverdue = (inv) => inv.status === 'SENT' && new Date(inv.dueDate) < new Date();
const fmtDate = (d) => {
  try { return format(new Date(d), 'dd.MM.yyyy', { locale: de }); } catch { return '—'; }
};
const EMPTY_FILTERS = { status: '', search: '', startDate: null, endDate: null };

// Zahlungsart einer bezahlten Kundenrechnung (null = Altbestand ohne Zahlungsart, gilt als Bank)
const PAYMENT = {
  CASH: { label: 'Bar', long: 'bar bezahlt (Kasse)', Icon: Payments },
  TRANSFER: { label: 'Überweisung', long: 'per Überweisung bezahlt (Bank)', Icon: AccountBalance },
};
const paymentOf = (pm) => PAYMENT[pm] || null;

/** Status-Chip; Klick öffnet den Statuswechsel (wie der Bezahlt-Chip im Einkauf) */
function StatusChip({ inv, onClick, disabled }) {
  const st = statusOf(inv.status);
  const canChange = !disabled && inv.status !== 'CANCELLED';
  const pay = inv.status === 'PAID' ? paymentOf(inv.paymentMethod) : null;
  const tip = pay
    ? `${pay.long}${inv.paidAt ? ` am ${fmtDate(inv.paidAt)}` : ''}${canChange ? ' · Klicken, um den Status zu ändern' : ''}`
    : (canChange ? 'Klicken, um den Status zu ändern' : '');
  return (
    <Tooltip title={tip}>
      <span>
        <Chip
          size="small"
          clickable={canChange}
          onClick={canChange ? onClick : undefined}
          color={st.color}
          variant={inv.status === 'DRAFT' ? 'outlined' : 'filled'}
          icon={pay ? <pay.Icon fontSize="small" /> : undefined}
          label={pay ? `${st.label} · ${pay.label}` : st.label}
          sx={{ cursor: canChange ? 'pointer' : 'default', fontWeight: 600 }}
        />
      </span>
    </Tooltip>
  );
}

/** Positionen einer Rechnung, erst beim Aufklappen geladen (die Liste liefert nur _count.items) */
function InvoiceItems({ invoiceId, compact = false }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async () => (await api.get(`/invoices/${invoiceId}`)).data?.invoice,
    staleTime: 30_000,
  });
  if (isPending) return <CircularProgress size={16} />;
  if (isError || !data) return <Typography variant="caption" color="error">Positionen konnten nicht geladen werden</Typography>;
  const items = data.items || [];
  if (!items.length) return <Typography variant="caption" color="text.secondary">Keine Positionen</Typography>;
  return (
    <Stack spacing={0.5}>
      {data.description && <Typography variant="caption" color="text.secondary">{data.description}</Typography>}
      {items.map((it) => (
        <Stack key={it.id} direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="body2" sx={{ minWidth: 0 }} noWrap={!compact}>
            {fmtNumber(it.quantity)} × {it.description}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
            {money(it.pricePerUnit)} · <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{money(it.totalPrice)}</Box>
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** Karte unter md – gleiche Optik wie die Einkaufsbelege */
function CompactInvoiceCard({ inv, onStatus, onEdit, onPdf }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const st = statusOf(inv.status);
  const itemCount = inv._count?.items || 0;
  const overdue = isOverdue(inv);
  return (
    <MobileDocumentCard stripColor={st.strip}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" color="text.secondary" fontSize={11}>Kundenrechnung</Typography>
          <Typography variant="h6" fontWeight={700} lineHeight={1.2}>{inv.invoiceNumber}</Typography>
          <Typography variant="body2" fontWeight={500} color="text.primary" noWrap>{inv.customerName}</Typography>
          <Typography variant="caption" color={overdue ? 'error.main' : 'text.secondary'} fontWeight={overdue ? 700 : 400}>
            {fmtDate(inv.createdAt)} · fällig {fmtDate(inv.dueDate)}{overdue ? ' · überfällig' : ''}
          </Typography>
        </Box>
        <Typography variant="h6" color="primary.main" fontWeight={800} sx={{ flexShrink: 0 }}>
          {money(inv.totalAmount)}
        </Typography>
      </Stack>

      <Divider sx={{ borderStyle: 'dashed' }} />

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <StatusChip inv={inv} onClick={onStatus} />
        <Stack direction="row" spacing={0}>
          <Tooltip title="PDF herunterladen">
            <IconButton size="small" onClick={onPdf} aria-label="PDF herunterladen"><Download fontSize="small" /></IconButton>
          </Tooltip>
          {inv.status === 'DRAFT' && (
            <Tooltip title="Bearbeiten">
              <IconButton size="small" color="primary" onClick={onEdit} aria-label="Bearbeiten"><Edit fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {itemCount > 0 && (
        <Box sx={{ bgcolor: alpha(theme.palette.background.default, 0.5), mx: -2, px: 2, py: 1, mt: 1 }}>
          <Button
            size="small"
            fullWidth
            onClick={() => setOpen((o) => !o)}
            endIcon={open ? <ExpandLess /> : <ExpandMore />}
            sx={{ justifyContent: 'space-between', textTransform: 'none', color: 'text.secondary' }}
          >
            {itemCount} Position{itemCount === 1 ? '' : 'en'}
          </Button>
          {open && <Box sx={{ mt: 1 }}><InvoiceItems invoiceId={inv.id} compact /></Box>}
        </Box>
      )}
    </MobileDocumentCard>
  );
}

/* ============================================================ */

export default function Invoices() {
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));   // Anlegen: Vollbild-Dialog statt Drawer
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));  // Liste: Karten statt Tabelle
  const { isAdmin, isAccountant } = useAuth();
  const canSeeContact = isAdmin || isAccountant;

  // Tabelle / Filter
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const { data: invoicesData, isPending, isError, error } = useQuery({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      if (filters.startDate) params.startDate = format(filters.startDate, 'yyyy-MM-dd');
      if (filters.endDate) params.endDate = format(filters.endDate, 'yyyy-MM-dd');
      const res = await api.get('/invoices', { params });
      return { invoices: (res.data?.invoices || []).map(i => ({ ...i, totalAmount: num(i.totalAmount) })) };
    },
    placeholderData: (prev) => prev,
  });

  const { data: customersData = { customers: [] } } = useQuery({
    queryKey: ['customers-invoice-pos'],
    queryFn: async () => (await api.get('/customers')).data,
    staleTime: 5 * 60_000
  });
  // Artikel für das Bearbeiten bestehender Rechnungen (inkl. inaktive, damit alte Positionen auflösbar bleiben)
  const { allArticles } = useArticles({ activeOnly: false });

  const createInvoiceMutation = useMutation({
    mutationFn: async (payload) => (await api.post('/invoices', payload)).data,
    onSuccess: () => { invalidate(queryClient, 'invoices', 'finance'); setShowCreate(false); }
  });
  const updateInvoiceMutation = useMutation({
    mutationFn: async ({ id, payload }) => (await api.put(`/invoices/${id}`, payload)).data,
    onSuccess: () => {
      invalidate(queryClient, 'invoices', 'finance');
      setShowCreate(false);
    }
  });
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, paymentMethod, paidAt }) =>
      (await api.patch(`/invoices/${id}/status`, { status, paymentMethod, paidAt })).data,
    onSuccess: () => {
      // Bar bezahlte Kundenrechnungen verändern das Kassen-Soll, überwiesene die Bank-Abstimmung
      invalidate(queryClient, 'invoices', 'finance');
    }
  });
  const setStatus = (inv, status, extra = {}) => {
    if (updateStatusMutation.isPending) return;
    updateStatusMutation.mutate({ id: inv.id, status, ...extra });
  };

  const invoices = useMemo(() => invoicesData?.invoices || [], [invoicesData]);
  const customers = useMemo(() => customersData?.customers || [], [customersData]);

  const stats = useMemo(() => {
    const sum = (list) => list.reduce((acc, i) => acc + num(i.totalAmount), 0);
    const open = invoices.filter(i => i.status === 'SENT');
    const overdue = open.filter(isOverdue);
    const paid = invoices.filter(i => i.status === 'PAID');
    const drafts = invoices.filter(i => i.status === 'DRAFT');
    return {
      open: { count: open.length, sum: sum(open) },
      overdue: { count: overdue.length, sum: sum(overdue) },
      paid: { count: paid.length, sum: sum(paid) },
      drafts: { count: drafts.length },
    };
  }, [invoices]);

  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);

  // Empfänger-Freitext
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');

  const [customerSearch, setCustomerSearch] = useState('');
  // Positionen im gemeinsamen Zeilenmodell (Kisten + Stück getrennt, Preis je Zeile editierbar)
  const { lines, setLines, reset: resetLines, totalAmount: total } = useArticleLines([]);
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
  const [description, setDescription] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  // Anschrift beim Kunden speichern (nur für ADMIN/ACCOUNTANT sichtbar)
  const [saveAddressToCustomer, setSaveAddressToCustomer] = useState(false);

  // Statuswechsel: Dialog (Desktop) / Bottom Sheet (kompakt)
  const [statusSheet, setStatusSheet] = useState({ open: false, inv: null });
  // Schritt "Bezahlt": Zahlungsart (Pflicht, Vorgabe Überweisung) und Zahldatum (Vorgabe heute)
  const [payStep, setPayStep] = useState(false);
  const [payMethod, setPayMethod] = useState('TRANSFER');
  const [payDate, setPayDate] = useState(new Date());
  const openStatusSheet = (inv) => { setPayStep(false); setPayMethod('TRANSFER'); setPayDate(new Date()); setStatusSheet({ open: true, inv }); };
  const closeStatusSheet = () => { setStatusSheet({ open: false, inv: null }); setPayStep(false); };
  const confirmPaid = () => {
    if (!statusSheet.inv || !payMethod || !payDate || Number.isNaN(payDate.getTime())) return;
    // Zahldatum: gewählter Tag, Uhrzeit jetzt (heute) bzw. 12:00 (Vergangenheit), damit es im Geschäftstag liegt
    const when = new Date(payDate);
    const today = new Date();
    if (when.toDateString() === today.toDateString()) when.setTime(today.getTime());
    else when.setHours(12, 0, 0, 0);
    setStatus(statusSheet.inv, 'PAID', { paymentMethod: payMethod, paidAt: when.toISOString() });
    closeStatusSheet();
  };

  const filteredCustomers = useMemo(() => {
    const s = customerSearch.toLowerCase();
    return [...customers]
      .filter(c => c.name.toLowerCase().includes(s) || (c.nickname || '').toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [customers, customerSearch]);

  const openCreate = () => {
    setEditInvoice(null);
    setRecipientName('');
    setRecipientAddress('');
    setSelectedCustomerId(null);
    setSaveAddressToCustomer(false);
    resetLines([]);
    setDescription('');
    setDueDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
    setShowCreate(true);
  };

  const openEdit = async (row) => {
    const res = await api.get(`/invoices/${row.id}`);
    const inv = res.data?.invoice; if (!inv) return;
    setEditInvoice(inv);
    setRecipientName(inv.customerName || '');
    setRecipientAddress(inv.customerAddress || '');
    setSelectedCustomerId(inv.customerId || null);
    setSaveAddressToCustomer(false);
    setDueDate(new Date(inv.dueDate));
    setDescription(inv.description || '');
    // Menge in Basiseinheiten → Anzeige als Kisten + Stück
    resetLines(linesFromInvoiceItems(inv.items || [], allArticles));
    setShowCreate(true);
  };

  const submitDisabled = !lines.length || !recipientName.trim();

  const submitInvoice = async () => {
    if (submitDisabled) return;
    const payload = {
      description: description || null,
      dueDate: dueDate.toISOString(),
      taxRate: 0,
      // Backend-Vertrag unverändert: { articleId|null, description, quantity, pricePerUnit } in Basiseinheiten
      items: toInvoicePayload(lines),
      totalAmount: num(total),
      customerName: recipientName.trim(),
      customerAddress: recipientAddress || null,
      customerId: selectedCustomerId || null,
    };
    // Anschrift beim Kunden speichern (nur für ADMIN/ACCOUNTANT, wenn Checkbox aktiviert und Kunde gewählt)
    if (saveAddressToCustomer && selectedCustomerId && recipientAddress && canSeeContact) {
      const addrLines = recipientAddress.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let zip = null, city = null, street = null, company = null;
      for (let i = addrLines.length - 1; i >= 0; i--) {
        const m = addrLines[i].match(/^(\d{4,5})\s+(.+)$/);
        if (m && !zip) { zip = m[1]; city = m[2]; }
        else if (zip && !street) { street = addrLines[i]; }
        else if (street && !company) { company = addrLines[i]; }
      }
      if (zip && city) {
        try {
          await api.put('/customers/' + selectedCustomerId, { zip, city, street: street || undefined, company: company || undefined });
          invalidate(queryClient, 'customers');
        } catch (_e) { /* Speichern fehlgeschlagen – Rechnung trotzdem erstellen */ }
      }
    }
    if (editInvoice) updateInvoiceMutation.mutate({ id: editInvoice.id, payload }); else createInvoiceMutation.mutate(payload);
  };

  const handleDownloadPDF = async (id) => {
    const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `Rechnung_${id}.pdf`; a.click(); window.URL.revokeObjectURL(url);
  };

  const toggleRow = (id) => setExpandedRows((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });
  const handleFilterChange = (k, v) => setFilters((p) => (p[k] === v ? p : { ...p, [k]: v }));
  const hasActiveFilters = !!(filters.status || filters.search || filters.startDate || filters.endDate);
  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const bigActionSx = {
    height: '100%',
    minHeight: 140,
    borderRadius: 3,
    fontSize: '1.1rem',
    fontWeight: 800,
    textTransform: 'none',
    boxShadow: theme.shadows[8],
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1
  };

  /* ========= UI ========= */
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, width: '100%', pb: 10, overflowX: 'hidden', '& input': { fontSize: { xs: 16, sm: 14 } } }}>
      {/* Header (gleicher Aufbau wie Einkauf) */}
      <Box sx={{ mb: 4 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              Rechnungen an Mitglieder, Gäste und Vereine
            </Typography>
          </Box>
          {isAdmin && (
            <Tooltip title="Rechnungseinstellungen">
              <IconButton
                onClick={() => setShowSettings(true)}
                aria-label="Rechnungseinstellungen"
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, flexShrink: 0 }}
              >
                <Settings />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Stack spacing={2} sx={{ mt: 3, display: { xs: 'flex', md: 'none' } }}>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            startIcon={<Add />}
            onClick={openCreate}
            sx={{ py: 1.5, fontWeight: 700, boxShadow: theme.shadows[4] }}
          >
            Neue Kundenrechnung
          </Button>
        </Stack>
      </Box>

      {/* KPI-Kacheln + Desktop-Aktion */}
      <Grid container spacing={2} sx={{ mb: 3 }} alignItems="stretch">
        <Grid size={{ xs: 6, md: 3 }}>
          <KPICard title="Offen" value={stats.open.count} icon={MarkEmailRead} color="info" subTitle={money(stats.open.sum)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KPICard
            title="Überfällig"
            value={stats.overdue.count}
            icon={Warning}
            color={stats.overdue.count > 0 ? 'error' : 'success'}
            subTitle={stats.overdue.count > 0 ? money(stats.overdue.sum) : 'Alles im Rahmen'}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KPICard title="Bezahlt" value={stats.paid.count} icon={CheckCircle} color="success" subTitle={money(stats.paid.sum)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }} sx={{ display: { xs: 'block', md: 'none' } }}>
          <KPICard title="Entwürfe" value={stats.drafts.count} icon={Drafts} color="default" subTitle="In Bearbeitung" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }} sx={{ display: { xs: 'none', md: 'block' } }}>
          <Button variant="contained" color="primary" fullWidth onClick={openCreate} sx={bigActionSx}>
            <Add fontSize="large" />
            Neue Kundenrechnung
          </Button>
        </Grid>
      </Grid>

      {/* Filter */}
      <FilterBar hasActiveFilters={hasActiveFilters} onReset={resetFilters}>
        <DebouncedTextField
          label="Suche"
          placeholder="Nummer, Kunde, Beschreibung"
          value={filters.search}
          onChange={(v) => handleFilterChange('search', v)}
          size="small"
          sx={{ minWidth: 200, flex: 2 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
        />
        <TextField
          select
          label="Status"
          value={filters.status}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          size="small"
          sx={{ minWidth: 150, flex: 1 }}
        >
          <MenuItem value="">Alle</MenuItem>
          <MenuItem value="DRAFT">Entwurf</MenuItem>
          <MenuItem value="SENT">Versendet</MenuItem>
          <MenuItem value="PAID">Bezahlt</MenuItem>
          <MenuItem value="CANCELLED">Storniert</MenuItem>
        </TextField>
        <DatePicker
          label="Von"
          value={filters.startDate}
          onChange={(d) => handleFilterChange('startDate', d)}
          slotProps={{ textField: { size: 'small', sx: { minWidth: 140, flex: 1 } } }}
        />
        <DatePicker
          label="Bis"
          value={filters.endDate}
          onChange={(d) => handleFilterChange('endDate', d)}
          slotProps={{ textField: { size: 'small', sx: { minWidth: 140, flex: 1 } } }}
        />
      </FilterBar>

      {/* Laden / Fehler */}
      {isPending && <CircularProgress sx={{ display: 'block', mx: 'auto', my: 4 }} />}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Fehler beim Laden der Kundenrechnungen: {error?.response?.data?.error || error?.message}
        </Alert>
      )}

      {/* Desktop: Tabelle | kompakt: Karten */}
      {!isPending && !isError && (
        isCompact ? (
          <Box>
            {invoices.map((inv) => (
              <CompactInvoiceCard
                key={inv.id}
                inv={inv}
                onStatus={() => openStatusSheet(inv)}
                onEdit={() => openEdit(inv)}
                onPdf={() => handleDownloadPDF(inv.id)}
              />
            ))}
            {invoices.length === 0 && (
              <Typography align="center" color="text.secondary" sx={{ py: 4 }}>Keine Kundenrechnungen gefunden</Typography>
            )}
          </Box>
        ) : (
          <DocumentTable minWidth={800}>
            <DocumentTableHead>
              <TableCell width="24%">Rechnungsnr.</TableCell>
              <TableCell width="20%">Kunde</TableCell>
              <TableCell width="11%">Datum</TableCell>
              <TableCell width="11%">Fällig</TableCell>
              <TableCell align="right" width="12%">Betrag</TableCell>
              <TableCell width="12%">Status</TableCell>
              <TableCell align="center" width="10%">Aktion</TableCell>
            </DocumentTableHead>
            <TableBody>
              {invoices.map((inv) => {
                const itemCount = inv._count?.items || 0;
                const expanded = expandedRows.has(inv.id);
                const overdue = isOverdue(inv);
                return (
                  <React.Fragment key={inv.id}>
                    <TableRow hover sx={documentRowSx(theme)}>
                      <TableCell>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <IconButton
                            size="small"
                            onClick={() => toggleRow(inv.id)}
                            disabled={itemCount === 0}
                            aria-label="Positionen anzeigen"
                            sx={{ visibility: itemCount > 0 ? 'visible' : 'hidden' }}
                          >
                            {expanded ? <ExpandLess /> : <ExpandMore />}
                          </IconButton>
                          <Box>
                            <Chip label="RE" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: 9, mr: 1 }} />
                            <Typography component="span" variant="body2" fontWeight={600}>{inv.invoiceNumber}</Typography>
                            {itemCount > 0 && (
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                {itemCount} Pos.
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell>{fmtDate(inv.createdAt)}</TableCell>
                      <TableCell>
                        <Typography variant="body2" color={overdue ? 'error.main' : 'text.primary'} fontWeight={overdue ? 700 : 400}>
                          {fmtDate(inv.dueDate)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={700}>{money(inv.totalAmount)}</Typography>
                      </TableCell>
                      <TableCell>
                        <StatusChip inv={inv} onClick={() => openStatusSheet(inv)} disabled={updateStatusMutation.isPending} />
                      </TableCell>
                      <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="PDF herunterladen">
                          <IconButton size="small" onClick={() => handleDownloadPDF(inv.id)} aria-label="PDF herunterladen">
                            <Download fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {inv.status === 'DRAFT' && (
                          <Tooltip title="Bearbeiten">
                            <IconButton size="small" color="primary" onClick={() => openEdit(inv)} aria-label="Bearbeiten">
                              <Edit fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow sx={documentChildRowSx(theme)}>
                        <TableCell colSpan={7} sx={{ py: 1.5, pl: 8, pr: 2 }}>
                          <InvoiceItems invoiceId={inv.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
              {invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>Keine Kundenrechnungen gefunden</TableCell>
                </TableRow>
              )}
            </TableBody>
          </DocumentTable>
        )
      )}

      {/* ================== Erstellen/Bearbeiten: Drawer (Desktop) / Dialog (Mobile) ================== */}

      {/* DESKTOP: rechte Seitenscheibe */}
      {!isMobile && (
        <Drawer
          anchor="right"
          open={showCreate}
          onClose={() => setShowCreate(false)}
          ModalProps={{ keepMounted: true }}
          // Layout-AppBar liegt auf drawer+1 und würde den Titel überdecken (B15)
          sx={{ zIndex: (t) => t.zIndex.modal }}
          PaperProps={{ sx: { width: { xs: '100vw', md: '980px', lg: '1200px' }, maxWidth: '100vw', overflow: 'hidden' } }}
        >
          <Box sx={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
            <DialogTitle sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <span>{editInvoice ? `Kundenrechnung bearbeiten – ${editInvoice.invoiceNumber}` : 'Neue Kundenrechnung'}</span>
                <Button color="error" startIcon={<CloseIcon />} onClick={() => setShowCreate(false)}>Abbrechen</Button>
              </Box>
            </DialogTitle>
            <DialogContent sx={{ p: 2, minHeight: 0, overflow: 'hidden' }}>
              <ThreeColumnPOS
                isMobile={false}
                customers={filteredCustomers}
                onPickCustomer={(c) => {
                  setRecipientName(c.name || '');
                  setSelectedCustomerId(c.id);
                  // Anschrift aus Kontaktdaten zusammensetzen (nur wenn der Nutzer die Felder sehen darf)
                  const addrParts = [c.company, c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean);
                  if (addrParts.length > 0) setRecipientAddress(addrParts.join('\n'));
                }}
                customerSearch={customerSearch}
                setCustomerSearch={setCustomerSearch}
                recipientName={recipientName}
                setRecipientName={setRecipientName}
                recipientAddress={recipientAddress}
                setRecipientAddress={setRecipientAddress}
                lines={lines}
                setLines={setLines}
                dueDate={dueDate}
                setDueDate={setDueDate}
                description={description}
                setDescription={setDescription}
                total={total}
                submitDisabled={submitDisabled}
                submitInvoice={submitInvoice}
                onClose={() => setShowCreate(false)}
                editInvoice={editInvoice}
                selectedCustomerId={selectedCustomerId}
                saveAddressToCustomer={saveAddressToCustomer}
                setSaveAddressToCustomer={setSaveAddressToCustomer}
                canSeeContact={canSeeContact}
              />
            </DialogContent>
          </Box>
        </Drawer>
      )}

      {/* MOBILE: Fullscreen-Dialog */}
      {isMobile && (
        <Dialog open={showCreate} onClose={() => setShowCreate(false)} fullScreen>
          <DialogTitle sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <span>{editInvoice ? `Kundenrechnung bearbeiten – ${editInvoice.invoiceNumber}` : 'Neue Kundenrechnung'}</span>
              <Button color="error" startIcon={<CloseIcon />} onClick={() => setShowCreate(false)}>Abbrechen</Button>
            </Box>
          </DialogTitle>
          <DialogContent sx={{ p: 1, flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ThreeColumnPOS
              isMobile
              customers={filteredCustomers}
              onPickCustomer={(c) => {
                setRecipientName(c.name || '');
                setSelectedCustomerId(c.id);
                const addrParts = [c.company, c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean);
                if (addrParts.length > 0) setRecipientAddress(addrParts.join('\n'));
              }}
              customerSearch={customerSearch}
              setCustomerSearch={setCustomerSearch}
              recipientName={recipientName}
              setRecipientName={setRecipientName}
              recipientAddress={recipientAddress}
              setRecipientAddress={setRecipientAddress}
              lines={lines}
              setLines={setLines}
              dueDate={dueDate}
              setDueDate={setDueDate}
              description={description}
              setDescription={setDescription}
              total={total}
              submitDisabled={submitDisabled}
              submitInvoice={submitInvoice}
              onClose={() => setShowCreate(false)}
              editInvoice={editInvoice}
              selectedCustomerId={selectedCustomerId}
              saveAddressToCustomer={saveAddressToCustomer}
              setSaveAddressToCustomer={setSaveAddressToCustomer}
              canSeeContact={canSeeContact}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Status ändern: Dialog (Desktop) / Bottom-Sheet (kompakt) */}
      <Dialog
        open={statusSheet.open}
        onClose={closeStatusSheet}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: isCompact ? { alignSelf: 'flex-end', m: 0, borderRadius: '16px 16px 0 0' } : { borderRadius: 3 } }}
      >
        <DialogTitle>
          Status ändern
          {statusSheet.inv && (
            <Typography variant="body2" color="text.secondary">
              {statusSheet.inv.invoiceNumber} · {statusSheet.inv.customerName} · {money(statusSheet.inv.totalAmount)}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {payStep ? (
            <Stack spacing={2}>
              <Typography variant="subtitle2">Wie wurde bezahlt?</Typography>
              <ToggleButtonGroup
                exclusive
                fullWidth
                color="success"
                value={payMethod}
                onChange={(_, v) => { if (v) setPayMethod(v); }}
                aria-label="Zahlungsart"
              >
                <ToggleButton value="CASH" aria-label="Bar"><Payments fontSize="small" sx={{ mr: 1 }} />Bar</ToggleButton>
                <ToggleButton value="TRANSFER" aria-label="Überweisung"><AccountBalance fontSize="small" sx={{ mr: 1 }} />Überweisung</ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary">
                {payMethod === 'CASH'
                  ? 'Das Geld liegt in der Kasse und erhöht das Kassen-Soll beim nächsten Zählen.'
                  : 'Der Betrag ist auf dem Konto eingegangen und zählt in der Bank-Abstimmung.'}
              </Typography>
              <DatePicker
                label="Zahldatum"
                value={payDate}
                onChange={(v) => setPayDate(v)}
                disableFuture
                slotProps={{ textField: { fullWidth: true, size: 'small' } }}
              />
              <Stack direction="row" spacing={1}>
                <Button fullWidth onClick={() => setPayStep(false)}>Zurück</Button>
                <Button
                  fullWidth
                  variant="contained"
                  color="success"
                  onClick={confirmPaid}
                  disabled={!payMethod || !payDate || Number.isNaN(payDate.getTime()) || updateStatusMutation.isPending}
                >
                  Als „Bezahlt“ speichern
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={1}>
              {statusSheet.inv && statusSheet.inv.status === 'DRAFT' && (
                <Button fullWidth variant="outlined" onClick={() => { setStatus(statusSheet.inv, 'SENT'); closeStatusSheet(); }}>
                  Auf „Versendet“ setzen
                </Button>
              )}
              {statusSheet.inv && !['PAID', 'CANCELLED'].includes(statusSheet.inv.status) && (
                <Button fullWidth variant="outlined" color="success" onClick={() => setPayStep(true)}>
                  Als „Bezahlt“ markieren …
                </Button>
              )}
              {statusSheet.inv && statusSheet.inv.status === 'PAID' && (
                <Button fullWidth variant="outlined" color="warning" onClick={() => { setStatus(statusSheet.inv, 'SENT'); closeStatusSheet(); }}>
                  Zahlung zurücknehmen (wieder „Versendet“)
                </Button>
              )}
              {statusSheet.inv && statusSheet.inv.status !== 'CANCELLED' && (
                <Button fullWidth variant="outlined" color="error" onClick={() => { setStatus(statusSheet.inv, 'CANCELLED'); closeStatusSheet(); }}>
                  Stornieren
                </Button>
              )}
              <Button fullWidth onClick={closeStatusSheet}>Abbrechen</Button>
            </Stack>
          )}
          {updateStatusMutation.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {updateStatusMutation.error?.response?.data?.error || 'Status konnte nicht geändert werden.'}
            </Alert>
          )}
          {updateStatusMutation.isPending && (
            <Typography role="status" aria-live="polite" variant="caption" sx={{ mt: 1, display: 'block' }} color="text.secondary">
              Status wird aktualisiert…
            </Typography>
          )}
        </DialogContent>
      </Dialog>
      <InvoiceSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </Box>
  );
}

/* ----------------------- 3-Spalten-Komponente ----------------------- */
function ThreeColumnPOS(props) {
  const {
    isMobile,
    customers, onPickCustomer, customerSearch, setCustomerSearch,
    recipientName, setRecipientName, recipientAddress, setRecipientAddress,
    lines, setLines,
    dueDate, setDueDate, description, setDescription,
    total, submitDisabled, submitInvoice, onClose, editInvoice,
    selectedCustomerId, saveAddressToCustomer, setSaveAddressToCustomer, canSeeContact
  } = props;

  const DuePicker = isMobile ? MobileDatePicker : DesktopDatePicker;
  const [mobileTab, setMobileTab] = useState(1);

  const sidebar = (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CardContent sx={{ pb: 1 }}>
        <TextField
          label="Empfängername *"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          fullWidth size="small"
          variant="filled"
        />
        <TextField
          label="Anschrift"
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
          fullWidth multiline minRows={3} size="small" sx={{ mt: 1 }}
          variant="filled"
          placeholder={'Straße 1\n12345 Musterstadt'}
        />
        <DebouncedTextField
          placeholder="Kunde suchen"
          size="small"
          fullWidth
          value={customerSearch}
          onChange={setCustomerSearch}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
          sx={{ mt: 2 }}
        />
      </CardContent>
      <Box sx={{ overflowY: 'auto', flex: 1, px: 2, pb: 2 }}>
        <List dense>
          {customers.map(c => (
            <ListItemButton
              key={c.id}
              onClick={() => { onPickCustomer(c); setMobileTab(1); }}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                '&:hover': { bgcolor: 'primary.light', color: 'primary.contrastText', '& .MuiSvgIcon-root': { color: 'inherit' } }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}><Person /></ListItemIcon>
              <ListItemText
                primary={<Typography noWrap fontWeight={600}>{c.nickname || c.name}</Typography>}
                secondary={c.nickname ? c.name : null}
                secondaryTypographyProps={{ sx: { color: 'inherit', opacity: 0.8 } }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Card>
  );

  const linesHeader = (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <DuePicker
        label="Fällig am"
        value={dueDate}
        onChange={setDueDate}
        slotProps={{ textField: { fullWidth: true, size: 'small' } }}
      />
      <TextField label="Beschreibung (optional)" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" />
    </Stack>
  );

  const linesFooter = (
    <>
      {canSeeContact && selectedCustomerId && (
        <FormControlLabel
          control={
            <Checkbox
              checked={saveAddressToCustomer}
              onChange={(e) => setSaveAddressToCustomer(e.target.checked)}
              size="small"
            />
          }
          label={<Typography variant="caption">Anschrift beim Kunden speichern</Typography>}
          sx={{ mb: 0.5, display: 'flex' }}
        />
      )}
      <Typography variant="h5" align="right" sx={{ fontWeight: 900, color: 'primary.main' }} aria-live="polite">Gesamt: {money(total)}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
        <Button variant="contained" size="large" fullWidth onClick={submitInvoice} disabled={submitDisabled} sx={{ fontWeight: 800 }}>
          {editInvoice ? 'Speichern' : 'Erstellen (Entwurf)'}
        </Button>
        <Button variant="outlined" color="error" onClick={onClose}>
          Abbrechen
        </Button>
      </Stack>
    </>
  );

  return (
    <ArticleLinePicker
      mode="invoice"
      lines={lines}
      onChange={setLines}
      sidebar={sidebar}
      sidebarLabel="Empfänger"
      linesLabel="Positionen"
      linesHeader={linesHeader}
      linesFooter={linesFooter}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      columns={{ md: '280px 1fr 320px', lg: '320px 1fr 380px' }}
      height="100%"
    />
  );
}

function InvoiceSettingsDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({});
  const { data, isLoading } = useQuery({
    queryKey: ['invoiceSettings'],
    queryFn: async () => (await api.get('/invoices/settings')).data,
    enabled: open,
    staleTime: 0
  });

  useEffect(() => { if (data) setValues(data); }, [data]);

  const mutation = useMutation({
    mutationFn: async (vals) => (await api.put('/invoices/settings', vals)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceSettings'] });
      onClose();
    }
  });

  const handleChange = (key, val) => setValues(prev => ({ ...prev, [key]: val }));
  const save = () => mutation.mutate(values);

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Rechnungseinstellungen</DialogTitle>
      <DialogContent dividers>
        {isLoading && <Typography>Lade...</Typography>}
        {!isLoading && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2" color="primary">Absender & Kontakt</Typography>
            <TextField label="Firmenname / Zahlungsempfänger" value={values.INVOICE_PAYEE_NAME || ''} onChange={e => handleChange('INVOICE_PAYEE_NAME', e.target.value)} fullWidth size="small" />
            <TextField label="Straße & Hausnr." value={values.INVOICE_ADDRESS_STREET || ''} onChange={e => handleChange('INVOICE_ADDRESS_STREET', e.target.value)} fullWidth size="small" />
            <TextField label="PLZ & Stadt" value={values.INVOICE_ADDRESS_CITY || ''} onChange={e => handleChange('INVOICE_ADDRESS_CITY', e.target.value)} fullWidth size="small" />
            <TextField label="E-Mail" value={values.INVOICE_EMAIL || ''} onChange={e => handleChange('INVOICE_EMAIL', e.target.value)} fullWidth size="small" />

            <Typography variant="subtitle2" color="primary" sx={{ mt: 2 }}>Bankverbindung</Typography>
            <TextField label="IBAN" value={values.INVOICE_IBAN || ''} onChange={e => handleChange('INVOICE_IBAN', e.target.value)} fullWidth size="small" />
            <TextField label="BIC" value={values.INVOICE_BIC || ''} onChange={e => handleChange('INVOICE_BIC', e.target.value)} fullWidth size="small" />

            <Typography variant="subtitle2" color="primary" sx={{ mt: 2 }}>Sonstiges</Typography>
            <TextField label="Referenz-Präfix (z.B. RE)" value={values.INVOICE_REF_PREFIX || ''} onChange={e => handleChange('INVOICE_REF_PREFIX', e.target.value)} fullWidth size="small" />
          </Stack>
        )}
      </DialogContent>
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={save} disabled={mutation.isPending}>Speichern</Button>
      </Box>
    </Dialog>
  );
}
