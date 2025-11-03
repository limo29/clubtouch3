// src/pages/Invoices.jsx
import React, { useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
  Grid, Chip, MenuItem, InputAdornment, Divider, Autocomplete, ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { Add, Send, Download, AttachMoney, Delete, Search } from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import api from '../services/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;
const toISO = (d) => (d instanceof Date && !isNaN(d)) ? d.toISOString() : new Date().toISOString();

const Invoices = () => {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [filters, setFilters] = useState({ status: '', search: '', startDate: null, endDate: null });

  // Dialog-Zustände
  const [customerInputMode, setCustomerInputMode] = useState('existing'); // 'existing' | 'new'
  const [itemInputMode, setItemInputMode] = useState({});                // pro Position 'article' | 'custom'
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const { control, handleSubmit, reset, watch, setValue, setError, clearErrors } = useForm({
    defaultValues: {
      customerId: null,
      customerName: '',
      customerAddress: '',
      description: '',
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // +14 Tage
      // Steuer entfällt -> wir rechnen netto == brutto (taxRate = 0 wird nicht mehr abgefragt)
      items: [{ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 }]
    }
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  /* ------------ Daten laden ----------- */
  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      if (filters.startDate) params.startDate = format(filters.startDate, 'yyyy-MM-dd');
      if (filters.endDate) params.endDate = format(filters.endDate, 'yyyy-MM-dd');
      const res = await api.get('/invoices', { params });
      if (res.data?.invoices) {
        return {
          ...res.data,
          invoices: res.data.invoices.map(i => ({ ...i, totalAmount: num(i.totalAmount) }))
        };
      }
      return res.data;
    }
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers-invoice-form'],
    queryFn: async () => {
      const res = await api.get('/customers');
      return { customers: (res.data?.customers || []).map(c => ({ ...c })) };
    }
  });

  const { data: articlesData } = useQuery({
    queryKey: ['articles-invoice-form'],
    queryFn: async () => {
      const res = await api.get('/articles');
      return {
        articles: (res.data?.articles || []).map(a => ({ ...a, price: num(a.price) }))
      };
    }
  });

  /* ------------ Mutations ----------- */
  const createInvoiceMutation = useMutation({
    mutationFn: async (payload) => (await api.post('/invoices', payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries(['invoices']);
      setOpenDialog(false);
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => (await api.patch(`/invoices/${id}/status`, { status })).data,
    onSuccess: () => queryClient.invalidateQueries(['invoices'])
  });

  /* ------------ Helpers ----------- */
  const invoices = invoicesData?.invoices || [];
  const customers = customersData?.customers || [];
  const articles = articlesData?.articles || [];

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(num(amount));

  const getStatusColor = (status) => {
    switch (status) {
      case 'PAID': return 'success';
      case 'SENT': return 'info';
      case 'CANCELLED': return 'error';
      default: return 'default';
    }
  };
  const getStatusLabel = (status) => {
    switch (status) {
      case 'PAID': return 'Bezahlt';
      case 'SENT': return 'Versendet';
      case 'CANCELLED': return 'Storniert';
      default: return 'Entwurf';
    }
  };

  const watchedItems = watch('items');
  const netTotal = round2((Array.isArray(watchedItems) ? watchedItems : []).reduce(
    (s, it) => s + num(it.quantity) * num(it.pricePerUnit), 0
  ));
  // Steuer gibt’s nicht -> Brutto == Netto
  const grossTotal = netTotal;

  const handleOpenDialog = () => {
    reset({
      customerId: null,
      customerName: '',
      customerAddress: '',
      description: '',
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      items: [{ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 }]
    });
    setCustomerInputMode('existing');
    setItemInputMode({});
    setSelectedCustomer(null);
    setOpenDialog(true);
  };

  const onSubmit = (data) => {
    clearErrors();

    const items = (data.items || []).map((it) => ({
      articleId: it.articleId || null,
      description: String(it.description || '').trim(),
      quantity: num(it.quantity),
      unit: it.unit || 'Stück',
      // BACKEND erwartet bei dir "pricePerUnit" – das behalten wir exakt so.
      pricePerUnit: num(it.pricePerUnit)
    }));

    if (customerInputMode === 'existing' && !selectedCustomer) {
      setError('customerId', { type: 'required', message: 'Kunde auswählen' });
      return;
    }
    if (customerInputMode === 'new' && !data.customerName?.trim()) {
      setError('customerName', { type: 'required', message: 'Kundenname ist erforderlich' });
      return;
    }
    if (!items.length) {
      setError('items', { type: 'required', message: 'Mindestens eine Position' });
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (!items[i].description) { setError(`items.${i}.description`, { type: 'required', message: 'Beschreibung' }); return; }
      if (!(items[i].quantity > 0)) { setError(`items.${i}.quantity`, { type: 'validate', message: '> 0' }); return; }
      if (!(items[i].pricePerUnit >= 0)) { setError(`items.${i}.pricePerUnit`, { type: 'validate', message: '≥ 0' }); return; }
    }

    const payload = {
      description: data.description || null,
      dueDate: toISO(data.dueDate),
      // KEINE Steuer -> taxRate weglassen bzw. 0
      taxRate: 0,
      items,
      // Server rechnet ohnehin – wir schicken Totale trotzdem sauber mit
      netAmount: netTotal,
      taxAmount: 0,
      totalAmount: netTotal
    };

    if (customerInputMode === 'existing' && selectedCustomer) {
      payload.customerId = selectedCustomer.id;
      payload.customerName = selectedCustomer.name;
    } else {
      payload.customerName = data.customerName;
      payload.customerAddress = data.customerAddress || null;
    }

    createInvoiceMutation.mutate(payload);
  };

  const handleDownloadPDF = async (id) => {
    const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Rechnung_${id}.pdf`; a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Rechnungen</Typography>

      {/* Filter */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              label="Suche"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              size="small" fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField select label="Status" value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              size="small" fullWidth>
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="DRAFT">Entwurf</MenuItem>
              <MenuItem value="SENT">Versendet</MenuItem>
              <MenuItem value="PAID">Bezahlt</MenuItem>
              <MenuItem value="CANCELLED">Storniert</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <DatePicker label="Von" value={filters.startDate}
              onChange={(d) => setFilters({ ...filters, startDate: d })}
              slotProps={{ textField: { size: 'small', fullWidth: true } }} />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <DatePicker label="Bis" value={filters.endDate}
              onChange={(d) => setFilters({ ...filters, endDate: d })}
              slotProps={{ textField: { size: 'small', fullWidth: true } }} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Button variant="contained" startIcon={<Add />} onClick={handleOpenDialog} fullWidth>
              Neue Rechnung
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Tabelle */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Rechnungsnr.</TableCell>
              <TableCell>Datum</TableCell>
              <TableCell>Kunde</TableCell>
              <TableCell align="right">Betrag</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Fällig</TableCell>
              <TableCell align="right">Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7}>Lade…</TableCell></TableRow>}
            {!isLoading && invoices.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell><Typography fontWeight={600}>{inv.invoiceNumber}</Typography></TableCell>
                <TableCell>{format(new Date(inv.createdAt), 'dd.MM.yyyy', { locale: de })}</TableCell>
                <TableCell>{inv.customerName}</TableCell>
                <TableCell align="right">{formatCurrency(inv.totalAmount)}</TableCell>
                <TableCell><Chip size="small" label={getStatusLabel(inv.status)} color={getStatusColor(inv.status)} /></TableCell>
                <TableCell>{format(new Date(inv.dueDate), 'dd.MM.yyyy', { locale: de })}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleDownloadPDF(inv.id)} title="PDF">
                    <Download />
                  </IconButton>
                  {inv.status === 'DRAFT' && (
                    <IconButton size="small" color="info"
                      onClick={() => updateStatusMutation.mutate({ id: inv.id, status: 'SENT' })}
                      title="Als versendet markieren">
                      <Send />
                    </IconButton>
                  )}
                  {inv.status === 'SENT' && (
                    <IconButton size="small" color="success"
                      onClick={() => updateStatusMutation.mutate({ id: inv.id, status: 'PAID' })}
                      title="Als bezahlt markieren">
                      <AttachMoney />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="md" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Neue Rechnung</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {/* Kunde */}
              <Grid item xs={12}>
                <ToggleButtonGroup
                  value={customerInputMode} exclusive
                  onChange={(e, v) => {
                    if (!v) return;
                    setCustomerInputMode(v);
                    if (v === 'existing') { setValue('customerName', ''); setValue('customerAddress', ''); }
                    if (v === 'new') { setSelectedCustomer(null); setValue('customerId', null); }
                  }}
                  size="small" fullWidth>
                  <ToggleButton value="existing">Bestehender Kunde</ToggleButton>
                  <ToggleButton value="new">Neuer Kunde (einmalig)</ToggleButton>
                </ToggleButtonGroup>
              </Grid>

              {customerInputMode === 'existing' ? (
                <Grid item xs={12}>
                  <Controller
                    name="customerId" control={control}
                    rules={{ required: customerInputMode === 'existing' ? 'Kunde auswählen' : false }}
                    render={({ field, fieldState: { error } }) => (
                      <Autocomplete
                        options={customers}
                        getOptionLabel={(o) => `${o.name}${o.nickname ? ` (${o.nickname})` : ''}`}
                        value={selectedCustomer}
                        onChange={(_, v) => {
                          setSelectedCustomer(v);
                          field.onChange(v?.id || null);
                          setValue('customerName', v?.name || '');
                        }}
                        isOptionEqualToValue={(o, v) => o.id === v?.id}
                        renderInput={(params) => (
                          <TextField {...params} label="Kunde auswählen" error={!!error} helperText={error?.message} fullWidth />
                        )}
                      />
                    )}
                  />
                </Grid>
              ) : (
                <>
                  <Grid item xs={12} sm={6}>
                    <Controller
                      name="customerName" control={control}
                      rules={{ required: customerInputMode === 'new' ? 'Kundenname ist erforderlich' : false }}
                      render={({ field, fieldState: { error } }) => (
                        <TextField {...field} label="Kundenname" error={!!error} helperText={error?.message} fullWidth />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Controller
                      name="customerAddress" control={control}
                      render={({ field }) => (<TextField {...field} label="Adresse (optional)" fullWidth />)}
                    />
                  </Grid>
                </>
              )}

              {/* Kopf */}
              <Grid item xs={12} sm={6}>
                <Controller
                  name="dueDate" control={control}
                  rules={{ required: 'Fälligkeitsdatum' }}
                  render={({ field, fieldState: { error } }) => (
                    <DatePicker {...field} label="Fällig am"
                      slotProps={{ textField: { fullWidth: true, error: !!error, helperText: error?.message } }} />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="description" control={control}
                  render={({ field }) => (<TextField {...field} label="Beschreibung (optional)" fullWidth />)}
                />
              </Grid>

              {/* Positionen */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Positionen</Typography>

                {fields.map((f, index) => (
                  <Box key={f.id} sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Grid container spacing={2} alignItems="center">
                      <Grid item xs={12}>
                        <ToggleButtonGroup
                          value={itemInputMode[index] || 'custom'} exclusive size="small"
                          onChange={(_, v) => {
                            if (!v) return;
                            setItemInputMode({ ...itemInputMode, [index]: v });
                            if (v === 'custom') setValue(`items.${index}.articleId`, null);
                          }}>
                          <ToggleButton value="article">Artikel</ToggleButton>
                          <ToggleButton value="custom">Freie Eingabe</ToggleButton>
                        </ToggleButtonGroup>
                      </Grid>

                      {itemInputMode[index] === 'article' ? (
                        <Grid item xs={12}>
                          <Controller
                            name={`items.${index}.articleId`} control={control}
                            render={({ field: artField }) => (
                              <Autocomplete
                                {...artField}
                                options={articles.filter(a => a.active)}
                                getOptionLabel={(o) => o.name || ''}
                                isOptionEqualToValue={(o, v) => o.id === v?.id}
                                value={articles.find(a => a.id === artField.value) || null}
                                onChange={(_, v) => {
                                  artField.onChange(v?.id || null);
                                  setValue(`items.${index}.description`, v?.name || '');
                                  setValue(`items.${index}.pricePerUnit`, v ? num(v.price) : 0);
                                  setValue(`items.${index}.unit`, v?.unit || 'Stück');
                                }}
                                renderInput={(params) => <TextField {...params} label="Artikel auswählen" size="small" fullWidth />}
                              />
                            )}
                          />
                        </Grid>
                      ) : (
                        <Grid item xs={12} sm={6}>
                          <Controller
                            name={`items.${index}.description`} control={control}
                            rules={{ required: 'Beschreibung' }}
                            render={({ field, fieldState: { error } }) => (
                              <TextField {...field} label="Beschreibung" size="small" error={!!error}
                                helperText={error?.message} fullWidth />
                            )}
                          />
                        </Grid>
                      )}

                      <Grid item xs={itemInputMode[index] === 'article' ? 6 : 12} sm={itemInputMode[index] === 'article' ? 3 : 2}>
                        <Controller
                          name={`items.${index}.quantity`} control={control} defaultValue={1}
                          rules={{ required: 'Menge', min: { value: 0.01, message: '> 0' } }}
                          render={({ field, fieldState: { error } }) => (
                            <TextField {...field} label="Menge" type="number" inputProps={{ step: 0.01 }}
                              size="small" fullWidth error={!!error} helperText={error?.message} />
                          )}
                        />
                      </Grid>

                      {itemInputMode[index] !== 'article' && (
                        <Grid item xs={6} sm={2}>
                          <Controller name={`items.${index}.unit`} control={control} defaultValue="Stück"
                            render={({ field }) => (<TextField {...field} label="Einheit" size="small" fullWidth />)} />
                        </Grid>
                      )}

                      <Grid item xs={itemInputMode[index] === 'article' ? 6 : 12} sm={itemInputMode[index] === 'article' ? 3 : 3}>
                        <Controller
                          name={`items.${index}.pricePerUnit`} control={control} defaultValue={0}
                          rules={{ required: 'Preis', min: { value: 0, message: '≥ 0' } }}
                          render={({ field, fieldState: { error } }) => (
                            <TextField {...field} label="Einzelpreis" type="number" inputProps={{ step: 0.01 }}
                              size="small" fullWidth
                              InputProps={{ startAdornment: <InputAdornment position="start">€</InputAdornment> }}
                              disabled={itemInputMode[index] === 'article' && !!watch(`items.${index}.articleId`)}
                              error={!!error} helperText={error?.message} />
                          )}
                        />
                      </Grid>

                      <Grid item xs={12} sm={1} container justifyContent="flex-end">
                        {fields.length > 1 && (
                          <IconButton color="error" onClick={() => remove(index)} size="small"><Delete /></IconButton>
                        )}
                      </Grid>
                    </Grid>
                  </Box>
                ))}

                <Button
                  variant="outlined"
                  onClick={() => {
                    append({ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 });
                    setItemInputMode(prev => ({ ...prev, [fields.length]: 'custom' }));
                  }}
                  startIcon={<Add />}>
                  Position hinzufügen
                </Button>
              </Grid>

              {/* Summen */}
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="body1">Summe: {formatCurrency(netTotal)}</Typography>
                  <Typography variant="h6">Gesamt: {formatCurrency(grossTotal)}</Typography>
                </Box>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialog(false)}>Abbrechen</Button>
            <Button type="submit" variant="contained" disabled={createInvoiceMutation.isLoading}>
              {createInvoiceMutation.isLoading ? 'Erstelle…' : 'Erstellen (Entwurf)'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Invoices;
