import React, { memo } from 'react';
import { Box, Stack, Typography, alpha, keyframes } from '@mui/material';
import GroupBadge from '../customers/GroupBadge';
import { displayName, scoreText } from './format';

const flashAnim = keyframes`
  0% { background-color: rgba(255, 213, 79, 0.45); }
  100% { background-color: transparent; }
`;

/** Rangpfeil ▲n / ▼n / NEU */
export function RankChange({ change, fontSize = '0.75rem' }) {
  if (!change) return null;
  if (change.isNew) {
    return (
      <Box component="span" aria-label="neu in der Wertung"
        sx={{ fontSize, fontWeight: 800, color: 'info.main', px: 0.5, borderRadius: 1, bgcolor: (t) => alpha(t.palette.info.main, 0.15) }}>
        NEU
      </Box>
    );
  }
  if (!change.dir || !change.n) return null;
  const up = change.dir > 0;
  return (
    <Box component="span" aria-label={up ? `${change.n} Plätze hoch` : `${change.n} Plätze runter`}
      sx={{ fontSize, fontWeight: 800, color: up ? 'success.main' : 'error.main', whiteSpace: 'nowrap' }}>
      {up ? '▲' : '▼'}{change.n}
    </Box>
  );
}

/** Kurzform für einzeilige Zeilen: der Vordermann steht direkt darüber. */
const shortGap = (gap) => gap.replace(/ bis Platz \d+$/, '').replace(/^Gleichstand mit Platz \d+$/, 'Gleichstand');

/**
 * Zeile ab Platz 4. size: 'md' (intern) | 'lg' (TV). gap: Text „+3,50 € bis Platz 3“ oder null.
 * dense: einzeilig, Abstand klein hinter dem Namen (TV, damit alle 20 Plätze passen).
 */
function RankRow({ entry, mode, change, gap, size = 'md', dense = false }) {
  const lg = size === 'lg';
  return (
    <Box
      key={change?.flash || 'row'}
      sx={{
        display: 'flex', alignItems: 'center', gap: lg ? 1.5 : 1,
        px: lg ? 1.5 : 1, py: lg ? 0 : 0.5, minHeight: 0, height: lg || dense ? '100%' : 'auto',
        borderBottom: '1px solid', borderColor: 'divider', borderRadius: 1,
        animation: change?.flash ? `${flashAnim} 2.5s ease-out` : 'none',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none', ...(change?.flash && { bgcolor: 'action.selected' }) },
      }}
    >
      <Box sx={{
        width: lg ? 36 : 28, height: lg ? 36 : 28, flexShrink: 0, borderRadius: '50%', bgcolor: 'action.hover',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: lg ? '1.2rem' : '0.85rem', color: 'text.secondary',
      }}>
        {entry.rank}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          {entry.group && <GroupBadge group={entry.group} size={lg ? 26 : 18} />}
          <Typography noWrap sx={{ fontWeight: 600, fontSize: lg ? '1.35rem' : '0.95rem', minWidth: 0 }}>
            {displayName(entry)}
          </Typography>
          <RankChange change={change} fontSize={lg ? '1rem' : '0.72rem'} />
          {dense && gap && (
            <Typography noWrap title={gap} sx={{ fontSize: lg ? '0.95rem' : '0.72rem', color: 'text.secondary', minWidth: 0, flexShrink: 1000, pl: 0.5 }}>
              {shortGap(gap)}
            </Typography>
          )}
        </Stack>
        {!dense && gap && (
          <Typography noWrap sx={{ fontSize: lg ? '0.95rem' : '0.72rem', color: 'text.secondary', lineHeight: 1.2 }}>
            {gap}
          </Typography>
        )}
      </Box>
      <Typography color="primary" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: lg ? '1.4rem' : '1rem', whiteSpace: 'nowrap' }}>
        {scoreText(mode, entry.score)}
      </Typography>
    </Box>
  );
}

export default memo(RankRow);
