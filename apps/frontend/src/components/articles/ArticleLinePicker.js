/**
 * Gemeinsame Artikel-Buchungsmaske für Verkauf, Einkauf/Lieferschein und Ausgangsrechnung.
 *
 * Aufbau: [sidebar (Seite)] | Artikel (Suche, Kategorien, Kacheln) | Positionen (Liste + Slots)
 * Ab `md` drei Spalten, darunter Tabs "<sidebarLabel> | Artikel | <linesLabel> (n)".
 *
 * Props: mode ('sale'|'purchase'|'invoice'), lines, onChange, showCrates, showPrice,
 * editablePrice, allowFreeLines, showStock, sidebar/sidebarLabel, linesLabel,
 * linesHeader, linesFooter, mobileTab/onMobileTabChange, columns, height.
 *
 * `lines`/`onChange`: Zeilenmodell aus hooks/useArticleLines. `onChange` MUSS eine
 * Updater-Funktion akzeptieren (wie setState), damit Doppeltipps nichts verlieren –
 * `setLines` aus useArticleLines passt direkt.
 *
 * Verkaufsmodus (mode="sale") erweitert:
 *   • Wisch nach links auf einer Warenkorb-Zeile → „Entfernen" (via SwipeableLine).
 *   • Rückgängig-Snackbar nach jeder Zeilenlöschung (5 s, nur letzte Löschung).
 *   • Langer Touch (~500 ms) auf Artikel-Kachel → Mengenauswahl-Dialog.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, Snackbar, Stack, Tab, Tabs, TextField,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { Add, DeleteOutline, Inventory2Outlined, LocalBar, Search, ShoppingCart } from '@mui/icons-material';
import QuantityStepper from '../common/QuantityStepper';
import SwipeableLine from './SwipeableLine';
import { useArticles } from '../../hooks/useArticles';
import {
  addArticle, adjustLine, setLineQty, setLinePrice, setLineName, removeLine, addFreeLine,
  lineTotalQty, lineAmount, linesTotalQty,
} from '../../hooks/useArticleLines';
import { money, num, qty, unitShort, unitLabel } from '../../utils/format';
import { hasCrate, describeLineQty } from '../../utils/units';

// Platzhalter-Verlauf der Verkaufsmaske (Referenz-Optik); auf dem Bild liegt weißes Icon + schwarzes Preis-Badge
const TILE_FALLBACK = 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)';

const paneSx = { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' };

/* ------------------------------- Kachel ------------------------------- */

/**
 * Artikel-Kachel mit optionalem Long-Press (nur Verkauf).
 * Long-Press-Erkennung läuft über Pointer Events (Touch only, 500 ms).
 * Nach ausgelöstem Long-Press wird der nachfolgende click-Event unterdrückt,
 * damit nicht zusätzlich 1 Stück gebucht wird.
 */
