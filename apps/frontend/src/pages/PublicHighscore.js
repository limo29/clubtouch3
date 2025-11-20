import React, { useEffect, useState, useCallback } from 'react';
import {
    Box, Card, CardContent, Chip, CssBaseline, Divider, Stack,
    Typography, alpha, GlobalStyles
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech';
import TimerIcon from '@mui/icons-material/AccessTime';
import EuroIcon from '@mui/icons-material/Euro';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { io } from 'socket.io-client';
import api from '../services/api'; // We might need a public api instance or just use the existing one if it handles public routes
import { API_ENDPOINTS, WS_URL } from '../config/api';

// Helper for clamp
const clamp = (min, preferred, max) => `clamp(${min}, ${preferred}, ${max})`;
const money = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);

export default function PublicHighscore() {
    // Enforce Dark Mode
    const theme = createTheme({
        palette: {
            mode: 'dark',
            background: { default: '#0b0f15', paper: '#111824' },
            primary: { main: '#71a7ff' },
            secondary: { main: '#b792ff' }
        },
        typography: { fontSize: 16 }, // Slightly larger for public display
        shape: { borderRadius: 16 },
    });

    const [loading, setLoading] = useState(true);
    const [live, setLive] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [startDate, setStartDate] = useState(null);
    const [mode, setMode] = useState('AMOUNT'); // 'AMOUNT' | 'COUNT'

    const [boards, setBoards] = useState({
        daily: { amount: { entries: [] }, count: { entries: [] } },
        yearly: { amount: { entries: [] }, count: { entries: [] } }
    });

    // Auto-Rotate Mode
    useEffect(() => {
        const id = setInterval(() => setMode((m) => (m === 'AMOUNT' ? 'COUNT' : 'AMOUNT')), 15000); // Slower rotation
        return () => clearInterval(id);
    }, []);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            // Use public endpoint
            const res = await api.get('/public/highscore/all');
            const hs = res.data || {};

            setBoards({
                daily: { amount: hs?.daily?.amount || { entries: [] }, count: hs?.daily?.count || { entries: [] } },
                yearly: { amount: hs?.yearly?.amount || { entries: [] }, count: hs?.yearly?.count || { entries: [] } }
            });
            setStartDate(hs?.daily?.amount?.startDate || hs?.daily?.count?.startDate || null);
            setLastUpdated(new Date());
        } catch (err) {
            console.error("Failed to fetch highscore", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // Live socket (Public namespace if needed, or just default)
    // Note: Socket might require auth if not configured otherwise. 
    // If socket fails, we just poll.
    useEffect(() => {
        // Try connecting without token first if backend allows, or just skip socket for public if it's protected
        // Assuming WS_URL is open or we need a public namespace.
        // For now, let's try to connect. If it fails, we rely on polling.
        const s = io(WS_URL);
        s.on('connect', () => setLive(true));
        s.on('disconnect', () => setLive(false));

        const refresh = () => fetchAll();
        s.on('highscore:update', refresh);
        s.on('sale:new', refresh);

        // Fallback polling every minute
        const poll = setInterval(refresh, 60000);

        return () => {
            s.close();
            clearInterval(poll);
        };
    }, [fetchAll]);


    const RankRow = ({ entry, isTop }) => {
        const rankAccent = (rank) => (rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : null);

        return (
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                    py: isTop ? 2 : 1.5,
                    px: 2,
                    gap: 2,
                    borderRadius: 3,
                    position: 'relative',
                    background: rankAccent(entry.rank) ? `linear-gradient(90deg, ${alpha(rankAccent(entry.rank), 0.15)}, transparent)` : 'transparent',
                    boxShadow: isTop ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.3)}` : 'none',
                    mb: 1
                }}
            >
                {rankAccent(entry.rank) && (
                    <Box sx={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 6, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, bgcolor: rankAccent(entry.rank) }} />
                )}
                <Stack direction="row" alignItems="center" spacing={2} sx={{ minWidth: 0 }}>
                    <Chip
                        label={`#${entry.rank}`}
                        sx={{
                            fontWeight: 900,
                            bgcolor: rankAccent(entry.rank) || 'action.selected',
                            color: rankAccent(entry.rank) ? '#000' : 'text.primary',
                            fontSize: '1.1rem',
                            height: 32
                        }}
                    />
                    <Typography noWrap sx={{ fontWeight: isTop ? 800 : 600, fontSize: clamp('20px', '2.5vw', '32px'), minWidth: 0 }}>
                        {entry.customerNickname || entry.customerName}
                    </Typography>
                    {entry.rank <= 3 && <MilitaryTechIcon sx={{ color: rankAccent(entry.rank), fontSize: 32 }} />}
                </Stack>

                <Stack direction="row" spacing={3} alignItems="center" sx={{ flexShrink: 0 }}>
                    {/* Only show score for cleaner look */}
                    <Typography
                        sx={{
                            fontWeight: 900,
                            fontSize: clamp('24px', '3vw', '40px'),
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            textShadow: isTop ? `0 0 20px ${alpha(theme.palette.primary.main, 0.5)}` : 'none'
                        }}
                        color="primary"
                    >
                        {mode === 'AMOUNT' ? money(entry.score) : `${entry.score}`}
                    </Typography>
                </Stack>
            </Stack>
        );
    };

    const Board = ({ title, data }) => (
        <Card
            variant="outlined"
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: alpha(theme.palette.background.paper, 0.6),
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.08)'
            }}
        >
            <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                    <Stack direction="row" spacing={2} alignItems="center">
                        <TrophyIcon color="primary" sx={{ fontSize: 40 }} />
                        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</Typography>
                    </Stack>
                    <Chip
                        icon={mode === 'AMOUNT' ? <EuroIcon /> : <ShoppingCartIcon />}
                        label={mode === 'AMOUNT' ? 'UMSATZ' : 'ANZAHL'}
                        color="primary"
                        variant="outlined"
                        sx={{ fontWeight: 700, borderRadius: 2 }}
                    />
                </Stack>

                <Divider sx={{ mb: 2, borderColor: 'rgba(255,255,255,0.1)' }} />

                <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    {/* Mask for smooth scroll fade if we had scrolling, but here we fit to screen usually */}
                    <Stack spacing={0} sx={{ height: '100%', overflowY: 'auto', pr: 1 }}>
                        {loading ? (
                            <Typography variant="h6" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>Lade Highscores...</Typography>
                        ) : (data?.entries?.length ?? 0) === 0 ? (
                            <Typography variant="h6" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>Keine Einträge vorhanden</Typography>
                        ) : (
                            data.entries.map((e, idx) => (
                                <RankRow key={e.customerId ?? idx} entry={e} isTop={idx === 0} />
                            ))
                        )}
                    </Stack>
                </Box>
            </CardContent>
        </Card>
    );

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <GlobalStyles styles={{
                body: { overflow: 'hidden' }, // Prevent scrollbars on kiosk
                '::-webkit-scrollbar': { width: '8px' },
                '::-webkit-scrollbar-track': { background: 'transparent' },
                '::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.1)', borderRadius: '4px' },
                '::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.2)' }
            }} />

            <Box sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                p: 3,
                background: 'radial-gradient(circle at 50% -20%, #1a2738 0%, #0b0f15 100%)'
            }}>

                {/* Header */}
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
                    <Stack direction="row" spacing={2} alignItems="center">
                        <Box sx={{
                            width: 64, height: 64,
                            borderRadius: 4,
                            bgcolor: 'primary.main',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 0 40px rgba(113, 167, 255, 0.3)'
                        }}>
                            <TrophyIcon sx={{ fontSize: 40, color: '#fff' }} />
                        </Box>
                        <Box>
                            <Typography variant="h3" sx={{ fontWeight: 900, lineHeight: 1 }}>Highscore</Typography>
                            <Typography variant="subtitle1" color="text.secondary" sx={{ fontWeight: 500 }}>
                                {live ? <Stack direction="row" spacing={1} alignItems="center"><Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4caf50', boxShadow: '0 0 10px #4caf50' }} /><span>LIVE UPDATE</span></Stack> : 'Letztes Update: ' + (lastUpdated?.toLocaleTimeString() || '-')}
                            </Typography>
                        </Box>
                    </Stack>

                    {startDate && (
                        <Chip
                            icon={<TimerIcon />}
                            label={`Saisonstart: ${new Date(startDate).toLocaleDateString('de-DE')}`}
                            sx={{ bgcolor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)' }}
                        />
                    )}
                </Stack>

                {/* Content Grid */}
                <Box sx={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                    gap: 4,
                    minHeight: 0
                }}>
                    <Board title="Heute" data={mode === 'AMOUNT' ? boards.daily.amount : boards.daily.count} />
                    <Board title="Saison" data={mode === 'AMOUNT' ? boards.yearly.amount : boards.yearly.count} />
                </Box>

            </Box>
        </ThemeProvider>
    );
}
