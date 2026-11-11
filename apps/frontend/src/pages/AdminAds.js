import React, { useState, useEffect, useCallback } from 'react';
import {
    Alert, Box, Button, Card, CardContent, CardMedia, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton,
    Stack, TextField, Typography, MenuItem, Select, FormControl, InputLabel,
    Grid, Switch, FormControlLabel, Divider, Tooltip, Snackbar, Chip, useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
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

import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import MovieIcon from '@mui/icons-material/Movie';
import ImageIcon from '@mui/icons-material/Image';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';

import UploadFileIcon from '@mui/icons-material/UploadFile';
import EditNoteIcon from '@mui/icons-material/EditNote';

import api from '../services/api';
import SlideEditor from '../components/admin/SlideEditor';
import DisplayPageBar, { BarButton } from '../components/display/DisplayPageBar';
import SlideRenderer from '../components/ads/SlideRenderer';

const MAX_UPLOAD_MB = 500;
const TRANSITIONS = [
    { value: 'FADE', label: 'Überblenden' },
    { value: 'SLIDE', label: 'Schieben' },
    { value: 'ZOOM', label: 'Zoom' },
    { value: 'NONE', label: 'Hart' },
];

const isVideo = (url) => {
    if (!url) return false;
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    return ['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(ext);
};

const safeParse = (data) => {
    if (!data) return null;
    if (typeof data === 'object') return data;
    try {
        return JSON.parse(data);
    } catch (e) {
        console.error("JSON parse error", e);
        return null;
    }
};

/** 75 → „1 min 15 s“, 40 → „40 s“ */
const formatSeconds = (sec) => {
    const n = Math.round(sec);
    if (n < 60) return `${n} s`;
    const m = Math.floor(n / 60), r = n % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
};

const apiError = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

const kindOf = (ad) => (ad.slideData ? 'slide' : isVideo(ad.imageUrl) ? 'video' : 'image');
const KIND_LABEL = { slide: 'Gestaltet', video: 'Video', image: 'Bild' };
const KIND_ICON = { slide: <DashboardCustomizeIcon fontSize="inherit" />, video: <MovieIcon fontSize="inherit" />, image: <ImageIcon fontSize="inherit" /> };

/** Dauer-Feld: lokal tippen, erst bei Verlassen/Enter speichern (vorher ging pro Tastendruck ein Request raus) */
const DurationField = ({ value, onCommit, disabled }) => {
    const [draft, setDraft] = useState(String(value ?? ''));
    useEffect(() => { setDraft(String(value ?? '')); }, [value]);
    const commit = () => {
        const n = Math.round(Number(draft));
        if (!Number.isFinite(n) || n < 1) { setDraft(String(value ?? '')); return; }
        if (n !== Number(value)) onCommit(Math.min(3600, n));
    };
    return (
        <TextField
            label="Dauer (s)"
            type="number"
            size="small"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
            slotProps={{ htmlInput: { min: 1, max: 3600, step: 1, inputMode: 'numeric' } }}
            sx={{ width: 110 }}
        />
    );
};

const SortableAdItem = ({ ad, index, count, onUpdate, onDelete, onOpenSlideEditor, onPreview, onMove, busy }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: ad.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 100 : 'auto',
        position: 'relative'
    };
    const kind = kindOf(ad);
    const overlayChip = { bgcolor: 'rgba(0,0,0,0.6)', color: 'white', '& .MuiChip-icon': { color: 'white' } };

    return (
        <Grid size={{ xs: 12, sm: 6, lg: 4, xl: 3 }} ref={setNodeRef} style={style}>
            <Card variant="elevation" elevation={2} sx={{ position: 'relative', borderRadius: 3, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', outline: ad.active ? 'none' : '2px dashed', outlineColor: 'warning.main', outlineOffset: -2 }}>
                <Box sx={{ position: 'relative', aspectRatio: '16 / 9', bgcolor: '#000' }}>
                    <Box sx={{ width: '100%', height: '100%', opacity: ad.active ? 1 : 0.4 }}>
                        {kind === 'video' ? (
                            <Box
                                component="video"
                                src={ad.imageUrl}
                                muted
                                preload="metadata"
                                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        ) : kind === 'slide' ? (
                            <Box sx={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
                                <SlideRenderer slideData={safeParse(ad.slideData)} />
                            </Box>
                        ) : (
                            <CardMedia
                                component="img"
                                image={ad.imageUrl}
                                alt=""
                                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        )}
                    </Box>

                    {/* Griff zum Ziehen (Maus/Touch), Reihenfolge = Abspielreihenfolge */}
                    <Tooltip title="Ziehen, um die Reihenfolge zu ändern">
                        <Box
                            {...attributes} {...listeners}
                            aria-label={`Folie ${index + 1} verschieben`}
                            sx={{
                                position: 'absolute', top: 8, left: 8, width: 40, height: 40,
                                bgcolor: 'rgba(0,0,0,0.6)', color: 'white', borderRadius: 1.5,
                                cursor: 'grab', touchAction: 'none', display: 'grid', placeItems: 'center',
                                '&:active': { cursor: 'grabbing' }
                            }}
                        >
                            <DragIndicatorIcon />
                        </Box>
                    </Tooltip>
                    {/* Auf einen Blick: Platz in der Reihenfolge, Art, Dauer */}
                    <Stack direction="row" spacing={0.75} sx={{ position: 'absolute', top: 12, right: 8 }}>
                        <Chip size="small" label={`Nr. ${index + 1}`} sx={{ ...overlayChip, fontWeight: 800 }} />
                        <Chip size="small" icon={KIND_ICON[kind]} label={KIND_LABEL[kind]} sx={overlayChip} />
                        <Chip size="small" label={`${ad.duration} s`} sx={overlayChip} />
                    </Stack>
                    {!ad.active && (
                        <Chip size="small" label="Ausgeblendet – läuft nicht" color="warning" sx={{ position: 'absolute', bottom: 8, left: 8, fontWeight: 700 }} />
                    )}
                </Box>

                <CardContent sx={{ pt: 1.5, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Stack spacing={1.5} sx={{ flex: 1 }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
                            <FormControlLabel
                                sx={{ mr: 0 }}
                                control={
                                    <Switch
                                        checked={!!ad.active}
                                        disabled={busy}
                                        onChange={(e) => onUpdate(ad.id, { active: e.target.checked })}
                                    />
                                }
                                label={ad.active ? 'Wird gezeigt' : <Typography component="span" color="warning.main" fontWeight={700}>Ausgeblendet</Typography>}
                            />
                            <Stack direction="row" alignItems="center">
                                <Tooltip title="Früher zeigen (in der Reihenfolge nach vorne)">
                                    <span><IconButton disabled={busy || index === 0} onClick={() => onMove(index, index - 1)} aria-label="Früher zeigen"><ArrowBackIcon /></IconButton></span>
                                </Tooltip>
                                <Tooltip title="Später zeigen (in der Reihenfolge nach hinten)">
                                    <span><IconButton disabled={busy || index >= count - 1} onClick={() => onMove(index, index + 1)} aria-label="Später zeigen"><ArrowForwardIcon /></IconButton></span>
                                </Tooltip>
                            </Stack>
                        </Stack>

                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <DurationField value={ad.duration} disabled={busy} onCommit={(duration) => onUpdate(ad.id, { duration })} />
                            <FormControl size="small" sx={{ minWidth: 130, flex: 1 }}>
                                <InputLabel>Übergang</InputLabel>
                                <Select
                                    value={ad.transition}
                                    label="Übergang"
                                    disabled={busy}
                                    onChange={(e) => onUpdate(ad.id, { transition: e.target.value })}
                                >
                                    {TRANSITIONS.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Stack>

                        <Box sx={{ flex: 1 }} />
                        <Divider />
                        <Stack direction="row" spacing={0.5} justifyContent="space-between" flexWrap="wrap" useFlexGap sx={{ '& .MuiButton-root': { minHeight: 40, px: 0.75 }, '& .MuiButton-startIcon': { mr: 0.5 } }}>
                            <Button size="small" color="inherit" startIcon={<VisibilityIcon />} onClick={() => onPreview(ad)}>Vorschau</Button>
                            {kind === 'slide' && (
                                <Button size="small" startIcon={<EditNoteIcon />} onClick={() => onOpenSlideEditor(ad)}>Bearbeiten</Button>
                            )}
                            <Button size="small" color="error" startIcon={<DeleteIcon />} disabled={busy} onClick={() => onDelete(ad)}>Löschen</Button>
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>
        </Grid>
    );
};

export default function AdminAds() {
    const theme = useTheme();
    const isXs = useMediaQuery(theme.breakpoints.down('sm'));

    const [ads, setAds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);
    const [snack, setSnack] = useState(null); // { severity, message }

    const [uploadOpen, setUploadOpen] = useState(false);
    const [slideCreatorOpen, setSlideCreatorOpen] = useState(false);
    const [editSlideData, setEditSlideData] = useState(null);
    const [editAdId, setEditAdId] = useState(null);
    const [newImageUrl, setNewImageUrl] = useState('');
    const [newFile, setNewFile] = useState(null);
    const [newFilePreview, setNewFilePreview] = useState(null);
    const [newDuration, setNewDuration] = useState(10);
    const [newTransition, setNewTransition] = useState('FADE');
    const [uploadError, setUploadError] = useState('');
    const [uploading, setUploading] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewAd, setPreviewAd] = useState(null);

    const sensors = useSensors(
        // Kleine Bewegung nötig, damit ein Tipp auf den Griff nicht schon zieht
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        // Touch: kurz halten, damit Scrollen auf dem Tablet weiter geht
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const notify = (message, severity = 'success') => setSnack({ message, severity });

    const fetchAds = useCallback(async () => {
        try {
            const res = await api.get('/ads');
            setAds(Array.isArray(res.data) ? res.data : []);
            setLoadError('');
        } catch (err) {
            console.error(err);
            setLoadError(apiError(err, 'Werbung konnte nicht geladen werden'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAds(); }, [fetchAds]);

    // Objekt-URL für die Vorschau der gewählten Datei sauber anlegen/freigeben
    useEffect(() => {
        if (!newFile || !newFile.type.startsWith('image/')) { setNewFilePreview(null); return undefined; }
        const url = URL.createObjectURL(newFile);
        setNewFilePreview(url);
        return () => URL.revokeObjectURL(url);
    }, [newFile]);

    const resetUpload = () => {
        setNewImageUrl(''); setNewFile(null); setNewDuration(10); setNewTransition('FADE'); setUploadError('');
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
            setUploadError(`Datei ist ${(file.size / 1024 / 1024).toFixed(0)} MB groß, erlaubt sind maximal ${MAX_UPLOAD_MB} MB.`);
            return;
        }
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
            setUploadError('Nur Bilder und Videos sind erlaubt.');
            return;
        }
        setUploadError('');
        setNewFile(file);
        setNewImageUrl('');

        // Dauer bei Videos aus der Datei übernehmen
        if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                window.URL.revokeObjectURL(video.src);
                if (Number.isFinite(video.duration) && video.duration > 0) setNewDuration(Math.ceil(video.duration));
            };
            video.src = URL.createObjectURL(file);
        } else {
            setNewDuration(10);
        }
    };

    const handleCreate = async () => {
        setUploading(true);
        setUploadError('');
        try {
            const formData = new FormData();
            if (newFile) {
                formData.append('image', newFile);
            } else if (newImageUrl) {
                formData.append('imageUrl', newImageUrl.trim());
            }
            formData.append('duration', newDuration);
            formData.append('transition', newTransition);
            formData.append('active', true);

            await api.post('/ads', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            setUploadOpen(false);
            resetUpload();
            notify('Folie hinzugefügt');
            fetchAds();
        } catch (err) {
            console.error(err);
            setUploadError(apiError(err, 'Fehler beim Hochladen'));
        } finally {
            setUploading(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await api.delete(`/ads/${deleteTarget.id}`);
            setDeleteTarget(null);
            notify('Folie gelöscht');
            fetchAds();
        } catch (err) {
            console.error(err);
            notify(apiError(err, 'Löschen fehlgeschlagen'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleUpdate = async (id, data) => {
        // optimistisch anzeigen, bei Fehler zurückladen
        setAds((list) => list.map((a) => (a.id === id ? { ...a, ...data } : a)));
        try {
            await api.put(`/ads/${id}`, data);
        } catch (err) {
            console.error(err);
            notify(apiError(err, 'Änderung konnte nicht gespeichert werden'), 'error');
            fetchAds();
        }
    };

    const persistOrder = (newAds) => {
        setAds(newAds);
        api.put('/ads/reorder', { orderedIds: newAds.map(a => a.id) })
            .catch(err => {
                console.error("Reorder failed", err);
                notify(apiError(err, 'Reihenfolge konnte nicht gespeichert werden'), 'error');
                fetchAds();
            });
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = ads.findIndex(a => a.id === active.id);
        const newIndex = ads.findIndex(a => a.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        persistOrder(arrayMove(ads, oldIndex, newIndex));
    };

    const handleMove = (from, to) => {
        if (to < 0 || to >= ads.length) return;
        persistOrder(arrayMove(ads, from, to));
    };

    const handleSlideSave = async (file, slideData) => {
        const formData = new FormData();
        formData.append('image', file);
        if (!editAdId) {
            formData.append('duration', 10);
            formData.append('transition', 'FADE');
            formData.append('active', true);
        }
        if (slideData) formData.append('slideData', slideData);

        try {
            if (editAdId) {
                await api.put(`/ads/${editAdId}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            } else {
                await api.post('/ads', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            }
            setSlideCreatorOpen(false);
            setEditAdId(null);
            setEditSlideData(null);
            notify(editAdId ? 'Folie gespeichert' : 'Folie erstellt');
            fetchAds();
        } catch (err) {
            console.error("Failed to upload slide", err);
            notify(apiError(err, 'Folie konnte nicht gespeichert werden'), 'error');
        }
    };

    const openSlideEditor = (ad) => {
        if (ad) {
            setEditAdId(ad.id);
            setEditSlideData(safeParse(ad.slideData));
        } else {
            setEditAdId(null);
            setEditSlideData(null);
        }
        setSlideCreatorOpen(true);
    };

    const activeCount = ads.filter((a) => a.active).length;
    const totalSeconds = ads.filter((a) => a.active).reduce((s, a) => s + (Number(a.duration) || 0), 0);

    return (
        <Box sx={{ pb: 4, minWidth: 0 }}>
            {/* Kopfzeile: gleicher Aufbau wie auf der Seite Clubscore (DisplayPageBar) */}
            <DisplayPageBar
                content="ads"
                onScreensSaved={() => notify('Bildschirm-Belegung gespeichert')}
                status={(
                    <Box sx={{ minWidth: 0 }}>
                        <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.85rem', lineHeight: 1.2 }}>
                            {ads.length ? `${activeCount} von ${ads.length} Folien werden gezeigt` : 'Noch keine Folien'}
                        </Typography>
                        <Typography noWrap color="text.secondary" sx={{ fontSize: '0.72rem', lineHeight: 1.2 }}>
                            {activeCount ? `Ein Durchlauf dauert ca. ${formatSeconds(totalSeconds)}` : 'Der Werbe-Bildschirm zeigt „Keine aktive Werbung“'}
                        </Typography>
                    </Box>
                )}
            >
                <BarButton variant="contained" startIcon={<EditNoteIcon />} onClick={() => openSlideEditor(null)}>
                    Folie gestalten
                </BarButton>
                <BarButton startIcon={<AddPhotoAlternateIcon />} onClick={() => { resetUpload(); setUploadOpen(true); }}>
                    Bild/Video hochladen
                </BarButton>
            </DisplayPageBar>
            {ads.length > 1 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, mb: 2 }}>
                    Die Folien laufen nacheinander in dieser Reihenfolge, jede so lange wie ihre Dauer. Reihenfolge ändern:
                    am Griff oben links ziehen oder die Pfeile benutzen.
                </Typography>
            )}
            <Box sx={{ mb: ads.length > 1 ? 0 : 2.5 }} />

            {loadError && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={fetchAds}>Erneut laden</Button>}>{loadError}</Alert>}

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
            ) : ads.length === 0 && !loadError ? (
                <Card variant="outlined" sx={{ borderStyle: 'dashed', borderRadius: 3 }}>
                    <CardContent sx={{ textAlign: 'center', py: 6 }}>
                        <DashboardCustomizeIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
                        <Typography variant="h6" sx={{ mt: 1 }}>Noch keine Folien</Typography>
                        <Typography color="text.secondary" sx={{ mb: 2, maxWidth: 560, mx: 'auto' }}>
                            Am schnellsten geht es mit einer Vorlage: Getränkekarte, Ankündigung, Angebot des Abends,
                            Öffnungszeiten … Texte und Farben lassen sich danach frei ändern. Oder ein fertiges Bild oder Video hochladen.
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="center" alignItems="center">
                            <Button variant="contained" startIcon={<EditNoteIcon />} onClick={() => openSlideEditor(null)} sx={{ minHeight: 40 }}>Folie aus Vorlage gestalten</Button>
                            <Button variant="outlined" startIcon={<AddPhotoAlternateIcon />} onClick={() => { resetUpload(); setUploadOpen(true); }} sx={{ minHeight: 40 }}>Bild/Video hochladen</Button>
                        </Stack>
                    </CardContent>
                </Card>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={ads.map(val => val.id)} strategy={rectSortingStrategy}>
                        <Grid container spacing={{ xs: 2, md: 3 }}>
                            {ads.map((ad, index) => (
                                <SortableAdItem
                                    key={ad.id}
                                    ad={ad}
                                    index={index}
                                    count={ads.length}
                                    busy={busy}
                                    onUpdate={handleUpdate}
                                    onDelete={setDeleteTarget}
                                    onMove={handleMove}
                                    onOpenSlideEditor={openSlideEditor}
                                    onPreview={(a) => { setPreviewAd(a); setPreviewOpen(true); }}
                                />
                            ))}
                        </Grid>
                    </SortableContext>
                </DndContext>
            )}

            {/* Upload-Dialog */}
            <Dialog open={uploadOpen} onClose={() => !uploading && setUploadOpen(false)} maxWidth="sm" fullWidth fullScreen={isXs}>
                <DialogTitle>Bild oder Video hochladen</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={3} sx={{ mt: 0.5 }}>
                        <Box
                            sx={{
                                border: '2px dashed',
                                borderColor: newFile ? 'primary.main' : 'divider',
                                borderRadius: 2,
                                p: 3,
                                textAlign: 'center',
                                cursor: 'pointer',
                                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
                            }}
                            component="label"
                        >
                            <input type="file" hidden accept="image/*,video/*" onChange={handleFileSelect} />
                            {newFile ? (
                                <Stack spacing={1} alignItems="center">
                                    {newFilePreview ? (
                                        <Box component="img" src={newFilePreview} alt="" sx={{ maxHeight: 150, maxWidth: '100%', objectFit: 'contain', borderRadius: 1 }} />
                                    ) : (
                                        <PlayCircleOutlineIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
                                    )}
                                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{newFile.name} · {(newFile.size / 1024 / 1024).toFixed(1)} MB</Typography>
                                    <Button size="small" color="error" onClick={(e) => { e.preventDefault(); setNewFile(null); }}>Entfernen</Button>
                                </Stack>
                            ) : (
                                <Stack spacing={1} alignItems="center">
                                    <UploadFileIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                                    <Typography color="text.secondary">Tippen, um ein Bild oder Video auszuwählen</Typography>
                                    <Typography variant="caption" color="text.secondary">Querformat 16:9 passt am besten · maximal {MAX_UPLOAD_MB} MB</Typography>
                                </Stack>
                            )}
                        </Box>

                        <Divider>oder</Divider>

                        <TextField
                            label="Link zu Bild/Video"
                            fullWidth
                            value={newImageUrl}
                            onChange={(e) => { setNewImageUrl(e.target.value); setNewFile(null); }}
                            disabled={!!newFile}
                            helperText="Direkter Link (https://…), z.B. aus der Vereins-Cloud"
                        />

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                            <TextField
                                label="Dauer (Sekunden)"
                                type="number"
                                value={newDuration}
                                onChange={(e) => setNewDuration(e.target.value)}
                                slotProps={{ htmlInput: { min: 1, max: 3600, step: 1, inputMode: 'numeric' } }}
                                sx={{ flex: 1 }}
                                helperText={newFile?.type?.startsWith('video/') ? 'Aus dem Video übernommen' : 'Standard: 10 s'}
                            />
                            <FormControl sx={{ flex: 1 }}>
                                <InputLabel>Übergang</InputLabel>
                                <Select value={newTransition} label="Übergang" onChange={(e) => setNewTransition(e.target.value)}>
                                    {TRANSITIONS.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Stack>

                        {uploadError && <Alert severity="error">{uploadError}</Alert>}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUploadOpen(false)} disabled={uploading}>Abbrechen</Button>
                    <Button variant="contained" onClick={handleCreate} disabled={uploading || (!newImageUrl.trim() && !newFile)} startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : null}>
                        {uploading ? 'Lädt hoch…' : 'Speichern'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Löschen bestätigen */}
            <Dialog open={!!deleteTarget} onClose={() => !busy && setDeleteTarget(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Folie löschen?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {deleteTarget ? `Folie Nr. ${ads.findIndex((a) => a.id === deleteTarget.id) + 1} (${KIND_LABEL[kindOf(deleteTarget)]}) verschwindet von der Werbung und lässt sich nicht wiederherstellen. Nur kurz pausieren geht mit dem Schalter „Wird gezeigt“.` : ''}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)} disabled={busy}>Abbrechen</Button>
                    <Button color="error" variant="contained" onClick={confirmDelete} disabled={busy}>Löschen</Button>
                </DialogActions>
            </Dialog>


            {/* Slide Editor Dialog */}
            <SlideEditor
                open={slideCreatorOpen}
                onClose={() => setSlideCreatorOpen(false)}
                onSave={handleSlideSave}
                initialData={editSlideData}
            />

            {/* Vorschau */}
            <Dialog
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                maxWidth={false}
                PaperProps={{
                    sx: {
                        width: '92vw', aspectRatio: '16 / 9', maxWidth: '1280px', maxHeight: '90vh',
                        overflow: 'hidden', bgcolor: 'black'
                    }
                }}
            >
                {previewAd && (
                    <Box sx={{ width: '100%', height: '100%' }} onClick={() => setPreviewOpen(false)}>
                        {isVideo(previewAd.imageUrl) ? (
                            <Box component="video" src={previewAd.imageUrl} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} controls autoPlay muted />
                        ) : previewAd.slideData ? (
                            <SlideRenderer slideData={safeParse(previewAd.slideData)} />
                        ) : (
                            <Box component="img" src={previewAd.imageUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        )}
                    </Box>
                )}
            </Dialog>

            <Snackbar
                open={!!snack}
                autoHideDuration={4000}
                onClose={() => setSnack(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                {snack ? <Alert onClose={() => setSnack(null)} severity={snack.severity} variant="filled" sx={{ width: '100%' }}>{snack.message}</Alert> : null}
            </Snackbar>
        </Box>
    );
}
