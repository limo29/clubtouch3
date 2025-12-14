import React from 'react';
import { Box, Stack, Typography, alpha, keyframes } from '@mui/material';


// Animations
const slideUp = keyframes`
  from { opacity: 0; transform: translateY(50px); }
  to { opacity: 1; transform: translateY(0); }
`;

const PodiumBase = ({ height, color, children }) => (
    <Box
        sx={{
            width: '100%',
            height: height,
            background: `linear-gradient(180deg, ${alpha(color, 0.8)} 0%, ${alpha(color, 0.4)} 100%)`,
            borderRadius: '16px 16px 0 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            pb: 2,
            position: 'relative',
            boxShadow: `0 0 20px ${alpha(color, 0.3)}`,
            border: `1px solid ${alpha(color, 0.5)}`,
            borderBottom: 'none',
        }}
    >
        {children}
    </Box>
);

const PodiumItem = ({ entry, rank, height, color, delay, moneyFormatter, mode }) => {
    if (!entry) return <Box sx={{ width: '30%' }} />;

    const name = entry.customerNickname || entry.customerName || '-';
    const score = mode === 'AMOUNT' ? moneyFormatter(entry.score) : `${entry.score} Stk`;

    return (
        <Stack
            alignItems="center"
            justifyContent="flex-end"
            sx={{
                width: '30%',
                animation: `${slideUp} 0.6s ease-out ${delay}ms both`,
                zIndex: rank === 1 ? 2 : 1
            }}
        >
            {/* Name (No Avatar) */}
            <Typography
                variant={rank === 1 ? 'h5' : 'h6'}
                sx={{
                    fontWeight: 900,
                    mb: 0.5,
                    textAlign: 'center',
                    textShadow: `0 0 10px ${alpha(color, 0.5)}`,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                    fontSize: { xs: '0.9rem', md: '1.2rem' }
                }}
            >
                {name}
            </Typography>

            {/* Score */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontWeight: 700 }}>
                {score}
            </Typography>

            <PodiumBase height={height} color={color}>
                <Typography variant="h2" sx={{ position: 'absolute', bottom: 10, opacity: 0.3, fontWeight: 900, color: '#fff' }}>
                    {rank}
                </Typography>
            </PodiumBase>
        </Stack>
    );
};

export default function Podium({ entries, mode, moneyFormatter }) {

    // Map based on rank if available, otherwise index
    const list = entries || [];
    const p1 = list.find(x => x.rank === 1) || list[0];
    const p2 = list.find(x => x.rank === 2) || list[1];
    const p3 = list.find(x => x.rank === 3) || list[2];

    return (
        <Stack direction="row" alignItems="flex-end" justifyContent="center" spacing={{ xs: 1, md: 3 }} sx={{ width: '100%', height: 240, pt: 2 }}>
            <PodiumItem
                rank={2}
                entry={p2}
                height={130}
                color="#C0C0C0" // Silver
                delay={200}
                mode={mode}
                moneyFormatter={moneyFormatter}
            />
            <PodiumItem
                rank={1}
                entry={p1}
                height={160}
                color="#FFD700" // Gold
                delay={0}
                mode={mode}
                moneyFormatter={moneyFormatter}
            />
            <PodiumItem
                rank={3}
                entry={p3}
                height={100}
                color="#CD7F32" // Bronze
                delay={400}
                mode={mode}
                moneyFormatter={moneyFormatter}
            />
        </Stack>
    );
}
