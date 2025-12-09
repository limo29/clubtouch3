import React, { useEffect, useState, useCallback } from 'react';
import {
    Box, Card, CardContent, Chip, CssBaseline, Divider, Stack,
    Typography, alpha, GlobalStyles, createTheme, ThemeProvider
} from '@mui/material';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech';
import EuroIcon from '@mui/icons-material/Euro';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import TimerIcon from '@mui/icons-material/Timer';
import { io } from 'socket.io-client';
import api from '../services/api';
import { WS_URL } from '../config/api';
import Podium from '../components/common/Podium';

// Helper functions
const clamp = (min, val, max) => `clamp(${min}, ${val}, ${max})`;
const money = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);

// Enforce Dark Mode? No, let's use global theme.
// If strict dark mode is needed for public view, we can handle it via URL param or similar, but for now inherit global.

export default function PublicHighscore() {
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

    // Live socket
    useEffect(() => {
        const s = io(WS_URL);
        s.on('connect', () => setLive(true));
        s.on('disconnect', () => setLive(false));

        const refresh = () => fetchAll();
        s.on('highscore:update', refresh);
        s.on('sale:new', refresh);

        const poll = setInterval(refresh, 60000);

        return () => {
            s.close();
            clearInterval(poll);
        };
    }, [fetchAll]);


    const RankRow = ({ entry, isTop }) => {
        return (
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                    py: 1,
                    px: 2,
                    borderRadius: 2,
                    // background: 'rgba(255,255,255,0.03)', // Let theme handle cards or keep subtle
                    borderBottom: '1px solid', borderColor: 'divider',
                    mb: 1
                }}
            >
                <Stack direction="row" alignItems="center" spacing={2} sx={{ minWidth: 0 }}>
                    <Box sx={{
                        width: 32, height: 32, borderRadius: '50%', bgcolor: 'action.hover',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14,
                        color: 'text.secondary'
                    }}>
                        {entry.rank}
                    </Box>
                    <Typography noWrap sx={{ fontWeight: 600, fontSize: '1.1rem', maxWidth: '18ch' }}>
                        {entry.customerNickname || entry.customerName}
                    </Typography>
                </Stack>

                <Typography
                    sx={{
                        fontWeight: 900,
                        fontSize: '1.2rem',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                    }}
                    color="primary"
                >
                    {mode === 'AMOUNT' ? money(entry.score) : `${entry.score}`}
                </Typography>
            </Stack>
        );
    };

    const Board = ({ title, data }) => {
        const topThree = (data?.entries || []).slice(0, 3);
        const rest = (data?.entries || []).slice(3, 20); // Show up to 20

        return (
            <Card
                variant="outlined"
                sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}
            >
                <CardContent sx={{ p: 4, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <TrophyIcon color="primary" sx={{ fontSize: 48 }} />
                            <Typography variant="h3" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</Typography>
                        </Stack>
                        <Chip
                            icon={mode === 'AMOUNT' ? <EuroIcon /> : <ShoppingCartIcon />}
                            label={mode === 'AMOUNT' ? 'UMSATZ' : 'ANZAHL'}
                            color="primary"
                            variant="filled"
                            sx={{ fontWeight: 900, borderRadius: 3, height: 40, px: 2, fontSize: '1rem' }}
                        />
                    </Stack>

                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {loading ? (
                            <Typography variant="h5" color="text.secondary" sx={{ mt: 10, textAlign: 'center' }}>Lade Clubscore...</Typography>
                        ) : (data?.entries?.length ?? 0) === 0 ? (
                            <Typography variant="h5" color="text.secondary" sx={{ mt: 10, textAlign: 'center' }}>Keine Einträge vorhanden</Typography>
                        ) : (
                            <>
                                {/* Podium Area */}
                                <Box sx={{ mb: 4, flexShrink: 0 }}>
                                    <Podium topThree={topThree} mode={mode} moneyFormatter={money} />
                                </Box>

                                {/* Grid for Rest */}
                                <Box sx={{
                                    flex: 1,
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gridTemplateRows: 'repeat(9, 1fr)', // Force fit rows
                                    columnGap: 4,
                                    rowGap: 1,
                                    alignContent: 'start',
                                    overflow: 'hidden' // No scroll
                                }}>
                                    {rest.map((e, idx) => (
                                        <RankRow key={e.customerId ?? idx} entry={e} />
                                    ))}
                                </Box>
                            </>
                        )}
                    </Box>
                </CardContent>
            </Card>
        );
    };

    return (
        <>
            <CssBaseline />
            <GlobalStyles styles={{
                body: { overflow: 'hidden' },
                '#root': { height: '100vh', overflow: 'hidden' }
            }} />

            <Box sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                p: 4,
                // Inherit background from body/theme usually, or explicit override if needed for standalone feel
                bgcolor: 'background.default',
                color: 'text.primary'
            }}>

                {/* Header */}
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4, flexShrink: 0 }}>
                    <Stack direction="row" spacing={3} alignItems="center">
                        <Box sx={{
                            width: 80, height: 80,
                            borderRadius: 6,
                            bgcolor: 'primary.main',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 0 60px rgba(0, 230, 118, 0.4)' // Neon Green Glow
                        }}>
                            <TrophyIcon sx={{ fontSize: 48, color: '#000' }} />
                        </Box>
                        <Box>
                            <Typography variant="h2" sx={{ fontWeight: 900, lineHeight: 1, mb: 0.5 }}>Clubscore</Typography>
                            <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 500, opacity: 0.8 }}>
                                {live ? <Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#4caf50', boxShadow: '0 0 15px #4caf50' }} /><span>LIVE UPDATE</span></Stack> : 'Letztes Update: ' + (lastUpdated?.toLocaleTimeString() || '-')}
                            </Typography>
                        </Box>
                    </Stack>

                    {startDate && (
                        <Chip
                            icon={<TimerIcon />}
                            label={`Saisonstart: ${new Date(startDate).toLocaleDateString('de-DE')}`}
                            sx={{ bgcolor: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', height: 48, px: 2, fontSize: '1.1rem', borderRadius: 4 }}
                        />
                    )}
                </Stack>

                {/* Content Grid */}
                <Box sx={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
                    gap: 4,
                    minHeight: 0,
                    overflow: 'hidden'
                }}>
                    <Board title="Heute" data={mode === 'AMOUNT' ? boards.daily.amount : boards.daily.count} />
                    <Board title="Saison" data={mode === 'AMOUNT' ? boards.yearly.amount : boards.yearly.count} />
                </Box>

            </Box>
        </>
    );
}
