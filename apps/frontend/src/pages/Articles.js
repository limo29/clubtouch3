// apps/frontend/src/pages/Articles.js
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
  CircularProgress,
} from '@mui/material';
import {
  Add,
  Edit,
  Warning,
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
  const [editingArticle, setEditingArticle] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const { control, handleSubmit, reset, formState: { errors } } = useForm();
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  // --- Queries ---
  const { data: articlesData, isLoading } = useQuery({
    queryKey: ['articles', 'all'],
    queryFn: async () => {
      const response = await api.get(`${API_ENDPOINTS.ARTICLES}?includeInactive=true`);
      if (response.data && Array.isArray(response.data.articles)) {
        const processed = response.data.articles.map(a => ({
          ...a,
          price: Number.parseFloat(a.price) || 0,
        }));
        return { ...response.data, articles: processed };
      }
      return response.data;
    },
  });

  const { data: lowStockData } = useQuery({
    queryKey: ['articles', 'low-stock'],
    queryFn: async () => (await api.get(API_ENDPOINTS.ARTICLES_LOW_STOCK)).data,
  });

  // --- Mutations ---
  const articleMutation = useMutation({
    mutationFn: async (data) => {
      if (editingArticle) {
        return (await api.put(`${API_ENDPOINTS.ARTICLES}/${editingArticle.id}`, data)).data;
      }
      return (await api.post(API_ENDPOINTS.ARTICLES, data)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
      handleCloseDialog();
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (articleId) =>
      (await api.patch(`${API_ENDPOINTS.ARTICLES}/${articleId}/toggle-status`)).data,
    onSuccess: () => queryClient.invalidateQueries(['articles']),
  });

  const articles = articlesData?.articles || [];
  const filteredArticles = articles.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.category || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // --- Dialog handling ---
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
        purchaseUnit: article.purchaseUnit || '',
        unitsPerPurchase: article.unitsPerPurchase ?? '',
      });
      // Vorschau (bevorzugt Thumbnail)
      if (article.imageThumbnail || article.imageMedium) {
        setImagePreview(article.imageThumbnail || article.imageMedium);
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
        purchaseUnit: 'Kiste',
        unitsPerPurchase: 24,
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingArticle(null);
    reset();
  };

  // --- Submit (multipart + Zahlen normalisieren) ---
const onSubmit = async (data) => {
  const formData = new FormData();

  const safe = { ...data };
  if (safe.price != null) safe.price = String(safe.price).replace(',', '.');
  if (safe.minStock != null) safe.minStock = String(safe.minStock);
  if (!editingArticle && safe.initialStock != null) safe.initialStock = String(safe.initialStock);

  Object.entries(safe).forEach(([k, v]) => {
    if (v !== undefined && v !== '') formData.append(k, v);
  });

  if (imageFile) formData.append('image', imageFile); // << Feldname MUSS "image" heißen

  try {
    const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };

    if (editingArticle) {
      await api.put(`${API_ENDPOINTS.ARTICLES}/${editingArticle.id}`, formData, cfg);
    } else {
      await api.post(API_ENDPOINTS.ARTICLES, formData, cfg);
    }

    queryClient.invalidateQueries(['articles']);
    handleCloseDialog();
  } catch (err) {
    console.error('Upload failed', err);
  }
};


  const categories = [...new Set(articles.map(a => a.category).filter(Boolean))];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Artikelverwaltung</Typography>

      {/* Stats */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography color="textSecondary" gutterBottom>Artikel gesamt</Typography>
            <Typography variant="h4">{articles.length}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography color="textSecondary" gutterBottom>Aktive Artikel</Typography>
            <Typography variant="h4">{articles.filter(a => a.active).length}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography color="textSecondary" gutterBottom>Niedriger Bestand</Typography>
            <Typography variant="h4" color="warning.main">{lowStockData?.count || 0}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card><CardContent>
            <Typography color="textSecondary" gutterBottom>Kategorien</Typography>
            <Typography variant="h4">{categories.length}</Typography>
          </CardContent></Card>
        </Grid>
      </Grid>

      {/* Actions */}
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
              fullWidth
            />
          </Grid>
          <Grid item>
            <Button variant="contained" startIcon={<Add />} onClick={() => handleOpenDialog()}>
              Neuer Artikel
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Low stock alert */}
      {lowStockData?.hasWarnings && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>{lowStockData.count} Artikel</strong> haben einen niedrigen Bestand!
        </Alert>
      )}

      {/* Table */}
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
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <CircularProgress size={26} />
                </TableCell>
              </TableRow>
            ) : (
              filteredArticles.map((article) => (
                <TableRow key={article.id} hover>
                  {/* Name + Thumbnail */}
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={1.5}>
                      <img
                        src={article.imageThumbnail || article.imageSmall || article.imageMedium || '/logo192.png'}
                        alt=""
                        style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }}
                        loading="lazy"
                      />
                      <Box>
                        <Typography variant="body2">{article.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{article.unit}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {article.unit}
                          {article.purchaseUnit && article.unitsPerPurchase
                           ? ` – ${article.purchaseUnit} à ${article.unitsPerPurchase} ${article.unit}`
                           : ''}
                        </Typography>

                      </Box>
                    </Box>
                  </TableCell>

                  <TableCell>{article.category || '—'}</TableCell>
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
                      <IconButton size="small" onClick={() => handleOpenDialog(article)}>
                        <Edit />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>{editingArticle ? 'Artikel bearbeiten' : 'Neuer Artikel'}</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="name"
                  control={control}
                  rules={{ required: 'Name ist erforderlich' }}
                  render={({ field }) => (
                    <TextField {...field} label="Name" error={!!errors.name} helperText={errors.name?.message} fullWidth />
                  )}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <Controller
                  name="price"
                  control={control}
                  rules={{ required: 'Preis ist erforderlich', min: { value: 0, message: 'Preis muss positiv sein' } }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Preis"
                      type="number"
                      inputProps={{ step: 0.01 }}
                      error={!!errors.price}
                      helperText={errors.price?.message}
                      InputProps={{ startAdornment: <InputAdornment position="start">€</InputAdornment> }}
                      fullWidth
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
                    <TextField {...field} label="Einheit" select fullWidth>
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
                    <TextField {...field} label="Kategorie" select={categories.length > 0} error={!!errors.category}
                      helperText={errors.category?.message} fullWidth>
                      {categories.map(cat => (
                        <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                      ))}
                    </TextField>
                  )}

                />
              </Grid>
<Grid item xs={12} sm={6}>
  <Controller
    name="purchaseUnit"
    control={control}
    render={({ field }) => (
      <TextField {...field} label="Einkaufseinheit (optional)" fullWidth placeholder="z. B. Kiste" />
    )}
  />
</Grid>

<Grid item xs={12} sm={6}>
  <Controller
    name="unitsPerPurchase"
    control={control}
    render={({ field }) => (
      <TextField
        {...field}
        label="Einheiten pro Einkaufseinheit"
        type="number"
        inputProps={{ step: 1, min: 1 }}
        fullWidth
      />
    )}
  />
</Grid>

              <Grid item xs={12} sm={6}>
                <Controller
                  name="minStock"
                  control={control}
                  defaultValue={0}
                  render={({ field }) => (
                    <TextField {...field} label="Mindestbestand" type="number" inputProps={{ min: 0 }} fullWidth />
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
                      <TextField {...field} label="Anfangsbestand" type="number" inputProps={{ min: 0 }} fullWidth />
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
                    <TextField {...field} label="Bild-URL (optional)" fullWidth />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Button variant="outlined" component="label" fullWidth startIcon={<CloudUpload />}>
                  Artikelbild hochladen
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setImageFile(file);
                        const reader = new FileReader();
                        reader.onloadend = () => setImagePreview(reader.result);
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
                      style={{ width: 150, height: 150, objectFit: 'cover', borderRadius: 8 }}
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
            <Button type="submit" variant="contained" disabled={articleMutation.isLoading}>
              {articleMutation.isLoading ? 'Speichere...' : 'Speichern'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Articles;
