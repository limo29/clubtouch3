import React, { useState, useEffect } from 'react';
import {
    Box, Button, Card, CardContent, CardMedia, Chip, Container,
    Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
    Stack, TextField, Typography, MenuItem, Select, FormControl, InputLabel,
    Grid, Switch, FormControlLabel
} from '@mui/material';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import api from '../services/api';

export default function AdminAds() {
    const [ads, setAds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [newImageUrl, setNewImageUrl] = useState('');
    const [newDuration, setNewDuration] = useState(10);
    const [newTransition, setNewTransition] = useState('FADE');

    const fetchAds = async () => {
        try {
            const res = await api.get('/ads');
            setAds(res.data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAds(); }, []);

    const handleCreate = async () => {
        try {
            await api.post('/ads', {
                imageUrl: newImageUrl,
                duration: newDuration,
                transition: newTransition,
                active: true
            });
            setUploadOpen(false);
            setNewImageUrl('');
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

    const moveAd = async (index, direction) => {
        const newAds = [...ads];
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= newAds.length) return;

        [newAds[index], newAds[targetIndex]] = [newAds[targetIndex], newAds[index]];
        setAds(newAds);

        // Sync order to backend
        try {
            await api.put('/ads/reorder', { orderedIds: newAds.map(a => a.id) });
        } catch (err) {
            console.error("Reorder failed", err);
            fetchAds(); // Revert on error
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight="bold">Werbung & Digital Signage</Typography>
                <Button
                    variant="contained"
                    startIcon={<AddPhotoAlternateIcon />}
                    onClick={() => setUploadOpen(true)}
                >
                    Neues Bild
                </Button>
            </Stack>

            <Grid container spacing={3}>
                {ads.map((ad, index) => (
                    <Grid item xs={12} sm={6} md={4} key={ad.id}>
                        <Card variant="outlined" sx={{ position: 'relative' }}>
                            <CardMedia
                                component="img"
                                height="200"
                                image={ad.imageUrl}
                                alt="Ad"
                                sx={{ objectFit: 'contain', bgcolor: '#000' }}
                            />
                            <CardContent>
                                <Stack spacing={2}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <TextField
                                            label="Dauer (s)"
                                            type="number"
                                            size="small"
                                            value={ad.duration}
                                            onChange={(e) => handleUpdate(ad.id, { duration: e.target.value })}
                                            sx={{ width: 100 }}
                                        />
                                        <FormControl size="small" sx={{ minWidth: 120 }}>
                                            <InputLabel>Übergang</InputLabel>
                                            <Select
                                                value={ad.transition}
                                                label="Übergang"
                                                onChange={(e) => handleUpdate(ad.id, { transition: e.target.value })}
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
                                                    onChange={(e) => handleUpdate(ad.id, { active: e.target.checked })}
                                                    size="small"
                                                />
                                            }
                                            label={ad.active ? "Aktiv" : "Inaktiv"}
                                        />
                                        <Box>
                                            <IconButton size="small" onClick={() => moveAd(index, -1)} disabled={index === 0}><DragIndicatorIcon sx={{ transform: 'rotate(90deg)' }} /></IconButton>
                                            <IconButton size="small" onClick={() => moveAd(index, 1)} disabled={index === ads.length - 1}><DragIndicatorIcon sx={{ transform: 'rotate(90deg)' }} /></IconButton>
                                            <IconButton color="error" onClick={() => handleDelete(ad.id)}><DeleteIcon /></IconButton>
                                        </Box>
                                    </Stack>
                                </Stack>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Neue Werbung hinzufügen</DialogTitle>
                <DialogContent>
                    <Stack spacing={3} sx={{ mt: 1 }}>
                        <TextField
                            label="Bild URL"
                            fullWidth
                            value={newImageUrl}
                            onChange={(e) => setNewImageUrl(e.target.value)}
                            helperText="Direkter Link zum Bild (z.B. Imgur, S3, oder lokaler Upload Pfad)"
                        />
                        <Stack direction="row" spacing={2}>
                            <TextField
                                label="Dauer (Sekunden)"
                                type="number"
                                value={newDuration}
                                onChange={(e) => setNewDuration(e.target.value)}
                                sx={{ flex: 1 }}
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
                    <Button variant="contained" onClick={handleCreate} disabled={!newImageUrl}>Speichern</Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
