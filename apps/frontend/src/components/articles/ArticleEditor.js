/**
 * Artikel anlegen/bearbeiten: Seitenleiste rechts (ab sm), auf dem Handy Vollbild.
 * Oben eine Live-Vorschau der Verkaufskachel, die zugleich das Bild aufnimmt (Tippen oder Datei hineinziehen).
 * Darunter drei Blöcke: Verkauf · Einkauf & Bestand · Einstellungen. Speichern bleibt unten fest stehen.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer,
  IconButton, InputAdornment, MenuItem, Stack, Switch, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Add, Close, DeleteOutline, EventBusy, LocalBar, PhotoCameraOutlined,
} from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../config/api';
import { money, num, qty, unitLabel } from '../../utils/format';

const TILE_FALLBACK = 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)'; // wie die Verkaufskachel
const UNITS = ['Flasche', 'Dose', 'Glas', 'Stück', 'Portion', 'Tüte'];
const PURCHASE_UNITS = ['Kiste', 'Karton', 'Packung', 'Palette', 'Fass'];

const priceText = (v) => (v === '' || v === null || v === undefined ? '' : num(v).toFixed(2).replace('.', ','));
const intText = (v) => (v === '' || v === null || v === undefined ? '' : String(Math.trunc(num(v))));

const emptyForm = (category) => ({
  name: '', price: '', category: category || '', unit: 'Flasche', purchaseUnit: 'Kiste', unitsPerPurchase: '20',
  minStock: '0', initialStock: '0', countsForHighscore: true, active: true,
});

const fromArticle = (a) => ({
  name: a.name, price: priceText(a.price), category: a.category || '', unit: a.unit || 'Stück',
  purchaseUnit: a.purchaseUnit || 'Kiste', unitsPerPurchase: intText(a.unitsPerPurchase), minStock: intText(a.minStock),
  initialStock: '0', countsForHighscore: a.countsForHighscore !== false, active: a.active !== false,
});

function Section({ title, children, action }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, p: { xs: 2, sm: 2.5 }, bgcolor: 'background.paper' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.08em', color: 'text.secondary', lineHeight: 1.5 }}>{title}</Typography>
        {action}
      </Stack>
      <Stack spacing={2}>{children}</Stack>
    </Box>
  );
}

function SwitchRow({ label, hint, checked, onChange, disabled }) {
  return (
    <Stack direction="row" alignItems="center" spacing={2} component="label" sx={{ cursor: disabled ? 'default' : 'pointer' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={600}>{label}</Typography>
        {hint && <Typography variant="body2" color="text.secondary">{hint}</Typography>}
      </Box>
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
    </Stack>
  );
}

/** Kachel wie im Verkauf; nimmt Bilder per Tippen oder Drag & Drop an */
function TilePreview({ name, price, image, onPick, onRemove, readOnly }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (file) => { if (file && file.type.startsWith('image/')) onPick(file); };
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Box
        onClick={() => !readOnly && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!readOnly) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!readOnly) pick(e.dataTransfer.files?.[0]); }}
        sx={{
          width: 150, flexShrink: 0, borderRadius: 3, overflow: 'hidden', cursor: readOnly ? 'default' : 'pointer',
          border: '2px solid', borderColor: over ? 'primary.main' : 'divider', bgcolor: 'background.paper',
          transition: 'border-color .15s', '&:hover': readOnly ? {} : { borderColor: 'primary.main' },
        }}
      >
        <Box sx={{ height: 120, background: TILE_FALLBACK, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {image ? (
            <Box component="img" src={image} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <LocalBar sx={{ fontSize: 48, color: 'rgba(255,255,255,0.25)' }} />
          )}
          <Box sx={{ position: 'absolute', bottom: 0, right: 0, bgcolor: 'rgba(0,0,0,0.85)', color: '#fff', px: 1, py: 0.25, borderTopLeftRadius: 8, fontWeight: 900, fontSize: '0.95rem' }}>
            {money(num(price))}
          </Box>
          {!readOnly && (
            <Box sx={{ position: 'absolute', top: 6, left: 6, width: 30, height: 30, borderRadius: '50%', bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PhotoCameraOutlined sx={{ fontSize: 18 }} />
            </Box>
          )}
        </Box>
        <Typography fontWeight={700} sx={{ p: 1.25, lineHeight: 1.2, minHeight: 44, wordBreak: 'break-word', fontSize: '0.95rem' }}>
          {name || 'Artikelname'}
        </Typography>
      </Box>
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">So erscheint der Artikel im Verkauf.</Typography>
        {!readOnly && (
          <>
            <Button size="small" variant="outlined" startIcon={<PhotoCameraOutlined />} onClick={() => inputRef.current?.click()} sx={{ alignSelf: 'flex-start' }}>
              {image ? 'Bild ändern' : 'Bild wählen'}
            </Button>
            {image && (
              <Button size="small" color="inherit" startIcon={<DeleteOutline />} onClick={onRemove} sx={{ alignSelf: 'flex-start', color: 'text.secondary' }}>
                Bild entfernen
              </Button>
            )}
            <Typography variant="caption" color="text.disabled">Quadratisch wirkt am besten.</Typography>
          </>
        )}
      </Stack>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </Stack>
  );
}

/** Kategorie als Chips; „Neu“ öffnet ein Textfeld */
function CategoryPicker({ value, options, onChange, error, disabled }) {
  const [adding, setAdding] = useState(false);
  const isCustom = value && !options.includes(value);
  return (
    <Box>
      <Typography variant="body2" color={error ? 'error' : 'text.secondary'} sx={{ mb: 1 }}>Kategorie</Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {options.map((c) => (
          <Chip key={c} label={c} clickable={!disabled} disabled={disabled && value !== c}
            color={value === c ? 'primary' : 'default'} variant={value === c ? 'filled' : 'outlined'}
            onClick={() => { setAdding(false); onChange(c); }} sx={{ fontWeight: 600 }} />
        ))}
        {isCustom && !adding && <Chip label={value} color="primary" sx={{ fontWeight: 600 }} onDelete={disabled ? undefined : () => onChange('')} />}
        {!disabled && !adding && (
          <Chip icon={<Add />} label="Neue Kategorie" variant="outlined" clickable onClick={() => { setAdding(true); onChange(''); }}
            sx={{ borderStyle: 'dashed' }} />
        )}
      </Stack>
      {adding && (
        <TextField autoFocus size="small" fullWidth placeholder="z. B. Snacks" value={value} sx={{ mt: 1.5 }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (value.trim()) setAdding(false); } }}
          onBlur={() => { if (value.trim()) setAdding(false); }}
          InputProps={{ endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => setAdding(false)}><Close fontSize="small" /></IconButton></InputAdornment> }} />
      )}
      {error && <Typography variant="caption" color="error">{error}</Typography>}
    </Box>
  );
}

