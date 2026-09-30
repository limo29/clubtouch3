import React, { memo } from 'react';
import { Box, Card, Chip, Stack, Typography, alpha } from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import GroupBadge from '../customers/GroupBadge';
import { scoreText } from './format';
import { num } from '../../utils/format';

/** Team-Wertung: Balken je Gruppe in Gruppenfarbe, sortiert nach Summe, rechts Ø pro Kopf. */
function TeamBoard({ title, subtitle, board, mode, size = 'md', fill = true, emptyText }) {
  const lg = size === 'lg';
  const entries = [...(board?.entries || [])].sort((a, b) => num(b.total) - num(a.total));
  const max = Math.max(1, ...entries.map((e) => num(e.total)));

  return (
    <Card variant="outlined" component="section" aria-label={title}
      sx={{ height: fill ? '100%' : 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ p: lg ? 3 : { xs: 1.5, md: 2 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" alignItems="center" spacing={lg ? 2 : 1.5} sx={{ mb: lg ? 3 : 1.5, flexShrink: 0 }}>
          <Box sx={{ p: lg ? 1.25 : 0.75, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main', display: 'flex' }}>
            <GroupsIcon fontSize={lg ? 'large' : 'medium'} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 900, fontSize: lg ? '2.2rem' : '1.15rem', lineHeight: 1.15 }}>{title}</Typography>
            <Typography noWrap color="text.secondary" sx={{ fontSize: lg ? '1.15rem' : '0.78rem' }}>
              Teams · {mode === 'AMOUNT' ? 'nach Umsatz' : 'nach Anzahl'} · rechts Ø pro Kopf{subtitle ? ` · ${subtitle}` : ''}
            </Typography>
          </Box>
        </Stack>

        {entries.length === 0 ? (
          <Box sx={{ flex: 1, minHeight: fill ? 0 : 140, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}>
            <Typography color="text.secondary" sx={{ fontSize: lg ? '1.8rem' : '1.05rem', fontWeight: 600 }}>
              {emptyText || 'Noch keine Team-Wertung – der erste Kauf eines Teams zählt!'}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={lg ? 2.5 : 1.5} sx={{ flex: 1, minHeight: 0, overflowY: lg ? 'hidden' : 'auto', pr: lg ? 0 : 0.5 }} role="list">
            {entries.map((t, i) => {
              const color = t.color || '#1976d2';
              const pct = Math.max(4, (num(t.total) / max) * 100);
              const hasHeads = num(t.heads) > 0 && t.perHead !== null && t.perHead !== undefined;
              return (
                <Stack key={t.groupId} direction="row" alignItems="center" spacing={lg ? 2 : 1.25} role="listitem"
                  aria-label={`${t.name}: ${scoreText(mode, t.total)}, pro Kopf ${hasHeads ? scoreText(mode, t.perHead) : 'keine Angabe'}`}>
                  <Typography sx={{ width: lg ? 36 : 20, textAlign: 'right', fontWeight: 900, color: 'text.secondary', fontSize: lg ? '1.6rem' : '0.95rem', flexShrink: 0 }}>
                    {t.rank ?? i + 1}
                  </Typography>
                  <GroupBadge group={t} size={lg ? 64 : 36} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1} sx={{ minWidth: 0 }}>
                      <Typography noWrap sx={{ fontWeight: 800, fontSize: lg ? '1.7rem' : '1rem', minWidth: 0 }}>{t.name}</Typography>
                      <Typography sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', fontSize: lg ? '1.7rem' : '1rem', whiteSpace: 'nowrap' }}>
                        {scoreText(mode, t.total)}
                      </Typography>
                    </Stack>
                    <Box sx={{ height: lg ? 22 : 12, borderRadius: 99, bgcolor: 'action.hover', overflow: 'hidden', my: lg ? 0.75 : 0.5 }}>
                      <Box sx={{
                        height: '100%', width: `${pct}%`, borderRadius: 99,
                        background: `linear-gradient(90deg, ${alpha(color, 0.65)}, ${color})`,
                        transition: 'width 0.8s ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                      }} />
                    </Box>
                    <Typography noWrap color="text.secondary" sx={{ fontSize: lg ? '1.1rem' : '0.75rem' }}>
                      {num(t.heads)} {num(t.heads) === 1 ? 'Kopf' : 'Köpfe'}{t.topMember?.name ? ` · Top: ${t.topMember.name}` : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right', flexShrink: 0, minWidth: lg ? 150 : 72 }}>
                    <Typography sx={{ fontSize: lg ? '0.95rem' : '0.68rem', color: 'text.secondary', lineHeight: 1.2 }}>Ø pro Kopf</Typography>
                    <Typography sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: lg ? '1.5rem' : '0.95rem' }}>
                      {hasHeads ? scoreText(mode, t.perHead) : '–'}
                    </Typography>
                    {t.perHeadRank === 1 && (
                      <Chip size="small" label="Ø-Sieger" color="warning"
                        sx={{ fontWeight: 800, height: lg ? 28 : 20, fontSize: lg ? '0.95rem' : '0.68rem', mt: 0.25 }} />
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        )}
      </Box>
    </Card>
  );
}

export default memo(TeamBoard);
