import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Grid,
  IconButton,
  Chip,
  Stack,
  Switch,
  FormControlLabel,
  Tooltip,
  CircularProgress,
  Alert,
  Divider,
  useMediaQuery,
  Avatar,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  ArrowBack,
  CloudUpload,
  Cancel,
  DeleteForever,
} from '@mui/icons-material';
import { useTheme, alpha } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import GroupBadge from './GroupBadge';

/* ---- Konstanten ---- */
const PRESET_COLORS = [
  '#1976d2', '#388e3c', '#d32f2f', '#f57c00',
  '#7b1fa2', '#0097a7', '#e91e63', '#795548',
  '#455a64', '#fbc02d',
];

const EMOJI_LIST = [
  // Tiere
  '🐆', '🦊', '🐺', '🦅', '🐻', '🦁', '🐯', '🐼', '🐨', '🐸',
  '🐙', '🦈', '🐝', '🦉', '🐍', '🐲', '🦄', '🐧', '🐬', '🦋',
  // Symbole
  '🔥', '⚡', '⭐', '🌙', '☀️', '🌊', '🍀', '💎', '🚀', '🎯',
  '🏆', '⚽', '🎸', '👑', '🛡️', '⚔️', '🌟', '🎮', '🎪', '🎭',
];

/* ---- Farbauswahl-Komponente ---- */
function ColorPicker({ value, onChange }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
        Farbe
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {PRESET_COLORS.map((c) => (
          <Box
            key={c}
            onClick={() => onChange(c)}
            sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              bgcolor: c,
              cursor: 'pointer',
              border: value === c ? '3px solid' : '2px solid transparent',
              borderColor: value === c ? 'text.primary' : 'transparent',
              boxShadow: value === c ? 3 : 0,
              transition: 'all 0.15s',
              '&:hover': { transform: 'scale(1.15)' },
            }}
          />
        ))}
        {/* Freier Farbwähler */}
        <Tooltip title="Eigene Farbe wählen">
          <Box
            component="label"
            sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              cursor: 'pointer',
              border: '2px dashed',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              bgcolor: !PRESET_COLORS.includes(value) ? value : 'background.default',
              '&:hover': { borderColor: 'primary.main' },
            }}
          >
            <input
              type="color"
              value={value || '#1976d2'}
              onChange={(e) => onChange(e.target.value)}
              style={{ opacity: 0, position: 'absolute', width: 1, height: 1 }}
            />
            <Typography variant="caption" fontSize={16}>🎨</Typography>
          </Box>
        </Tooltip>
      </Stack>
    </Box>
  );
}

/* ---- Emoji-Auswahl-Komponente ---- */
function EmojiPicker({ value, onChange }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
        Emoji (optional)
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {EMOJI_LIST.map((e) => (
          <Box
            key={e}
            onClick={() => onChange(value === e ? '' : e)}
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              border: '1px solid',
              borderColor: value === e ? 'primary.main' : 'divider',
              bgcolor: value === e ? 'primary.lighter' : 'background.default',
              '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
              transition: 'all 0.1s',
            }}
          >
            {e}
          </Box>
        ))}
      </Box>
      <TextField
        size="small"
        label="Eigenes Emoji eingeben"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="z.B. 🌈"
        inputProps={{ maxLength: 8 }}
        sx={{ maxWidth: 220 }}
      />
    </Box>
  );
}

