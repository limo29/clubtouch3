import React, { useEffect, useRef, useState } from 'react';
import { Box, Stack, Typography, keyframes } from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import GroupBadge from '../customers/GroupBadge';

const slideIn = keyframes`
  from { opacity: 0; transform: translateY(60%); }
  to { opacity: 1; transform: translateY(0); }
`;

const ITEM_MS = 8000;

/** Laufband unten: eine Meldung nach der anderen (~8 s), aria-live="polite". size 'sm' (intern) | 'lg' (TV) */
export default function Ticker({ items, size = 'sm' }) {
  const lg = size === 'lg';
  const [idx, setIdx] = useState(0);
  const list = items && items.length ? items : [];
  const currentIdRef = useRef(null);

  // bei neuer Liste möglichst beim aktuellen Eintrag bleiben
  useEffect(() => {
    if (!list.length) return;
    const pos = list.findIndex((x) => x.id === currentIdRef.current);
    setIdx(pos >= 0 ? pos : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((x) => x.id).join('|')]);

  useEffect(() => {
    if (list.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), ITEM_MS);
    return () => clearInterval(t);
  }, [list.length]);

  if (!list.length) return null;
  const item = list[idx % list.length];
  currentIdRef.current = item.id;

  return (
    <Box sx={{
      flexShrink: 0, overflow: 'hidden', borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
      height: lg ? 72 : 36, display: 'flex', alignItems: 'center', px: lg ? 3 : 1.5,
    }}>
      <CampaignIcon color="primary" sx={{ fontSize: lg ? 38 : 20, mr: lg ? 2 : 1, flexShrink: 0 }} aria-hidden />
      <Box aria-live="polite" aria-atomic="true" sx={{ flex: 1, minWidth: 0 }}>
        <Stack key={item.id} direction="row" spacing={1} alignItems="center" sx={{
          minWidth: 0, animation: `${slideIn} 0.5s ease-out both`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}>
          {item.group && <GroupBadge group={item.group} size={lg ? 40 : 22} tooltip={false} />}
          <Typography noWrap sx={{ fontWeight: 700, fontSize: lg ? '1.9rem' : '0.9rem', minWidth: 0 }}>{item.text}</Typography>
        </Stack>
      </Box>
      {list.length > 1 && (
        <Typography color="text.secondary" sx={{ fontSize: lg ? '1rem' : '0.7rem', ml: 1, flexShrink: 0 }} aria-hidden>
          {(idx % list.length) + 1}/{list.length}
        </Typography>
      )}
    </Box>
  );
}
