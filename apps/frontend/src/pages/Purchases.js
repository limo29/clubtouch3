import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,                 // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet, wenn ich mich nicht täusche
  CardContent,          // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
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
  InputAdornment,
  Alert,                // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
  List,                 // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
  ListItem,             // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
  ListItemText,         // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
  Divider,              // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
  FormControlLabel,
  Checkbox,
  MenuItem,
  Autocomplete,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';

import {
  Add,
  Receipt,              // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
  CheckCircle,
  Cancel,
  AttachMoney,
  CalendarToday,        // War im bestehenden Code, wird aber im finalen Merge nicht direkt verwendet
  CloudUpload,
  Delete,
  Visibility,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller, useFieldArray, setValue } from 'react-hook-form'; // 'setValue' hinzugefügt
import api from '../services/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const Purchases = () => {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState(null); // Behalten, falls es für Detailansicht/Editieren später genutzt wird
  const [filters, setFilters] = useState({
    startDate: null,
    endDate: null,
    paid: '',
    search: '',
  });
  const [imageFile, setImageFile] = useState(null);

  // NEU: Zustand für den Eingabemodus der Artikelpositionen
  const [itemInputMode, setItemInputMode] = useState({}); // 'article' oder 'custom' pro Position

  const { control, handleSubmit, reset, watch, setValue } = useForm({ // 'setValue' aus useForm hier auch verfügbar
    defaultValues: {
      supplier: '', // Wird durch Autocomplete-Logik beeinflusst, Initialwert kann bleiben
      invoiceNumber: '',
      description: '',
      invoiceDate: new Date(),
      dueDate: null,
      paid: false,
      paymentMethod: 'TRANSFER',
      items: [{ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 }] // 'articleId' hinzugefügt
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items'
  });

  // Fetch purchases
  const { data: purchasesData, isLoading } = useQuery({
    queryKey: ['purchases', filters],
    queryFn: async () => {
      const params = {};
      if (filters.startDate) params.startDate = format(filters.startDate, 'yyyy-MM-dd');
      if (filters.endDate) params.endDate = format(filters.endDate, 'yyyy-MM-dd');
      if (filters.paid !== '') params.paid = filters.paid;
      if (filters.search) params.search = filters.search;

      const response = await api.get('/purchases', { params });
      // Konvertiere totalAmount zu einer Zahl
      if (response.data && Array.isArray(response.data.purchases)) {
        return {
          ...response.data,
          purchases: response.data.purchases.map(purchase => ({
            ...purchase,
            totalAmount: parseFloat(purchase.totalAmount) || 0,
          })),
        };
      }
      return response.data;
    },
  });

  // Fetch articles for linking
  const { data: articlesData } = useQuery({
    queryKey: ['articles-list-purchases'], // Geänderter Key zur Sicherheit, falls 'articles-list' woanders verwendet wird
    queryFn: async () => {
      const response = await api.get('/articles'); // Annahme: Endpunkt liefert alle Artikel für Auswahl
       // Stelle sicher, dass der Preis eine Zahl ist
      if (response.data && Array.isArray(response.data.articles)) {
        return {
            ...response.data,
            articles: response.data.articles.map(article => {
                const price = parseFloat(article.price);
                return {
                    ...article,
                    price: isNaN(price) ? 0 : price
                };
            })
        };
      }
      return response.data;
    },
  });

  // NEU: Fetch unique suppliers
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const response = await api.get('/purchases/suppliers'); // Stelle sicher, dass dieser Endpunkt existiert
      return response.data;
    },
  });

  // Create purchase mutation
  const createPurchaseMutation = useMutation({
    mutationFn: async (formData) => {
      const response = await api.post('/purchases', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['purchases']);
      handleCloseDialog();
    },
  });

  // Mark as paid mutation
  const markAsPaidMutation = useMutation({
    mutationFn: async ({ id, paymentMethod }) => {
      const response = await api.post(`/purchases/${id}/mark-paid`, { paymentMethod });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['purchases']);
    },
  });

  const purchases = purchasesData?.purchases || [];
  const articles = articlesData?.articles || []; // Artikel für die Auswahl
  const suppliers = suppliersData?.suppliers || []; // NEU: Lieferanten für Autocomplete

  const handleOpenDialog = () => {
    reset({
      supplier: '', // Wird durch Autocomplete-Logik beeinflusst
      invoiceNumber: '',
      description: '',
      invoiceDate: new Date(),
      dueDate: null,
      paid: false,
      paymentMethod: 'TRANSFER',
      items: [{ articleId: null, description: '', quantity: 1, unit: 'Stück', pricePerUnit: 0 }] // 'articleId' hinzugefügt
    });
    setImageFile(null);
    setItemInputMode({}); // NEU: itemInputMode zurücksetzen
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setImageFile(null);
  };

  const onSubmit = (data) => {
    const formData = new FormData();

    const totalAmount = data.items.reduce((sum, item) => {
      const price = parseFloat(item.pricePerUnit) || 0;
      const quantity = parseInt(item.quantity) || 0;
      return sum + (quantity * price);
    }, 0);

    // Für Autocomplete wird der Wert von 'supplier' direkt als String übernommen, wenn er neu ist,
    // oder ist ein Objekt, wenn einer ausgewählt wurde. Backend muss das handhaben oder wir müssen hier den Namen extrahieren.
    // Annahme: Wenn es ein String ist, ist es ein neuer Lieferant. Wenn Objekt, dann `value.name` oder `value` selbst, falls getOptionLabel nur Strings liefert.
    // Da freeSolo erlaubt ist, kann data.supplier ein String (neuer Lieferant) oder ein Objekt (ausgewählter Lieferant) sein.
    // Das Backend muss entscheiden, wie es damit umgeht (neuen Lieferanten anlegen oder bestehenden verwenden).
    // Für den Fall, dass ein Objekt zurückgegeben wird und nur der Name gesendet werden soll:
    const supplierName = typeof data.supplier === 'object' && data.supplier !== null ? data.supplier.name : data.supplier;
    formData.append('supplier', supplierName || '');


    formData.append('invoiceNumber', data.invoiceNumber || '');
    formData.append('description', data.description || '');
    formData.append('totalAmount', totalAmount.toString()); // Als String senden, Backend konvertiert
    formData.append('invoiceDate', data.invoiceDate.toISOString());
    formData.append('paid', data.paid.toString()); // Als String 'true'/'false'

    if (data.dueDate) {
      formData.append('dueDate', data.dueDate.toISOString());
    }

    if (data.paid) {
      formData.append('paymentMethod', data.paymentMethod);
    }

    // Items als JSON, inklusive articleId falls vorhanden
    formData.append('items', JSON.stringify(data.items.map(item => {
      const price = parseFloat(item.pricePerUnit) || 0;
      const quantity = parseInt(item.quantity) || 0;
      return {
        articleId: item.articleId || null, // articleId aus dem Formularwert
        description: item.description,
        quantity: quantity,
        unit: item.unit,
        pricePerUnit: price,
        totalPrice: quantity * price
      };
    })));

    if (imageFile) {
      formData.append('invoice', imageFile);
    }

    createPurchaseMutation.mutate(formData);
  };

  const formatCurrency = (amount) => {
    const num = parseFloat(amount); // Sicherstellen, dass es eine Zahl ist
    if (isNaN(num)) return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(0);
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(num);
  };

  const items = watch('items');
  const formTotal = items.reduce((sum, item) => {
    const price = parseFloat(item.pricePerUnit) || 0;
    const quantity = parseInt(item.quantity) || 0;
    return sum + (quantity * price);
  }, 0);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Einkaufsverwaltung
      </Typography>

      {/* Filters (bestehender Code) */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <DatePicker
              label="Von"
              value={filters.startDate}
              onChange={(date) => setFilters({ ...filters, startDate: date })}
              renderInput={(params) => <TextField {...params} size="small" fullWidth />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <DatePicker
              label="Bis"
              value={filters.endDate}
              onChange={(date) => setFilters({ ...filters, endDate: date })}
              renderInput={(params) => <TextField {...params} size="small" fullWidth />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              label="Status"
              value={filters.paid}
              onChange={(e) => setFilters({ ...filters, paid: e.target.value })}
              size="small"
              fullWidth
            >
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="true">Bezahlt</MenuItem>
              <MenuItem value="false">Offen</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              label="Suche"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              size="small"
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleOpenDialog}
              fullWidth
            >
              Neuer Einkauf
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Purchases Table (bestehender Code) */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Datum</TableCell>
              <TableCell>Lieferant</TableCell>
              <TableCell>Rechnungsnr.</TableCell>
              <TableCell align="right">Betrag</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Fällig</TableCell>
              <TableCell align="right">Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {purchases.map((purchase) => (
              <TableRow key={purchase.id}>
                <TableCell>
                  {format(new Date(purchase.invoiceDate), 'dd.MM.yyyy', { locale: de })}
                </TableCell>
                <TableCell>{purchase.supplier}</TableCell>
                <TableCell>{purchase.invoiceNumber || '-'}</TableCell>
                <TableCell align="right">
                  <Typography variant="body2">
                    {formatCurrency(purchase.totalAmount)}
                  </Typography>
                </TableCell>
                <TableCell>
                  {purchase.paid ? (
                    <Chip
                      icon={<CheckCircle />}
                      label="Bezahlt"
                      color="success"
                      size="small"
                    />
                  ) : (
                    <Chip
                      icon={<Cancel />}
                      label="Offen"
                      color="error"
                      size="small"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {purchase.dueDate
                    ? format(new Date(purchase.dueDate), 'dd.MM.yyyy', { locale: de })
                    : '-'
                  }
                </TableCell>
                <TableCell align="right">
                  {purchase.invoiceImage && (
                    <IconButton
                      size="small"
                      href={purchase.invoiceImage} // Stelle sicher, dass dies die korrekte URL ist (ggf. vom Backend-Pfad ableiten)
                      target="_blank"
                    >
                      <Visibility />
                    </IconButton>
                  )}
                  {!purchase.paid && (
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => {
                        if (window.confirm('Als bezahlt markieren?')) {
                          markAsPaidMutation.mutate({
                            id: purchase.id,
                            paymentMethod: 'TRANSFER' // Oder eine Auswahlmöglichkeit bieten
                          });
                        }
                      }}
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

      {/* Create Purchase Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Neuer Einkauf</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {/* ERSETZT: Supplier TextField durch Autocomplete */}
              <Grid item xs={12} sm={6}>
                <Controller
                  name="supplier"
                  control={control}
                  rules={{ required: 'Lieferant ist erforderlich' }}
                  render={({ field, fieldState: { error } }) => (
                    <Autocomplete
                      {...field}
                      freeSolo // Erlaubt freie Eingabe
                      options={suppliers.map((option) => option.name || option)} // Stellt sicher, dass Strings oder Objekte mit .name funktionieren
                      getOptionLabel={(option) => typeof option === 'string' ? option : option.name || ''}
                      onChange={(event, value) => field.onChange(value)} // value kann String oder Objekt sein
                      value={typeof field.value === 'object' ? field.value : suppliers.find(s => s.name === field.value) || field.value || null}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Lieferant"
                          error={!!error}
                          helperText={error?.message || 'Wählen Sie einen bestehenden oder geben Sie einen neuen ein'}
                          fullWidth
                        />
                      )}
                    />
                  )}
                />
              </Grid>
              {/* Ende Supplier Autocomplete */}

              <Grid item xs={12} sm={6}>
                <Controller
                  name="invoiceNumber"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Rechnungsnummer"
                      fullWidth
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="invoiceDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      {...field}
                      label="Rechnungsdatum"
                      renderInput={(params) => <TextField {...params} fullWidth />}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="dueDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      {...field}
                      label="Fälligkeitsdatum"
                      renderInput={(params) => <TextField {...params} fullWidth />}
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
                      label="Beschreibung"
                      multiline
                      rows={2}
                      fullWidth
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  Positionen
                </Typography>
                {/* NEU: Artikel-Positionen mit Auswahlmodus */}
                {fields.map((field, index) => (
                  <Box key={field.id} sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <ToggleButtonGroup
                          value={itemInputMode[index] || 'custom'} // Standard auf 'custom'
                          exclusive
                          onChange={(e, value) => {
                            if (value) { // Stellt sicher, dass value nicht null ist (passiert, wenn derselbe Button erneut geklickt wird)
                              setItemInputMode({ ...itemInputMode, [index]: value });
                              if (value === 'custom') {
                                setValue(`items.${index}.articleId`, null);
                                // Optional: Beschreibung und Preis leeren oder beibehalten?
                                // setValue(`items.${index}.description`, '');
                                // setValue(`items.${index}.pricePerUnit`, 0);
                              } else { // value === 'article'
                                // Optional: Wenn zu Artikel gewechselt wird und vorher freie Eingabe war,
                                // könnte man das Beschreibungsfeld für die Artikelauswahl leeren.
                                // setValue(`items.${index}.description`, '');
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
                        <>
                          <Grid item xs={12}> {/* Volle Breite für Artikel-Autocomplete */}
                            <Controller
                              name={`items.${index}.articleId`}
                              control={control}
                              // rules={{ required: 'Artikel muss ausgewählt werden' }} // Validierung, falls Artikelmodus aktiv
                              render={({ field: articleField, fieldState: { error: articleError } }) => (
                                <Autocomplete
                                  {...articleField}
                                  options={articles}
                                  getOptionLabel={(option) => option.name || ''}
                                  isOptionEqualToValue={(option, value) => option.id === value?.id}
                                  onChange={(event, value) => {
                                    articleField.onChange(value?.id || null);
                                    if (value) {
                                      setValue(`items.${index}.description`, value.name);
                                      // 'value.price' sollte hier bereits eine Zahl sein durch die Transformation in useQuery
                                      setValue(`items.${index}.pricePerUnit`, value.price);
                                      setValue(`items.${index}.unit`, value.unit || 'Stück'); // Einheit vom Artikel übernehmen
                                    } else { // Wenn Auswahl gelöscht wird
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
                                      error={!!articleError}
                                      helperText={articleError?.message}
                                    />
                                  )}
                                />
                              )}
                            />
                          </Grid>
                        </>
                      ) : ( // 'custom' input mode
                        <Grid item xs={12}> {/* Volle Breite für freie Beschreibung */}
                          <Controller
                            name={`items.${index}.description`}
                            control={control}
                            rules={{ required: 'Beschreibung ist erforderlich' }}
                            render={({ field: descField, fieldState: { error: descError } }) => (
                              <TextField
                                {...descField}
                                label="Beschreibung"
                                size="small"
                                fullWidth
                                error={!!descError}
                                helperText={descError?.message}
                              />
                            )}
                          />
                        </Grid>
                      )}

                      {/* Gemeinsame Felder für Menge, Einheit, Einzelpreis */}
                      <Grid item xs={6} sm={3}> {/* Angepasste Grid-Größen */}
                        <Controller
                          name={`items.${index}.quantity`}
                          control={control}
                          defaultValue={1}
                          rules={{ required: 'Menge ist erforderlich', min: { value: 1, message: "Mind. 1" } }}
                          render={({ field, fieldState: { error } }) => (
                            <TextField
                              {...field}
                              label="Menge"
                              type="number"
                              size="small"
                              fullWidth
                              error={!!error}
                              helperText={error?.message}
                            />
                          )}
                        />
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <Controller
                          name={`items.${index}.unit`}
                          control={control}
                          defaultValue="Stück"
                          rules={{ required: 'Einheit ist erforderlich' }}
                          render={({ field, fieldState: { error } }) => (
                            <TextField
                              {...field}
                              label="Einheit"
                              size="small"
                              fullWidth
                              error={!!error}
                              helperText={error?.message}
                            />
                          )}
                        />
                      </Grid>
                      <Grid item xs={12} sm={4}> {/* Angepasste Grid-Größen */}
                        <Controller
                          name={`items.${index}.pricePerUnit`}
                          control={control}
                          defaultValue={0}
                          rules={{ required: 'Preis ist erforderlich', min: {value: 0, message: "Positiver Preis"} }}
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
                              error={!!error}
                              helperText={error?.message}
                              // Deaktiviere das Feld, wenn ein Artikel ausgewählt ist und der Preis vom Artikel kommt
                              disabled={itemInputMode[index] === 'article' && !!watch(`items.${index}.articleId`)}
                            />
                          )}
                        />
                      </Grid>
                      <Grid item xs={12} sm={2} container alignItems="center" justifyContent="flex-end"> {/* Angepasste Grid-Größen */}
                        {fields.length > 1 && (
                          <IconButton
                            color="error"
                            onClick={() => remove(index)}
                            size="small"
                          >
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
                    // Neuen Eintrag standardmäßig auf 'custom' setzen oder letzten Modus beibehalten?
                    // Hier wird standardmäßig 'custom' via (itemInputMode[index] || 'custom') in der ToggleButtonGroup
                  }}
                  startIcon={<Add />}
                >
                  Position hinzufügen
                </Button>
              </Grid>
              {/* Ende Artikel-Positionen */}

              <Grid item xs={12}>
                <Typography variant="h6">
                  Gesamtbetrag: {formatCurrency(formTotal)}
                </Typography>
              </Grid>

              <Grid item xs={12} sm={6}>
                <Controller
                  name="paid"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Checkbox {...field} checked={field.value} />}
                      label="Bereits bezahlt"
                    />
                  )}
                />
              </Grid>

              {watch('paid') && (
                <Grid item xs={12} sm={6}>
                  <Controller
                    name="paymentMethod"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Zahlungsart"
                        select
                        fullWidth
                      >
                        <MenuItem value="CASH">Bar</MenuItem>
                        <MenuItem value="TRANSFER">Überweisung</MenuItem>
                      </TextField>
                    )}
                  />
                </Grid>
              )}

              <Grid item xs={12}>
                <Button
                  variant="outlined"
                  component="label"
                  startIcon={<CloudUpload />}
                  fullWidth
                >
                  Rechnung hochladen
                  <input
                    type="file"
                    hidden
                    accept="image/*,application/pdf"
                    onChange={(e) => setImageFile(e.target.files[0])}
                  />
                </Button>
                {imageFile && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Datei: {imageFile.name}
                  </Typography>
                )}
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Abbrechen</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createPurchaseMutation.isLoading}
            >
              {createPurchaseMutation.isLoading ? 'Speichere...' : 'Speichern'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Purchases;