/* ---- Haupt-Komponente ---- */
export default function GroupManagerDialog({ open, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  // Ansicht: 'list' | 'form'
  const [view, setView] = useState('list');
  const [editGroup, setEditGroup] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Bild-Zustand für das Formular
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);

  const { control, handleSubmit, reset, watch } = useForm({
    defaultValues: {
      name: '',
      color: '#1976d2',
      emoji: '',
      sortOrder: 0,
      active: true,
    },
  });

  const watchColor = watch('color');
  const watchEmoji = watch('emoji');

  // Gruppen laden
  const { data: groupsData, isLoading } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.CUSTOMER_GROUPS, {
        params: { includeInactive: true },
      });
      return res.data;
    },
    enabled: open,
  });
  const groups = groupsData?.groups || [];

  // Bei Öffnen zurücksetzen
  useEffect(() => {
    if (open) {
      setView('list');
      setEditGroup(null);
      setSaveError('');
      setConfirmDeleteId(null);
    }
  }, [open]);

  const openCreate = () => {
    setEditGroup(null);
    setImageFile(null);
    setImagePreview(null);
    setRemoveImage(false);
    reset({ name: '', color: '#1976d2', emoji: '', sortOrder: 0, active: true });
    setSaveError('');
    setView('form');
  };

  const openEdit = (grp) => {
    setEditGroup(grp);
    setImageFile(null);
    setImagePreview(grp.imageUrl || null);
    setRemoveImage(false);
    reset({
      name: grp.name,
      color: grp.color || '#1976d2',
      emoji: grp.emoji || '',
      sortOrder: grp.sortOrder ?? 0,
      active: grp.active,
    });
    setSaveError('');
    setView('form');
  };

  const handleImageSelect = (file) => {
    setImageFile(file);
    setRemoveImage(false);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setRemoveImage(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        name: data.name.trim(),
        color: data.color || '#1976d2',
        emoji: data.emoji || null,
        sortOrder: parseInt(data.sortOrder, 10) || 0,
        active: data.active,
      };

      let group;
      if (editGroup) {
        const res = await api.put(
          `${API_ENDPOINTS.CUSTOMER_GROUPS}/${editGroup.id}`,
          payload
        );
        group = res.data.group;
      } else {
        const res = await api.post(API_ENDPOINTS.CUSTOMER_GROUPS, payload);
        group = res.data.group;
      }

      // Bild verarbeiten
      if (editGroup && removeImage) {
        await api.delete(`${API_ENDPOINTS.CUSTOMER_GROUPS}/${group.id}/image`);
      } else if (imageFile) {
        const fd = new FormData();
        fd.append('image', imageFile);
        await api.post(`${API_ENDPOINTS.CUSTOMER_GROUPS}/${group.id}/image`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      queryClient.invalidateQueries({ queryKey: ['customer-groups'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-sales'] });
      setView('list');
    } catch (err) {
      setSaveError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          'Fehler beim Speichern'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`${API_ENDPOINTS.CUSTOMER_GROUPS}/${id}`);
      queryClient.invalidateQueries({ queryKey: ['customer-groups'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-sales'] });
      setConfirmDeleteId(null);
    } catch (err) {
      setSaveError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          'Fehler beim Löschen'
      );
    }
  };

  /* ---- Listenansicht ---- */
  const listView = (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>Gruppen verwalten</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          size="small"
          onClick={openCreate}
        >
          Neue Gruppe
        </Button>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {isLoading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : groups.length === 0 ? (
          <Box textAlign="center" p={4} color="text.secondary">
            <Typography>Noch keine Gruppen angelegt.</Typography>
          </Box>
        ) : (
          <Box>
            {groups.map((grp) => (
              <Box key={grp.id}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1.5,
                    opacity: grp.active ? 1 : 0.55,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <GroupBadge group={grp} size={36} />
                  <Box flex={1} minWidth={0}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography fontWeight={700} noWrap>{grp.name}</Typography>
                      {!grp.active && (
                        <Chip label="Inaktiv" size="small" color="default" sx={{ height: 18, fontSize: '0.65rem' }} />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {grp.memberCount ?? 0} Mitglieder · Reihenfolge {grp.sortOrder}
                    </Typography>
                  </Box>
                  <IconButton size="small" aria-label={`${grp.name} bearbeiten`} onClick={() => openEdit(grp)}>
                    <Edit fontSize="small" />
                  </IconButton>
                  {isAdmin && (
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`${grp.name} löschen`}
                      onClick={() => setConfirmDeleteId(grp.id)}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                </Box>
                {/* Inline-Bestätigung löschen */}
                {confirmDeleteId === grp.id && (
                  <Box
                    sx={{
                      mx: 2,
                      mb: 1,
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: alpha(theme.palette.error.main, 0.06),
                      border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
                    }}
                  >
                    <Typography variant="body2" fontWeight={600} gutterBottom>
                      Gruppe „{grp.name}" wirklich löschen? Kunden verlieren die Gruppenzuordnung.
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Abbrechen
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        color="error"
                        startIcon={<DeleteForever />}
                        onClick={() => handleDelete(grp.id)}
                      >
                        Endgültig löschen
                      </Button>
                    </Stack>
                  </Box>
                )}
                <Divider />
              </Box>
            ))}
          </Box>
        )}
        {saveError && (
          <Alert severity="error" sx={{ m: 2 }}>{saveError}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </>
  );

  /* ---- Formularansicht ---- */
  const formView = (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <IconButton size="small" aria-label="Zurück zur Liste" onClick={() => setView('list')} sx={{ mr: 0.5 }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" fontWeight={700}>
          {editGroup ? `Gruppe bearbeiten` : 'Neue Gruppe'}
        </Typography>
        {editGroup && (
          <Box ml={1}>
            <GroupBadge group={{ ...editGroup, color: watchColor, emoji: watchEmoji }} size={28} tooltip={false} />
          </Box>
        )}
      </DialogTitle>

      <DialogContent dividers sx={{ overflowY: 'auto' }}>
        <Grid container spacing={2}>
          {/* Vorschau */}
          <Grid size={{ xs: 12 }}>
            <Box display="flex" alignItems="center" gap={2} p={1.5} sx={{ bgcolor: 'background.default', borderRadius: 2 }}>
              <GroupBadge
                group={{ name: watch('name') || '?', color: watchColor, emoji: watchEmoji, imageUrl: imagePreview && !imageFile ? imagePreview : (imageFile ? imagePreview : null) }}
                size={48}
                tooltip={false}
              />
              <Typography variant="body2" color="text.secondary">Vorschau</Typography>
            </Box>
          </Grid>

          {/* Name */}
          <Grid size={{ xs: 12 }}>
            <Controller
              name="name"
              control={control}
              rules={{ required: 'Name ist erforderlich' }}
              render={({ field, fieldState: { error } }) => (
                <TextField
                  {...field}
                  label="Gruppenname"
                  fullWidth
                  required
                  error={!!error}
                  helperText={error?.message}
                  autoFocus
                />
              )}
            />
          </Grid>

          {/* Farbe */}
          <Grid size={{ xs: 12 }}>
            <Controller
              name="color"
              control={control}
              render={({ field }) => (
                <ColorPicker value={field.value} onChange={field.onChange} />
              )}
            />
          </Grid>

          {/* Emoji */}
          <Grid size={{ xs: 12 }}>
            <Controller
              name="emoji"
              control={control}
              render={({ field }) => (
                <EmojiPicker value={field.value} onChange={field.onChange} />
              )}
            />
          </Grid>

          {/* Bild */}
          <Grid size={{ xs: 12 }}>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              Gruppenbild (optional, überschreibt Emoji)
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                component="label"
                variant="outlined"
                size="small"
                startIcon={<CloudUpload />}
              >
                Bild wählen
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageSelect(f);
                  }}
                />
              </Button>
              {imagePreview && !removeImage && (
                <>
                  <Avatar src={imagePreview} variant="rounded" sx={{ width: 40, height: 40 }} />
                  <IconButton size="small" color="error" aria-label="Bild entfernen" onClick={handleRemoveImage}>
                    <Cancel fontSize="small" />
                  </IconButton>
                </>
              )}
              {removeImage && (
                <Typography variant="caption" color="text.secondary">Bild wird beim Speichern entfernt</Typography>
              )}
            </Stack>
          </Grid>

          {/* Reihenfolge & Aktiv */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="sortOrder"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Reihenfolge"
                  type="number"
                  fullWidth
                  size="small"
                  helperText="Niedrigere Zahlen zuerst"
                  inputProps={{ min: 0 }}
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="active"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                  label="Gruppe aktiv"
                  sx={{ mt: 1 }}
                />
              )}
            />
          </Grid>

          {saveError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">{saveError}</Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>

      <DialogActions>
        <Button onClick={() => setView('list')} color="inherit">
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? 'Speichert…' : editGroup ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogActions>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={view === 'list' ? onClose : undefined}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
      PaperProps={{ sx: { borderRadius: isMobile ? 0 : 3, overflow: 'hidden' } }}
    >
      {view === 'list' ? listView : formView}
    </Dialog>
  );
}
