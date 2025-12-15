import React, { useEffect, useState } from 'react'; // Optimization: Removed unused imports
import {
    Box, Card, CardContent, Chip, Stack, CssBaseline,
    Typography, GlobalStyles, alpha, useTheme, Grid
} from '@mui/material';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import FlagIcon from '@mui/icons-material/Flag';

import Podium from '../components/common/Podium';
import GoalOverlay from '../components/common/GoalOverlay';
import { useHighscoreLogic } from '../hooks/useHighscoreLogic';
// import { usePrevious } from '../hooks/usePrevious'; // We still need this for GoalBar's internal logic -> No we don't, GoalBar imports it itself.
import GoalBar from '../components/common/GoalBar';

// Helper functions
const money = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0);



/* -------------------------------------------------------------------------- */
/*                           PUBLIC HIGHSCORE PAGE                            */
/* -------------------------------------------------------------------------- */
export default function PublicHighscore() {
    // USE THE HOOK
    const {
        boards, goalProgress, loading, live, lastUpdated, startDate,
        overlay, setOverlay
    } = useHighscoreLogic();

    const [mode, setMode] = useState('AMOUNT'); // 'AMOUNT' | 'COUNT'

    // Auto-rotate mode every 15s
    useEffect(() => {
        const t = setInterval(() => setMode(p => p === 'AMOUNT' ? 'COUNT' : 'AMOUNT'), 15000);
        return () => clearInterval(t);
    }, []);

    const theme = useTheme();

    // Milestone Handler (UI specific)
    const handleMilestone = (goal, level) => {
        const target = Math.max(1, Number(goal.targetUnits));
        const total = target * (level);
        setOverlay({
            active: true,
            type: 'GOAL',
            message: `Ziel erreicht! ${goal.label}: ${total} ${goal.purchaseUnit || 'Stk'}!`
        });
    };

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
                    borderBottom: '1px solid', borderColor: 'divider',
                    mb: 1,
                    bgcolor: isTop ? alpha(theme.palette.primary.main, 0.1) : 'transparent'
                }}
            >
                <Stack direction="row" alignItems="center" spacing={2} sx={{ minWidth: 0 }}>
                    <Box sx={{
                        width: 32, height: 32, borderRadius: '50%', bgcolor: 'action.hover',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'text.secondary'
                    }}>
                        {entry.rank}
                    </Box>
                    <Typography variant="body1" noWrap sx={{ fontWeight: isTop ? 700 : 500 }}>
                        {entry.customerNickname || entry.customerName}
                    </Typography>
                </Stack>
                <Typography
                    sx={{ fontWeight: 900, fontSize: '1.2rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                    color="primary"
                >
                    {mode === 'AMOUNT' ? money(entry.score) : `${entry.score}`}
                </Typography>
            </Stack>
        );
    };

    const Board = ({ title, data }) => {
        const topThree = (data?.entries || []).slice(0, 3);
        const rest = (data?.entries || []).slice(3, 20);

        return (
            <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' }}>
                <CardContent sx={{ p: 4, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main' }}>
                                <TrophyIcon fontSize="large" />
                            </Box>
                            <Box>
                                <Typography variant="h4" fontWeight={900}>{title}</Typography>
                                <Typography variant="subtitle1" color="text.secondary">
                                    {mode === 'AMOUNT' ? 'Nach Umsatz' : 'Nach Anzahl'} &bull; Top 20
                                </Typography>
                            </Box>
                        </Stack>
                        {topThree.length > 0 && (
                            <Box sx={{ textAlign: 'right' }}>
                                <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, opacity: 0.6 }}>Top Score</Typography>
                                <Typography variant="h3" color="primary" sx={{ fontWeight: 900, lineHeight: 1 }}>
                                    {mode === 'AMOUNT' ? money(topThree[0].score) : topThree[0].score}
                                </Typography>
                            </Box>
                        )}
                    </Stack>

                    {data?.entries?.length === 0 ? (
                        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                            <Typography variant="h5">Noch keine Daten</Typography>
                        </Box>
                    ) : (
                        <>
                            {/* Podium */}
                            <Box sx={{ mb: 4 }}>
                                <Podium entries={topThree} mode={mode} moneyFormatter={money} />
                            </Box>

                            {/* List */}
                            <Box sx={{
                                flex: 1,
                                overflowY: 'auto',
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
                                columnGap: 4,
                                rowGap: 1,
                                alignContent: 'start',
                                overflow: 'hidden'
                            }}>
                                {rest.map((e, idx) => (
                                    <RankRow key={e.customerId ?? idx} entry={e} />
                                ))}
                            </Box>
                        </>
                    )}
                </CardContent>
            </Card>
        );
    };

    if (loading) return null; // Or a spinner

    return (
        <Box sx={{
            height: '100vh',
            width: '100vw',
            bgcolor: '#0a0a0a',
            color: 'white',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            p: 3
        }}>
            <CssBaseline />
            <GlobalStyles styles={{
                body: { overflow: 'hidden', backgroundColor: '#0a0a0a' },
                '::-webkit-scrollbar': { width: 8, height: 8 },
                '::-webkit-scrollbar-track': { background: 'transparent' },
                '::-webkit-scrollbar-thumb': { background: '#333', borderRadius: 4 },
                '::-webkit-scrollbar-thumb:hover': { background: '#555' }
            }} />

            <GoalOverlay
                trigger={overlay.active}
                type={overlay.type}
                message={overlay.message}
                onComplete={() => setOverlay({ ...overlay, active: false })}
            />

            {/* Header */}
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
                <Stack direction="row" spacing={3} alignItems="center">
                    <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: -1, background: 'linear-gradient(45deg, #FFF, #999)', backgroundClip: 'text', textFillColor: 'transparent', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Clubscore
                    </Typography>
                    {live && <Chip icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#00e676', boxShadow: '0 0 10px #00e676' }} />} label="LIVE" size="small" sx={{ bgcolor: alpha('#00e676', 0.1), color: '#00e676', fontWeight: 800, border: '1px solid', borderColor: alpha('#00e676', 0.2) }} />}
                </Stack>

                <Stack direction="row" spacing={4} alignItems="center">
                    <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>Zeitraum</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1 }}>
                            {startDate ? startDate.toLocaleDateString('de-DE') : 'Heute'}
                        </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>Letztes Update</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1, fontFamily: 'monospace' }}>
                            {lastUpdated ? lastUpdated.toLocaleTimeString('de-DE') : '--:--'}
                        </Typography>
                    </Box>
                </Stack>
            </Stack>

            {/* Content Grid */}
            <Box sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                overflowY: { xs: 'auto', md: 'hidden' }, // Scroll on mobile, auto-fit on desktop
                pr: { xs: 1, md: 0 } // Right padding for scrollbar on mobile
            }}>
                {/* Top: Goals (if any) */}
                {goalProgress.goals.filter(g => g.articleId).length > 0 && (
                    <Card variant="outlined" sx={{ flexShrink: 0, bgcolor: 'background.paper' }}>
                        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                                <FlagIcon fontSize="small" color="primary" />
                                <Typography variant="h6" fontWeight={800}>Tagesziele</Typography>
                            </Stack>
                            <Grid container spacing={4} justifyContent="center">
                                {goalProgress.goals.filter(g => g.articleId).map((g, i, arr) => {
                                    const count = arr.length;
                                    const smSize = count === 1 ? 12 : 6;
                                    const mdSize = count === 1 ? 12 : count === 2 ? 6 : count === 3 ? 4 : 3;

                                    return (
                                        <Grid size={{ xs: 12, sm: smSize, md: mdSize }} key={g.articleId || i}>
                                            <GoalBar
                                                goal={g}
                                                movingTargets={goalProgress.meta?.movingTargets}
                                                onMilestone={handleMilestone}
                                            />
                                        </Grid>
                                    );
                                })}
                            </Grid>
                        </CardContent>
                    </Card>
                )}

                {/* Boards Split */}
                <Box sx={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' }, // Stack on mobile
                    gap: 3,
                    pb: { xs: 4, md: 0 } // Bottom padding on mobile
                }}>
                    {/* Daily Board */}
                    <Box sx={{ flex: 1, minWidth: 0, minHeight: { xs: 600, md: 0 } }}>
                        <Board
                            title="Tages-Ranking"
                            data={mode === 'AMOUNT' ? boards.daily.amount : boards.daily.count}
                        />
                    </Box>

                    {/* Yearly Board */}
                    <Box sx={{ flex: 1, minWidth: 0, minHeight: { xs: 600, md: 0 } }}>
                        <Board
                            title="Jahres-Charts"
                            data={mode === 'AMOUNT' ? boards.yearly.amount : boards.yearly.count}
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
