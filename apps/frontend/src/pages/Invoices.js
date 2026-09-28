import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Grid, Card, CardContent, TextField, InputAdornment, Typography,
  Stack, IconButton, List, ListItemText, Button, Dialog, DialogTitle,
  DialogContent, MenuItem, Chip, Drawer, useMediaQuery,
  CardActions, Collapse, CardActionArea, Tooltip, Zoom,
  Divider, ListItemButton, ListItemIcon
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Search, Person, Add, Download, Edit, Settings,
  Close as CloseIcon,
  Send as SendIcon, AttachMoney, Block, FilterList, KeyboardArrowUp
} from '@mui/icons-material';
import { DatePicker, MobileDatePicker, DesktopDatePicker } from '@mui/x-date-pickers';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import KPICard from '../components/common/KPICard';
import { Drafts, MarkEmailRead, Warning, CheckCircle } from '@mui/icons-material';
import ArticleLinePicker from '../components/articles/ArticleLinePicker';
import { useArticleLines, toInvoicePayload, linesFromInvoiceItems } from '../hooks/useArticleLines';
import { useArticles } from '../hooks/useArticles';
import { num, money } from '../utils/format';

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

/* ============================================================ */

export default function Invoices() {
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { isAdmin } = useAuth();

  // Tabelle / Filter
  const [filters, setFilters] = useState({ status: '', search: '', startDate: null, endDate: null });
  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      if (filters.startDate) params.startDate = format(filters.startDate, 'yyyy-MM-dd');
      if (filters.endDate) params.endDate = format(filters.endDate, 'yyyy-MM-dd');
      const res = await api.get('/invoices', { params });
      return { invoices: (res.data?.invoices || []).map(i => ({ ...i, totalAmount: num(i.totalAmount) })) };
    }
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); setShowCreate(false); }
  });
  const updateInvoiceMutation = useMutation({
    mutationFn: async ({ id, payload }) => (await api.put(`/invoices/${id}`, payload)).data,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); setShowCreate(false); }
  });
  // NEU: Status ändern
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => (await api.patch(`/invoices/${id}/status`, { status })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] })
  });
  const setStatus = (inv, status) => {
    if (updateStatusMutation.isPending) return;
    updateStatusMutation.mutate({ id: inv.id, status });
  };

  const invoices = invoicesData?.invoices || [];
  const customers = useMemo(() => customersData?.customers || [], [customersData]);

  const getStatusColor = (s) => (s === 'PAID' ? 'success' : s === 'SENT' ? 'info' : s === 'CANCELLED' ? 'error' : 'default');
  const getStatusLabel = (s) => (s === 'PAID' ? 'Bezahlt' : s === 'SENT' ? 'Versendet' : s === 'CANCELLED' ? 'Storniert' : 'Entwurf');

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

  // MOBILE: Bottom Sheet für Statuswechsel
  const [statusSheet, setStatusSheet] = useState({ open: false, inv: null });
  const openStatusSheet = (inv) => setStatusSheet({ open: true, inv });
  const closeStatusSheet = () => setStatusSheet({ open: false, inv: null });

  const [showFilters, setShowFilters] = useState(false); // Mobile filter toggle
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
    setDueDate(new Date(inv.dueDate));
    setDescription(inv.description || '');
    // Menge in Basiseinheiten → Anzeige als Kisten + Stück
    resetLines(linesFromInvoiceItems(inv.items || [], allArticles));
    setShowCreate(true);
  };

  const submitDisabled = !lines.length || !recipientName.trim();

  const submitInvoice = () => {
    if (submitDisabled) return;
    const payload = {
      description: description || null,
      dueDate: dueDate.toISOString(),
      taxRate: 0,
      // Backend-Vertrag unverändert: { articleId|null, description, quantity, pricePerUnit } in Basiseinheiten
      items: toInvoicePayload(lines),
      totalAmount: num(total),
      customerName: recipientName.trim(),
      customerAddress: recipientAddress || null
    };
    if (editInvoice) updateInvoiceMutation.mutate({ id: editInvoice.id, payload }); else createInvoiceMutation.mutate(payload);
  };

  const handleDownloadPDF = async (id) => {
    const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `Rechnung_${id}.pdf`; a.click(); window.URL.revokeObjectURL(url);
  };

  /* ========= UI ========= */
  return (
    <Box
      // Touch-Ziele & iOS-Input-Zoom
      sx={{
        '& button, & .MuiIconButton-root': { minHeight: 44, minWidth: 44 },
        '& input': { fontSize: { xs: 16, sm: 14 } }
      }}
    >
      <Typography variant="h4" gutterBottom>Rechnungen</Typography>

      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Offen"
            value={invoices.filter(i => i.status === 'SENT').length}
            icon={MarkEmailRead}
            color="info"
            subTitle={money(invoices.filter(i => i.status === 'SENT').reduce((acc, curr) => acc + curr.totalAmount, 0))}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Überfällig"
            value={invoices.filter(i => i.status === 'SENT' && new Date(i.dueDate) < new Date()).length}
            icon={Warning}
            color="error"
            subTitle={money(invoices.filter(i => i.status === 'SENT' && new Date(i.dueDate) < new Date()).reduce((acc, curr) => acc + curr.totalAmount, 0))}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Bezahlt"
            value={invoices.filter(i => i.status === 'PAID').length}
            icon={CheckCircle}
            color="success"
            subTitle="Bestätigt"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Entwürfe"
            value={invoices.filter(i => i.status === 'DRAFT').length}
            icon={Drafts}
            color="default"
            subTitle="In Bearbeitung"
          />
        </Grid>
      </Grid>

      <Box component={Card} sx={{
        p: 2, mb: 3,
        borderRadius: 3,
        background: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(10px)',
        boxShadow: theme.shadows[2]
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: { xs: 1, md: 0 } }}>
          {isMobile && (
            <Button
              startIcon={showFilters ? <KeyboardArrowUp /> : <FilterList />}
              onClick={() => setShowFilters(!showFilters)}
              size="small"
              sx={{ mr: 2 }}
            >
              Filter
            </Button>
          )}
          {!isMobile && <Typography variant="h6" sx={{ opacity: 0.7, fontSize: '1rem', mr: 2 }}>Filter</Typography>}
        </Box>

        <Collapse in={!isMobile || showFilters}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                label="Suche"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                size="small" fullWidth
                variant="outlined"
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search /></InputAdornment>,
                  sx: { borderRadius: 2 }
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2.5}>
              <TextField
                select
                label="Status"
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                size="small" fullWidth
                SelectProps={{ sx: { borderRadius: 2 } }}
              >
                <MenuItem value="">Alle</MenuItem>
                <MenuItem value="DRAFT">Entwurf</MenuItem>
                <MenuItem value="SENT">Versendet</MenuItem>
                <MenuItem value="PAID">Bezahlt</MenuItem>
                <MenuItem value="CANCELLED">Storniert</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={6} sm={6} md={2}>
              <DatePicker
                label="Von"
                value={filters.startDate}
                onChange={(d) => setFilters({ ...filters, startDate: d })}
                slotProps={{ textField: { size: 'small', fullWidth: true, sx: { '& .MuiOutlinedInput-root': { borderRadius: 2 } } } }}
              />
            </Grid>
            <Grid item xs={6} sm={6} md={2}>
              <DatePicker
                label="Bis"
                value={filters.endDate}
                onChange={(d) => setFilters({ ...filters, endDate: d })}
                slotProps={{ textField: { size: 'small', fullWidth: true, sx: { '& .MuiOutlinedInput-root': { borderRadius: 2 } } } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={openCreate}
                  sx={{ borderRadius: 2, px: 3, fontWeight: 700, textTransform: 'none', background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})` }}
                  fullWidth={isMobile}
                >
                  Neu
                </Button>
                {isAdmin && (
                  <IconButton
                    onClick={() => setShowSettings(true)}
                    title="Einstellungen"
                    sx={{
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2
                    }}
                  >
                    <Settings />
                  </IconButton>
                )}
              </Stack>
            </Grid>
          </Grid>
        </Collapse>
      </Box>

      {/* Desktop: Tabelle | Mobile: Karten */}
      {!isMobile ? (
        <Card>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
            <Box component="thead" sx={{ bgcolor: 'action.hover', position: 'sticky', top: 0, zIndex: 1 }}>
              <Box component="tr">
                <Box component="th" sx={{ p: 1.5, textAlign: 'left' }}>Rechnungsnr.</Box>
                <Box component="th" sx={{ p: 1.5, textAlign: 'left' }}>Datum</Box>
                <Box component="th" sx={{ p: 1.5, textAlign: 'left' }}>Kunde</Box>
                <Box component="th" sx={{ p: 1.5, textAlign: 'right' }}>Betrag</Box>
                <Box component="th" sx={{ p: 1.5 }}>Status</Box>
                <Box component="th" sx={{ p: 1.5 }}>Fällig</Box>
                <Box component="th" sx={{ p: 1.5, textAlign: 'right', position: 'sticky', right: 0, bgcolor: 'background.paper' }}>Aktionen</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {isLoading && (<Box component="tr"><Box component="td" colSpan={7} sx={{ p: 2 }}>Lade…</Box></Box>)}
              {!isLoading && invoices.map(inv => (
                <Box component="tr" key={inv.id} sx={{
                  borderTop: '1px solid', borderColor: 'divider',
                  transition: 'background-color 0.2s',
                  '&:hover': { bgcolor: 'action.hover' }
                }}>
                  <Box component="td" sx={{ p: 1.5, fontWeight: 700, fontFamily: 'monospace' }}>{inv.invoiceNumber}</Box>
                  <Box component="td" sx={{ p: 1.5 }}>{format(new Date(inv.createdAt), 'dd.MM.yyyy', { locale: de })}</Box>
                  <Box component="td" sx={{ p: 1.5 }}>{inv.customerName}</Box>
                  <Box component="td" sx={{ p: 1.5, textAlign: 'right', fontWeight: 600 }}>{money(inv.totalAmount)}</Box>
                  <Box component="td" sx={{ p: 1.5 }}><Chip size="small" variant="outlined" color={getStatusColor(inv.status)} label={getStatusLabel(inv.status)} sx={{ fontWeight: 600, borderRadius: 1 }} /></Box>
                  <Box component="td" sx={{ p: 1.5 }}>{format(new Date(inv.dueDate), 'dd.MM.yyyy', { locale: de })}</Box>
                  <Box component="td" sx={{ p: 1.5, textAlign: 'right', position: 'sticky', right: 0, bgcolor: 'inherit' }}>
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="PDF herunterladen">
                        <IconButton size="small" onClick={() => handleDownloadPDF(inv.id)}><Download fontSize="small" /></IconButton>
                      </Tooltip>

                      {inv.status === 'DRAFT' && (
                        <Tooltip title="Bearbeiten">
                          <IconButton size="small" color="primary" onClick={() => openEdit(inv)}>
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}

                      {/* Status-Aktionen (Icons) */}
                      {inv.status === 'DRAFT' && (
                        <Tooltip title="Versenden markieren">
                          <IconButton size="small" color="info" onClick={() => setStatus(inv, 'SENT')}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {!['PAID', 'CANCELLED'].includes(inv.status) && (
                        <Tooltip title="Als Bezahlt markieren">
                          <IconButton size="small" color="success" onClick={() => setStatus(inv, 'PAID')}>
                            <AttachMoney fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {inv.status !== 'CANCELLED' && (
                        <Tooltip title="Stornieren">
                          <IconButton size="small" color="error" onClick={() => setStatus(inv, 'CANCELLED')}>
                            <Block fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Card>
      ) : (
        <Stack spacing={1.25} sx={{ pb: 8 }}>
          {isLoading && <Card sx={{ p: 2 }}>Lade…</Card>}
          {!isLoading && invoices.map(inv => (
            <Card key={inv.id} sx={{ borderRadius: 3, boxShadow: theme.shadows[2], overflow: 'hidden' }}>
              <CardActionArea onClick={() => openStatusSheet(inv)}>
                <CardContent sx={{ pb: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography fontWeight={700} variant="h6" sx={{ fontFamily: 'monospace' }}>{inv.invoiceNumber}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {format(new Date(inv.createdAt), 'dd.MM.yyyy', { locale: de })}
                      </Typography>
                      <Typography variant="body1" fontWeight={500} sx={{ mt: 0.5 }}>{inv.customerName}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Chip size="small" variant="filled" color={getStatusColor(inv.status)} label={getStatusLabel(inv.status)} sx={{ borderRadius: 1.5, fontWeight: 700 }} />
                      <Typography variant="h5" sx={{ mt: 1, fontWeight: 800, color: 'primary.main' }}>
                        {money(inv.totalAmount)}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </CardActionArea>
              <Divider />
              <CardActions sx={{ justifyContent: 'space-between', px: 2, bgcolor: 'action.hover' }}>
                <Button size="small" startIcon={<Download />} onClick={() => handleDownloadPDF(inv.id)}>PDF</Button>
                <Box>
                  {inv.status === 'DRAFT' && (
                    <IconButton size="small" color="primary" onClick={() => openEdit(inv)}><Edit /></IconButton>
                  )}
                  <Button size="small" onClick={() => openStatusSheet(inv)}>Status</Button>
                </Box>
              </CardActions>
            </Card>
          ))}
          {/* FAB für „Neu“ - Mobile Only */}
          <Zoom in={true}>
            <Box sx={{ position: 'fixed', right: 20, bottom: 84, zIndex: 10 }}>
              <Button
                variant="contained"
                onClick={openCreate}
                startIcon={<Add />}
                sx={{
                  borderRadius: 8, px: 3, py: 1.5,
                  boxShadow: 6,
                  background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                  fontWeight: 700
                }}
              >
                Neu
              </Button>
            </Box>
          </Zoom>
        </Stack>
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
                <span>{editInvoice ? `Rechnung bearbeiten – ${editInvoice.invoiceNumber}` : 'Neue Rechnung'}</span>
                <Button color="error" startIcon={<CloseIcon />} onClick={() => setShowCreate(false)}>Abbrechen</Button>
              </Box>
            </DialogTitle>
            <DialogContent sx={{ p: 2, minHeight: 0, overflow: 'hidden' }}>
              <ThreeColumnPOS
                isMobile={false}
                customers={filteredCustomers}
                onPickCustomer={(c) => {
                  setRecipientName(c.nickname || c.name || '');
                  if (c.address) setRecipientAddress(c.address);
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
              <span>{editInvoice ? `Rechnung bearbeiten – ${editInvoice.invoiceNumber}` : 'Neue Rechnung'}</span>
              <Button color="error" startIcon={<CloseIcon />} onClick={() => setShowCreate(false)}>Abbrechen</Button>
            </Box>
          </DialogTitle>
          <DialogContent sx={{ p: 1, flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ThreeColumnPOS
              isMobile
              customers={filteredCustomers}
              onPickCustomer={(c) => {
                setRecipientName(c.nickname || c.name || '');
                if (c.address) setRecipientAddress(c.address);
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
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Mobile Bottom-Sheet: Status ändern */}
      <Dialog
        open={statusSheet.open}
        onClose={closeStatusSheet}
        fullWidth
        PaperProps={{ sx: { alignSelf: 'flex-end', m: 0 } }}
      >
        <DialogTitle>Rechnungsstatus ändern</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            {statusSheet.inv && statusSheet.inv.status === 'DRAFT' && (
              <Button fullWidth variant="outlined" onClick={() => { setStatus(statusSheet.inv, 'SENT'); closeStatusSheet(); }}>
                Auf „Versendet“ setzen
              </Button>
            )}
            {statusSheet.inv && !['PAID', 'CANCELLED'].includes(statusSheet.inv.status) && (
              <Button fullWidth variant="outlined" color="success" onClick={() => { setStatus(statusSheet.inv, 'PAID'); closeStatusSheet(); }}>
                Als „Bezahlt“ markieren
              </Button>
            )}
            {statusSheet.inv && statusSheet.inv.status !== 'CANCELLED' && (
              <Button fullWidth variant="outlined" color="error" onClick={() => { setStatus(statusSheet.inv, 'CANCELLED'); closeStatusSheet(); }}>
                Stornieren
              </Button>
            )}
            <Button fullWidth onClick={closeStatusSheet}>Abbrechen</Button>
          </Stack>
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
    total, submitDisabled, submitInvoice, onClose, editInvoice
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
