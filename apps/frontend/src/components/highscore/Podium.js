import React, { memo } from 'react';
import { Box, Stack, Typography, alpha, darken, keyframes } from '@mui/material';
import { DISPLAY_FONTS } from '../display/StageChrome';
import GroupBadge from '../customers/GroupBadge';
import { RankChange } from './RankRow';
import { displayName, scoreText } from './format';

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
`;

const COLORS = ['#FFC400', '#C0C0C0', '#CD7F32'];
const HEIGHTS = [1, 0.78, 0.6];
// Reihenfolge links → rechts: 2., 1., 3. Eintrag (Positionen). Farbe und Sockelhöhe kommen aus dem Rang:
// bei Gleichstand teilen sich mehrere den Rang und stehen gleich hoch in derselben Farbe.
const SLOTS = [1, 0, 2];
const tier = (entry, idx) => Math.min(2, Math.max(0, (Number(entry?.rank) || idx + 1) - 1));

function PodiumItem({ entry, idx, baseHeight, mode, change, gap, lg }) {
  if (!entry) return <Box sx={{ width: idx === 0 ? '37%' : '29%' }} />;
  const t = tier(entry, idx);
  const color = COLORS[t];
  return (
    <Stack alignItems="center" justifyContent="flex-end" sx={{
      width: idx === 0 ? '37%' : '29%', minWidth: 0, height: '100%',
      animation: `${slideUp} 0.6s ease-out ${idx * 150}ms both`,
      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    }}>
      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" sx={{ maxWidth: '100%', minWidth: 0 }}>
        {entry.group && <GroupBadge group={entry.group} size={lg ? 34 : 20} />}
        <Typography sx={{
          fontWeight: 900, minWidth: 0, textAlign: 'center', lineHeight: 1.1,
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', overflowWrap: 'break-word',
          textShadow: (t) => (t.palette.mode === 'dark' ? `0 0 10px ${alpha(color, 0.35)}` : 'none'),
          fontSize: lg ? (t === 0 ? '2rem' : '1.6rem') : { xs: '0.9rem', md: t === 0 ? '1.2rem' : '1.05rem' },
        }}>
          {displayName(entry)}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Typography sx={{ fontWeight: 800, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', fontSize: lg ? '1.5rem' : '0.9rem' }}>
          {scoreText(mode, entry.score)}
        </Typography>
        <RankChange change={change} fontSize={lg ? '1rem' : '0.72rem'} />
      </Stack>
      <Typography noWrap sx={{ fontSize: lg ? '0.95rem' : '0.7rem', color: 'text.secondary', mb: 0.5, minHeight: lg ? 22 : 16, maxWidth: '100%' }}>
        {gap || ''}
      </Typography>
      {/* Sockel bewusst dunkel: die Metallfarbe steckt in Oberkante und Rangzahl, nicht in einer großen hellen Fläche
          (im dunklen Clubraum leuchtet jede helle Fläche auf dem Fernseher). */}
      <Box sx={{
        width: '100%', height: baseHeight, flexShrink: 0, position: 'relative',
        background: `linear-gradient(180deg, ${alpha(color, 0.24)} 0%, ${alpha(color, 0.04)} 100%)`,
        borderRadius: '10px 10px 0 0', borderTop: `${lg ? 6 : 4}px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        <Typography sx={{ fontFamily: DISPLAY_FONTS.headline, fontWeight: 400, lineHeight: 1,
          color: (t) => (t.palette.mode === 'dark' ? color : darken(color, 0.35)),
          fontSize: `${Math.max(16, Math.min(lg ? 96 : 52, Math.round(baseHeight * 0.85)))}px` }}>
          {entry.rank}
        </Typography>
      </Box>
    </Stack>
  );
}

/** Podium Platz 1–3. height in px; size 'md' | 'lg' (TV); changes: Array je Position */
function Podium({ entries, mode, height = 200, size = 'md', changes = [], gaps = [] }) {
  const list = entries || [];
  const lg = size === 'lg';
  const textH = lg ? 116 : 70; // Name + Wert über dem Sockel
  const maxBase = Math.max(30, height - textH);
  return (
    <Stack direction="row" alignItems="flex-end" justifyContent="center" spacing={{ xs: 1, md: 2 }}
      sx={{ width: '100%', height }} role="list" aria-label="Podium">
      {SLOTS.map((idx) => (
        <PodiumItem key={idx} idx={idx} entry={list[idx]} baseHeight={Math.round(maxBase * HEIGHTS[tier(list[idx], idx)])}
          mode={mode} change={changes[idx]} gap={gaps[idx]} lg={lg} />
      ))}
    </Stack>
  );
}

export default memo(Podium);
