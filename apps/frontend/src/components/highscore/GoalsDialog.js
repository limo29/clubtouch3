import React, { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, FormControlLabel, IconButton, InputAdornment, InputLabel, ListItemIcon, ListItemText, Menu, MenuItem,
  Paper, Select, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import api from '../../services/api';
import GroupBadge from '../customers/GroupBadge';
import useArticles from '../../hooks/useArticles';
import { num, unitLabel } from '../../utils/format';
import { crateFactor, fromBaseUnits, toBaseUnits } from '../../utils/units';

export const MAX_GOALS = 6;
const TEMPLATES_KEY = ['clubscore-goal-templates'];
const KIND_LABELS = { ARTICLE: 'Artikel', CATEGORY: 'Kategorie', REVENUE: 'Tagesumsatz' };

let seq = 0;
const newKey = () => `g${Date.now().toString(36)}${(seq += 1)}`;

/** Fehlertext aus der API (inkl. Validierungsdetails) */
export const goalsApiError = (err, fallback) => {
  const d = err?.response?.data;
  const details = Array.isArray(d?.details) ? d.details.map((x) => x.msg || x.message).filter(Boolean) : [];
  if (details.length) return details.join(' · ');
  return d?.error || err?.message || fallback;
};

/** Gespeichertes Ziel → Formularzeile */
const toRow = (g) => {
  const target = num(g.target ?? g.targetUnits);
  const factor = Math.max(1, num(g.unitsPerPurchase) || 1);
  const { crateQty, baseQty } = fromBaseUnits(target, factor);
  const kind = g.kind || 'ARTICLE';
  return {
    key: g.id || newKey(),
    id: g.id || undefined,
    kind,
    articleId: g.articleId || null,
    category: g.category || '',
    groupId: g.groupId || '',
    crates: kind === 'ARTICLE' && crateQty ? String(crateQty) : '',
    singles: kind === 'ARTICLE' && baseQty ? String(baseQty) : '',
    qty: kind === 'CATEGORY' && target ? String(target) : '',
    amount: kind === 'REVENUE' && target ? String(target).replace('.', ',') : '',
    label: g.label || '',
  };
};

const emptyRow = (kind = 'ARTICLE') => ({ ...toRow({ kind, target: 0 }), key: newKey(), id: undefined });

const parseNum = (s) => {
  const n = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const defaultLabel = (row, article) => {
  if (row.kind === 'ARTICLE') return article?.name || 'Artikel';
  if (row.kind === 'CATEGORY') return row.category || 'Kategorie';
  return 'Tagesumsatz';
};

const rowTarget = (row, article) => {
  if (row.kind === 'ARTICLE') {
    return toBaseUnits(Math.floor(parseNum(row.crates)), Math.floor(parseNum(row.singles)), crateFactor(article));
  }
  if (row.kind === 'CATEGORY') return Math.floor(parseNum(row.qty));
  return Math.round(parseNum(row.amount) * 100) / 100;
};

const rowKey = (r) => [
  r.kind,
  r.kind === 'ARTICLE' ? r.articleId : '',
  r.kind === 'CATEGORY' ? r.category.trim().toLowerCase() : '',
  r.groupId || '',
].join('|');

/** Eine Zielzeile */
function GoalRow({ row, index, articles, categories, groups, onChange, onRemove, disabled }) {
  const article = articles.find((a) => a.id === row.articleId) || null;
  const factor = crateFactor(article);
  const set = (patch) => onChange(row.key, patch);
  const target = rowTarget(row, article);
  const unit = article?.unit || 'Stück';
  const purchaseUnit = article?.purchaseUnit || 'Kiste';

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>Ziel {index + 1}</Typography>
          <ToggleButtonGroup exclusive size="small" value={row.kind} disabled={disabled}
            sx={{ order: { xs: 3, sm: 0 }, width: { xs: '100%', sm: 'auto' }, '& .MuiToggleButton-root': { flex: { xs: 1, sm: 'none' } } }}
            onChange={(_, v) => v && set({ kind: v })} aria-label={`Zieltyp für Ziel ${index + 1}`}>
            {Object.entries(KIND_LABELS).map(([k, l]) => <ToggleButton key={k} value={k}>{l}</ToggleButton>)}
          </ToggleButtonGroup>
          <Tooltip title="Ziel entfernen">
            <span>
              <IconButton onClick={() => onRemove(row.key)} disabled={disabled} aria-label={`Ziel ${index + 1} entfernen`} size="small">
                <DeleteOutlineIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {row.kind === 'ARTICLE' && (
            <Autocomplete
              sx={{ flex: 2, minWidth: 0 }}
              options={articles}
              value={article}
              disabled={disabled}
              onChange={(_, a) => set({ articleId: a?.id || null })}
              getOptionLabel={(a) => a?.name || ''}
              groupBy={(a) => a.category || 'Ohne Kategorie'}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(p) => <TextField {...p} label="Artikel" required size="small" />}
              noOptionsText="Kein aktiver Artikel gefunden"
            />
          )}
          {row.kind === 'CATEGORY' && (
            <FormControl size="small" sx={{ flex: 2, minWidth: 0 }} required disabled={disabled}>
              <InputLabel>Kategorie</InputLabel>
              <Select label="Kategorie" value={categories.includes(row.category) ? row.category : ''}
                onChange={(e) => set({ category: e.target.value })}>
                {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          {row.kind === 'REVENUE' && (
            <Typography variant="body2" color="text.secondary" sx={{ flex: 2, alignSelf: 'center' }}>
              Umsatz aller Verkäufe des Tages (ab 06:00).
            </Typography>
          )}
          <FormControl size="small" sx={{ flex: 1, minWidth: 160 }} disabled={disabled}>
            <InputLabel shrink>Team</InputLabel>
            <Select label="Team" notched displayEmpty
              value={groups.some((g) => g.id === row.groupId) ? row.groupId : ''}
              onChange={(e) => set({ groupId: e.target.value })}
              renderValue={(v) => {
                const g = groups.find((x) => x.id === v);
                if (!g) return 'Alle';
                return (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <GroupBadge group={g} size={20} tooltip={false} /><span>{g.name}</span>
                  </Stack>
                );
              }}>
              <MenuItem value="">Alle (ohne Team)</MenuItem>
              {groups.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  <ListItemIcon><GroupBadge group={g} size={22} tooltip={false} /></ListItemIcon>
                  <ListItemText primary={g.name} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
          {row.kind === 'ARTICLE' && factor > 1 && (
            <TextField size="small" type="number" label={unitLabel(purchaseUnit, 2)} value={row.crates} disabled={disabled}
              onChange={(e) => set({ crates: e.target.value })} inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
              helperText={`à ${factor} ${unitLabel(unit, factor)}`} sx={{ width: { sm: 130 } }} />
          )}
          {row.kind === 'ARTICLE' && (
            <TextField size="small" type="number" label={factor > 1 ? `+ einzelne ${unitLabel(unit, 2)}` : unitLabel(unit, 2)}
              value={row.singles} disabled={disabled} onChange={(e) => set({ singles: e.target.value })}
              inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
              helperText={target > 0 ? `Ziel: ${target} ${unitLabel(unit, target)}` : ' '} sx={{ width: { sm: 180 } }} />
          )}
          {row.kind === 'CATEGORY' && (
            <TextField size="small" type="number" label="Stück" value={row.qty} disabled={disabled}
              onChange={(e) => set({ qty: e.target.value })} inputProps={{ min: 1, step: 1, inputMode: 'numeric' }}
              helperText="alle Artikel der Kategorie zusammen" sx={{ width: { sm: 220 } }} />
          )}
          {row.kind === 'REVENUE' && (
            <TextField size="small" label="Betrag" value={row.amount} disabled={disabled}
              onChange={(e) => set({ amount: e.target.value })} inputProps={{ inputMode: 'decimal' }}
              InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment> }}
              helperText=" " sx={{ width: { sm: 160 } }} />
          )}
          <TextField size="small" label="Bezeichnung" value={row.label} disabled={disabled}
            onChange={(e) => set({ label: e.target.value.slice(0, 60) })}
            placeholder={defaultLabel(row, article)} InputLabelProps={{ shrink: true }}
            helperText="leer = Standardname" sx={{ flex: 1 }} />
        </Stack>
      </Stack>
    </Paper>
  );
}

/** Formularinhalt; wird bei jedem Öffnen neu eingehängt → Entwurf aus den aktuellen Zielen. */
function Body({ goalsProgress, canEdit, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const { articles, isLoading: articlesLoading } = useArticles({ activeOnly: true });
  const { data: groups = [] } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => (await api.get('/customer-groups')).data?.groups || [],
    staleTime: 60000,
  });
  const templatesQuery = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => (await api.get('/highscore/goal-templates')).data?.templates || [],
    staleTime: 30000,
  });
  const templates = templatesQuery.data || [];
  const activeGroups = useMemo(() => groups.filter((g) => g.active !== false), [groups]);
  const categories = useMemo(
    () => [...new Set(articles.map((a) => a.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de')),
    [articles]
  );

  const [rows, setRows] = useState(() => (goalsProgress?.goals || []).map(toRow));
  const [movingTargets, setMovingTargets] = useState(() => !!goalsProgress?.movingTargets);
  const [formError, setFormError] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplAnchor, setTplAnchor] = useState(null);
  const [tplMsg, setTplMsg] = useState(null);
  const listEnd = useRef(null);

  const change = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => {
    setRows((rs) => (rs.length >= MAX_GOALS ? rs : [...rs, emptyRow()]));
    setTimeout(() => listEnd.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }), 50);
  };

  /** Zeilen prüfen und in das API-Format bringen; wirft mit deutscher Meldung */
  const buildGoals = () => {
    const seen = new Set();
    return rows.map((r, i) => {
      const article = articles.find((a) => a.id === r.articleId);
      if (r.kind === 'ARTICLE' && !r.articleId) throw new Error(`Ziel ${i + 1}: bitte einen Artikel wählen.`);
      if (r.kind === 'CATEGORY' && !r.category) throw new Error(`Ziel ${i + 1}: bitte eine Kategorie wählen.`);
      const target = rowTarget(r, article);
      if (!(target > 0)) throw new Error(`Ziel ${i + 1}: Zielwert muss größer als 0 sein.`);
      const k = rowKey(r);
      if (seen.has(k)) throw new Error(`Ziel ${i + 1}: dieses Ziel gibt es schon.`);
      seen.add(k);
      return {
        ...(r.id ? { id: r.id } : {}),
        kind: r.kind,
        ...(r.kind === 'ARTICLE' ? { articleId: r.articleId } : {}),
        ...(r.kind === 'CATEGORY' ? { category: r.category } : {}),
        groupId: r.groupId || null,
        target,
        label: r.label.trim() || defaultLabel(r, article),
      };
    });
  };

  const save = useMutation({
    mutationFn: async (payload) => (await api.post('/highscore/goals-progress', payload)).data,
    onSuccess: (res) => { onSaved?.(res); onClose(); },
  });

  const saveTemplates = useMutation({
    mutationFn: async (list) => (await api.put('/highscore/goal-templates', { templates: list })).data,
    onSuccess: (res) => queryClient.setQueryData(TEMPLATES_KEY, res?.templates || []),
  });

  const submit = (e) => {
    e?.preventDefault?.();
    setFormError('');
    save.reset();
    try {
      save.mutate({ goals: buildGoals(), movingTargets });
    } catch (err) {
      setFormError(err.message);
    }
  };

  const saveAsTemplate = () => {
    setTplMsg(null);
    const name = tplName.trim();
    if (!name) return;
    let goals;
    try {
      goals = buildGoals().map(({ id, ...g }) => g);
    } catch (err) {
      setTplMsg({ severity: 'error', text: err.message });
      return;
    }
    const lower = name.toLowerCase();
    const exists = templates.some((t) => t.name.toLowerCase() === lower);
    const next = [...templates.filter((t) => t.name.toLowerCase() !== lower), { name, goals, movingTargets }];
    saveTemplates.mutate(next, {
      onSuccess: () => {
        setTplName('');
        setTplMsg({ severity: 'success', text: exists ? `Vorlage „${name}“ überschrieben.` : `Vorlage „${name}“ gespeichert.` });
      },
      onError: (err) => setTplMsg({ severity: 'error', text: goalsApiError(err, 'Vorlage konnte nicht gespeichert werden.') }),
    });
  };

  const loadTemplate = (t) => {
    setTplAnchor(null);
    setRows((t.goals || []).slice(0, MAX_GOALS).map((g) => {
      const a = articles.find((x) => x.id === g.articleId);
      const row = toRow({ ...g, id: undefined, unitsPerPurchase: g.unitsPerPurchase ?? crateFactor(a) });
      return { ...row, key: newKey(), id: undefined };
    }));
    setMovingTargets(!!t.movingTargets);
    setTplMsg({ severity: 'info', text: `Vorlage „${t.name}“ geladen – zum Übernehmen „Ziele speichern“.` });
  };

  const deleteTemplate = (t) => {
    saveTemplates.mutate(templates.filter((x) => x.name !== t.name), {
      onSuccess: () => setTplMsg({ severity: 'success', text: `Vorlage „${t.name}“ gelöscht.` }),
      onError: (err) => setTplMsg({ severity: 'error', text: goalsApiError(err, 'Vorlage konnte nicht gelöscht werden.') }),
    });
  };

  const disabled = !canEdit || save.isPending;
  const error = formError || (save.isError ? goalsApiError(save.error, 'Ziele konnten nicht gespeichert werden.') : '');

  return (
    <>
      <DialogTitle>Tagesziele</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {!canEdit && <Alert severity="info">Nur Admin und Kasse können die Ziele ändern.</Alert>}
          <Typography variant="body2" color="text.secondary">
            Ziele gelten für den laufenden Tag (ab 06:00) und erscheinen auf allen Clubscore-Bildschirmen. Höchstens {MAX_GOALS} Ziele.
          </Typography>

          {articlesLoading && <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={28} /></Box>}
          {!articlesLoading && rows.length === 0 && (
            <Alert severity="info" variant="outlined">Noch keine Ziele. Mit „Ziel hinzufügen“ geht es los.</Alert>
          )}
          {!articlesLoading && rows.map((r, i) => (
            <GoalRow key={r.key} row={r} index={i} articles={articles} categories={categories} groups={activeGroups}
              onChange={change} onRemove={remove} disabled={disabled} />
          ))}
          <div ref={listEnd} />
          <Box>
            <Button startIcon={<AddIcon />} onClick={add} disabled={disabled || rows.length >= MAX_GOALS || articlesLoading}>
              Ziel hinzufügen
            </Button>
            {rows.length >= MAX_GOALS && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>Maximal {MAX_GOALS} Ziele.</Typography>
            )}
          </Box>

          <Divider />
          <Box>
            <FormControlLabel disabled={disabled}
              control={<Switch checked={movingTargets} onChange={(e) => setMovingTargets(e.target.checked)} />}
              label="Mitwachsende Ziele" />
            <Typography variant="body2" color="text.secondary">
              Ist ein Ziel erreicht, beginnt sofort die nächste Stufe mit dem gleichen Abstand
              (z. B. 2 Kisten → 4 Kisten → 6 Kisten). Jede Stufe wird auf den Bildschirmen gefeiert.
            </Typography>
          </Box>

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>Vorlagen</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Button variant="outlined" startIcon={<FolderOpenOutlinedIcon />} disabled={disabled || templates.length === 0}
                onClick={(e) => setTplAnchor(e.currentTarget)} aria-haspopup="menu">
                Vorlage laden{templates.length ? ` (${templates.length})` : ''}
              </Button>
              <TextField size="small" label="Name der Vorlage" value={tplName} disabled={disabled}
                onChange={(e) => setTplName(e.target.value.slice(0, 60))} sx={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveAsTemplate(); } }} />
              <Button startIcon={saveTemplates.isPending ? <CircularProgress size={16} /> : <BookmarkAddOutlinedIcon />}
                disabled={disabled || !tplName.trim() || rows.length === 0 || saveTemplates.isPending} onClick={saveAsTemplate}>
                Als Vorlage speichern
              </Button>
            </Stack>
            {tplMsg && <Alert severity={tplMsg.severity} sx={{ mt: 1 }} onClose={() => setTplMsg(null)}>{tplMsg.text}</Alert>}
            <Menu anchorEl={tplAnchor} open={!!tplAnchor} onClose={() => setTplAnchor(null)}>
              {templates.map((t) => {
                const n = (t.goals || []).length;
                return (
                  <MenuItem key={t.name} onClick={() => loadTemplate(t)} sx={{ gap: 1 }}>
                    <ListItemText primary={t.name} secondary={`${n} ${n === 1 ? 'Ziel' : 'Ziele'}${t.movingTargets ? ' · mitwachsend' : ''}`} />
                    <IconButton size="small" edge="end" aria-label={`Vorlage ${t.name} löschen`}
                      onClick={(e) => { e.stopPropagation(); deleteTemplate(t); }}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </MenuItem>
                );
              })}
            </Menu>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>{canEdit ? 'Abbrechen' : 'Schließen'}</Button>
        {canEdit && (
          <Button type="submit" variant="contained" onClick={submit} disabled={save.isPending || articlesLoading}
            startIcon={save.isPending ? <CircularProgress size={16} color="inherit" /> : null}>
            {save.isPending ? 'Speichere…' : 'Ziele speichern'}
          </Button>
        )}
      </DialogActions>
    </>
  );
}

/** Tagesziele bearbeiten (Artikel, Kategorie oder Tagesumsatz; optional je Team). */
export default function GoalsDialog({ open, onClose, goalsProgress, canEdit, onSaved }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen}
      PaperProps={{ component: 'form', onSubmit: (e) => e.preventDefault() }}>
      {/* Modal hängt den Inhalt beim Schließen aus → Entwurf wird bei jedem Öffnen neu aufgebaut */}
      <Body goalsProgress={goalsProgress} canEdit={canEdit} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