export function ExpiredDialog({ article, open, onClose }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('1');
  useEffect(() => { if (open) setAmount('1'); }, [open]);
  const mutation = useMutation({
    mutationFn: async () => (await api.post(API_ENDPOINTS.TRANSACTIONS, {
      type: 'EXPIRED', items: [{ articleId: article.id, quantity: Math.trunc(num(amount)) }], paymentMethod: 'CASH', customerId: null,
    })).data,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['articles'] }); onClose(true); },
  });
  const n = Math.trunc(num(amount));
  return (
    <Dialog open={open} onClose={() => onClose(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Abschreibung buchen</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Abgelaufene oder kaputte Ware von <strong>{article?.name}</strong> aus dem Bestand nehmen.
          Aktuell: {qty(article?.stock ?? 0, article?.unit)}.
        </Typography>
        <TextField autoFocus fullWidth label="Menge" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
          helperText={n > (article?.stock ?? 0) ? 'Mehr als der erfasste Bestand – der Bestand wird negativ.' : ' '}
          FormHelperTextProps={{ sx: { color: n > (article?.stock ?? 0) ? 'warning.main' : undefined } }}
          InputProps={{ endAdornment: <InputAdornment position="end">{unitLabel(article?.unit, n || 2)}</InputAdornment> }} />
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{mutation.error?.response?.data?.error || 'Buchen fehlgeschlagen'}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={() => onClose(false)}>Abbrechen</Button>
        <Button variant="contained" color="error" disabled={n < 1 || mutation.isPending} onClick={() => mutation.mutate()}>
          {n >= 1 ? `${qty(n, article?.unit)} abschreiben` : 'Abschreiben'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * @param {{ open, article?, presetCategory?, categories: string[], nextOrder: number, readOnly?, onClose }} props
 */
export default function ArticleEditor({ open, article, presetCategory, categories, nextOrder, readOnly, onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const isNew = !article;

  const [form, setForm] = useState(emptyForm());
  const [initial, setInitial] = useState(emptyForm()); // Ausgangswerte, um nur Geändertes zu senden
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [touched, setTouched] = useState(false);
  const [expiredOpen, setExpiredOpen] = useState(false);

  // Nur beim Öffnen bzw. Wechsel des Artikels zurücksetzen – nicht, wenn Artikel/Kategorien im Hintergrund neu laden
  const articleId = article?.id;
  useEffect(() => {
    if (!open) return;
    const start = article ? fromArticle(article) : emptyForm(presetCategory || categories[0]);
    setForm(start);
    setInitial(start);
    setImageFile(null);
    setImagePreview(article ? (article.imageMedium || article.imageSmall || article.imageThumbnail || article.imageUrl || null) : null);
    setRemoveImage(false);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, articleId, presetCategory]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const errors = useMemo(() => ({
    name: form.name.trim().length < 2 ? 'Mindestens 2 Zeichen' : null,
    price: form.price === '' || num(form.price) < 0 || Number.isNaN(Number(String(form.price).replace(',', '.'))) ? 'Preis angeben, z. B. 1,50' : null,
    category: !form.category.trim() ? 'Bitte eine Kategorie wählen' : null,
  }), [form]);
  const valid = !errors.name && !errors.price && !errors.category;
  const perPurchase = Math.max(1, Math.trunc(num(form.unitsPerPurchase)) || 1);

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('name', form.name.trim());
      fd.append('price', String(num(form.price)));
      fd.append('category', form.category.trim());
      fd.append('unit', form.unit);
      // Gebinde nur senden, wenn neu oder geändert – sonst würden die Anzeige-Standardwerte
      // („Kiste“, Faktor 1) bei Artikeln ohne Gebinde festgeschrieben
      if (isNew || form.purchaseUnit !== initial.purchaseUnit) fd.append('purchaseUnit', form.purchaseUnit.trim() || 'Kiste');
      if (isNew || form.unitsPerPurchase !== initial.unitsPerPurchase) fd.append('unitsPerPurchase', String(perPurchase));
      fd.append('minStock', String(Math.max(0, Math.trunc(num(form.minStock)))));
      fd.append('countsForHighscore', String(form.countsForHighscore));
      if (imageFile) fd.append('image', imageFile);
      const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };
      if (isNew) {
        fd.append('initialStock', String(Math.max(0, Math.trunc(num(form.initialStock)))));
        fd.append('order', String(nextOrder));
        return (await api.post(API_ENDPOINTS.ARTICLES, fd, cfg)).data;
      }
      fd.append('active', String(form.active));
      if (removeImage && !imageFile) fd.append('removeImage', 'true');
      return (await api.put(`${API_ENDPOINTS.ARTICLES}/${article.id}`, fd, cfg)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      onClose(true);
    },
  });

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (valid && !readOnly) mutation.mutate();
  };

  const pickImage = (file) => {
    setImageFile(file);
    setRemoveImage(false);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const err = (k) => (touched ? errors[k] : null);

  return (
    <Drawer
      anchor="right" open={open} onClose={() => onClose(false)}
      sx={{ zIndex: (t) => t.zIndex.modal }} // über der App-Leiste (drawer + 1)
      PaperProps={{
        component: 'form', onSubmit: submit, noValidate: true,
        sx: { width: fullScreen ? '100%' : 520, maxWidth: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', borderRadius: 0 },
      }}
    >
      {/* Kopf */}
      <Stack direction="row" alignItems="center" spacing={1}
        sx={{ px: { xs: 1, sm: 2 }, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', pt: { xs: 'calc(12px + env(safe-area-inset-top, 0px))', sm: 1.5 } }}>
        <IconButton onClick={() => onClose(false)} aria-label="Schließen"><Close /></IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" noWrap sx={{ lineHeight: 1.2 }}>{isNew ? 'Neuer Artikel' : readOnly ? 'Artikel' : 'Artikel bearbeiten'}</Typography>
          {!isNew && <Typography variant="body2" color="text.secondary" noWrap>{article.name}</Typography>}
        </Box>
        {!isNew && !form.active && <Chip size="small" label="Inaktiv" />}
      </Stack>

      {/* Inhalt */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 1.5, sm: 2 } }}>
        <Stack spacing={2}>
          <Box sx={{ p: { xs: 1, sm: 0.5 } }}>
            <TilePreview name={form.name} price={form.price} image={imagePreview} readOnly={readOnly}
              onPick={pickImage} onRemove={() => { setImageFile(null); setImagePreview(null); setRemoveImage(true); }} />
          </Box>

          <Section title="Verkauf">
            <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} fullWidth autoFocus={isNew}
              error={!!err('name')} helperText={err('name')} disabled={readOnly} />
            <Stack direction="row" spacing={2}>
              <TextField label="Preis" value={form.price} inputMode="decimal" placeholder="0,00" fullWidth disabled={readOnly}
                onChange={(e) => set({ price: e.target.value.replace(/[^0-9.,]/g, '') })}
                onBlur={() => form.price !== '' && set({ price: priceText(String(form.price).replace(',', '.')) })}
                error={!!err('price')} helperText={err('price') || `pro ${unitLabel(form.unit, 1)}`}
                InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment> }} />
              <TextField select label="Verkauft als" value={form.unit} onChange={(e) => set({ unit: e.target.value })} fullWidth disabled={readOnly}>
                {[...new Set([...UNITS, form.unit])].map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </TextField>
            </Stack>
            <CategoryPicker value={form.category} options={categories} onChange={(category) => set({ category })} error={err('category')} disabled={readOnly} />
          </Section>

          <Section title="Einkauf & Bestand">
            <Stack direction="row" spacing={2}>
              <TextField select label="Geliefert als" value={form.purchaseUnit} onChange={(e) => set({ purchaseUnit: e.target.value })} fullWidth disabled={readOnly}>
                {[...new Set([...PURCHASE_UNITS, form.purchaseUnit])].map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </TextField>
              <TextField label="Inhalt" value={form.unitsPerPurchase} inputMode="numeric" fullWidth disabled={readOnly}
                onChange={(e) => set({ unitsPerPurchase: e.target.value.replace(/\D/g, '') })}
                InputProps={{ endAdornment: <InputAdornment position="end">{unitLabel(form.unit, perPurchase)}</InputAdornment> }} />
            </Stack>
            <Typography variant="body2" sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.08), color: 'text.secondary' }}>
              1 {form.purchaseUnit || 'Kiste'} = <strong>{qty(perPurchase, form.unit)}</strong>
              {num(form.price) > 0 && <> · Verkaufswert {money(perPurchase * num(form.price))}</>}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, alignItems: 'start' }}>
              <TextField label="Warnen ab" value={form.minStock} inputMode="numeric" fullWidth disabled={readOnly}
                onChange={(e) => set({ minStock: e.target.value.replace(/\D/g, '') })}
                helperText="Mindestbestand"
                InputProps={{ endAdornment: <InputAdornment position="end">{unitLabel(form.unit, 2)}</InputAdornment> }} />
              {isNew ? (
                <TextField label="Startbestand" value={form.initialStock} inputMode="numeric" fullWidth
                  onChange={(e) => set({ initialStock: e.target.value.replace(/\D/g, '') })}
                  InputProps={{ endAdornment: <InputAdornment position="end">{unitLabel(form.unit, 2)}</InputAdornment> }} />
              ) : (
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" color="text.secondary">Aktueller Bestand</Typography>
                  <Typography variant="h6" color={article.stock <= 0 ? 'error.main' : article.stock <= article.minStock ? 'warning.main' : 'text.primary'}>
                    {qty(article.stock, article.unit)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Ändert sich über Einkauf und Inventur</Typography>
                </Box>
              )}
            </Box>
          </Section>

          <Section title="Einstellungen">
            {!isNew && (
              <SwitchRow label="Im Verkauf anzeigen" hint="Inaktive Artikel bleiben erhalten, erscheinen aber nicht an der Kasse."
                checked={form.active} onChange={(active) => set({ active })} disabled={readOnly} />
            )}
            {!isNew && <Divider />}
            <SwitchRow label="Zählt für den Clubscore" hint="Käufe fließen in Rangliste und Team-Wertung ein."
              checked={form.countsForHighscore} onChange={(countsForHighscore) => set({ countsForHighscore })} disabled={readOnly} />
          </Section>

          {!isNew && !readOnly && (
            <Button color="error" variant="outlined" startIcon={<EventBusy />} onClick={() => setExpiredOpen(true)} sx={{ alignSelf: 'flex-start' }}>
              Abschreibung buchen (abgelaufen, Bruch)
            </Button>
          )}

          {mutation.isError && (
            <Alert severity="error">{mutation.error?.response?.data?.error || mutation.error?.response?.data?.errors?.[0]?.msg || 'Speichern fehlgeschlagen'}</Alert>
          )}
        </Stack>
      </Box>

      {/* Aktionen */}
      {!readOnly && (
        <Stack direction="row" spacing={1.5} justifyContent="flex-end"
          sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 } }}>
          <Button color="inherit" onClick={() => onClose(false)}>Abbrechen</Button>
          <Button type="submit" variant="contained" size="large" disabled={mutation.isPending} sx={{ px: 4, flex: { xs: 1, sm: 'none' } }}>
            {mutation.isPending ? 'Speichert…' : isNew ? 'Anlegen' : 'Speichern'}
          </Button>
        </Stack>
      )}

      {!isNew && <ExpiredDialog article={article} open={expiredOpen} onClose={() => setExpiredOpen(false)} />}
    </Drawer>
  );
}
