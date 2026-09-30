import React, { memo } from 'react';
import { Box, Card, Chip, Stack, Typography } from '@mui/material';
import FlagIcon from '@mui/icons-material/Flag';
import GoalBar from './GoalBar';

/** Tagesziele als Karte; nichts, wenn keine Ziele gesetzt sind. */
function GoalsSection({ goals, size = 'md', columnsMax = 3 }) {
  const list = goals?.goals || [];
  if (!list.length) return null;
  const lg = size === 'lg';
  const cols = Math.min(list.length, lg ? 6 : columnsMax);
  return (
    <Card variant="outlined" component="section" aria-label="Tagesziele" sx={{ flexShrink: 0, bgcolor: 'background.paper' }}>
      <Box sx={{ px: lg ? 3 : { xs: 1.5, md: 2 }, py: lg ? 2 : 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: lg ? 1.5 : 1 }}>
          <FlagIcon fontSize={lg ? 'medium' : 'small'} color="primary" />
          <Typography sx={{ fontWeight: 800, fontSize: lg ? '1.5rem' : '1rem' }}>Tagesziele</Typography>
          {goals.movingTargets && <Chip size="small" variant="outlined" label="mitwachsend" />}
          <Box sx={{ flex: 1 }} />
          {goals.monthReached > 0 && (
            <Typography color="text.secondary" sx={{ fontSize: lg ? '1.1rem' : '0.78rem' }}>
              {goals.monthReached} {goals.monthReached === 1 ? 'Ziel' : 'Ziele'} diesen Monat geschafft
            </Typography>
          )}
        </Stack>
        <Box sx={{
          display: 'grid', gap: lg ? 4 : { xs: 1.5, md: 3 },
          gridTemplateColumns: lg
            ? `repeat(${cols}, minmax(0, 1fr))`
            : { xs: '1fr', sm: `repeat(${Math.min(cols, 2)}, minmax(0, 1fr))`, md: `repeat(${cols}, minmax(0, 1fr))` },
        }}>
          {list.map((g, i) => <GoalBar key={g.id || i} goal={g} movingTargets={goals.movingTargets} size={size} />)}
        </Box>
      </Box>
    </Card>
  );
}

export default memo(GoalsSection);
