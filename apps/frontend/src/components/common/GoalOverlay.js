import React, { useEffect, useState } from 'react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { Box, Typography } from '@mui/material';
import { keyframes } from '@emotion/react';

const popIn = keyframes`
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const getColorsForType = (type) => {
  switch (type) {
    case 'GOAL': return ['#FFD700', '#FFA500', '#FF4500', '#FFFFFF']; // Gold/Orange
    case 'DAILY_RANK_1': return ['#00E676', '#69F0AE', '#B9F6CA', '#FFFFFF']; // Green/Mint
    case 'DAILY_RANK': return ['#2979FF', '#448AFF', '#82B1FF', '#FFFFFF']; // Blue
    case 'YEARLY_RANK_1': return ['#FFD700', '#E0AA3E', '#FDD835', '#FFFFFF', '#000000']; // Gold/Lux
    case 'YEARLY_RANK': return ['#9C27B0', '#E1BEE7', '#BA68C8', '#FFFFFF']; // Purple
    default: return ['#FFD700', '#FFFFFF'];
  }
};

const getTitleForType = (type) => {
  if (type === 'GOAL') return 'Ziel erreicht!';
  if (type.includes('RANK_1')) return 'Neuer Spitzenreiter!';
  return 'Aufstieg!';
};

const getGradientForType = (type) => {
  if (type === 'GOAL') return 'linear-gradient(45deg, #FFD700, #FFA500)';
  if (type === 'YEARLY_RANK_1') return 'linear-gradient(45deg, #FFD700, #FDB931, #996515)';
  if (type.includes('YEARLY')) return 'linear-gradient(45deg, #9C27B0, #E040FB)';
  if (type === 'DAILY_RANK_1') return 'linear-gradient(45deg, #00E676, #69F0AE)';
  return 'linear-gradient(45deg, #2979FF, #40C4FF)';
}

export default function GoalOverlay({ trigger, type = 'GOAL', message, onComplete }) {
  const { width, height } = useWindowSize();
  const [active, setActive] = useState(false);
  const [config, setConfig] = useState({});

  useEffect(() => {
    if (trigger) {
      setActive(true);
      // Randomize per trigger
      setConfig({
        numberOfPieces: 400,
        gravity: 0.2 + Math.random() * 0.2,
        wind: (Math.random() - 0.5) * 0.1,
        colors: getColorsForType(type),
      });

      const timer = setTimeout(() => {
        setActive(false);
        if (onComplete) onComplete();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [trigger, type, onComplete]);

  if (!active) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
        bgcolor: 'rgba(0,0,0,0.3)',
      }}
    >
      <Confetti
        width={width}
        height={height}
        recycle={false}
        {...config}
      />
      <Box
        sx={{
          animation: `${popIn} 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards`,
          textAlign: 'center',
          textShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}
      >
        <Typography
          variant="h1"
          sx={{
            fontWeight: 900,
            color: 'white',
            background: getGradientForType(type),
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: { xs: '3rem', md: '6rem' },
            mb: 2,
          }}
        >
          {getTitleForType(type)}
        </Typography>
        {message && (
          <Typography variant="h3" sx={{ color: 'white', fontWeight: 800, px: 4 }}>
            {message}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
