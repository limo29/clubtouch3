import React, { useEffect } from 'react';
import { Box, Stack, Typography, Chip, alpha } from '@mui/material';
import { usePrevious } from '../../hooks/usePrevious';

export default function GoalBar({ goal, movingTargets, onMilestone }) {
    const initialTarget = Math.max(1, Number(goal.targetUnits || 1));
    const step = Math.max(1, Number(goal.unitsPerPurchase || 1));
    const total = Number(goal.totalUnits || 0);


    // Moving Target Logic
    let currentTarget = initialTarget;
    if (movingTargets) {
        const factor = Math.floor(total / initialTarget);
        // If exact multiple, target is next level. e.g. 24/24 -> factor 1 -> target 48
        currentTarget = initialTarget * (factor + 1);
    }

    const pct = Math.min(100, (total / currentTarget) * 100);

    // Gradient Colors
    const getGradient = (p) => {
        if (p < 33) return 'linear-gradient(90deg, #ef5350, #ff8a80)';
        if (p < 66) return 'linear-gradient(90deg, #ffb300, #ffd54f)';
        return 'linear-gradient(90deg, #43a047, #66bb6a)'; // Vibrant Green
    };

    const gradient = getGradient(pct);
    const color = pct < 33 ? '#ef5350' : pct < 66 ? '#ffb300' : '#43a047';


    // Milestone detection
    const level = Math.floor(total / initialTarget);
    const prevLevel = usePrevious(level);

    useEffect(() => {
        if (prevLevel !== undefined && level > prevLevel && level > 0) {
            if (movingTargets || level === 1) {
                onMilestone?.(goal, level);
            }
        }
    }, [level, prevLevel, onMilestone, goal, movingTargets]);

    return (
        <Box sx={{ width: '100%' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 1.5 }}>
                <Box sx={{ minWidth: 0, mr: 2 }}>
                    <Typography variant="h6" noWrap sx={{
                        fontWeight: 900,
                        lineHeight: 1.2,
                        fontSize: '1.2rem',
                        color: 'text.primary',
                        textShadow: '0 2px 10px rgba(0,0,0,0.5)'
                    }}>
                        {goal.label || goal.articleName}
                        {movingTargets && level > 0 && (
                            <Chip
                                label={`LEVEL ${level + 1}`}
                                size="small"
                                sx={{
                                    height: 20,
                                    ml: 1.5,
                                    fontWeight: 900,
                                    background: 'linear-gradient(45deg, #d50000, #ff1744)',
                                    color: 'white',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    boxShadow: '0 2px 8px rgba(213,0,0,0.4)',
                                    letterSpacing: 1
                                }}
                            />
                        )}
                    </Typography>
                    <Typography variant="caption" sx={{
                        opacity: 0.8,
                        fontWeight: 600,
                        display: 'block',
                        mt: 0.5,
                        color: 'text.secondary',
                        letterSpacing: 0.5
                    }}>
                        {step} EINHEITEN / MILESTONE
                    </Typography>
                </Box>
                <Typography variant="h4" sx={{
                    fontWeight: 900,
                    color: color,
                    whiteSpace: 'nowrap',
                    lineHeight: 1,
                    fontSize: '4rem',
                    textShadow: `0 0 20px ${alpha(color, 0.5)}`
                }}>
                    {Math.floor(total)} <Typography component="span" variant="body2" sx={{ opacity: 0.5, fontWeight: 700, fontSize: '3rem', color: 'text.secondary' }}>/ {currentTarget} </Typography>
                </Typography>
            </Stack>

            <Box sx={{
                height: 32,
                bgcolor: alpha('#fff', 0.05),
                borderRadius: 4,
                overflow: 'hidden',
                position: 'relative',
                boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05)'
            }}>
                {/* Ticks */}
                {Array.from({ length: Math.floor(currentTarget / step) }).map((_, i) => {
                    const tickPct = ((i + 1) * step / currentTarget) * 100;
                    if (tickPct >= 100) return null;
                    return (
                        <Box
                            key={i}
                            sx={{
                                position: 'absolute',
                                left: `${tickPct}%`,
                                top: 4, bottom: 4,
                                width: 2,
                                bgcolor: 'rgba(0,0,0,0.5)',
                                zIndex: 1
                            }}
                        />
                    );
                })}

                {/* Bar */}
                <Box sx={{
                    position: 'absolute',
                    inset: 0,
                    width: `${pct}%`,
                    background: gradient,
                    transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    boxShadow: `0 0 30px ${alpha(color, 0.6)}`,
                    '&::after': {
                        content: '""',
                        position: 'absolute',
                        top: 0, left: 0, right: 0, height: '50%',
                        background: 'linear-gradient(to bottom, rgba(255,255,255,0.3), transparent)',
                    }
                }} />
            </Box>
        </Box>
    );
}
