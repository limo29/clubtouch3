import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
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
  Chip,
  Grid,
  MenuItem,
  InputAdornment,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Add,
  Edit,
  Inventory,
  Warning,
  TrendingUp,
  TrendingDown,
  Search,
  CloudUpload,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

const Articles = () => {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [openStockDialog, setOpenStockDialog] = useState(false);
  const [editingArticle, setEditingArticle] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [stockAction, setStockAction] = useState('delivery');
  
  const { control, handleSubmit, reset, formState: { errors } } = useForm();
  const { control: stockControl, handleSubmit: handleStockSubmit, reset: resetStock } = useForm();
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  // Fetch articles
const { data: articlesData, isLoading } = useQuery({
  queryKey: ['articles', 'all'],
  queryFn: async () => {
    const response = await api.get(API_ENDPOINTS.ARTICLES + '?includeInactive=true');

    // Stelle sicher, dass response.data und response.data.articles existieren
    // und dass response.data.articles ein Array ist.
    if (response.data && Array.isArray(response.data.articles)) {
      const processedArticles = response.data.articles.map(article => {
        const price = parseFloat(article.price); // Konvertiere den Preis
        return {
          ...article,
          price: isNaN(price) ? 0 : price // Setze Standardwert (z.B. 0) oder handle Fehler, falls Konvertierung fehlschlägt
        };
      });
      // Gib das gesamte response.data Objekt zurück, aber mit den verarbeiteten Artikeln
      return { ...response.data, articles: processedArticles };
    }
    // Fallback, falls die Datenstruktur unerwartet ist
    return response.data;
  },
});

  // Fetch low stock articles
  const { data: lowStockData } = useQuery({
    queryKey: ['articles', 'low-stock'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.ARTICLES_LOW_STOCK);
      return response.data;
    },
  });

  // Create/Update article mutation
  const articleMutation = useMutation({
    mutationFn: async (data) => {
      if (editingArticle) {
        const response = await api.put(`${API_ENDPOINTS.ARTICLES}/${editingArticle.id}`, data);
        return response.data;
      } else {
        const response = await api.post(API_ENDPOINTS.ARTICLES, data);
        return response.data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
      handleCloseDialog();
    },
  });

  // Stock adjustment mutations
  const deliveryMutation = useMutation({
    mutationFn: async ({ articleId, ...data }) => {
      const response = await api.post(`${API_ENDPOINTS.ARTICLES}/${articleId}/delivery`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
      handleCloseStockDialog();
    },
  });

  const inventoryMutation = useMutation({
    mutationFn: async ({ articleId, ...data }) => {
      const response = await api.post(`${API_ENDPOINTS.ARTICLES}/${articleId}/inventory`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
      handleCloseStockDialog();
    },
  });

  // Toggle article status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async (articleId) => {
      const response = await api.patch(`${API_ENDPOINTS.ARTICLES}/${articleId}/toggle-status`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
    },
  });

  const articles = articlesData?.articles || [];
  const filteredArticles = articles.filter(article =>
    article.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    article.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

const handleOpenDialog = (article = null) => {
  setEditingArticle(article);
  setImageFile(null);
  setImagePreview(null);
  
  if (article) {
    reset({
      name: article.name,
      price: article.price,
      category: article.category,
      unit: article.unit,
      minStock: article.minStock,
      imageUrl: article.imageUrl || '',
      countsForHighscore: article.countsForHighscore,
    });
    // Setze Vorschau wenn Bild vorhanden
    if (article.imageMedium) {
      setImagePreview(article.imageMedium);
    }
  } else {
    reset({
      name: '',
      price: '',
      category: '',
      unit: 'Stück',
      minStock: 0,
      initialStock: 0,
      imageUrl: '',
      countsForHighscore: true,
    });
  }
  setOpenDialog(true);
};


  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingArticle(null);
    reset();
  };

  const handleOpenStockDialog = (article, action) => {
    setSelectedArticle(article);
    setStockAction(action);
    resetStock({
      quantity: '',
      actualStock: article.stock,
      reason: '',
    });
    setOpenStockDialog(true);
  };

  const handleCloseStockDialog = () => {
    setOpenStockDialog(false);
    setSelectedArticle(null);
    resetStock();
  };

const onSubmit = (data) => {
  const formData = new FormData();
  
  // Füge alle Felder hinzu
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== '') {
      formData.append(key, data[key]);
    }
  });
  
  // Füge Bild hinzu wenn vorhanden
  if (imageFile) {
    formData.append('image', imageFile);
  }
  
  if (editingArticle) {
    // Update mit PUT
    api.put(`/articles/${editingArticle.id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(() => {
      queryClient.invalidateQueries(['articles']);
      handleCloseDialog();
    });
  } else {
    // Create mit POST
    api.post('/articles', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(() => {
      queryClient.invalidateQueries(['articles']);
      handleCloseDialog();
    });
  }
};


  const onStockSubmit = (data) => {
    const mutation = stockAction === 'delivery' ? deliveryMutation : inventoryMutation;
    
    if (stockAction === 'delivery') {
      mutation.mutate({
        articleId: selectedArticle.id,
        quantity: parseInt(data.quantity),
        reason: data.reason || 'Wareneingang',
      });
    } else {
      mutation.mutate({
        articleId: selectedArticle.id,
        actualStock: parseInt(data.actualStock),
        reason: data.reason || 'Inventur',
      });
    }
  };

  const categories = [...new Set(articles.map(a => a.category))];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Artikelverwaltung
      </Typography>

      {/* Statistics Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Artikel gesamt
              </Typography>
              <Typography variant="h4">
                {articles.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Aktive Artikel
              </Typography>
              <Typography variant="h4">
                {articles.filter(a => a.active).length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Niedriger Bestand
              </Typography>
              <Typography variant="h4" color="warning.main">
                {lowStockData?.count || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Kategorien
              </Typography>
              <Typography variant="h4">
                {categories.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Actions Bar */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item flex={1}>
            <TextField
              placeholder="Artikel suchen..."
              variant="outlined"
              size="small"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => handleOpenDialog()}
            >
              Neuer Artikel
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Low Stock Alert */}
      {lowStockData?.hasWarnings && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>{lowStockData.count} Artikel</strong> haben einen niedrigen Bestand!
        </Alert>
      )}

      {/* Articles Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Kategorie</TableCell>
              <TableCell align="right">Preis</TableCell>
              <TableCell align="right">Bestand</TableCell>
              <TableCell align="right">Min. Bestand</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredArticles.map((article) => (
              <TableRow key={article.id}>
                <TableCell>
                  <Typography variant="body2">
                    {article.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {article.unit}
                  </Typography>
                </TableCell>
                <TableCell>{article.category}</TableCell>
                <TableCell align="right">€{article.price.toFixed(2)}</TableCell>
                <TableCell align="right">
                  <Box display="flex" alignItems="center" justifyContent="flex-end">
                    {article.stock}
                    {article.stock <= article.minStock && (
                      <Warning color="warning" fontSize="small" sx={{ ml: 1 }} />
                    )}
                  </Box>
                </TableCell>
                <TableCell align="right">{article.minStock}</TableCell>
                <TableCell>
                  <Chip
                    label={article.active ? 'Aktiv' : 'Inaktiv'}
                    color={article.active ? 'success' : 'default'}
                    size="small"
                    onClick={() => toggleStatusMutation.mutate(article.id)}
                    sx={{ cursor: 'pointer' }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Bearbeiten">
                    <IconButton
                      size="small"
                      onClick={() => handleOpenDialog(article)}
                    >
                      <Edit />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Wareneingang">
                    <IconButton
                      size="small"
                      color="success"
                      onClick={() => handleOpenStockDialog(article, 'delivery')}
                    >
                      <TrendingUp />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Inventur">
                    <IconButton
                      size="small"
                      color="info"
                      onClick={() => handleOpenStockDialog(article, 'inventory')}
                    >
                      <Inventory />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Article Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            {editingArticle ? 'Artikel bearbeiten' : 'Neuer Artikel'}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="name"
                  control={control}
                  rules={{ required: 'Name ist erforderlich' }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Name"
                      error={!!errors.name}
                      helperText={errors.name?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="price"
                  control={control}
                  rules={{ 
                    required: 'Preis ist erforderlich',
                    min: { value: 0, message: 'Preis muss positiv sein' }
                  }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Preis"
                      type="number"
                      inputProps={{ step: 0.01 }}
                      error={!!errors.price}
                      helperText={errors.price?.message}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">€</InputAdornment>,
                      }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="unit"
                  control={control}
                  defaultValue="Stück"
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Einheit"
                      select
                    >
                      <MenuItem value="Stück">Stück</MenuItem>
                      <MenuItem value="Flasche">Flasche</MenuItem>
                      <MenuItem value="Glas">Glas</MenuItem>
                      <MenuItem value="Tüte">Tüte</MenuItem>
                      <MenuItem value="Portion">Portion</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="category"
                  control={control}
                  rules={{ required: 'Kategorie ist erforderlich' }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Kategorie"
                      select={categories.length > 0}
                      error={!!errors.category}
                      helperText={errors.category?.message}
                    >
                      {categories.map(cat => (
                        <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="minStock"
                  control={control}
                  defaultValue={0}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Mindestbestand"
                      type="number"
                      inputProps={{ min: 0 }}
                    />
                  )}
                />
              </Grid>
              {!editingArticle && (
                <Grid item xs={12}>
                  <Controller
                    name="initialStock"
                    control={control}
                    defaultValue={0}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Anfangsbestand"
                        type="number"
                        inputProps={{ min: 0 }}
                      />
                    )}
                  />
                </Grid>
              )}
              <Grid item xs={12}>
                <Controller
                  name="imageUrl"
                  control={control}
                  defaultValue=""
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Bild-URL (optional)"
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
  <Button
    variant="outlined"
    component="label"
    fullWidth
    startIcon={<CloudUpload />}
  >
    Artikelbild hochladen
    <input
      type="file"
      hidden
      accept="image/*"
      onChange={(e) => {
        const file = e.target.files[0];
        if (file) {
          setImageFile(file);
          // Erstelle Vorschau
          const reader = new FileReader();
          reader.onloadend = () => {
            setImagePreview(reader.result);
          };
          reader.readAsDataURL(file);
        }
      }}
    />
  </Button>
  {imagePreview && (
    <Box sx={{ mt: 2, textAlign: 'center' }}>
      <img 
        src={imagePreview} 
        alt="Vorschau" 
        style={{ maxWidth: '200px', maxHeight: '200px', objectFit: 'cover' }}
      />
      <Typography variant="caption" display="block">
        {imageFile ? imageFile.name : 'Aktuelles Bild'}
      </Typography>
    </Box>
  )}
</Grid>

            </Grid>
          </DialogContent>
          
          <DialogActions>
            <Button onClick={handleCloseDialog}>Abbrechen</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={articleMutation.isLoading}
            >
              {articleMutation.isLoading ? 'Speichere...' : 'Speichern'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Stock Dialog */}
      <Dialog open={openStockDialog} onClose={handleCloseStockDialog}>
        <form onSubmit={handleStockSubmit(onStockSubmit)}>
          <DialogTitle>
            {stockAction === 'delivery' ? 'Wareneingang' : 'Inventur'}: {selectedArticle?.name}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Aktueller Bestand: {selectedArticle?.stock} {selectedArticle?.unit}
                </Typography>
              </Grid>
              
              {stockAction === 'delivery' ? (
                <Grid item xs={12}>
                  <Controller
                    name="quantity"
                    control={stockControl}
                    rules={{ 
                      required: 'Menge ist erforderlich',
                      min: { value: 1, message: 'Menge muss größer als 0 sein' }
                    }}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Liefermenge"
                        type="number"
                        inputProps={{ min: 1 }}
                        error={!!errors.quantity}
                        helperText={errors.quantity?.message}
                      />
                    )}
                  />
                </Grid>
              ) : (
                <Grid item xs={12}>
                  <Controller
                    name="actualStock"
                    control={stockControl}
                    rules={{ 
                      required: 'Bestand ist erforderlich',
                      min: { value: 0, message: 'Bestand kann nicht negativ sein' }
                    }}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Tatsächlicher Bestand"
                        type="number"
                        inputProps={{ min: 0 }}
                        error={!!errors.actualStock}
                        helperText={errors.actualStock?.message}
                      />
                    )}
                  />
                </Grid>
              )}
              
              <Grid item xs={12}>
                <Controller
                  name="reason"
                  control={stockControl}
                  defaultValue=""
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Grund/Bemerkung (optional)"
                      multiline
                      rows={2}
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseStockDialog}>Abbrechen</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={deliveryMutation.isLoading || inventoryMutation.isLoading}
            >
              {deliveryMutation.isLoading || inventoryMutation.isLoading ? 'Speichere...' : 'Bestätigen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Articles;
