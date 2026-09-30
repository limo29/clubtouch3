import React, { memo } from 'react';
import { Box, Stack, Typography, alpha, keyframes } from '@mui/material';
import GroupBadge from '../customers/GroupBadge';
import { RankChange } from './RankRow';
import { displayName, scoreText } from './format';

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
`;

const COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];
// Reihenfolge links → rechts: Platz 2, 1, 3 (Positionen, nicht Rangzahl – bei Gleichstand teilen sich zwei den Rang)
const SLOTS = [{ idx: 1, h: 0.78 }, { idx: 0, h: 1 }, { idx: 2, h: 0.6 }];

function PodiumItem({ entry, idx, baseHeight, mode, change, gap, lg }) {
  const color = COLORS[idx];
  if (!entry) return <Box sx={{ width: '31%' }} />;
  return (
    <Stack alignItems="center" justifyContent="flex-end" sx={{
      width: '31%', minWidth: 0, height: '100%',
      animation: `${slideUp} 0.6s ease-out ${idx * 150}ms both`,
      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    }}>
      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" sx={{ maxWidth: '100%', minWidth: 0 }}>
        {entry.group && <GroupBadge group={entry.group} size={lg ? 34 : 20} />}
        <Typography noWrap sx={{
          fontWeight: 900, minWidth: 0, textShadow: `0 0 10px ${alpha(color, 0.5)}`,
          fontSize: lg ? (idx === 0 ? '2rem' : '1.6rem') : { xs: '0.9rem', md: idx === 0 ? '1.2rem' : '1.05rem' },
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
      <Box sx={{
        width: '100%', height: baseHeight, flexShrink: 0, position: 'relative',
        background: `linear-gradient(180deg, ${alpha(color, 0.8)} 0%, ${alpha(color, 0.35)} 100%)`,
        borderRadius: '14px 14px 0 0', border: `1px solid ${alpha(color, 0.5)}`, borderBottom: 'none',
        boxShadow: `0 0 20px ${alpha(color, 0.25)}`,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden',
      }}>
        <Typography sx={{ fontWeight: 900, color: '#fff', opacity: 0.45, lineHeight: 1,
          fontSize: `${Math.max(14, Math.min(lg ? 56 : 35, Math.round(baseHeight * 0.9)))}px` }}>
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
      {SLOTS.map((s) => (
        <PodiumItem key={s.idx} idx={s.idx} entry={list[s.idx]} baseHeight={Math.round(maxBase * s.h)} mode={mode} change={changes[s.idx]} gap={gaps[s.idx]} lg={lg} />
      ))}
    </Stack>
  );
}

export default memo(Podium);
