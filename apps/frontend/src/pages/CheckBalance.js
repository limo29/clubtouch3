import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Container, Button, Card, CardContent, Stack, Typography,
    TextField, CircularProgress, Alert, Divider
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import HistoryIcon from '@mui/icons-material/History';
import api from '../services/api';

const money = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);

export default function CheckBalance() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    const handleCheck = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        setLoading(true);
        setError(null);
        setData(null);

        try {
            const res = await api.get(`/public/customer/balance?name=${encodeURIComponent(name)}`);
            setData(res.data);
        } catch (err) {
            console.error(err);
            setError('Kunde nicht gefunden oder Fehler aufgetreten.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
            <Container maxWidth="sm" sx={{ py: 4, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate('/login')}
                    sx={{ alignSelf: 'flex-start', mb: 2 }}
                >
                    Zurück zum Login
                </Button>

                <Card variant="outlined" sx={{ borderRadius: 4, boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                    <CardContent sx={{ p: 4 }}>
                        <Stack spacing={3} alignItems="center" sx={{ mb: 4 }}>
                            <Box sx={{ p: 2, borderRadius: '50%', bgcolor: 'primary.light', color: 'primary.main' }}>
                                <AccountBalanceWalletIcon sx={{ fontSize: 40 }} />
                            </Box>
                            <Typography variant="h4" fontWeight="bold" textAlign="center">Guthaben prüfen</Typography>
                            <Typography variant="body1" color="text.secondary" textAlign="center">
                                Gib deinen Namen ein, um deinen aktuellen Kontostand und die letzten Transaktionen zu sehen.
                            </Typography>
                        </Stack>

                        <form onSubmit={handleCheck}>
                            <Stack spacing={2}>
                                <TextField
                                    label="Dein Name"
                                    fullWidth
                                    variant="outlined"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    autoFocus
                                />
                                <Button
                                    type="submit"
                                    variant="contained"
                                    size="large"
                                    fullWidth
                                    disabled={loading || !name.trim()}
                                    sx={{ py: 1.5, fontSize: '1.1rem' }}
                                >
                                    {loading ? <CircularProgress size={24} /> : 'Prüfen'}
                                </Button>
                            </Stack>
                        </form>

                        {error && (
                            <Alert severity="error" sx={{ mt: 3 }}>{error}</Alert>
                        )}

                        {data && (
                            <Box sx={{ mt: 4, animation: 'fadeIn 0.5s ease-out' }}>
                                <Divider sx={{ mb: 3 }} />
                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                                    <Typography variant="h6">Hallo, {data.name}!</Typography>
                                </Stack>
                                <Typography variant="h3" color={data.balance < 0 ? 'error.main' : 'success.main'} fontWeight="900" sx={{ mb: 3 }}>
                                    {money(data.balance)}
                                </Typography>

                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                                    <HistoryIcon color="action" />
                                    <Typography variant="subtitle2" fontWeight="bold">Letzte Aktivitäten</Typography>
                                </Stack>

                                <Stack spacing={1.5}>
                                    {data.history.map((item, i) => (
                                        <Stack
                                            key={i}
                                            direction="row"
                                            justifyContent="space-between"
                                            alignItems="center"
                                            sx={{
                                                p: 1.5,
                                                bgcolor: 'background.paper',
                                                borderRadius: 2,
                                                border: '1px solid',
                                                borderColor: 'divider'
                                            }}
                                        >
                                            <Box>
                                                <Typography variant="body2" fontWeight="bold">
                                                    {item.type === 'TOPUP' ? 'Aufladung' : item.cancelled ? 'Storno' : 'Einkauf'}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {new Date(item.date).toLocaleDateString()} • {item.items || item.method}
                                                </Typography>
                                            </Box>
                                            <Typography
                                                fontWeight="bold"
                                                color={item.amount > 0 ? 'success.main' : item.amount < 0 ? 'text.primary' : 'text.secondary'}
                                            >
                                                {item.amount > 0 ? '+' : ''}{money(item.amount)}
                                            </Typography>
                                        </Stack>
                                    ))}
                                </Stack>
                            </Box>
                        )}
                    </CardContent>
                </Card>
            </Container>
        </Box>
    );
}
