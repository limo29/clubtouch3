import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
  Chip,
  Grid,
  MenuItem,
  InputAdornment,
  Alert,
  CircularProgress,
  useTheme,
  useMediaQuery,
  Stack,
  LinearProgress,
  Avatar,
  Divider,
  Switch,
  Tooltip,
} from '@mui/material';
import {
  Add,
  Edit,
  Warning,
  Search,
  CloudUpload,
  EventBusy,
  Inventory,
  Category,
  CheckCircle,
  Cancel,
  Image as ImageIcon,
  Save,
  DragIndicator,
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { alpha } from '@mui/material/styles';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import KPICard from '../components/common/KPICard';

/* ----------------------------- Helper Components ----------------------------- */

/**
 * Format stock display.
 */
const getStockLabel = (stock, unit, purchaseUnit, unitsPerPurchase) => {
  if (!purchaseUnit || !unitsPerPurchase || unitsPerPurchase <= 1) {
    return `${stock} ${unit}`;
  }

  const bigUnits = Math.floor(stock / unitsPerPurchase);
  const remainder = stock % unitsPerPurchase;

  let mainLabel = "";
  if (bigUnits > 0) mainLabel += `${bigUnits} ${purchaseUnit}`;
  if (remainder > 0) mainLabel += `${mainLabel ? ' ' : ''}${remainder} ${unit}`;
  if (!mainLabel) mainLabel = `0 ${unit}`;

  return `${mainLabel} (${stock} ${unit})`;
};

const StockIndicator = ({ stock, minStock, unit, purchaseUnit, unitsPerPurchase }) => {
  const theme = useTheme();
  const max = Math.max(stock, (minStock || 0) * 3, 50);
  const pct = Math.min((stock / max) * 100, 100);

  let color = theme.palette.success.main;
  let statusText = "OK";

  if (stock <= 0) {
    color = theme.palette.error.main;
    statusText = "Leer";
  } else if (stock <= minStock) {
    color = theme.palette.warning.main;
    statusText = "Kritisch";
  }

  const label = getStockLabel(stock, unit, purchaseUnit, unitsPerPurchase);

  return (
    <Box sx={{ width: '100%', minWidth: 100 }}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-end" mb={1}>
        <Typography variant="h6" fontWeight={800} sx={{ color, lineHeight: 1 }}>
          {label}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 8,
          borderRadius: 4,
          bgcolor: alpha(color, 0.15),
          '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: color },
        }}
      />
      {statusText !== "OK" && (
        <Typography variant="caption" sx={{ color, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {stock <= 0 ? <Cancel fontSize="inherit" /> : <Warning fontSize="inherit" />}
          {statusText}
        </Typography>
      )}
    </Box>
  );
};



const ArticleCard = ({ article, onEdit, onExpired, onToggleStatus }) => {
  const theme = useTheme();


  // Helper text for purchase unit configuration
  const purchaseInfo = (article.purchaseUnit && article.unitsPerPurchase > 1)
    ? `1 ${article.purchaseUnit} = ${article.unitsPerPurchase} ${article.unit}`
    : null;

  return (
    <Card sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 3,
      border: `1px solid ${theme.palette.divider}`,
      bgcolor: 'background.paper',
      transition: 'all 0.2s ease-in-out',
      overflow: 'visible', // For shadows
      '&:hover': {
        transform: 'translateY(-4px)',
        boxShadow: theme.shadows[8],
        borderColor: theme.palette.primary.main
      }
    }} elevation={0}>
      <Box sx={{ p: 2, display: 'flex', gap: 2 }}>
        <Avatar
          variant="rounded"
          src={article.imageThumbnail || article.imageSmall || article.imageMedium || '/logo192.png'}
          sx={{ width: 72, height: 72, borderRadius: 2, bgcolor: 'action.hover', border: `1px solid ${theme.palette.divider}` }}
        >
          <ImageIcon />
        </Avatar>
        <Box flex={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h6" fontWeight={700} lineHeight={1.2} mb={0.5} noWrap sx={{ maxWidth: '100%' }}>
                {article.name}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={article.category}
                  size="small"
                  sx={{ borderRadius: 1, fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08), color: 'primary.main', height: 22, fontSize: '0.7rem', border: 'none' }}
                />
                {purchaseInfo && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                    {purchaseInfo}
                  </Typography>
                )}
              </Stack>
            </Box>
            <Tooltip title={article.active ? "Artikel ist aktiv" : "Artikel ist inaktiv"}>
              <Switch
                checked={article.active}
                onChange={() => onToggleStatus(article.id)}
                color="success"
                size="small"
                sx={{ ml: 1 }}
              />
            </Tooltip>
          </Stack>
          <Typography variant="h5" color="text.primary" fontWeight={800} mt={1}>
            {Number(article.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
          </Typography>
        </Box>
      </Box >

      <Divider sx={{ opacity: 0.5, mx: 2 }} />

      <Box sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <StockIndicator
          stock={article.stock}
          minStock={article.minStock}
          unit={article.unit}
          purchaseUnit={article.purchaseUnit}
          unitsPerPurchase={article.unitsPerPurchase}
        />
        {article.minStock > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'right' }}>
            Min. Bestand: <strong>{article.minStock} {article.unit}</strong>
          </Typography>
        )}
      </Box>

      {/* Integrated Actions */}
      <Box sx={{ p: 2, pt: 0, display: 'flex', gap: 1 }}>
        <Button
          size="small"
          color="error"
          variant="outlined"
          startIcon={<EventBusy />}
          onClick={() => onExpired(article)}
          fullWidth
          sx={{ borderRadius: 2, border: `1px solid ${alpha(theme.palette.error.main, 0.5)}`, color: 'error.main', '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.05) } }}
        >
          Abgelaufen
        </Button>
        <Button
          size="small"
          variant="contained"
          color="primary"
          disableElevation
          startIcon={<Edit />}
          onClick={() => onEdit(article)}
          fullWidth
          sx={{ borderRadius: 2, fontWeight: 700 }}
        >
          Bearbeiten
        </Button>
      </Box>
    </Card >
  );
};

