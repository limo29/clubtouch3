import React, { useState } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  Paper,
  Grid,
  TextField,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Autocomplete,
  Chip,
  Card,
  CardContent,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
} from '@mui/material';
import {
  Add,
  Delete,
  CloudUpload,
  Receipt,
  LocalShipping,
  AttachMoney,
  Search,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const steps = ['Lieferschein/Direkteinkauf', 'Artikel erfassen', 'Rechnung zuordnen'];

const PurchasesNew = () => {
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [purchaseType, setPurchaseType] = useState('direct'); // 'direct' oder 'delivery'
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeliveryNotes, setSelectedDeliveryNotes] = useState([]);
  
  const { control, handleSubmit, watch, setValue, reset } = useForm({
    defaultValues: {
      supplier: '',
      invoiceNumber: '',
      invoiceDate: new Date(),
      dueDate: null,
      items: []
    }
  });
  
  const { fields, append, remove, update } = useFieldArray({
    control,
    name: 'items'
  });

  // Fetch Artikel mit Umrechnungen
  const { data: articlesData } = useQuery({
    queryKey: ['articles-purchase'],
    queryFn: async () => {
      const response = await api.get('/articles');
      return response.data;
    },
  });

  // Fetch Lieferscheine
  const { data: deliveryNotesData } = useQuery({
    queryKey: ['delivery-notes', 'open'],
    queryFn: async () => {
      const response = await api.get('/delivery-notes?status=open');
      return response.data;
    },
  });

  const articles = articlesData?.articles || [];
  const deliveryNotes = deliveryNotesData?.deliveryNotes || [];

  // Artikel-Suche mit besserer UI
  const ArticleSearch = ({ onSelect }) => {
    const filteredArticles = articles.filter(a => 
      a.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
      <Box>
        <TextField
          placeholder="Artikel suchen..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
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
        
        <Grid container spacing={1} sx={{ maxHeight: 400, overflowY: 'auto' }}>
          {filteredArticles.map(article => (
            <Grid item xs={12} sm={6} md={4} key={article.id}>
              <Card 
                sx={{ 
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
                onClick={() => onSelect(article)}
              >
                <CardContent sx={{ p: 1 }}>
                  <Typography variant="body2" noWrap>
                    {article.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {article.category} • {article.purchaseUnit || article.unit}
                  </Typography>
                  <Typography variant="caption" display="block">
                    Bestand: {article.stock} {article.unit}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  };

  const handleArticleSelect = (article) => {
    const existingIndex = fields.findIndex(f => f.articleId === article.id);
    
    if (existingIndex >= 0) {
      // Erhöhe Menge wenn bereits vorhanden
      const existing = fields[existingIndex];
      update(existingIndex, {
        ...existing,
        quantity: existing.quantity + 1
      });
    } else {
      // Füge neuen Artikel hinzu
      append({
        articleId: article.id,
        articleName: article.name,
        description: article.name,
        quantity: 1,
        unit: article.purchaseUnit || article.unit,
        unitsPerPurchase: article.unitsPerPurchase || 1,
        pricePerUnit: 0
      });
    }
  };

  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Einkaufsart wählen
            </Typography>
            
            <ToggleButtonGroup
              value={purchaseType}
              exclusive
              onChange={(e, value) => value && setPurchaseType(value)}
              fullWidth
              sx={{ mb: 3 }}
            >
              <ToggleButton value="direct">
                <Receipt sx={{ mr: 1 }} />
                Direkteinkauf mit Rechnung
              </ToggleButton>
              <ToggleButton value="delivery">
                <LocalShipping sx={{ mr: 1 }} />
                Lieferschein erfassen
              </ToggleButton>
            </ToggleButtonGroup>

            {purchaseType === 'delivery' && (
              <Box>
                <Typography variant="subtitle1" gutterBottom>
                  Offene Lieferscheine
                </Typography>
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox"></TableCell>
                        <TableCell>Nummer</TableCell>
                        <TableCell>Lieferant</TableCell>
                        <TableCell>Datum</TableCell>
                        <TableCell>Positionen</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {deliveryNotes.map(note => (
                        <TableRow 
                          key={note.id}
                          hover
                          onClick={() => {
                            const isSelected = selectedDeliveryNotes.find(n => n.id === note.id);
                            if (isSelected) {
                              setSelectedDeliveryNotes(selectedDeliveryNotes.filter(n => n.id !== note.id));
                            } else {
                              setSelectedDeliveryNotes([...selectedDeliveryNotes, note]);
                            }
                          }}
                          selected={!!selectedDeliveryNotes.find(n => n.id === note.id)}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox checked={!!selectedDeliveryNotes.find(n => n.id === note.id)} />
                          </TableCell>
                          <TableCell>{note.noteNumber}</TableCell>
                          <TableCell>{note.supplier}</TableCell>
                          <TableCell>{new Date(note.deliveryDate).toLocaleDateString('de-DE')}</TableCell>
                          <TableCell>{note._count.items}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            <Grid container spacing={2} sx={{ mt: 2 }}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="supplier"
                  control={control}
                  render={({ field }) => (
                    <Autocomplete
                      {...field}
                      freeSolo
                      options={[]} // Später mit Lieferanten füllen
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Lieferant"
                          required
                        />
                      )}
                    />
                  )}
                />
              </Grid>
              {purchaseType === 'direct' && (
                <>
                  <Grid item xs={12} sm={6}>
                    <Controller
                      name="invoiceNumber"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Rechnungsnummer"
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
                          renderInput={(params) => <TextField {...params} />}
                        />
                      )}
                    />
                  </Grid>
                </>
              )}
            </Grid>
          </Box>
        );

      case 1:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Artikel erfassen
            </Typography>
            
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <ArticleSearch onSelect={handleArticleSelect} />
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Erfasste Artikel
                </Typography>
                
                <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Artikel</TableCell>
                        <TableCell>Menge</TableCell>
                        <TableCell>Einheit</TableCell>
                        <TableCell>Preis/Einheit</TableCell>
                        <TableCell>Gesamt</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {fields.map((field, index) => (
                        <TableRow key={field.id}>
                          <TableCell>{field.articleName}</TableCell>
                          <TableCell>
                            <TextField
                              type="number"
                              value={field.quantity}
                              onChange={(e) => update(index, { ...field, quantity: parseFloat(e.target.value) || 0 })}
                              size="small"
                              sx={{ width: 80 }}
                            />
                          </TableCell>
                          <TableCell>
                            {field.unit}
                            {field.unitsPerPurchase > 1 && (
                              <Typography variant="caption" display="block">
                                = {field.quantity * field.unitsPerPurchase} {field.article?.unit}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <TextField
                              type="number"
                              value={field.pricePerUnit}
                              onChange={(e) => update(index, { ...field, pricePerUnit: parseFloat(e.target.value) || 0 })}
                              size="small"
                              sx={{ width: 100 }}
                              InputProps={{
                                startAdornment: <InputAdornment position="start">€</InputAdornment>,
                              }}
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
                    </TableBody>
                  </Table>
                </TableContainer>
                
                <Box sx={{ mt: 2, textAlign: 'right' }}>
                  <Typography variant="h6">
                    Gesamt: €{fields.reduce((sum, item) => sum + (item.quantity * item.pricePerUnit), 0).toFixed(2)}
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Rechnung zuordnen
            </Typography>
            
            <Alert severity="info" sx={{ mb: 2 }}>
              Sie können die Rechnung jetzt oder später zuordnen.
            </Alert>
            
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Rechnungsnummer"
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <DatePicker
                  label="Rechnungsdatum"
                  renderInput={(params) => <TextField {...params} fullWidth />}
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="outlined"
                  component="label"
                  fullWidth
                  startIcon={<CloudUpload />}
                >
                  Rechnung hochladen
                  <input type="file" hidden accept="image/*,application/pdf" />
                </Button>
              </Grid>
            </Grid>
          </Box>
        );

      default:
        return 'Unbekannter Schritt';
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Neuer Einkauf
      </Typography>
      
      <Paper sx={{ p: 3 }}>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        
        {getStepContent(activeStep)}
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          <Button
            disabled={activeStep === 0}
            onClick={() => setActiveStep(activeStep - 1)}
          >
            Zurück
          </Button>
          
          <Button
            variant="contained"
            onClick={() => {
              if (activeStep === steps.length - 1) {
                // Speichern
                handleSubmit((data) => {
                  console.log('Speichere:', data);
                })();
              } else {
                setActiveStep(activeStep + 1);
              }
            }}
          >
            {activeStep === steps.length - 1 ? 'Speichern' : 'Weiter'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

export default PurchasesNew;
