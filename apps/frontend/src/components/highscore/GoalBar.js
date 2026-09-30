import React, { memo } from 'react';
import { Box, Chip, Stack, Typography, alpha } from '@mui/material';
import GroupBadge from '../customers/GroupBadge';
import { num, unitLabel, fmtNumber } from '../../utils/format';
import { goalValueText, timeHM } from './format';

const MAX_TICKS = 20;
const stateColor = (pct, reached) => (reached ? '#43a047' : pct < 33 ? '#ef5350' : pct < 66 ? '#ffb300' : '#7cb342');

/** Beschriftung des Fortschritts, z. B. „Kiste 2 von 3“ */
const progressLabel = (goal, current, displayTarget, upp) => {
  if (goal.kind === 'REVENUE') return `${goalValueText(goal, current)} von ${goalValueText(goal, displayTarget)}`;
  if (goal.kind === 'ARTICLE' && upp > 1) {
    const crates = Math.max(1, Math.ceil(displayTarget / upp));
    const unit = goal.purchaseUnit || 'Kiste';
    if (current >= displayTarget) return `${crates} von ${crates} ${unitLabel(unit, crates)} voll`;
    return `${unit} ${Math.min(crates, Math.floor(current / upp) + 1)} von ${crates}`;
  }
  return `${fmtNumber(Math.round(current))} von ${fmtNumber(Math.round(displayTarget))} Stk`;
};

/** Fortschritt eines Tagesziels. size 'md' (intern) | 'lg' (TV) */
function GoalBar({ goal, movingTargets, size = 'md' }) {
  const lg = size === 'lg';
  const target = Math.max(0.01, num(goal.target));
  const current = num(goal.current);
  const level = Number.isFinite(Number(goal.level)) ? Number(goal.level) : Math.floor(current / target);
  const displayTarget = num(goal.displayTarget) || (movingTargets ? target * (level + 1) : target);
  const reached = movingTargets ? false : (goal.reached ?? current >= target);
  const pct = Math.min(100, (current / displayTarget) * 100);
  const upp = goal.kind === 'ARTICLE' ? Math.max(1, num(goal.unitsPerPurchase)) : 1;
  const crateCount = upp > 1 ? Math.ceil(displayTarget / upp) : 0;
  const ticks = crateCount > 1 && crateCount <= MAX_TICKS ? crateCount - 1 : 0;
  const color = goal.group?.color || stateColor(pct, reached);
  const title = goal.label || goal.articleName || goal.category || (goal.kind === 'REVENUE' ? 'Tagesumsatz' : 'Ziel');
  const rest = Math.max(0, displayTarget - current);

  let status;
  if (reached) {
    status = `Geschafft${goal.reachedAt ? ` um ${timeHM(goal.reachedAt)}` : ''}${goal.reachedBy?.name ? ` · ${goal.reachedBy.name}` : ''}`;
  } else if (goal.forecastAt) {
    status = `noch ${goalValueText(goal, rest)} · voraussichtlich ~${timeHM(goal.forecastAt)}`;
  } else {
    status = `noch ${goalValueText(goal, rest)}`;
  }
  if (movingTargets && level > 0) {
    status = `Stufe ${level} geschafft${goal.reachedBy?.name ? ` (${goal.reachedBy.name})` : ''} · ${status}`;
  }

  return (
    <Box sx={{ width: '100%', minWidth: 0 }} role="group"
      aria-label={`${goal.group ? `${goal.group.name}: ` : ''}${title}, ${progressLabel(goal, current, displayTarget, upp)}`}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-end" spacing={1.5} sx={{ mb: lg ? 1 : 0.75 }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            {goal.group && <GroupBadge group={goal.group} size={lg ? 32 : 22} />}
            <Typography noWrap sx={{ fontWeight: 900, lineHeight: 1.2, fontSize: lg ? '1.6rem' : 'clamp(0.95rem, 1.4vw, 1.2rem)', minWidth: 0 }}>
              {goal.group ? `${goal.group.name}: ` : ''}{title}
            </Typography>
            {movingTargets && level > 0 && (
              <Chip label={`Stufe ${level + 1}`} size="small" color="error"
                sx={{ fontWeight: 800, height: lg ? 26 : 20, fontSize: lg ? '0.95rem' : '0.7rem', flexShrink: 0 }} />
            )}
          </Stack>
          <Typography noWrap color="text.secondary" sx={{ fontWeight: 600, fontSize: lg ? '1.1rem' : '0.78rem', mt: 0.25 }}>
            {progressLabel(goal, current, displayTarget, upp)}
          </Typography>
        </Box>
        <Typography sx={{
          fontWeight: 900, whiteSpace: 'nowrap', lineHeight: 1, color, fontVariantNumeric: 'tabular-nums',
          fontSize: lg ? '3rem' : 'clamp(1.4rem, 2.6vw, 2.4rem)', textShadow: `0 0 18px ${alpha(color, 0.4)}`,
        }}>
          {goal.kind === 'REVENUE' ? Math.floor(current) : Math.round(current)}
          <Box component="span" sx={{ opacity: 0.55, fontWeight: 700, fontSize: '0.6em', color: 'text.secondary' }}>
            {' / '}{goal.kind === 'REVENUE' ? `${Math.round(displayTarget)} €` : Math.round(displayTarget)}
          </Box>
        </Typography>
      </Stack>

      <Box sx={{ height: lg ? 30 : 20, bgcolor: alpha('#888', 0.18), borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
        <Box sx={{
          position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 99,
          background: `linear-gradient(90deg, ${alpha(color, 0.7)}, ${color})`,
          transition: 'width 0.8s ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }} />
        {Array.from({ length: ticks }).map((_, i) => (
          <Box key={i} sx={{
            position: 'absolute', left: `${(((i + 1) * upp) / displayTarget) * 100}%`, top: 3, bottom: 3, width: 2,
            bgcolor: 'rgba(0,0,0,0.45)',
          }} />
        ))}
      </Box>
      <Typography noWrap sx={{ mt: 0.5, fontSize: lg ? '1.05rem' : '0.75rem', color: reached ? 'success.main' : 'text.secondary', fontWeight: reached ? 700 : 500 }}>
        {status}
      </Typography>
    </Box>
  );
}

export default memo(GoalBar);
