import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Card,
  CardContent,
  Chip,
  Alert,
  InputAdornment,
} from '@mui/material';
import {
  Add,
  Delete,
  Save,
  Print,
  Search,
  Person,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const InvoicesNew = () => {
const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState('');
  const [articleSearch, setArticleSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  
  const { control, handleSubmit, watch, setValue } = useForm({
    defaultValues: {
      customerId: null,
      customerName: '',
      customerAddress: '',
      description: '',
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      items: []
    }
  });

  const { fields, append, remove, update } = useFieldArray({
    control,
    name: 'items'
  });

  // Fetch Kunden
  const { data: customersData } = useQuery({
    queryKey: ['customers-invoice', customerSearch],
    queryFn: async () => {
      const response = await api.get('/customers', {
        params: customerSearch ? { search: customerSearch } : {}
      });
      return response.data;
    },
  });

  // Fetch Artikel
  const { data: articlesData } = useQuery({
    queryKey: ['articles-invoice'],
    queryFn: async () => {
      const response = await api.get('/articles');
      return response.data;
    },
  });

  const customers = customersData?.customers || [];
  const articles = articlesData?.articles || [];
  const watchedItems = watch('items');
  // Gefilterte Artikel
  const filteredArticles = articles.filter(a => 
    a.name.toLowerCase().includes(articleSearch.toLowerCase())
  );

  // Kunde auswählen
  const handleCustomerSelect = (customer) => {
    setSelectedCustomer(customer);
    setValue('customerId', customer.id);
    setValue('customerName', customer.name);
    setValue('customerAddress', ''); // Später aus Kundendaten
  };

  // Artikel hinzufügen
const handleArticleAdd = (article) => {
  append({
    articleId: article.id,
    description: article.name,
    quantity: 1,
    pricePerUnit: Number(article.price) // Konvertiere zu Number
  });
};


  // Freie Position hinzufügen
  const handleFreeItemAdd = () => {
    append({
      articleId: null,
      description: '',
      quantity: 1,
      pricePerUnit: 0
    });
  };

  // Gesamtbetrag berechnen
 const total = React.useMemo(() => {
  if (!watchedItems || !Array.isArray(watchedItems)) return 0;
  
  return watchedItems.reduce((sum, item) => {
    const quantity = parseFloat(item?.quantity) || 0;
    const price = parseFloat(item?.pricePerUnit) || 0;
    return sum + (quantity * price);
  }, 0);
}, [watchedItems]);


  const createInvoiceMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post('/api/invoices', data);
      return response.data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries(['invoices']);
      
      // PDF herunterladen
      try {
        const response = await api.get(`/api/invoices/${data.invoice.id}/pdf`, {
          responseType: 'blob'
        });
        
        const blob = new Blob([response.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Rechnung_${data.invoice.invoiceNumber}.pdf`;
        link.click();
      } catch (error) {
        console.error('PDF-Download fehlgeschlagen:', error);
      }
      
      // Zurück zur Übersicht
      navigate('/invoices');
    },
  });



  // Button zum Speichern als Entwurf
  const saveDraftMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post('/api/invoices', { ...data, status: 'DRAFT' });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['invoices']);
      navigate('/invoices');
    },
  });


  const onSubmit = async (data) => {
    try {
      const response = await api.post('/invoices', data);
      queryClient.invalidateQueries(['invoices']);
      createInvoiceMutation.mutate(data);
      // Navigate zur Übersicht oder öffne PDF
    } catch (error) {
      console.error('Fehler beim Erstellen der Rechnung:', error);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Neue Rechnung erstellen
      </Typography>
      
      <form onSubmit={handleSubmit(onSubmit)}>
        <Grid container spacing={3}>
          {/* Kunde auswählen */}
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2, height: '100%' }}>
              <Typography variant="h6" gutterBottom>
                Kunde
              </Typography>
              
              <TextField
                placeholder="Kunde suchen..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                fullWidth
                sx={{ mb: 2 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
              />
              
              {selectedCustomer ? (
                <Card>
                  <CardContent>
                    <Typography variant="subtitle1">
                      {selectedCustomer.name}
                    </Typography>
                    {selectedCustomer.nickname && (
                      <Typography variant="body2" color="text.secondary">
                        {selectedCustomer.nickname}
                      </Typography>
                    )}
                    <Button
                      size="small"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setValue('customerId', null);
                        setValue('customerName', '');
                      }}
                    >
                      Anderen Kunden wählen
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Box sx={{ maxHeight: 200, overflowY: 'auto', mb: 2 }}>
                    {customers.slice(0, 5).map(customer => (
                      <Card
                        key={customer.id}
                        sx={{ mb: 1, cursor: 'pointer' }}
                        onClick={() => handleCustomerSelect(customer)}
                      >
                        <CardContent sx={{ p: 1 }}>
                          <Typography variant="body2">
                            {customer.name}
                            {customer.nickname && ` (${customer.nickname})`}
                          </Typography>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                  
                  <Alert severity="info">
                    Oder geben Sie die Kundendaten manuell ein:
                  </Alert>
                  
                  <Controller
                    name="customerName"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Kundenname"
                        fullWidth
                        sx={{ mt: 2 }}
                      />
                    )}
                  />
                  
                  <Controller
                    name="customerAddress"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Adresse"
                        multiline
                        rows={3}
                        fullWidth
                        sx={{ mt: 2 }}
                      />
                    )}
                  />
                </>
              )}
            </Paper>
          </Grid>
          
          {/* Rechnungspositionen */}
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Rechnungspositionen
              </Typography>
              
              {/* Artikel-Suche */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={8}>
                  <TextField
                    placeholder="Artikel suchen und hinzufügen..."
                    value={articleSearch}
                    onChange={(e) => setArticleSearch(e.target.value)}
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
                <Grid item xs={4}>
                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={handleFreeItemAdd}
                    startIcon={<Add />}
                  >
                    Freie Position
                  </Button>
                </Grid>
              </Grid>
              
              {/* Artikel-Vorschläge */}
              {articleSearch && (
                <Grid container spacing={1} sx={{ mb: 2, maxHeight: 150, overflowY: 'auto' }}>
                  {filteredArticles.slice(0, 6).map(article => (
                    <Grid item xs={12} sm={6} md={4} key={article.id}>
                      <Card
                        sx={{ cursor: 'pointer' }}
                        onClick={() => {
                          handleArticleAdd(article);
                          setArticleSearch('');
                        }}
                      >
                        <CardContent sx={{ p: 1 }}>
                          <Typography variant="body2" noWrap>
                            {article.name}
                          </Typography>
                            <Typography variant="caption">
                            €{Number(article.price).toFixed(2)}
                            </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
              
              {/* Positionen-Tabelle */}
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Beschreibung</TableCell>
                      <TableCell width={100}>Menge</TableCell>
                      <TableCell width={120}>Einzelpreis</TableCell>
                      <TableCell width={120}>Gesamt</TableCell>
                      <TableCell width={50}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {fields.map((field, index) => (
                      <TableRow key={field.id}>
                        <TableCell>
                          <Controller
                            name={`items.${index}.description`}
                            control={control}
                            render={({ field }) => (
                              <TextField
                                {...field}
                                size="small"
                                fullWidth
                                variant="standard"
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <Controller
                            name={`items.${index}.quantity`}
                            control={control}
                            render={({ field }) => (
                              <TextField
                                {...field}
                                type="number"
                                size="small"
                                variant="standard"
                                inputProps={{ min: 0.01, step: 0.01 }}
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <Controller
                            name={`items.${index}.pricePerUnit`}
                            control={control}
                            render={({ field }) => (
                              <TextField
                                {...field}
                                type="number"
                                size="small"
                                variant="standard"
                                inputProps={{ min: 0, step: 0.01 }}
                                InputProps={{
                                  startAdornment: <InputAdornment position="start">€</InputAdornment>,
                                }}
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          €{(field.quantity * field.pricePerUnit).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => remove(index)}>
                            <Delete />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                    
                    {fields.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3 }}>
                          <Typography color="text.secondary">
                            Keine Positionen vorhanden. Suchen Sie nach Artikeln oder fügen Sie eine freie Position hinzu.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Controller
                  name="dueDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      {...field}
                      label="Fälligkeitsdatum"
                      renderInput={(params) => <TextField {...params} size="small" />}
                    />
                  )}
                />
                
                <Typography variant="h5">
                  Gesamtbetrag: €{total.toFixed(2)}
                </Typography>
              </Box>
              
              <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                <Button
                     variant="outlined"
                     startIcon={<Save />}
                    onClick={() => saveDraftMutation.mutate(watch())}
                    disabled={saveDraftMutation.isLoading}
                    >
                      Als Entwurf speichern
                    </Button>

                  <Button
    variant="contained"
    type="submit"
    startIcon={<Print />}
    disabled={createInvoiceMutation.isLoading}
  >
    {createInvoiceMutation.isLoading ? 'Erstelle...' : 'Erstellen & PDF generieren'}
  </Button>

              </Box>
            </Paper>
          </Grid>
        </Grid>
      </form>
    </Box>
  );
};

export default InvoicesNew;
