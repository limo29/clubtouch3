// Einstellungen der Getränkekarte im Slide-Editor: Spalten, Preisfarbe, einzelne Getränke ausblenden und
// mehrere Sorten zu einer Zeile zusammenfassen (z. B. alle Frucade-Sorten).
// Gespeichert wird am Element: columns (1|2), priceColor, hidden [Artikel-ID], groups [{ id, label, articleIds }].
import React from 'react';
import {
    Autocomplete, Box, Button, Checkbox, Chip, IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AddIcon from '@mui/icons-material/Add';
import { SLIDE_COLORS } from './slideTemplates';

const PRICE_COLORS = [
    { value: '', label: 'wie Text' },
    { value: SLIDE_COLORS.green, label: 'Grün' },
    { value: SLIDE_COLORS.amber, label: 'Gelb' },
    { value: SLIDE_COLORS.red, label: 'Rot' },
];

const Label = ({ children }) => (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>{children}</Typography>
);

/** Vorschlag: Artikel mit gleichem ersten Wort und gleichem Preis (ab drei Sorten) werden eine Gruppe. */
export function suggestGroups(articles) {
    const buckets = new Map();
    articles.forEach((a) => {
        const first = a.name.trim().split(/\s+/)[0];
        const key = `${first.toLowerCase()}|${Number(a.price).toFixed(2)}`;
        if (!buckets.has(key)) buckets.set(key, { label: first, ids: [] });
        buckets.get(key).ids.push(a.id);
    });
    return [...buckets.values()].filter((b) => b.ids.length >= 3)
        .map((b, i) => ({ id: `g${Date.now()}${i}`, label: b.label, articleIds: b.ids }));
}

export default function MenuOptions({ element, articles, onChange }) {
    const hidden = element.hidden || [];
    const groups = element.groups || [];
    const grouped = new Map();
    groups.forEach((g) => (g.articleIds || []).forEach((id) => grouped.set(id, g)));

    const toggleHidden = (id) => onChange({ hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
    const setGroups = (next) => onChange({ groups: next });
    const patchGroup = (id, patch) => setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    // Ein Artikel gehört zu höchstens einer Gruppe: beim Zuordnen aus den anderen entfernen
    const setMembers = (id, ids) => setGroups(groups.map((g) => (g.id === id
        ? { ...g, articleIds: ids }
        : { ...g, articleIds: (g.articleIds || []).filter((x) => !ids.includes(x)) })));
    const suggestion = suggestGroups(articles.filter((a) => !grouped.has(a.id)));

    return (
        <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
                <Box>
                    <Label>Spalten</Label>
                    <ToggleButtonGroup size="small" exclusive value={Number(element.columns) === 2 ? 2 : 1}
                        onChange={(_, v) => v && onChange({ columns: v })}>
                        <ToggleButton value={1} sx={{ px: 2 }}>1</ToggleButton>
                        <ToggleButton value={2} sx={{ px: 2 }}>2</ToggleButton>
                    </ToggleButtonGroup>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                    <Label>Preisfarbe</Label>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {PRICE_COLORS.map((c) => (
                            <Chip key={c.label} size="small" label={c.label} onClick={() => onChange({ priceColor: c.value })}
                                variant={(element.priceColor || '') === c.value ? 'filled' : 'outlined'}
                                sx={c.value ? { borderColor: c.value, ...((element.priceColor || '') === c.value && { bgcolor: c.value, color: '#000' }) } : undefined} />
                        ))}
                    </Stack>
                </Box>
            </Stack>

            <Box>
                <Label>Zusammenfassen (eine Zeile für mehrere Sorten)</Label>
                <Stack spacing={1.5}>
                    {groups.map((g) => (
                        <Box key={g.id} sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                <TextField size="small" label="Name auf der Karte" value={g.label} fullWidth
                                    onChange={(e) => patchGroup(g.id, { label: e.target.value })} />
                                <IconButton size="small" aria-label="Gruppe auflösen" onClick={() => setGroups(groups.filter((x) => x.id !== g.id))}>
                                    <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                            </Stack>
                            <Autocomplete multiple size="small" disableCloseOnSelect
                                options={articles} getOptionLabel={(a) => a.name}
                                isOptionEqualToValue={(a, b) => a.id === b.id}
                                value={articles.filter((a) => (g.articleIds || []).includes(a.id))}
                                onChange={(_, v) => setMembers(g.id, v.map((a) => a.id))}
                                renderInput={(params) => <TextField {...params} label="Sorten" placeholder="Getränk wählen" />} />
                        </Box>
                    ))}
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Button size="small" startIcon={<AddIcon />} onClick={() => setGroups([...groups, { id: `g${Date.now()}`, label: '', articleIds: [] }])}>
                            Gruppe
                        </Button>
                        {suggestion.length > 0 && (
                            <Button size="small" startIcon={<AutoAwesomeIcon />} onClick={() => setGroups([...groups, ...suggestion])}>
                                Vorschlag: {suggestion.map((g) => g.label).join(', ')}
                            </Button>
                        )}
                    </Stack>
                </Stack>
            </Box>

            <Box>
                <Label>Auf der Karte zeigen ({articles.length - articles.filter((a) => hidden.includes(a.id)).length} von {articles.length})</Label>
                <Box sx={{ maxHeight: 260, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                    {articles.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>Keine aktiven Artikel in dieser Kategorie.</Typography>}
                    {articles.map((a) => (
                        <Box key={a.id} component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                            <Checkbox size="small" checked={!hidden.includes(a.id)} onChange={() => toggleHidden(a.id)} />
                            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, opacity: hidden.includes(a.id) ? 0.45 : 1 }} noWrap>{a.name}</Typography>
                            {grouped.has(a.id) && <Chip size="small" variant="outlined" label={grouped.get(a.id).label || 'Gruppe'} />}
                        </Box>
                    ))}
                </Box>
            </Box>
        </Stack>
    );
}