const SortableArticleItem = ({ article, onEdit, onExpired, onToggleStatus, isReordering }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: article.id, disabled: !isReordering });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 999 : 'auto',
    position: 'relative'
  };

  return (
    <Grid item xs={12} sm={6} md={4} lg={3} ref={setNodeRef} style={style}>
      <Box {...(isReordering ? attributes : {})} {...(isReordering ? listeners : {})} sx={{ height: '100%', touchAction: 'none' }}>
        <ArticleCard
          article={article}
          onEdit={onEdit}
          onExpired={onExpired}
          onToggleStatus={onToggleStatus}
        />
        {isReordering && (
          <Box
            sx={{
              position: 'absolute',
              top: -8,
              left: -8,
              zIndex: 10,
              bgcolor: 'background.paper',
              borderRadius: '50%',
              boxShadow: 2,
              p: 0.5,
              cursor: 'grab',
              '&:active': { cursor: 'grabbing' }
            }}
          >
            <DragIndicator />
          </Box>
        )}
      </Box>
    </Grid>
  );
};

/* ----------------------------- Main Component ----------------------------- */

const Articles = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const queryClient = useQueryClient();

  // State
  const [openDialog, setOpenDialog] = useState(false);
  const [editingArticle, setEditingArticle] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Expired Dialog State
  const [openExpiredDialog, setOpenExpiredDialog] = useState(false);
  const [expiredArticle, setExpiredArticle] = useState(null);
  const [expiredQuantity, setExpiredQuantity] = useState(1);

  // Form
  const { control, handleSubmit, reset, formState: { errors }, watch } = useForm();

  // Image Upload State
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Sorting State
  const [isReordering, setIsReordering] = useState(false);
  const [localArticles, setLocalArticles] = useState([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Watch fields
  const watchUnit = watch("unit");
  const watchPurchaseUnit = watch("purchaseUnit");
  const watchUnitsPerPurchase = watch("unitsPerPurchase");

  const [isCustomCategory, setIsCustomCategory] = useState(false);



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
        // Ensure sorting by order first
        return { ...response.data, articles: processed.sort((a, b) => (a.order || 0) - (b.order || 0)) };
      }
      return response.data;
    },
  });

  // Sync local articles when data changes (if not reordering)
  useEffect(() => {
    if (articlesData?.articles && !hasUnsavedChanges) {
      setLocalArticles(articlesData.articles);
    }
  }, [articlesData, hasUnsavedChanges]);

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

  const expiredMutation = useMutation({
    mutationFn: async (data) => {
      return (await api.post(API_ENDPOINTS.TRANSACTIONS, {
        type: 'EXPIRED',
        items: [{ articleId: data.articleId, quantity: data.quantity }],
        paymentMethod: 'CASH', // Dummy
        customerId: null
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
      handleCloseExpiredDialog();
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (items) => {
      return (await api.put(`${API_ENDPOINTS.ARTICLES}/reorder`, { items })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
      setHasUnsavedChanges(false);
      setIsReordering(false); // Optionally exit mode
    },
  });

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setLocalArticles((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        setHasUnsavedChanges(true);
        return newOrder;
      });
    }
  };

  const handleSaveOrder = () => {
    // Generate new order indices
    const updates = localArticles.map((a, index) => ({ id: a.id, order: index + 1 }));
    reorderMutation.mutate(updates);
  };

  const articles = localArticles || []; // Use local state
  const filteredArticles = articles.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.category || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const categories = [...new Set(articles.map(a => a.category).filter(Boolean))];

  // --- Handlers ---
  const handleOpenDialog = (article = null) => {
    setEditingArticle(article);
    setImageFile(null);
    setImagePreview(null);
    setIsDragging(false);
    setIsCustomCategory(false);

    if (article) {
      reset({
        name: article.name,
        price: article.price,
        category: article.category,
        order: article.order || 0,
        unit: article.unit,
        minStock: article.minStock,
        imageUrl: article.imageUrl || '',
        countsForHighscore: article.countsForHighscore,
        purchaseUnit: article.purchaseUnit || '',
        unitsPerPurchase: article.unitsPerPurchase ?? '',
      });
      if (article.imageThumbnail || article.imageMedium || article.imageUrl) {
        setImagePreview(article.imageThumbnail || article.imageMedium || article.imageUrl);
      }
    } else {
      reset({
        name: '',
        price: '',
        category: '',
        order: 0,
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

  const handleOpenExpiredDialog = (article) => {
    setExpiredArticle(article);
    setExpiredQuantity(1);
    setOpenExpiredDialog(true);
  };

  const handleCloseExpiredDialog = () => {
    setOpenExpiredDialog(false);
    setExpiredArticle(null);
    setExpiredQuantity(1);
  };

  const handleExpiredSubmit = () => {
    if (expiredArticle && expiredQuantity > 0) {
      expiredMutation.mutate({
        articleId: expiredArticle.id,
        quantity: Number(expiredQuantity)
      });
    }
  };

  // Drag and Drop Logic
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file);
    }
  }, []);

  const handleFileSelect = (file) => {
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const onSubmit = async (data) => {
    const formData = new FormData();
    const safe = { ...data };
    if (safe.price != null) safe.price = String(safe.price).replace(',', '.');
    if (safe.minStock != null) safe.minStock = String(safe.minStock);
    if (!editingArticle && safe.initialStock != null) safe.initialStock = String(safe.initialStock);

    Object.entries(safe).forEach(([k, v]) => {
      if (v !== undefined && v !== '') formData.append(k, v);
    });

    if (imageFile) formData.append('image', imageFile);

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

  return (
    <Box sx={{ pb: 10 }}>
      {/* --- Header Section --- */}
      <Box mb={4}>
        <Typography variant="h4" fontWeight={800} gutterBottom sx={{ letterSpacing: "-0.02em" }}>
          Artikelverwaltung
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Verwalten Sie Ihren Bestand, Preise und Kategorien.
        </Typography>
      </Box>

      {/* --- KPI Cards --- */}
      {/* --- KPI Cards --- */}
      <Grid container spacing={3} sx={{ mb: 4 }} alignItems="stretch">
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Artikel gesamt"
            value={articles.length}
            icon={Inventory}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Aktive Artikel"
            value={articles.filter(a => a.active).length}
            icon={CheckCircle}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Niedriger Bestand"
            value={lowStockData?.count || 0}
            icon={Warning}
            color="warning"
            subTitle={lowStockData?.count > 0 ? "Handlungsbedarf" : "Alles OK"}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Kategorien"
            value={categories.length}
            icon={Category}
            color="info"
          />
        </Grid>
      </Grid>

      {/* --- Action Bar --- */}
      <Card sx={{ mb: 3, borderRadius: 2, p: 1, border: `1px solid ${theme.palette.divider}` }} elevation={0}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" p={1}>
          <TextField
            placeholder="Suche nach Name oder Kategorie..."
            variant="outlined"
            size="small"
            fullWidth
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={isReordering}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search color="action" /></InputAdornment>,
              sx: { borderRadius: 1.5 }
            }}
          />
          {isReordering ? (
            <Button
              variant="contained"
              color="success"
              startIcon={<Save />}
              onClick={handleSaveOrder}
              disabled={!hasUnsavedChanges}
              sx={{ borderRadius: 1.5, px: 3, whiteSpace: 'nowrap', py: 1 }}
            >
              Sortierung Speichern
            </Button>
          ) : (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<DragIndicator />}
              onClick={() => {
                setSearchTerm(''); // Clear search to show all
                setIsReordering(true);
              }}
              sx={{ borderRadius: 1.5, px: 3, whiteSpace: 'nowrap', py: 1 }}
            >
              Reihenfolge ändern
            </Button>
          )}

          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => handleOpenDialog()}
            disabled={isReordering}
            sx={{ borderRadius: 1.5, px: 3, whiteSpace: 'nowrap', py: 1 }}
            fullWidth={isMobile}
          >
            Neuer Artikel
          </Button>
        </Stack>
        {isReordering && (
          <Alert severity="info" sx={{ mx: 1, mb: 1 }}>
            Ziehen Sie die Artikel per Drag-and-Drop an die gewünschte Position. Klicken Sie auf Speichern, um die Änderung zu übernehmen.
          </Alert>
        )}
      </Card>

      {/* --- Articles Grid --- */}
      {isLoading ? (
        <Box display="flex" justifyContent="center" p={8}>
          <CircularProgress />
        </Box>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={filteredArticles.map(a => a.id)}
            strategy={rectSortingStrategy}
            disabled={!isReordering}
          >
            <Grid container spacing={2}>
              {filteredArticles.map((article) => (
                <SortableArticleItem
                  key={article.id}
                  article={article}
                  onEdit={handleOpenDialog}
                  onExpired={handleOpenExpiredDialog}
                  onToggleStatus={(id) => toggleStatusMutation.mutate(id)}
                  isReordering={isReordering}
                />
              ))}
            </Grid>
          </SortableContext>
        </DndContext>
      )}

      {/* --- Dialogs --- */}

      {/* Create/Edit Dialog */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, overflow: 'hidden' } }}
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 3, bgcolor: 'background.paper', borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Box>
              <Typography variant="h5" fontWeight={800}>
                {editingArticle ? 'Artikel bearbeiten' : 'Neuer Artikel'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {editingArticle ? `ID: ${editingArticle.id}` : 'Fügen Sie einen neuen Artikel zum Sortiment hinzu'}
              </Typography>
            </Box>
            <IconButton onClick={handleCloseDialog} size="small" sx={{ bgcolor: 'action.hover' }}><Cancel /></IconButton>
          </DialogTitle>

          <DialogContent sx={{ p: 0 }}>
            <Grid container>
              {/* Left Panel: Image Upload */}
              <Grid item xs={12} md={4} sx={{ bgcolor: alpha(theme.palette.action.hover, 0.5), borderRight: `1px solid ${theme.palette.divider}`, p: 3 }}>
                <Typography variant="overline" fontWeight={800} color="text.secondary" display="block" mb={2}>Artikelbild</Typography>

                <Box
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  sx={{
                    width: '100%',
                    maxWidth: '350px', // Prevent massive explosion
                    margin: '0 auto',
                    aspectRatio: '1/1',
                    borderRadius: 3,
                    bgcolor: isDragging ? alpha(theme.palette.primary.main, 0.1) : 'background.paper',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px dashed',
                    borderColor: isDragging ? 'primary.main' : 'divider',
                    overflow: 'hidden',
                    position: 'relative',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.05) }
                  }}
                  component="label"
                >
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Box textAlign="center" p={2}>
                      <CloudUpload sx={{ fontSize: 40, color: isDragging ? 'primary.main' : 'text.secondary', mb: 1, opacity: isDragging ? 1 : 0.5 }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={600}>
                        {isDragging ? 'Hier loslassen' : 'Bild auswählen'}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">oder hierher ziehen</Typography>
                    </Box>
                  )}
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                  />
                </Box>

                <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block', textAlign: 'center' }}>
                  Empfohlen: Quadratisch (500x500px)
                </Typography>
              </Grid>

              {/* Right Panel: Form Fields */}
              <Grid item xs={12} md={8} sx={{ p: 3 }}>
                <Stack spacing={4}>

                  {/* Section 1: Core Info */}
                  <Box>
                    <Typography variant="overline" fontWeight={700} color="primary" display="block" gutterBottom>Allgemeine Informationen</Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <Controller
                          name="name"
                          control={control}
                          rules={{ required: 'Name ist erforderlich' }}
                          render={({ field }) => (
                            <TextField {...field} label="Artikelname" placeholder="z.B. Club Mate" fullWidth error={!!errors.name} helperText={errors.name?.message} variant="filled" hiddenLabel size="small" />
                          )}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <Controller
                          name="category"
                          control={control}
                          rules={{ required: true }}
                          render={({ field }) => (
                            isCustomCategory ? (
                              <TextField
                                {...field}
                                label="Neue Kategorie"
                                fullWidth
                                variant="outlined"
                                size="small"
                                autoFocus
                                onBlur={() => {
                                  if (!field.value || field.value === '_new') {
                                    setIsCustomCategory(false);
                                    field.onChange('');
                                  }
                                  field.onBlur();
                                }}
                                InputProps={{
                                  endAdornment: (
                                    <InputAdornment position="end">
                                      <IconButton size="small" onClick={() => setIsCustomCategory(false)}>
                                        <Cancel fontSize="small" />
                                      </IconButton>
                                    </InputAdornment>
                                  )
                                }}
                              />
                            ) : (
                              <TextField
                                {...field}
                                label="Kategorie"
                                select
                                fullWidth
                                variant="outlined"
                                size="small"
                                onChange={(e) => {
                                  if (e.target.value === '_new') {
                                    setIsCustomCategory(true);
                                    field.onChange(''); // Clear value for typing
                                  } else {
                                    field.onChange(e.target.value);
                                  }
                                }}
                              >
                                {categories.length > 0 ? categories.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>) : (
                                  <MenuItem value="Getränke">Getränke</MenuItem>
                                )}
                                <Divider />
                                <MenuItem value="_new" sx={{ fontStyle: 'italic', color: 'primary.main' }}>+ Neue Kategorie...</MenuItem>
                              </TextField>
                            )
                          )}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', px: 1 }}>
                          Tipp: Kategorien verschwinden automatisch, wenn kein Artikel mehr zu ihnen gehört.
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Controller
                          name="price"
                          control={control}
                          rules={{ required: true, min: 0 }}
                          render={({ field: { onChange, value, ...field } }) => (
                            <TextField
                              {...field}
                              value={value}
                              onChange={(e) => {
                                // Allow mostly flexible input for now, sanitized on submit
                                onChange(e.target.value);
                              }}
                              label="Verkaufspreis"
                              // type="text" allows flexible input (commas)
                              fullWidth
                              variant="outlined"
                              size="small"
                              InputProps={{ startAdornment: <InputAdornment position="start">€</InputAdornment> }}
                            />
                          )}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <Controller
                          name="order"
                          control={control}
                          render={({ field }) => (
                            <TextField
                              {...field}
                              label="Sortierung (Reihenfolge)"
                              type="number"
                              fullWidth
                              variant="outlined"
                              size="small"
                              helperText="Niedrigere Zahlen erscheinen zuerst (z.B. 1 vor 10)"
                            />
                          )}
                        />
                      </Grid>
                    </Grid>
                  </Box>

                  <Divider />

                  {/* Section 2: Inventory Config */}
                  <Box>
                    <Typography variant="overline" fontWeight={700} color="primary" display="block" gutterBottom>Bestandsführung</Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={4}>
                        <Controller
                          name="unit"
                          control={control}
                          defaultValue="Stück"
                          render={({ field }) => (
                            <TextField {...field} label="Einheit (Verkauf)" select fullWidth size="small">
                              {['Stück', 'Flasche', 'Glas', 'Tüte', 'Portion', 'Dose'].map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                            </TextField>
                          )}
                        />
                      </Grid>
                      <Grid item xs={4}>
                        <Controller
                          name="purchaseUnit"
                          control={control}
                          render={({ field }) => (
                            <TextField {...field} label="Einkaufseinheit" placeholder="Kiste" fullWidth size="small" />
                          )}
                        />
                      </Grid>
                      <Grid item xs={4}>
                        <Controller
                          name="unitsPerPurchase"
                          control={control}
                          render={({ field }) => (
                            <TextField
                              {...field}
                              label="Inhalt"
                              placeholder="20"
                              type="number"
                              fullWidth
                              size="small"
                              InputProps={{
                                endAdornment: <InputAdornment position="end">{watchUnit || 'Stk'}</InputAdornment>
                              }}
                            />
                          )}
                        />
                      </Grid>
                      {/* Preview Calculation */}
                      {(watchPurchaseUnit && watchUnitsPerPurchase) && (
                        <Grid item xs={12}>
                          <Alert severity="info" sx={{ py: 0, px: 2, alignItems: 'center' }}>
                            <Typography variant="caption">
                              1 {watchPurchaseUnit} = {watchUnitsPerPurchase} {watchUnit}
                            </Typography>
                          </Alert>
                        </Grid>
                      )}

                      <Grid item xs={6}>
                        <Controller
                          name="minStock"
                          control={control}
                          render={({ field }) => (
                            <TextField {...field} label="Mindestbestand (Warnung)" type="number" fullWidth size="small" />
                          )}
                        />
                      </Grid>
                      {!editingArticle && (
                        <Grid item xs={6}>
                          <Controller
                            name="initialStock"
                            control={control}
                            render={({ field }) => (
                              <TextField {...field} label="Startbestand" type="number" fullWidth size="small" />
                            )}
                          />
                        </Grid>
                      )}
                    </Grid>
                  </Box>

                </Stack>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ p: 2, bgcolor: 'background.paper', borderTop: `1px solid ${theme.palette.divider}` }}>
            <Button onClick={handleCloseDialog} color="inherit" sx={{ borderRadius: 2 }}>Abbrechen</Button>
            <Button type="submit" variant="contained" disabled={articleMutation.isLoading} size="large" sx={{ borderRadius: 2, px: 4 }} startIcon={<Save />}>
              {editingArticle ? 'Speichern' : 'Anlegen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Expired Dialog */}
      <Dialog open={openExpiredDialog} onClose={handleCloseExpiredDialog} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ pb: 1 }}>Abschreibung erfassen</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Artikel: <strong>{expiredArticle?.name}</strong>
          </Alert>
          <Typography variant="body2" gutterBottom color="text.secondary">
            Wie viele Einheiten sollen als "Abgelaufen" oder "Bruch" ausgebucht werden?
          </Typography>
          <TextField
            autoFocus
            margin="normal"
            label="Menge"
            type="number"
            fullWidth
            variant="outlined"
            value={expiredQuantity}
            onChange={(e) => setExpiredQuantity(e.target.value)}
            inputProps={{ min: 1 }}
            InputProps={{
              endAdornment: <InputAdornment position="end">{expiredArticle?.unit}</InputAdornment>
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseExpiredDialog} color="inherit">Abbrechen</Button>
          <Button
            onClick={handleExpiredSubmit}
            variant="contained"
            color="error" // Use error color for destructive/negative action
            disabled={expiredMutation.isLoading || !expiredQuantity || expiredQuantity < 1}
          >
            Buchen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Articles;
