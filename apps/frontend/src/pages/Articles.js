/**
 * Artikel: Sortiment nach Kategorien – in der Reihenfolge, in der es im Verkauf erscheint.
 *
 * Liste: eine Karte je Kategorie, Zeile antippen öffnet den Editor (Seitenleiste / Vollbild).
 * „Reihenfolge bearbeiten“: Reiter und Artikel per Griff oder Pfeiltasten umstellen, wird sofort gespeichert.
 * Suche, Filter und Knöpfe bzw. „Fertig“ bleiben beim Scrollen oben stehen.
 * Kategorie-Menü: umbenennen bzw. mit einer anderen zusammenführen, neuer Artikel in dieser Kategorie.
 */
import React, { useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Fab, Grid,
  IconButton, InputAdornment, ListItemIcon, Menu, MenuItem, Skeleton, Stack, Switch, TextField, Tooltip,
  Typography, useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Add, CheckCircle, ChevronRight, DriveFileRenameOutline, EditOutlined, EventBusy, Inventory, LocalBar, MoreVert,
  Search, SwapVert, VisibilityOff, Warning, Check,
} from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import KPICard from '../components/common/KPICard';
import StickyToolbar, { FilterChips } from '../components/common/StickyToolbar';
import ArticleEditor, { ExpiredDialog } from '../components/articles/ArticleEditor';
import ArticleSortView from '../components/articles/ArticleSortView';
import { useArticles } from '../hooks/useArticles';
import { useArticleCategories, sortCategoryNames } from '../hooks/useArticleCategories';
import { useAuth } from '../context/AuthContext';
import { money, qty, qtyShort, unitLabel, unitShort } from '../utils/format';

const TILE_FALLBACK = 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)';

const FILTERS = [
  { key: 'all', label: 'Alle', icon: Inventory, color: 'primary' },
  { key: 'active', label: 'Im Verkauf', icon: CheckCircle, color: 'success' },
  { key: 'inactive', label: 'Inaktiv', icon: VisibilityOff, color: 'info' },
  { key: 'low', label: 'Bestand niedrig', icon: Warning, color: 'warning' },
];
const isLow = (a) => a.stock <= a.minStock || a.stock <= 0;
const matchesFilter = (a, f) => f === 'all' || (f === 'active' && a.active) || (f === 'inactive' && !a.active) || (f === 'low' && isLow(a));

/* ------------------------------- Zeile ------------------------------- */

// Desktop-Tabelle: Artikel | Verkaufspreis | Gebinde | Bestand | Im Verkauf | Aktionen
const TABLE_COLUMNS = 'minmax(220px, 2.4fr) minmax(110px, 1fr) minmax(150px, 1.3fr) minmax(170px, 1.5fr) 96px 168px';

const stockState = (a) => (a.stock <= 0 ? 'empty' : a.stock <= a.minStock ? 'low' : 'ok');
const STOCK_UI = {
  empty: { color: 'error.main', chip: { label: 'Leer', color: 'error' } },
  low: { color: 'warning.main', chip: { label: 'Niedrig', color: 'warning' } },
  ok: { color: 'text.primary', chip: null },
};

/** "2 Kisten + 4 Fl." für den Bestand */
const crateBreakdown = (a) => {
  if (a.unitsPerPurchase <= 1 || a.stock <= 0) return null;
  const crates = Math.floor(a.stock / a.unitsPerPurchase);
  const rest = a.stock - crates * a.unitsPerPurchase;
  return [crates ? qty(crates, a.purchaseUnit) : null, rest ? qtyShort(rest, a.unit) : null].filter(Boolean).join(' + ');
};

function StockLabel({ article }) {
  const st = STOCK_UI[stockState(article)];
  if (st.chip) return <Chip size="small" color={st.chip.color} label={st.chip.label} sx={{ fontWeight: 700 }} />;
  return <Chip size="small" variant="outlined" label={qtyShort(article.stock, article.unit)} sx={{ fontWeight: 600 }} />;
}

const Cell = ({ main, sub, color, align = 'left' }) => (
  <Box sx={{ minWidth: 0, textAlign: align }}>
    <Typography fontWeight={700} noWrap sx={{ color }}>{main}</Typography>
    {sub && <Typography variant="body2" color="text.secondary" noWrap>{sub}</Typography>}
  </Box>
);

function TableHeader() {
  const head = (label, align = 'left') => (
    <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary', textAlign: align }}>{label}</Typography>
  );
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: TABLE_COLUMNS, gap: 2, alignItems: 'center', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
      {head('Artikel')}{head('Verkaufspreis')}{head('Gebinde')}{head('Bestand')}{head('Im Verkauf', 'center')}<span />
    </Box>
  );
}

