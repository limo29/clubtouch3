/**
 * Reihenfolge von Kategorien und Artikeln – genau so, wie sie im Verkauf erscheint.
 * Ziehen nur am Griff (senkrecht), alternativ Pfeiltasten: auf dem Handy zuverlässiger als Drag & Drop.
 * Jede Änderung wird sofort gespeichert (optimistisch, bei Fehler wird neu geladen).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Box, Card, Chip, IconButton, Snackbar, Stack, Typography } from '@mui/material';
import { ArrowDownward, ArrowUpward, DragIndicator, LocalBar, ViewModuleOutlined } from '@mui/icons-material';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../config/api';
import { ARTICLES_QUERY_KEY } from '../../hooks/useArticles';
import { ALL_TAB, CATEGORIES_QUERY_KEY } from '../../hooks/useArticleCategories';

const restrictToVertical = ({ transform }) => ({ ...transform, x: 0 });

function SortRow({ id, index, count, onMove, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <Box ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, minHeight: 60, position: 'relative',
        bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' },
        zIndex: isDragging ? 2 : 'auto', boxShadow: isDragging ? 8 : 'none', borderRadius: isDragging ? 2 : 0,
      }}>
      <IconButton ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Ziehen zum Verschieben"
        sx={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab', color: 'text.secondary' }}>
        <DragIndicator />
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.5 }}>{children}</Box>
      <IconButton aria-label="Nach oben" disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUpward fontSize="small" /></IconButton>
      <IconButton aria-label="Nach unten" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}><ArrowDownward fontSize="small" /></IconButton>
    </Box>
  );
}

function SortList({ ids, onReorder, renderItem }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 80, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const move = (from, to) => { if (to >= 0 && to < ids.length && from !== to) onReorder(arrayMove(ids, from, to)); };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVertical]}
      onDragEnd={({ active, over }) => over && move(ids.indexOf(active.id), ids.indexOf(over.id))}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((id, i) => (
          <SortRow key={id} id={id} index={i} count={ids.length} onMove={move}>{renderItem(id, i)}</SortRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

const SectionTitle = ({ title, hint }) => (
  <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
    <Typography variant="h6" sx={{ fontSize: '1.05rem' }}>{title}</Typography>
    {hint && <Typography variant="body2" color="text.secondary">{hint}</Typography>}
  </Box>
);

/**
 * @param {{ articles: Array, tabs: string[] }} props  articles: alle Artikel nach `order`; tabs: Reiter vom Server inkl. ALL_TAB
 */
export default function ArticleSortView({ articles, tabs: serverTabs }) {
  const queryClient = useQueryClient();
  const [tabs, setTabs] = useState(serverTabs);
  const cats = tabs.filter((n) => n !== ALL_TAB);
  const [byCat, setByCat] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => setTabs(serverTabs), [serverTabs]);
  useEffect(() => {
    const m = {};
    for (const a of articles) (m[a.category] ||= []).push(a.id);
    setByCat(m);
  }, [articles]);

  const byId = new Map(articles.map((a) => [a.id, a]));
  const onError = () => {
    setToast({ severity: 'error', text: 'Speichern fehlgeschlagen – Reihenfolge neu geladen' });
    queryClient.invalidateQueries({ queryKey: ['articles'] });
  };
  const saved = () => setToast({ severity: 'success', text: 'Reihenfolge gespeichert' });

  // Speichern strikt nacheinander: sonst kann eine langsame ältere Anfrage eine neuere überschreiben
  const queue = useRef(Promise.resolve());
  const enqueue = (fn) => {
    const run = queue.current.then(fn);
    queue.current = run.catch(() => {});
    return run.then(saved, onError);
  };

  const reorderCategories = (next) => {
    setTabs(next);
    const names = next.filter((n) => n !== ALL_TAB);
    queryClient.setQueryData(CATEGORIES_QUERY_KEY, (old) => ({
      categories: names.map((n) => old?.categories?.find((c) => c.name === n) || { name: n }),
      tabs: next,
    }));
    enqueue(() => api.put(`${API_ENDPOINTS.ARTICLES}/categories/order`, { order: next }));
  };

  // Artikel bekommen eine durchgehende Nummer: Kategorie für Kategorie, so wie sie im Verkauf stehen.
  // Gesendet werden nur Artikel, deren Nummer sich wirklich ändert.
  const reorderArticles = (cat, ids) => {
    const next = { ...byCat, [cat]: ids };
    setByCat(next);
    let n = 0;
    const changed = [];
    for (const c of [...cats, ...Object.keys(next).filter((k) => !cats.includes(k))]) {
      for (const id of next[c] || []) {
        n += 1;
        if (byId.get(id)?.order !== n) changed.push({ id, order: n });
      }
    }
    if (!changed.length) return;
    const pos = new Map(changed.map((i) => [i.id, i.order]));
    queryClient.setQueryData(ARTICLES_QUERY_KEY, (old = []) =>
      [...old].map((a) => ({ ...a, order: pos.get(a.id) ?? a.order })).sort((a, b) => a.order - b.order));
    enqueue(() => api.put(`${API_ENDPOINTS.ARTICLES}/reorder`, { items: changed }));
  };

  const thumb = (a) => (
    <Avatar variant="rounded" src={a.imageThumbnail || a.imageSmall || undefined}
      sx={{ width: 44, height: 44, background: 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)' }}>
      <LocalBar sx={{ color: 'rgba(255,255,255,0.5)' }} />
    </Avatar>
  );

  return (
    <Stack spacing={2}>
      <Card>
        <SectionTitle title="Reiter im Verkauf" hint="Der oberste Reiter ist beim Öffnen ausgewählt. „Alles“ zeigt alle Artikel und steht standardmäßig am Ende." />
        <SortList ids={tabs} onReorder={reorderCategories}
          renderItem={(name, i) => (
            <>
              {name === ALL_TAB ? (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                  <ViewModuleOutlined fontSize="small" sx={{ color: 'text.secondary' }} />
                  <Typography fontWeight={700} noWrap>Alles</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>alle Artikel</Typography>
                </Stack>
              ) : (
                <Typography fontWeight={700} noWrap sx={{ flex: 1, minWidth: 0 }}>{name}</Typography>
              )}
              {i === 0 && <Chip size="small" color="primary" variant="outlined" label="Start" />}
              <Chip size="small" label={name === ALL_TAB ? articles.length : (byCat[name] || []).length} />
            </>
          )} />
      </Card>

      {cats.map((cat) => (
        <Card key={cat}>
          <SectionTitle title={cat} />
          <SortList ids={byCat[cat] || []} onReorder={(ids) => reorderArticles(cat, ids)}
            renderItem={(id) => {
              const a = byId.get(id);
              if (!a) return null;
              return (
                <>
                  {thumb(a)}
                  <Box sx={{ minWidth: 0, flex: 1, opacity: a.active ? 1 : 0.55 }}>
                    <Typography fontWeight={700} noWrap>{a.name}</Typography>
                    {!a.active && <Typography variant="caption" color="text.secondary">inaktiv – nicht im Verkauf</Typography>}
                  </Box>
                </>
              );
            }} />
        </Card>
      ))}

      <Snackbar open={!!toast} autoHideDuration={toast?.severity === 'error' ? 5000 : 1500} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.text}</Alert> : <span />}
      </Snackbar>
    </Stack>
  );
}
