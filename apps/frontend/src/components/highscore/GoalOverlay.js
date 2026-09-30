import React, { useEffect, useRef, useState } from 'react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { Box, Stack, Typography, keyframes } from '@mui/material';
import GroupBadge from '../customers/GroupBadge';

const popIn = keyframes`
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const SHOW_MS = 6000;
const CONFETTI_MS = 3000;

const STYLE = {
  GOAL_REACHED: { colors: ['#FFD700', '#FFA500', '#FF4500', '#FFFFFF'], gradient: 'linear-gradient(45deg, #FFD700, #FFA500)' },
  NEW_LEADER_DAY: { colors: ['#00E676', '#69F0AE', '#B9F6CA', '#FFFFFF'], gradient: 'linear-gradient(45deg, #00E676, #69F0AE)' },
  NEW_LEADER_YEAR: { colors: ['#FFD700', '#E0AA3E', '#FDD835', '#FFFFFF'], gradient: 'linear-gradient(45deg, #FFD700, #FDB931, #C58B1E)' },
  TEAM_LEAD_DAY: { colors: ['#2979FF', '#448AFF', '#82B1FF', '#FFFFFF'], gradient: 'linear-gradient(45deg, #2979FF, #40C4FF)' },
};

const prefersReducedMotion = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Großes Overlay für eine Meldung (level 'big'). Text kommt fest aus event.title / event.text.
 * Konfetti 3 s, bei prefers-reduced-motion nur das Banner. onDone nach ~6 s (Timer stabil pro Meldung).
 */
export default function GoalOverlay({ event, onDone, zIndex = 1290 }) {
  const { width, height } = useWindowSize();
  const [confetti, setConfetti] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const reduced = prefersReducedMotion();
  const id = event?.id;

  useEffect(() => {
    if (!id) return undefined;
    setConfetti(!reduced);
    const c = setTimeout(() => setConfetti(false), CONFETTI_MS);
    const t = setTimeout(() => doneRef.current?.(), SHOW_MS);
    return () => { clearTimeout(c); clearTimeout(t); };
  }, [id, reduced]);

  if (!event) return null;
  const style = STYLE[event.kind] || STYLE.GOAL_REACHED;

  return (
    <Box role="alert" aria-live="assertive" sx={{
      position: 'fixed', inset: 0, zIndex, pointerEvents: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'rgba(0,0,0,0.45)', backdropFilter: reduced ? 'none' : 'blur(3px)',
    }}>
      {confetti && <Confetti width={width} height={height} recycle={false} numberOfPieces={350} colors={style.colors} />}
      <Stack alignItems="center" spacing={2} sx={{
        textAlign: 'center', px: 4, maxWidth: 1400,
        animation: reduced ? 'none' : `${popIn} 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both`,
        textShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}>
        {event.group && <GroupBadge group={event.group} size={96} tooltip={false} />}
        <Typography sx={{
          fontWeight: 900, lineHeight: 1.05, fontSize: { xs: '2.6rem', md: '5.5rem' },
          background: style.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          {event.title}
        </Typography>
        {event.text && (
          <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: { xs: '1.4rem', md: '2.8rem' } }}>
            {event.text}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