function Thumb({ article: a, size }) {
  return (
    <Avatar variant="rounded" src={a.imageThumbnail || a.imageSmall || undefined} alt=""
      sx={{ width: size, height: size, borderRadius: '10px', background: TILE_FALLBACK, opacity: a.active ? 1 : 0.5, flexShrink: 0 }}>
      <LocalBar sx={{ color: 'rgba(255,255,255,0.5)' }} />
    </Avatar>
  );
}

const rowSx = {
  cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' },
  transition: 'background-color .15s', '&:hover': { bgcolor: 'action.hover' }, outline: 'none', '&:focus-visible': { bgcolor: 'action.focus' },
};

/** Desktop: Tabellenzeile mit klaren Spalten und direkter Bruch-Buchung */
function ArticleTableRow({ article: a, onOpen, onToggle, onExpired, readOnly }) {
  const st = STOCK_UI[stockState(a)];
  const crate = a.unitsPerPurchase > 1;
  const breakdown = crateBreakdown(a);
  const warn = a.minStock > 0 ? `Warnung ab ${qtyShort(a.minStock, a.unit)}` : null;
  return (
    <Box onClick={() => onOpen(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(a)}
      sx={{ ...rowSx, display: 'grid', gridTemplateColumns: TABLE_COLUMNS, gap: 2, alignItems: 'center', px: 2, py: 1.25 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0, opacity: a.active ? 1 : 0.6 }}>
        <Thumb article={a} size={52} />
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>{a.name}</Typography>
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.25 }}>
            {!a.active && <Chip size="small" label="Inaktiv" sx={{ height: 20, fontSize: '0.7rem' }} />}
            {!a.countsForHighscore && <Chip size="small" variant="outlined" label="kein Clubscore" sx={{ height: 20, fontSize: '0.7rem' }} />}
          </Stack>
        </Box>
      </Stack>
      <Cell main={money(a.price)} sub={`pro ${unitLabel(a.unit, 1)}`} />
      <Cell main={crate ? `${a.purchaseUnit} à ${qty(a.unitsPerPurchase, a.unit)}` : `einzeln (${unitLabel(a.unit, 1)})`}
        sub={crate ? `Verkaufswert ${money(a.unitsPerPurchase * a.price)}` : null} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Cell main={qty(a.stock, a.unit)} color={st.color} sub={breakdown || warn} />
        {st.chip && <Chip size="small" color={st.chip.color} label={st.chip.label} sx={{ fontWeight: 700, flexShrink: 0 }} />}
      </Stack>
      <Box sx={{ display: 'flex', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={a.active ? 'Wird im Verkauf angezeigt' : 'Ausgeblendet – erscheint nicht im Verkauf'}>
          <span><Switch checked={a.active} disabled={readOnly} onChange={() => onToggle(a.id)} color="success" /></span>
        </Tooltip>
      </Box>
      <Stack direction="row" spacing={0.5} justifyContent="flex-end" onClick={(e) => e.stopPropagation()}>
        {!readOnly && (
          <Tooltip title="Abgelaufene oder kaputte Ware abschreiben">
            <Button size="small" color="error" variant="outlined" startIcon={<EventBusy />}
              onClick={() => onExpired(a)} sx={{ whiteSpace: 'nowrap' }}>Bruch</Button>
          </Tooltip>
        )}
        <Tooltip title={readOnly ? 'Ansehen' : 'Bearbeiten'}>
          <IconButton onClick={() => onOpen(a)}><EditOutlined /></IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

/** Handy/Tablet: kompakte Zeile, antippen öffnet den Editor */
function ArticleRow({ article: a, onOpen }) {
  const sub = [
    a.unitsPerPurchase > 1 ? `${a.purchaseUnit} = ${qty(a.unitsPerPurchase, a.unit)}` : unitLabel(a.unit, 1),
    a.countsForHighscore ? null : 'kein Clubscore',
  ].filter(Boolean).join(' · ');
  return (
    <Box onClick={() => onOpen(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(a)}
      sx={{ ...rowSx, display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 1.5, sm: 2 }, py: 1.25 }}>
      <Thumb article={a} size={52} />
      <Box sx={{ flex: 1, minWidth: 0, opacity: a.active ? 1 : 0.6 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>{a.name}</Typography>
          {!a.active && <Chip size="small" label="Inaktiv" sx={{ height: 20, fontSize: '0.7rem' }} />}
        </Stack>
        <Typography variant="body2" color="text.secondary" noWrap>{sub}</Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
          <Typography fontWeight={800}>{money(a.price)}<Typography component="span" variant="body2" color="text.secondary"> / {unitShort(a.unit)}</Typography></Typography>
          <StockLabel article={a} />
        </Stack>
      </Box>
      <ChevronRight sx={{ color: 'text.disabled' }} />
    </Box>
  );
}

/* --------------------------- Kategorie-Karte -------------------------- */

function CategoryCard({ name, articles, total, onOpen, onToggle, onExpired, onAdd, onRename, readOnly, table }) {
  const [anchor, setAnchor] = useState(null);
  const active = articles.filter((a) => a.active).length;
  return (
    <Card>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 2, pr: 1, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ fontSize: '1.1rem', flex: 1, minWidth: 0 }} noWrap>{name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {articles.length === total ? `${total} Artikel` : `${articles.length} von ${total}`}{active < articles.length ? ` · ${active} im Verkauf` : ''}
        </Typography>
        {!readOnly && (
          <>
            <Tooltip title={`Neuer Artikel in ${name}`}><IconButton onClick={() => onAdd(name)}><Add /></IconButton></Tooltip>
            <IconButton aria-label="Kategorie-Menü" onClick={(e) => setAnchor(e.currentTarget)}><MoreVert /></IconButton>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
              <MenuItem onClick={() => { setAnchor(null); onRename(name); }}>
                <ListItemIcon><DriveFileRenameOutline fontSize="small" /></ListItemIcon>Umbenennen oder zusammenführen
              </MenuItem>
            </Menu>
          </>
        )}
      </Stack>
      {table && <TableHeader />}
      {articles.map((a) => (table
        ? <ArticleTableRow key={a.id} article={a} onOpen={onOpen} onToggle={onToggle} onExpired={onExpired} readOnly={readOnly} />
        : <ArticleRow key={a.id} article={a} onOpen={onOpen} />
      ))}
    </Card>
  );
}

/* --------------------------- Umbenennen-Dialog ------------------------ */

function RenameDialog({ name, categories, onClose }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name || '');
  React.useEffect(() => setValue(name || ''), [name]);
  const target = value.trim();
  const merge = target && target !== name && categories.includes(target);
  const mutation = useMutation({
    mutationFn: async () => (await api.put(`${API_ENDPOINTS.ARTICLES}/categories/rename`, { from: name, to: target })).data,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['articles'] }); onClose(); },
  });
  return (
    <Dialog open={!!name} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Kategorie umbenennen</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth label="Neuer Name" value={value} onChange={(e) => setValue(e.target.value)} sx={{ mt: 1 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && target && target !== name) mutation.mutate(); }} />
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          {categories.filter((c) => c !== name).map((c) => (
            <Chip key={c} size="small" variant="outlined" label={`→ ${c}`} onClick={() => setValue(c)} />
          ))}
        </Stack>
        {merge && (
          <Alert severity="info" sx={{ mt: 2 }}>
            „{target}“ gibt es schon. Alle Artikel aus „{name}“ werden dorthin verschoben, „{name}“ verschwindet.
          </Alert>
        )}
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{mutation.error?.response?.data?.error || 'Umbenennen fehlgeschlagen'}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" disabled={!target || target === name || mutation.isPending} onClick={() => mutation.mutate()}>
          {merge ? 'Zusammenführen' : 'Umbenennen'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* -------------------------------- Seite ------------------------------- */

export default function Articles() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const compactRows = useMediaQuery(theme.breakpoints.down('md')); // Handy + Tablet hochkant: Filter als Chips
  const tableLayout = useMediaQuery(theme.breakpoints.up('lg')); // breit genug für Spalten, sonst kompakte Zeilen
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEdit = can('editArticles');

  const { allArticles: articles, isLoading } = useArticles({ activeOnly: false });
  const { names: categoryOrder, tabs } = useArticleCategories();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sorting, setSorting] = useState(false);
  const [editor, setEditor] = useState({ open: false, article: null, category: null });
  const [renaming, setRenaming] = useState(null);
  const [expired, setExpired] = useState(null);

  const categories = useMemo(
    () => sortCategoryNames(articles.map((a) => a.category).filter(Boolean), categoryOrder),
    [articles, categoryOrder]
  );
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, articles.filter((a) => matchesFilter(a, f.key)).length])), [articles]);
  const nextOrder = useMemo(() => articles.reduce((m, a) => Math.max(m, a.order || 0), 0) + 1, [articles]);

  const s = search.trim().toLowerCase();
  const visible = articles.filter((a) => matchesFilter(a, filter) && (!s || a.name.toLowerCase().includes(s) || (a.category || '').toLowerCase().includes(s)));
  const groups = categories
    .map((c) => ({ name: c, total: articles.filter((a) => a.category === c).length, items: visible.filter((a) => a.category === c) }))
    .filter((g) => g.items.length);

  const toggle = useMutation({
    mutationFn: async (id) => (await api.patch(`${API_ENDPOINTS.ARTICLES}/${id}/toggle-status`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['articles'] }),
  });

  // Klick auf den aktiven Filter wählt ihn ab -> alle Artikel
  const pickFilter = (key) => setFilter((f) => (f === key ? 'all' : key));
  const startSorting = () => { setSearch(''); setFilter('all'); setSorting(true); window.scrollTo({ top: 0 }); };
  const openEditor = (article) => setEditor({ open: true, article, category: null });
  const newArticle = (category = null) => setEditor({ open: true, article: null, category });
  const fresh = editor.article ? articles.find((a) => a.id === editor.article.id) || editor.article : null;

  return (
    <Box sx={{ pb: 10 }}>
      {/* Kennzahlen = Filter (ab Desktop); darunter als Chips unter der Suche */}
      {!compactRows && !sorting && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {FILTERS.map((f) => (
            <Grid key={f.key} size={{ xs: 6, md: 3 }}>
              <KPICard title={f.label} value={counts[f.key]} icon={f.icon} color={f.color} loading={isLoading}
                onClick={() => pickFilter(f.key)}
                subTitle={f.key === 'low' ? (counts.low ? 'Einkauf oder Inventur nötig' : 'Alles OK') : undefined}
                sx={{ outline: filter === f.key ? `2px solid ${theme.palette[f.color].main}` : 'none', outlineOffset: 2 }} />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Werkzeugleiste – bleibt beim Scrollen unter der App-Leiste stehen (64 px). Der Streifen in
          Hintergrundfarbe dahinter verdeckt Inhalt, der sonst an den runden Ecken durchscheint. */}
      <StickyToolbar>
        {sorting ? (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={700}>Reihenfolge wie im Verkauf</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                Am Griff ziehen oder Pfeile antippen. Wird sofort gespeichert.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'block', sm: 'none' } }}>Wird sofort gespeichert.</Typography>
            </Box>
            <Button variant="contained" startIcon={<Check />} onClick={() => setSorting(false)} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Fertig</Button>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField placeholder="Artikel oder Kategorie suchen…" size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} />
              {canEdit && !isMobile && (
                <Button variant="outlined" startIcon={<SwapVert />} onClick={startSorting} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                  Reihenfolge bearbeiten
                </Button>
              )}
              {canEdit && !isMobile && (
                <Button variant="contained" startIcon={<Add />} onClick={() => newArticle()} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Neuer Artikel</Button>
              )}
            </Stack>
            {compactRows && (
              <FilterChips value={filter} onChange={setFilter}
                options={FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key], color: f.color }))} />
            )}
            {canEdit && isMobile && (
              <Button variant="outlined" size="small" fullWidth startIcon={<SwapVert />} onClick={startSorting}>Reihenfolge bearbeiten</Button>
            )}
          </Stack>
        )}
      </StickyToolbar>

      {/* Inhalt */}
      {isLoading ? (
        <Stack spacing={2}>{[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={240} />)}</Stack>
      ) : sorting ? (
        <ArticleSortView articles={articles} tabs={tabs} />
      ) : groups.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center' }}>
          <Inventory sx={{ fontSize: 56, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">
            {articles.length === 0 ? 'Noch keine Artikel angelegt.' : 'Keine Artikel für diese Suche oder diesen Filter.'}
          </Typography>
          {articles.length > 0 && (filter !== 'all' || s) && (
            <Button sx={{ mt: 2 }} onClick={() => { setFilter('all'); setSearch(''); }}>Filter zurücksetzen</Button>
          )}
        </Card>
      ) : (
        <Stack spacing={2}>
          {groups.map((g) => (
            <CategoryCard key={g.name} name={g.name} articles={g.items} total={g.total} table={tableLayout}
              onOpen={openEditor} onToggle={(id) => toggle.mutate(id)} onExpired={setExpired} onAdd={newArticle} onRename={setRenaming} readOnly={!canEdit} />
          ))}
        </Stack>
      )}

      {canEdit && isMobile && !sorting && (
        <Fab color="primary" aria-label="Neuer Artikel" onClick={() => newArticle()}
          sx={{ position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', boxShadow: `0 8px 24px ${alpha(theme.palette.primary.main, 0.35)}` }}>
          <Add />
        </Fab>
      )}

      <ArticleEditor open={editor.open} article={fresh} presetCategory={editor.category} categories={categories} nextOrder={nextOrder}
        readOnly={!canEdit} onClose={() => setEditor((e) => ({ ...e, open: false }))} />
      <RenameDialog name={renaming} categories={categories} onClose={() => setRenaming(null)} />
      {expired && <ExpiredDialog article={expired} open onClose={() => setExpired(null)} />}
    </Box>
  );
}
