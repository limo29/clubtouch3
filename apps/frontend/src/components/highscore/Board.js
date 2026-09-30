import React, { memo } from 'react';
import { Box, Card, Stack, Typography, alpha } from '@mui/material';
import TrophyIcon from '@mui/icons-material/EmojiEvents';
import Podium from './Podium';
import RankRow from './RankRow';
import { gapText, scoreText } from './format';
import { markFor } from './useRankChanges';

const MAX = 20;

/** Rang des Vordermanns (bei Gleichstand der nächstbessere Rang) */
const prevRankOf = (entries, i) => {
  for (let j = i - 1; j >= 0; j -= 1) if (entries[j].rank < entries[i].rank) return entries[j].rank;
  return null;
};

/**
 * Rangliste: Podium Platz 1–3 + Liste 4–20.
 * fill=true: feste Höhe, die Liste teilt sich die Resthöhe in gleich hohe Zeilen (TV / Desktop);
 * fill=false: natürliche Höhe (Handy).
 */
function Board({
  title, subtitle, board, mode, marks, marksKey, now,
  size = 'md', fill = true, columns = 2, podiumHeight = 190, minRow = 36, dense: denseProp, emptyText, footer,
}) {
  const lg = size === 'lg';
  const dense = denseProp ?? lg;
  const entries = (board?.entries || []).slice(0, MAX);
  const rest = entries.slice(3);
  const rows = Math.max(1, Math.ceil((MAX - 3) / columns));
  const changes = entries.slice(0, 3).map((e) => markFor(marks, marksKey, e.customerId, now));
  const gapFor = (e, i) => (e.rank >= 2 && e.rank <= 10 ? gapText(mode, e, prevRankOf(entries, i)) : null);
  const leader = entries[0];

  return (
    <Card variant="outlined" component="section" aria-label={title}
      sx={{ height: fill ? '100%' : 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ p: lg ? 2.5 : { xs: 1.5, md: 2 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" alignItems="center" spacing={lg ? 2 : 1.5} sx={{ mb: lg ? 1.5 : 1, flexShrink: 0 }}>
          <Box sx={{ p: lg ? 1 : 0.75, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main', display: 'flex' }}>
            <TrophyIcon fontSize={lg ? 'large' : 'medium'} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontWeight: 900, fontSize: lg ? '2rem' : '1.15rem', lineHeight: 1.15 }}>{title}</Typography>
            <Typography noWrap color="text.secondary" sx={{ fontSize: lg ? '1.15rem' : '0.78rem' }}>
              Die besten 20 · {mode === 'AMOUNT' ? 'nach Umsatz' : 'nach Anzahl'}{subtitle ? ` · ${subtitle}` : ''}
            </Typography>
          </Box>
          {lg && leader && (
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, opacity: 0.6 }}>Bestwert</Typography>
              <Typography color="primary" sx={{ fontWeight: 900, fontSize: '2rem', lineHeight: 1 }}>{scoreText(mode, leader.score)}</Typography>
            </Box>
          )}
        </Stack>

        {entries.length === 0 ? (
          <Box sx={{ flex: 1, minHeight: fill ? 0 : 160, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}>
            <Typography color="text.secondary" sx={{ fontSize: lg ? '1.8rem' : '1.05rem', fontWeight: 600 }}>
              {emptyText || 'Noch keine Wertung – der erste Kauf zählt!'}
            </Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ flexShrink: 0, mb: lg ? 1.5 : 1 }}>
              <Podium entries={entries.slice(0, 3)} mode={mode} height={podiumHeight} size={size} changes={changes}
                gaps={entries.slice(0, 3).map((e, i) => gapFor(e, i))} />
            </Box>
            {fill ? (
              <Box sx={{
                flex: 1, minHeight: 0, overflowY: lg ? 'hidden' : 'auto',
                display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(${minRow}px, 1fr))`, gridAutoFlow: 'column',
                columnGap: lg ? 3 : 2,
              }}>
                {rest.map((e, i) => (
                  <RankRow key={e.customerId} entry={e} mode={mode} size={size} dense={dense}
                    change={markFor(marks, marksKey, e.customerId, now)} gap={gapFor(e, i + 3)} />
                ))}
              </Box>
            ) : (
              <Stack>
                {rest.map((e, i) => (
                  <RankRow key={e.customerId} entry={e} mode={mode} size={size}
                    change={markFor(marks, marksKey, e.customerId, now)} gap={gapFor(e, i + 3)} />
                ))}
              </Stack>
            )}
          </>
        )}
        {footer}
      </Box>
    </Card>
  );
}

export default memo(Board);