function ArticleTile({ article, qtyInLines, showPrice, showStock, showCrates, onTap, onCrate, onLongPress }) {
  const theme = useTheme();
  const crate = showCrates && hasCrate(article);

  // Refs für Long-Press-Erkennung (kein Re-Render nötig)
  const lpTimerRef = useRef(null);
  const lpFiredRef = useRef(false); // wurde Long-Press ausgelöst?
  const lpStartRef = useRef(null);  // Startpunkt, damit Finger-Zittern den Long-Press nicht abbricht

  const startLongPress = (e) => {
    if (e.pointerType !== 'touch' || !onLongPress) return;
    lpFiredRef.current = false;
    lpStartRef.current = { x: e.clientX, y: e.clientY };
    lpTimerRef.current = setTimeout(() => {
      lpFiredRef.current = true;
      onLongPress(article);
    }, 500);
  };

  const cancelLongPress = () => {
    clearTimeout(lpTimerRef.current);
  };

  return (
    <Card
      onClick={() => {
        // Nach Long-Press den regulären Tap unterdrücken
        if (lpFiredRef.current) { lpFiredRef.current = false; return; }
        onTap(article);
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerMove={(e) => {
        const st = lpStartRef.current;
        if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) cancelLongPress();
      }}
      onPointerCancel={cancelLongPress}
      onContextMenu={(e) => e.preventDefault()} // Browser-Kontextmenü bei Long-Touch unterdrücken
      sx={{
        height: '100%', display: 'flex', flexDirection: 'column', cursor: 'pointer', position: 'relative',
        border: '2px solid', borderColor: qtyInLines > 0 ? 'primary.main' : 'divider',
        transition: 'transform .15s, box-shadow .15s',
        '&:hover': { transform: 'scale(1.02)', boxShadow: 6, zIndex: 2 },
        '&:active': { transform: 'scale(0.98)' },
        userSelect: 'none',
      }}
    >
      <Box sx={{ height: { xs: 120, sm: 140 }, background: TILE_FALLBACK, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        {article.imageMedium || article.imageSmall ? (
          <Box component="img" src={article.imageMedium || article.imageSmall} alt={article.name} loading="lazy"
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <LocalBar sx={{ fontSize: 56, color: 'rgba(255,255,255,0.25)' }} />
        )}
        {showPrice ? (
          <Box sx={{ position: 'absolute', bottom: 0, right: 0, bgcolor: 'rgba(0,0,0,0.85)', color: '#fff', px: 1.25, py: 0.4, borderTopLeftRadius: 8, fontWeight: 900, fontSize: '1.05rem' }}>
            {money(article.price)}
          </Box>
        ) : crate ? (
          <Box sx={{ position: 'absolute', bottom: 0, right: 0, bgcolor: 'rgba(0,0,0,0.75)', color: '#fff', px: 1, py: 0.4, borderTopLeftRadius: 8, fontWeight: 700, fontSize: '0.75rem' }}>
            1 {article.purchaseUnit} = {qty(article.unitsPerPurchase, article.unit)}
          </Box>
        ) : null}
        {qtyInLines > 0 && (
          <Box sx={{
            position: 'absolute', top: 8, right: 8, minWidth: 32, height: 32, px: 0.75, borderRadius: 16,
            bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, boxShadow: 3, border: '2px solid', borderColor: 'background.paper',
          }}>
            {qtyInLines}
          </Box>
        )}
      </Box>
      <CardContent sx={{ p: 1.5, display: 'flex', flexDirection: 'column', flex: 1, gap: 0.75, '&:last-child': { pb: 1.5 } }}>
        <Typography fontWeight={700} sx={{ lineHeight: 1.2, fontSize: '1rem', wordBreak: 'break-word' }}>{article.name}</Typography>
        <Box sx={{ mt: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {showStock && (article.stock <= 0
            ? <Chip size="small" color="error" label="Leer" sx={{ fontWeight: 'bold' }} />
            : <Typography variant="caption" color="text.secondary">Bestand: {qty(article.stock, article.unit)}</Typography>)}
        </Box>
        {crate && (
          <Button
            size="small" variant="outlined" color="primary" fullWidth
            onClick={(e) => { e.stopPropagation(); onCrate(article); }}
            sx={{ borderColor: alpha(theme.palette.primary.main, 0.5), fontWeight: 700, py: 0.75, fontSize: '0.8rem', lineHeight: 1.2 }}
          >
            +1 {article.purchaseUnit} ({article.unitsPerPurchase} {unitShort(article.unit)})
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Preisfeld ------------------------------ */

function PriceField({ value, onChange }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? num(value).toFixed(2).replace('.', ',');
  return (
    <TextField
      size="small" label="Einzelpreis" inputMode="decimal"
      value={shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) onChange(num(draft)); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment> }}
      sx={{ width: 120 }}
    />
  );
}

/* ------------------------------- Zeile -------------------------------- */

function LineRow({ line, showCrates, showPrice, editablePrice, allowFreeLines, update }) {
  const crate = showCrates && !line.isFree && hasCrate(line);
  const total = lineTotalQty(line);
  const deleteAtOne = !crate || line.crateQty === 0;

  return (
    <Box sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {line.isFree && allowFreeLines ? (
            <TextField size="small" fullWidth placeholder="Beschreibung" value={line.name} autoFocus={!line.name}
              onChange={(e) => update((prev) => setLineName(prev, line.key, e.target.value))} />
          ) : (
            <Typography fontWeight={700} sx={{ lineHeight: 1.25 }}>{line.name}</Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {crate ? describeLineQty(line) : qty(total, line.unit)}
            {showPrice && <> · {money(line.price)} / {unitLabel(line.unit, 1)} · Summe {money(lineAmount(line))}</>}
          </Typography>
        </Box>
        {crate && (
          <IconButton size="small" aria-label="Position entfernen" onClick={() => update((prev) => removeLine(prev, line.key))} sx={{ color: 'text.secondary' }}>
            <DeleteOutline fontSize="small" />
          </IconButton>
        )}
      </Stack>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <QuantityStepper
          value={line.baseQty} unit={line.unit} deleteAtOne={deleteAtOne}
          onDelta={(d) => update((prev) => adjustLine(prev, line.key, { baseDelta: d }))}
          onSet={(v) => update((prev) => setLineQty(prev, line.key, { baseQty: v }))}
        />
        {crate && (
          <QuantityStepper
            value={line.crateQty} unit={line.purchaseUnit}
            onDelta={(d) => update((prev) => adjustLine(prev, line.key, { crateDelta: d }))}
            onSet={(v) => update((prev) => setLineQty(prev, line.key, { crateQty: v }))}
          />
        )}
        {editablePrice && <PriceField value={line.price} onChange={(p) => update((prev) => setLinePrice(prev, line.key, p))} />}
      </Stack>
    </Box>
  );
}

/* ---------------------------- Artikel-Pane ---------------------------- */

export function ArticlePane({ articles, lines, showPrice, showStock, showCrates, onTap, onCrate, onLongPress }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const categories = useMemo(() => ['all', ...new Set(articles.map((a) => a.category).filter(Boolean))], [articles]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return articles.filter((a) => (category === 'all' || a.category === category) && (!s || a.name.toLowerCase().includes(s)));
  }, [articles, search, category]);
  const qtyByArticle = useMemo(() => {
    const m = new Map();
    for (const l of lines) if (l.articleId && !l.isFree) m.set(l.articleId, (m.get(l.articleId) || 0) + lineTotalQty(l));
    return m;
  }, [lines]);

  return (
    <Card sx={paneSx}>
      <Box sx={{ p: { xs: 1.5, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider' }}>
        <TextField placeholder="Artikel suchen…" size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} />
        <Tabs value={categories.includes(category) ? category : 'all'} onChange={(e, v) => setCategory(v)} variant="scrollable" scrollButtons="auto"
          sx={{ mt: 1, minHeight: 44, '& .MuiTab-root': { minHeight: 44, fontWeight: 600 } }}>
          {categories.map((c) => <Tab key={c} value={c} label={c === 'all' ? 'Alle' : c} />)}
        </Tabs>
      </Box>
      <Box sx={{ p: { xs: 1.5, sm: 2 }, overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 6, opacity: 0.5 }}>
            <Inventory2Outlined sx={{ fontSize: 56, mb: 1 }} />
            <Typography>Keine Artikel gefunden</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: { xs: 1.5, sm: 2 }, pb: 2 }}>
            {filtered.map((a) => (
              <ArticleTile key={a.id} article={a} qtyInLines={qtyByArticle.get(a.id) || 0}
                showPrice={showPrice} showStock={showStock} showCrates={showCrates}
                onTap={onTap} onCrate={onCrate} onLongPress={onLongPress} />
            ))}
          </Box>
        )}
      </Box>
    </Card>
  );
}

/* --------------------------- Positionen-Pane -------------------------- */

/**
 * Zeigt die Positionsliste. Im Verkaufsmodus (mode="sale") werden die Zeilen
 * mit SwipeableLine umschlossen; onSwipeRemove(key) wird beim Herauswischen aufgerufen.
 */
export function LinesPane({ lines, update, title, mode, showCrates, showPrice, editablePrice, allowFreeLines, header, footer, emptyText, showSummary, onSwipeRemove }) {
  return (
    <Card sx={paneSx}>
      <CardContent sx={{ p: 2, flex: 1, overflowY: 'auto', '&:last-child': { pb: 2 } }}>
        {header}
        <Typography variant="h6" sx={{ mb: 1, fontWeight: 800, display: 'flex', alignItems: 'center' }}>
          <ShoppingCart sx={{ mr: 1 }} /> {title}
        </Typography>
        {lines.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 6, opacity: 0.4 }}>
            <ShoppingCart sx={{ fontSize: 64, mb: 1 }} />
            <Typography variant="h6">{emptyText}</Typography>
          </Box>
        ) : (
          lines.map((l) => {
            const row = (
              <LineRow key={l.key} line={l} showCrates={showCrates} showPrice={showPrice}
                editablePrice={editablePrice} allowFreeLines={allowFreeLines} update={update} />
            );
            // Verkauf: Zeile in wischbaren Wrapper hüllen
            return mode === 'sale' ? (
              <SwipeableLine key={l.key} onRemove={() => onSwipeRemove(l.key)}>
                {row}
              </SwipeableLine>
            ) : row;
          })
        )}
        {allowFreeLines && (
          <Button variant="outlined" startIcon={<Add />} onClick={() => update((prev) => addFreeLine(prev))} sx={{ mt: 2 }}>
            Freie Zeile
          </Button>
        )}
        {showSummary && lines.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'right' }}>
            {lines.length} {lines.length === 1 ? 'Position' : 'Positionen'} · {linesTotalQty(lines)} Einheiten
          </Typography>
        )}
      </CardContent>
      {footer && (
        <Box sx={{ p: 2, bgcolor: 'background.default', borderTop: '1px solid', borderColor: 'divider' }}>
          {footer}
        </Box>
      )}
    </Card>
  );
}

