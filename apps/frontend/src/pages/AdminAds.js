import React, { useState, useEffect } from 'react';
import {
    Box, Button, Card, CardContent, CardMedia, Container,
    Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
    Stack, TextField, Typography, MenuItem, Select, FormControl, InputLabel,
    Grid, Switch, FormControlLabel, Divider, Tooltip
} from '@mui/material';
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

import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';

import UploadFileIcon from '@mui/icons-material/UploadFile';
import EditNoteIcon from '@mui/icons-material/EditNote';

import api from '../services/api';
import SlideEditor from '../components/admin/SlideEditor';
import SlideRenderer from '../components/ads/SlideRenderer';

const isVideo = (url) => {
    if (!url) return false;
    const ext = url.split('.').pop().toLowerCase();
    return ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
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

const SortableAdItem = ({ ad, onUpdate, onDelete, onOpenSlideEditor, onPreview }) => {
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

    return (
        <Grid item xs={12} sm={6} md={4} ref={setNodeRef} style={style}>
            <Card variant="elevation" elevation={2} sx={{ position: 'relative', borderRadius: 3, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ position: 'relative', height: 200, bgcolor: '#000' }}>
                    {isVideo(ad.imageUrl) ? (
                        <Box
                            component="video"
                            src={ad.imageUrl}
                            sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            controls
                        />
                    ) : (
                        ad.slideData ? (
                            <Box sx={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
                                <SlideRenderer slideData={safeParse(ad.slideData)} />
                            </Box>
                        ) : (
                            <CardMedia
                                component="img"
                                height="200"
                                image={ad.imageUrl}
                                alt="Ad"
                                sx={{ objectFit: 'contain' }}
                            />
                        )
                    )}

                    {/* Handle for dragging */}
                    <Box
                        {...attributes} {...listeners}
                        sx={{
                            position: 'absolute',
                            top: 8, left: 8,
                            bgcolor: 'rgba(0,0,0,0.5)',
                            color: 'white',
                            borderRadius: 1,
                            p: 0.5,
                            cursor: 'grab',
                            '&:active': { cursor: 'grabbing' }
                        }}
                    >
                        <DragIndicatorIcon />
                    </Box>
                </Box>
                <CardContent>
                    <Stack spacing={2}>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <TextField
                                label="Dauer (s)"
                                type="number"
                                size="small"
                                value={ad.duration}
                                onChange={(e) => onUpdate(ad.id, { duration: e.target.value })}
                                sx={{ width: 100 }}
                            />
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <InputLabel>Übergang</InputLabel>
                                <Select
                                    value={ad.transition}
                                    label="Übergang"
                                    onChange={(e) => onUpdate(ad.id, { transition: e.target.value })}
                                >
                                    <MenuItem value="FADE">Fade</MenuItem>
                                    <MenuItem value="SLIDE">Slide</MenuItem>
                                    <MenuItem value="ZOOM">Zoom</MenuItem>
                                    <MenuItem value="NONE">Kein</MenuItem>
                                </Select>
                            </FormControl>
                        </Stack>

                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={ad.active}
                                        onChange={(e) => onUpdate(ad.id, { active: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={ad.active ? "Aktiv" : "Inaktiv"}
                            />
                            <Box>
                                <Tooltip title="Vorschau">
                                    <IconButton size="small" onClick={() => onPreview(ad)}>
                                        <VisibilityIcon />
                                    </IconButton>
                                </Tooltip>
                                {ad.slideData && (
                                    <Tooltip title="Slide bearbeiten">
                                        <IconButton size="small" onClick={() => onOpenSlideEditor(ad)} color="primary">
                                            <EditNoteIcon />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                <IconButton color="error" onClick={() => onDelete(ad.id)}><DeleteIcon /></IconButton>
                            </Box>
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>
        </Grid>
    );
};

export default function AdminAds() {
    const [ads, setAds] = useState([]);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [slideCreatorOpen, setSlideCreatorOpen] = useState(false);
    const [editSlideData, setEditSlideData] = useState(null);
    const [editAdId, setEditAdId] = useState(null);
    const [newImageUrl, setNewImageUrl] = useState('');
    const [newFile, setNewFile] = useState(null);
    const [newDuration, setNewDuration] = useState(10);
    const [newTransition, setNewTransition] = useState('FADE');

    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewAd, setPreviewAd] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const fetchAds = async () => {
        try {
            const res = await api.get('/ads');
            let sorted = res.data || [];
            // Ideally backend sorts, but we ensure frontend honors it?
            // Assuming backend returns in 'order'
            setAds(sorted);
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => { fetchAds(); }, []);

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setNewFile(file);
        setNewImageUrl('');

        // Auto-detect duration for videos
        if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                window.URL.revokeObjectURL(video.src);
                setNewDuration(Math.ceil(video.duration));
            };
            video.src = URL.createObjectURL(file);
        } else {
            setNewDuration(10); // Default for images
        }
    };

    const handleCreate = async () => {
        try {
            const formData = new FormData();
            if (newFile) {
                formData.append('image', newFile);
            } else if (newImageUrl) {
                formData.append('imageUrl', newImageUrl);
            }
            formData.append('duration', newDuration);
            formData.append('transition', newTransition);
            formData.append('active', true);

            await api.post('/ads', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            setUploadOpen(false);
            setNewImageUrl('');
            setNewFile(null);
            fetchAds();
        } catch (err) {
            console.error(err);
            alert('Fehler beim Erstellen');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Wirklich löschen?')) return;
        try {
            await api.delete(`/ads/${id}`);
            fetchAds();
        } catch (err) {
            console.error(err);
        }
    };

    const handleUpdate = async (id, data) => {
        try {
            await api.put(`/ads/${id}`, data);
            fetchAds();
        } catch (err) {
            console.error(err);
        }
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (active.id !== over.id) {
            const oldIndex = ads.findIndex(a => a.id === active.id);
            const newIndex = ads.findIndex(a => a.id === over.id);

            const newAds = arrayMove(ads, oldIndex, newIndex);
            setAds(newAds);

            // Sync with backend
            api.put('/ads/reorder', { orderedIds: newAds.map(a => a.id) })
                .catch(err => {
                    console.error("Reorder failed", err);
                    fetchAds();
                });
        }
    };

    const handleSlideSave = async (file, slideData) => {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('duration', 10);
        formData.append('transition', 'FADE');
        formData.append('active', true);
        if (slideData) formData.append('slideData', slideData);

        try {
            if (editAdId) {
                // Update existing ad
                await api.put(`/ads/${editAdId}`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
            } else {
                // Create new ad
                await api.post('/ads', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
            }

            setSlideCreatorOpen(false);
            setEditAdId(null);
            setEditSlideData(null);
            fetchAds();
        } catch (err) {
            console.error("Failed to upload slide", err);
            alert("Fehler beim Speichern der Slide");
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

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
                <Box>
                    <Typography variant="h4" fontWeight="800" sx={{ background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Werbung & Digital Signage
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                        Verwalte die Anzeigen auf den Bildschirmen
                    </Typography>
                </Box>
                <Stack direction="row" spacing={2}>
                    <Button
                        variant="outlined"
                        startIcon={<OpenInNewIcon />}
                        onClick={() => window.open('/public/ads', '_blank')}
                    >
                        Anzeige öffnen
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<EditNoteIcon />}
                        onClick={() => openSlideEditor(null)}
                    >
                        Slide erstellen
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<AddPhotoAlternateIcon />}
                        onClick={() => setUploadOpen(true)}
                        sx={{ boxShadow: '0 4px 14px 0 rgba(33, 150, 243, 0.3)' }}
                    >
                        Neue Datei
                    </Button>
                </Stack>
            </Stack>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={ads.map(val => val.id)}
                    strategy={rectSortingStrategy}
                >
                    <Grid container spacing={3}>
                        {ads.map((ad) => (
                            <SortableAdItem
                                key={ad.id}
                                ad={ad}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                                onOpenSlideEditor={openSlideEditor}
                                onPreview={(ad) => {
                                    setPreviewAd(ad);
                                    setPreviewOpen(true);
                                }}
                            />
                        ))}
                    </Grid>
                </SortableContext>
            </DndContext>

            {/* Create Dialog */}
            <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Neue Werbung hinzufügen</DialogTitle>
                <DialogContent>
                    <Stack spacing={3} sx={{ mt: 1 }}>
                        <Box
                            sx={{
                                border: '2px dashed',
                                borderColor: newFile ? 'primary.main' : 'divider',
                                borderRadius: 2,
                                p: 3,
                                textAlign: 'center',
                                bgcolor: newFile ? 'primary.soft' : 'background.paper',
                                cursor: 'pointer',
                                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
                            }}
                            component="label"
                        >
                            <input
                                type="file"
                                hidden
                                accept="image/*,video/*"
                                onChange={handleFileSelect}
                            />
                            {newFile ? (
                                <Stack spacing={1} alignItems="center">
                                    {newFile.type.startsWith('image/') ? (
                                        <Box
                                            component="img"
                                            src={URL.createObjectURL(newFile)}
                                            sx={{ maxHeight: 150, maxWidth: '100%', objectFit: 'contain', borderRadius: 1 }}
                                        />
                                    ) : (
                                        <Stack alignItems="center" spacing={1}>
                                            <PlayCircleOutlineIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
                                            <Typography variant="body2">{newFile.name}</Typography>
                                        </Stack>
                                    )}
                                    <Button size="small" color="error" onClick={(e) => {
                                        e.preventDefault();
                                        setNewFile(null);
                                    }}>Entfernen</Button>
                                </Stack>
                            ) : (
                                <Stack spacing={1} alignItems="center">
                                    <UploadFileIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                                    <Typography color="text.secondary">
                                        Klicken um Bild oder Video auszuwählen
                                    </Typography>
                                </Stack>
                            )}
                        </Box>

                        <Divider>ODER</Divider>

                        <TextField
                            label="Datei URL"
                            fullWidth
                            value={newImageUrl}
                            onChange={(e) => {
                                setNewImageUrl(e.target.value);
                                setNewFile(null);
                            }}
                            disabled={!!newFile}
                            helperText="Direkter Link zum Bild/Video (z.B. Imgur, S3)"
                        />

                        <Stack direction="row" spacing={2}>
                            <TextField
                                label="Dauer (Sekunden)"
                                type="number"
                                value={newDuration}
                                onChange={(e) => setNewDuration(e.target.value)}
                                sx={{ flex: 1 }}
                                helperText={newFile?.type?.startsWith('video/') ? "Automatisch erkannt" : "Standard: 10s"}
                            />
                            <FormControl sx={{ flex: 1 }}>
                                <InputLabel>Übergang</InputLabel>
                                <Select
                                    value={newTransition}
                                    label="Übergang"
                                    onChange={(e) => setNewTransition(e.target.value)}
                                >
                                    <MenuItem value="FADE">Fade</MenuItem>
                                    <MenuItem value="SLIDE">Slide</MenuItem>
                                    <MenuItem value="ZOOM">Zoom</MenuItem>
                                    <MenuItem value="NONE">Kein</MenuItem>
                                </Select>
                            </FormControl>
                        </Stack>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUploadOpen(false)}>Abbrechen</Button>
                    <Button variant="contained" onClick={handleCreate} disabled={!newImageUrl && !newFile}>Speichern</Button>
                </DialogActions>
            </Dialog>

            {/* Slide Editor Dialog */}
            <SlideEditor
                open={slideCreatorOpen}
                onClose={() => setSlideCreatorOpen(false)}
                onSave={handleSlideSave}
                initialData={editSlideData}
            />

            {/* Preview Dialog */}
            <Dialog
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                maxWidth={false}
                PaperProps={{
                    sx: {
                        width: '80vw',
                        height: '80vh',
                        maxWidth: '1280px',
                        maxHeight: '720px',
                        overflow: 'hidden',
                        bgcolor: 'black'
                    }
                }}
            >
                {previewAd && (
                    <Box sx={{ width: '100%', height: '100%' }}>
                        {isVideo(previewAd.imageUrl) ? (
                            <Box
                                component="video"
                                src={previewAd.imageUrl}
                                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                controls
                                autoPlay
                            />
                        ) : (
                            previewAd.slideData ? (
                                <SlideRenderer slideData={safeParse(previewAd.slideData)} />
                            ) : (
                                <Box
                                    component="img"
                                    src={previewAd.imageUrl}
                                    sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                />
                            )
                        )}
                    </Box>
                )}
            </Dialog>

        </Container >
    );
}
