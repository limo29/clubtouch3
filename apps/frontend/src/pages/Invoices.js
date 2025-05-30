import React, { useState } from 'react';
import {
  Box,
  Button,
  // Card, // Nicht direkt im finalen Code verwendet
  // CardContent, // Nicht direkt im finalen Code verwendet
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Grid,
  Chip,
  MenuItem,
  // List, // Nicht direkt im finalen Code verwendet
  // ListItem, // Nicht direkt im finalen Code verwendet
  // ListItemText, // Nicht direkt im finalen Code verwendet
  InputAdornment,
  Divider,
  // Alert, // Nicht direkt im finalen Code verwendet
  Autocomplete, // NEU (oder war schon da, wird jetzt aber intensiver genutzt)
  ToggleButton, // NEU
  ToggleButtonGroup, // NEU
} from '@mui/material';
import {
  Add,
  Description,
  CheckCircle,
  Cancel,
  Send,
  Download,
  AttachMoney,
  Delete,
  Search,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller, useFieldArray } from 'react-hook-form'; // setValue wird über useForm geholt
import api from '../services/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

const Invoices = () => {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  // const [selectedInvoice, setSelectedInvoice] = useState(null); // Behalten, falls für Editieren/Detailansicht benötigt
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    status: '',
    search: '',
    startDate: null,
    endDate: null,
  });

  // NEUE STATE-VARIABLEN
  const [customerInputMode, setCustomerInputMode] = useState('existing'); // 'existing' oder 'new'
  const [itemInputMode, setItemInputMode] = useState({}); // 'article' oder 'custom' pro Position
  const [selectedCustomer, setSelectedCustomer] = useState(null); // Für das Autocomplete im Dialog

  const { control, handleSubmit, reset, watch, setValue } = useForm({ // setValue hinzugefügt
    defaultValues: {
      customerId: null, // NEU für bestehenden Kunden
      customerName: '',
      customerAddress: '',
      description: '',
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 Tage
      taxRate: 19,
      items: [{ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 }] // 'articleId' und 'unit' hinzugefügt/standardisiert
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items'
  });

  // Fetch invoices
  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      if (filters.startDate) params.startDate = format(filters.startDate, 'yyyy-MM-dd');
      if (filters.endDate) params.endDate = format(filters.endDate, 'yyyy-MM-dd');

      const response = await api.get('/invoices', { params });
      // Sicherstellen, dass totalAmount eine Zahl ist
      if (response.data && Array.isArray(response.data.invoices)) {
        return {
          ...response.data,
          invoices: response.data.invoices.map(invoice => ({
            ...invoice,
            totalAmount: parseFloat(invoice.totalAmount) || 0,
          })),
        };
      }
      return response.data;
    },
  });

  // Fetch customers for dropdown
  const { data: customersData } = useQuery({
    queryKey: ['customers-invoice-form'], // Eindeutiger Key
    queryFn: async () => {
      const response = await api.get('/customers'); // Annahme: liefert alle Kunden
      // Sicherstellen, dass customer.balance (falls verwendet) und andere numerische Felder Zahlen sind
      if (response.data && Array.isArray(response.data.customers)) {
        return {
          ...response.data,
          customers: response.data.customers.map(customer => ({
            ...customer,
            // balance hier nicht direkt für Autocomplete benötigt, aber gute Praxis für die Datenquelle
            balance: parseFloat(customer.balance) || 0,
          })),
        };
      }
      return response.data;
    },
  });

  // NEU: Fetch articles for item selection
  const { data: articlesData } = useQuery({
    queryKey: ['articles-invoice-form'],
    queryFn: async () => {
      const response = await api.get('/articles'); // Annahme: Endpunkt liefert Artikel
      if (response.data && Array.isArray(response.data.articles)) {
        return {
          ...response.data,
          articles: response.data.articles.map(article => ({
            ...article,
            price: parseFloat(article.price) || 0, // Preis als Zahl sicherstellen
          })),
        };
      }
      return response.data;
    },
  });


  // Create invoice mutation
  const createInvoiceMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post('/invoices', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['invoices']);
      handleCloseDialog();
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const response = await api.patch(`/invoices/${id}/status`, { status });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['invoices']);
    },
  });

  const invoices = invoicesData?.invoices || [];
  const customers = customersData?.customers || []; // Für Kundenauswahl
  const articles = articlesData?.articles || [];   // NEU: Für Artikelauswahl

  const handleOpenDialog = () => {
    reset({
      customerId: null,
      customerName: '',
      customerAddress: '',
      description: '',
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      taxRate: 19,
      items: [{ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 }]
    });
    setCustomerInputMode('existing'); // NEU: Standard-Kundenmodus
    setItemInputMode({}); // NEU: Artikelmodus zurücksetzen
    setSelectedCustomer(null); // NEU: Ausgewählten Kunden zurücksetzen
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
  };

  const onSubmit = (data) => {
    // Bereite die Daten für das Backend vor, basierend auf customerInputMode etc.
    const itemsPayload = data.items.map(item => ({
      articleId: item.articleId || null,
      description: item.description,
      quantity: parseInt(item.quantity) || 1,
      unit: item.unit || 'Stück',
      pricePerUnit: parseFloat(item.pricePerUnit) || 0,
    }));

    const netTotalSubmit = itemsPayload.reduce((sum, item) => sum + (item.quantity * item.pricePerUnit), 0);
    const taxAmountSubmit = netTotalSubmit * ( (parseFloat(data.taxRate) || 0) / 100);
    const grossTotalSubmit = netTotalSubmit + taxAmountSubmit;

    const payload = {
      description: data.description,
      dueDate: data.dueDate.toISOString(),
      taxRate: parseFloat(data.taxRate) || 0,
      items: itemsPayload,
      // Gesamtsummen werden oft im Backend berechnet, aber können auch gesendet werden
      netAmount: netTotalSubmit,
      taxAmount: taxAmountSubmit,
      totalAmount: grossTotalSubmit,
    };

    if (customerInputMode === 'existing' && selectedCustomer) {
      payload.customerId = selectedCustomer.id;
      payload.customerName = selectedCustomer.name; // Name vom ausgewählten Kunden
      // payload.customerAddress = selectedCustomer.address; // Falls Adresse vom Kunden übernommen werden soll
    } else { // 'new' customer
      payload.customerName = data.customerName;
      payload.customerAddress = data.customerAddress;
    }
    
    createInvoiceMutation.mutate(payload);
  };

  const handleDownloadPDF = async (invoiceId) => {
    try {
      const response = await api.get(`/invoices/${invoiceId}/pdf`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Rechnung_${invoiceId}.pdf`; // Dynamischer Dateiname
      link.click();
      window.URL.revokeObjectURL(url); // Speicher freigeben
    } catch (error) {
      console.error('Download error:', error);
      // Hier könnte eine Fehlermeldung für den User angezeigt werden
    }
  };

  const formatCurrency = (amount) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(0);
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(num);
  };

  const getStatusColor = (status) => { /* ... (bestehender Code) ... */ };
  const getStatusLabel = (status) => { /* ... (bestehender Code) ... */ };

  const watchedItems = watch('items');
  const watchedTaxRate = watch('taxRate');

  const netTotal = (Array.isArray(watchedItems) ? watchedItems : []).reduce((sum, item) => {
    const quantity = parseFloat(item.quantity) || 0;
    const pricePerUnit = parseFloat(item.pricePerUnit) || 0;
    return sum + (quantity * pricePerUnit);
  }, 0);
  const taxAmount = netTotal * ((parseFloat(watchedTaxRate) || 0) / 100);
  const grossTotal = netTotal + taxAmount;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Rechnungsverwaltung
      </Typography>

      {/* Filters (bestehender Code) */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
             <Grid item xs={12} sm={6} md={3}>
            <TextField
              label="Suche"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              size="small"
              fullWidth
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              label="Status"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              size="small"
              fullWidth
            >
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="DRAFT">Entwurf</MenuItem>
              <MenuItem value="SENT">Versendet</MenuItem>
              <MenuItem value="PAID">Bezahlt</MenuItem>
              <MenuItem value="CANCELLED">Storniert</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <DatePicker
              label="Von"
              value={filters.startDate}
              onChange={(date) => setFilters({ ...filters, startDate: date })}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <DatePicker
              label="Bis"
              value={filters.endDate}
              onChange={(date) => setFilters({ ...filters, endDate: date })}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Button
    variant="contained"
    startIcon={<Add />}
    onClick={() => navigate('/invoices/new')}
    fullWidth
  >
    Neue Rechnung
  </Button>

          </Grid>
        </Grid>
      </Paper>

      {/* Invoices Table (bestehender Code, ggf. Anpassungen bei Datenfeldern wie invoice.totalAmount) */}
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
            {isLoading && <TableRow><TableCell colSpan={7}>Lade Rechnungen...</TableCell></TableRow>}
            {!isLoading && invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  <Typography variant="body2" fontWeight="bold">
                    {invoice.invoiceNumber}
                  </Typography>
                </TableCell>
                <TableCell>
                  {format(new Date(invoice.createdAt), 'dd.MM.yyyy', { locale: de })}
                </TableCell>
                <TableCell>{invoice.customerName}</TableCell>
                <TableCell align="right">
                  <Typography variant="body2">
                    {formatCurrency(invoice.totalAmount)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={getStatusLabel(invoice.status)}
                    color={getStatusColor(invoice.status)}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  {format(new Date(invoice.dueDate), 'dd.MM.yyyy', { locale: de })}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => handleDownloadPDF(invoice.id)}
                    title="PDF herunterladen"
                  >
                    <Download />
                  </IconButton>
                  {invoice.status === 'DRAFT' && (
                    <IconButton
                      size="small"
                      color="info"
                      onClick={() => updateStatusMutation.mutate({
                        id: invoice.id,
                        status: 'SENT'
                      })}
                      title="Als versendet markieren"
                    >
                      <Send />
                    </IconButton>
                  )}
                  {invoice.status === 'SENT' && (
                    <IconButton
                      size="small"
                      color="success"
                      onClick={() => updateStatusMutation.mutate({
                        id: invoice.id,
                        status: 'PAID'
                      })}
                      title="Als bezahlt markieren"
                    >
                      <AttachMoney />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Invoice Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Neue Rechnung erstellen</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {/* NEU: Kundenauswahl / Eingabe */}
              <Grid item xs={12}>
                <ToggleButtonGroup
                  value={customerInputMode}
                  exclusive
                  onChange={(e, value) => {
                    if (value) {
                      setCustomerInputMode(value);
                      if (value === 'existing') {
                        setValue('customerName', '');
                        setValue('customerAddress', '');
                      } else { // 'new'
                        setSelectedCustomer(null);
                        setValue('customerId', null);
                         // Wenn von bestehend zu neu gewechselt wird und ein Kunde ausgewählt war,
                         // könnte man customerName etc. aus selectedCustomer übernehmen oder leeren.
                         // Hier wird es geleert bzw. nicht automatisch übernommen.
                      }
                    }
                  }}
                  size="small"
                  fullWidth // Nimmt volle Breite des Grid-Items
                >
                  <ToggleButton value="existing">Bestehender Kunde</ToggleButton>
                  <ToggleButton value="new">Neuer Kunde (einmalig)</ToggleButton>
                </ToggleButtonGroup>
              </Grid>

              {customerInputMode === 'existing' ? (
                <Grid item xs={12}>
                  <Controller
                    name="customerId" // Dieses Feld wird für die Formular-Daten benötigt
                    control={control}
                    rules={{ required: customerInputMode === 'existing' ? 'Kunde muss ausgewählt werden' : false }}
                    render={({ field, fieldState: { error } }) => (
                      <Autocomplete
                        // {...field} // field enthält onChange, onBlur, value, ref. Wir überschreiben value und onChange.
                        options={customers}
                        getOptionLabel={(option) => `${option.name} ${option.nickname ? `(${option.nickname})` : ''}`}
                        value={selectedCustomer} // Gesteuert durch selectedCustomer State
                        onChange={(event, newValue) => {
                          setSelectedCustomer(newValue);
                          field.onChange(newValue?.id || null); // Formularwert setzen
                          if (newValue) {
                            setValue('customerName', newValue.name); // Setze Namen für den Fall, dass er gebraucht wird
                            // Optional: Adresse aus Kunde übernehmen, wenn vorhanden und gewünscht
                            // setValue('customerAddress', newValue.address || '');
                          } else {
                             setValue('customerName', '');
                             // setValue('customerAddress', '');
                          }
                        }}
                        isOptionEqualToValue={(option, value) => option.id === value?.id}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Kunde auswählen"
                            required={customerInputMode === 'existing'}
                            error={!!error}
                            helperText={error?.message}
                            fullWidth
                          />
                        )}
                      />
                    )}
                  />
                </Grid>
              ) : ( // customerInputMode === 'new'
                <>
                  <Grid item xs={12} sm={6}>
                    <Controller
                      name="customerName"
                      control={control}
                      rules={{ required: customerInputMode === 'new' ? 'Kundenname ist erforderlich' : false }}
                      render={({ field, fieldState: { error } }) => (
                        <TextField
                          {...field}
                          label="Kundenname"
                          error={!!error}
                          helperText={error?.message}
                          fullWidth
                          required={customerInputMode === 'new'}
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Controller
                      name="customerAddress"
                      control={control}
                      // rules für Adresse optional machen oder je nach Bedarf anpassen
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Kundenadresse (optional)"
                          multiline
                          rows={1} // Für eine kompaktere Darstellung, ggf. anpassen
                          fullWidth
                        />
                      )}
                    />
                  </Grid>
                </>
              )}
              {/* Ende Kundenauswahl */}

              <Grid item xs={12} sm={6}>
                <Controller
                  name="dueDate"
                  control={control}
                  rules={{ required: 'Fälligkeitsdatum ist erforderlich' }}
                  render={({ field, fieldState: { error } }) => (
                    <DatePicker
                      {...field}
                      label="Fälligkeitsdatum"
                      slotProps={{ textField: { fullWidth: true, error: !!error, helperText: error?.message } }}
                    />
                  )}
                />
              </Grid>
               <Grid item xs={12} sm={6}>
                <Controller
                  name="taxRate"
                  control={control}
                  defaultValue={19}
                  rules={{ required: 'Steuersatz ist erforderlich', min: 0 }}
                  render={({ field, fieldState: { error } }) => (
                    <TextField
                      {...field}
                      label="Steuersatz %"
                      type="number"
                      fullWidth
                      error={!!error}
                      helperText={error?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="description"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Beschreibung (optional, z.B. Projektname)"
                      multiline
                      rows={2}
                      fullWidth
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  Rechnungspositionen
                </Typography>
                {/* NEU: Rechnungspositionen mit Auswahlmodus */}
                {fields.map((field, index) => (
                  <Box key={field.id} sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Grid container spacing={2} alignItems="center"> {/* alignItems hinzugefügt */}
                      <Grid item xs={12}>
                        <ToggleButtonGroup
                          value={itemInputMode[index] || 'custom'}
                          exclusive
                          onChange={(e, value) => {
                            if (value) {
                              setItemInputMode({ ...itemInputMode, [index]: value });
                              if (value === 'custom') {
                                setValue(`items.${index}.articleId`, null);
                              }
                            }
                          }}
                          size="small"
                        >
                          <ToggleButton value="article">Bestehender Artikel</ToggleButton>
                          <ToggleButton value="custom">Freie Eingabe</ToggleButton>
                        </ToggleButtonGroup>
                      </Grid>

                      {itemInputMode[index] === 'article' ? (
                        <Grid item xs={12}> {/* Volle Breite für Artikel-Autocomplete */}
                           <Controller
                            name={`items.${index}.articleId`}
                            control={control}
                            render={({ field: articleField }) => ( // removed fieldState as not used here
                              <Autocomplete
                                {...articleField}
                                options={articles.filter(art => art.active)} // Nur aktive Artikel anbieten
                                getOptionLabel={(option) => option.name || ''}
                                isOptionEqualToValue={(option, value) => option.id === value?.id}
                                onChange={(event, newValue) => {
                                  articleField.onChange(newValue?.id || null);
                                  if (newValue) {
                                    setValue(`items.${index}.description`, newValue.name);
                                    setValue(`items.${index}.pricePerUnit`, newValue.price); // Preis ist bereits eine Zahl
                                    setValue(`items.${index}.unit`, newValue.unit || 'Stück');
                                  } else {
                                    setValue(`items.${index}.description`, '');
                                    setValue(`items.${index}.pricePerUnit`, 0);
                                    setValue(`items.${index}.unit`, 'Stück');
                                  }
                                }}
                                value={articles.find(art => art.id === articleField.value) || null}
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    label="Artikel auswählen"
                                    size="small"
                                    fullWidth
                                  />
                                )}
                              />
                            )}
                          />
                        </Grid>
                      ) : ( // 'custom' input mode
                        <Grid item xs={12} sm={6}> {/* Angepasst für Layout */}
                          <Controller
                            name={`items.${index}.description`}
                            control={control}
                            rules={{ required: 'Beschreibung erforderlich' }}
                            render={({ field: descField, fieldState: { error: descError } }) => (
                              <TextField
                                {...descField}
                                label="Beschreibung"
                                size="small"
                                error={!!descError}
                                helperText={descError?.message}
                                fullWidth
                              />
                            )}
                          />
                        </Grid>
                      )}
                      {/* Gemeinsame Felder, angepasst für Layout */}
                      <Grid item xs={itemInputMode[index] === 'article' ? 6 : 12} sm={itemInputMode[index] === 'article' ? 3 : 2}>
                        <Controller
                          name={`items.${index}.quantity`}
                          control={control}
                          defaultValue={1}
                          rules={{ required: "Menge?", min: { value: 0.01, message: ">0" } }}
                          render={({ field, fieldState: { error } }) => (
                            <TextField
                              {...field}
                              label="Menge"
                              type="number"
                              inputProps={{ step: 0.01 }}
                              size="small"
                              fullWidth
                              error={!!error}
                              helperText={error?.message}
                            />
                          )}
                        />
                      </Grid>
                      {itemInputMode[index] !== 'article' && ( // Einheit nur bei freier Eingabe oder immer?
                        <Grid item xs={6} sm={2}>
                            <Controller
                            name={`items.${index}.unit`}
                            control={control}
                            defaultValue={"Stück"}
                            render={({ field }) => (
                                <TextField
                                {...field}
                                label="Einheit"
                                size="small"
                                fullWidth
                                />
                            )}
                            />
                        </Grid>
                      )}
                      <Grid item xs={itemInputMode[index] === 'article' ? 6 : 12} sm={itemInputMode[index] === 'article' ? (articles.find(art => art.id === watch(`items.${index}.articleId`))?.unit ? 2 : 3 ) : 3}>
                         <Controller
                          name={`items.${index}.pricePerUnit`}
                          control={control}
                          defaultValue={0}
                          rules={{ required: "Preis?", min: {value: 0, message: ">=0"} }}
                          render={({ field, fieldState: { error } }) => (
                            <TextField
                              {...field}
                              label="Einzelpreis"
                              type="number"
                              inputProps={{ step: 0.01 }}
                              size="small"
                              fullWidth
                              InputProps={{
                                startAdornment: <InputAdornment position="start">€</InputAdornment>,
                              }}
                              disabled={itemInputMode[index] === 'article' && !!watch(`items.${index}.articleId`)}
                              error={!!error}
                              helperText={error?.message}
                            />
                          )}
                        />
                      </Grid>
                       {itemInputMode[index] === 'article' && articles.find(art => art.id === watch(`items.${index}.articleId`))?.unit && (
                         <Grid item xs={6} sm={1} container alignItems="center">
                            <Typography variant="body2">{watch(`items.${index}.unit`)}</Typography>
                         </Grid>
                       )}
                      <Grid item xs={12} sm={1} container alignItems="center" justifyContent="flex-end">
                        {fields.length > 1 && (
                          <IconButton color="error" onClick={() => remove(index)} size="small">
                            <Delete />
                          </IconButton>
                        )}
                      </Grid>
                    </Grid>
                  </Box>
                ))}
                <Button
                  variant="outlined"
                  onClick={() => {
                    append({ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 });
                    // Setzt den Modus für das neue Item standardmäßig auf 'custom'
                    setItemInputMode(prev => ({...prev, [fields.length]: 'custom'}));
                  }}
                  startIcon={<Add />}
                >
                  Position hinzufügen
                </Button>
              </Grid>
              {/* Ende Rechnungspositionen */}

              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="body1">
                    Netto: {formatCurrency(netTotal)}
                  </Typography>
                  <Typography variant="body1">
                    MwSt. ({parseFloat(watchedTaxRate) || 0}%): {formatCurrency(taxAmount)}
                  </Typography>
                  <Typography variant="h6">
                    Brutto: {formatCurrency(grossTotal)}
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Abbrechen</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createInvoiceMutation.isLoading}
            >
              {createInvoiceMutation.isLoading ? 'Erstelle...' : 'Erstellen & Entwurf'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Invoices;