/* ------------------------------ Shell --------------------------------- */

export default function ArticleLinePicker({
  mode = 'sale',
  lines,
  onChange,
  articles: articlesProp,
  showCrates = mode !== 'sale',
  showPrice = mode !== 'purchase',
  editablePrice = mode === 'invoice',
  allowFreeLines = mode === 'invoice',
  showStock = mode !== 'purchase',
  sidebar,
  sidebarLabel = 'Kunden',
  linesLabel = mode === 'sale' ? 'Warenkorb' : 'Positionen',
  linesHeader,
  linesFooter,
  emptyText = mode === 'sale' ? 'Leer' : 'Noch keine Positionen',
  mobileTab: mobileTabProp,
  onMobileTabChange,
  columns = { md: '280px 1fr 300px', lg: '340px 1fr 340px' },
  height = '100%',
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { articles: loaded } = useArticles();
  const articles = articlesProp || loaded;

  const [innerTab, setInnerTab] = useState(1);
  const mobileTab = mobileTabProp ?? innerTab;
  const setMobileTab = (v) => { setInnerTab(v); onMobileTabChange?.(v); };

  /* ---- Undo-Zustand für Zeilenlöschungen im Verkauf ---- */
  // undoRef speichert die zuletzt gelöschte Zeile außerhalb von React-State,
  // damit handleUndo immer die aktuellsten Daten liest.
  const undoRef = useRef(null); // { line, index } | null
  const [undoName, setUndoName] = useState(null); // Artikelname für Snackbar-Text

  /**
   * Wrapper um onChange: erkennt im Verkaufsmodus, wenn eine Zeile entfernt
   * wurde, und speichert sie für die Rückgängig-Aktion.
   */
  const update = (updater) => {
    if (mode !== 'sale') {
      onChange(updater);
      return;
    }
    // Updater-Funktion umhüllen, um Vorher-/Nachher-Vergleich zu ermöglichen
    onChange((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (Array.isArray(next) && next.length < prev.length) {
        // Genau eine Zeile entfernt → für Rückgängig merken
        const removed = prev.find((l) => !next.some((n) => n.key === l.key));
        if (removed) {
          const idx = prev.indexOf(removed);
          undoRef.current = { line: removed, index: idx };
          // State-Update außerhalb des laufenden Renders planen
          setTimeout(() => setUndoName(removed.name), 0);
        }
      }
      return next;
    });
  };

  const handleSwipeRemove = (key) => update((prev) => removeLine(prev, key));

  /** Rückgängig: letzte gelöschte Zeile an ursprünglicher Position wiederherstellen */
  const handleUndo = () => {
    const u = undoRef.current;
    if (!u) return;
    onChange((prev) => {
      const next = [...prev];
      // An ursprünglicher Position einfügen (ggf. am Ende, wenn Liste kürzer)
      next.splice(Math.min(u.index, next.length), 0, u.line);
      return next;
    });
    undoRef.current = null;
    setUndoName(null);
  };

  const handleUndoClose = () => {
    undoRef.current = null;
    setUndoName(null);
  };

  /* ---- Long-Press-Dialog (Verkauf) ---- */
  const [lpDialog, setLpDialog] = useState(null); // { article } | null
  const [lpQty, setLpQty] = useState(1);

  // onLongPress nur im Verkauf übergeben
  const onLongPress = mode === 'sale'
    ? (article) => { setLpQty(1); setLpDialog({ article }); }
    : undefined;

  const confirmLongPress = () => {
    if (!lpDialog) return;
    update((prev) => addArticle(prev, lpDialog.article, { units: lpQty }));
    setLpDialog(null);
  };

  /* ---- Artikel-Interaktionen ---- */
  const onTap = (a) => update((prev) => addArticle(prev, a, { units: 1 }));
  const onCrate = (a) => update((prev) => addArticle(prev, a, { units: 0, crates: 1 }));

  const badge = mode === 'sale' ? linesTotalQty(lines) : lines.length;
  const hasSidebar = Boolean(sidebar);
  const tabIndex = (i) => (hasSidebar ? i : i - 1); // ohne Sidebar: Artikel=0, Positionen=1
  const show = (i) => !isMobile || mobileTab === tabIndex(i);

  const gridCols = hasSidebar ? columns : { md: `1fr ${columns.md.split(' ').pop()}`, lg: `1fr ${columns.lg.split(' ').pop()}` };

  return (
    <>
      <Box sx={{ height, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {isMobile && (
          <Tabs value={mobileTab} onChange={(e, v) => setMobileTab(v)} variant="fullWidth" indicatorColor="primary" textColor="primary"
            sx={{ mb: 1.5, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 1, flexShrink: 0, '& .MuiTab-root': { fontWeight: 700 } }}>
            {hasSidebar && <Tab label={sidebarLabel} />}
            <Tab label="Artikel" />
            <Tab label={`${linesLabel} (${badge})`} />
          </Tabs>
        )}
        <Box sx={{ flex: 1, minHeight: 0, display: isMobile ? 'block' : 'grid', gap: 2, gridTemplateColumns: gridCols, overflow: 'hidden' }}>
          {hasSidebar && (
            <Box sx={{ display: show(0) ? 'block' : 'none', height: '100%', overflow: 'hidden' }}>{sidebar}</Box>
          )}
          <Box sx={{ display: show(1) ? 'block' : 'none', height: '100%', overflow: 'hidden' }}>
            <ArticlePane articles={articles} lines={lines} showPrice={showPrice} showStock={showStock}
              showCrates={showCrates} onTap={onTap} onCrate={onCrate} onLongPress={onLongPress} />
          </Box>
          <Box sx={{ display: show(2) ? 'block' : 'none', height: '100%', overflow: 'hidden' }}>
            <LinesPane
              lines={lines} update={update} title={linesLabel} mode={mode}
              showCrates={showCrates} showPrice={showPrice} editablePrice={editablePrice} allowFreeLines={allowFreeLines}
              header={linesHeader} footer={linesFooter} emptyText={emptyText}
              showSummary={mode !== 'sale'}
              onSwipeRemove={handleSwipeRemove}
            />
          </Box>
        </Box>
      </Box>

      {/* Rückgängig-Snackbar – oben mittig, damit der Kassenbereich unten frei bleibt */}
      <Snackbar
        open={Boolean(undoName)}
        autoHideDuration={5000}
        onClose={handleUndoClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        message={undoName ? `${undoName} entfernt` : ''}
        action={
          <Button color="inherit" size="small" onClick={handleUndo} sx={{ fontWeight: 800 }}>
            RÜCKGÄNGIG
          </Button>
        }
        sx={{ top: { xs: 72, sm: 80 } }} // unter der mobilen Tab-Leiste platzieren
      />

      {/* Long-Press-Mengenauswahl (Verkauf, Touch) */}
      <Dialog
        open={Boolean(lpDialog)}
        onClose={() => setLpDialog(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, p: 1 } }}
      >
        <DialogTitle sx={{ textAlign: 'center', fontWeight: 800, pb: 0 }}>
          {lpDialog?.article.name}
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', py: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Menge wählen
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <QuantityStepper
              value={lpQty}
              unit={lpDialog?.article.unit}
              min={1}
              onDelta={(d) => setLpQty((v) => Math.max(1, v + d))}
              onSet={(v) => setLpQty(Math.max(1, v))}
            />
          </Box>
          {lpDialog?.article.price > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Gesamt: {money(lpQty * num(lpDialog.article.price))}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 2, px: 2, gap: 1 }}>
          <Button onClick={() => setLpDialog(null)} color="inherit" fullWidth>Abbrechen</Button>
          <Button variant="contained" onClick={confirmLongPress} fullWidth sx={{ fontWeight: 800 }}>
            In den Warenkorb
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
