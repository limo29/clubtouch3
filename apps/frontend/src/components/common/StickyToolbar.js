/**
 * Werkzeugleiste (Suche, Filter, Aktionen), die beim Scrollen unter der App-Leiste (64 px) stehen bleibt.
 * Der Streifen in Hintergrundfarbe dahinter verdeckt Inhalt, der sonst an den runden Ecken durchscheint.
 * Einheitlich für Artikel, Kunden, Transaktionen, Einkauf und Rechnungen.
 */
import React from 'react';
import { Box, Card, Chip, Stack } from '@mui/material';

export default function StickyToolbar({ children, sx }) {
  return (
    <Box sx={{ position: 'sticky', top: 64, zIndex: 5, mx: -2, px: 2, pt: 1, pb: 2, mb: -0.5, bgcolor: 'background.default' }}>
      <Card sx={{ p: { xs: 1.5, sm: 2 }, ...sx }}>{children}</Card>
    </Box>
  );
}

/**
 * Filter-Chips mit Anzahl. Ein Klick auf den aktiven Chip wählt ihn ab (-> `fallback`).
 * options: [{ key, label, count?, color? }]
 */
export function FilterChips({ options, value, onChange, fallback = 'all', sx }) {
  return (
    <Stack direction="row" spacing={1}
      sx={{ minWidth: 0, overflowX: 'auto', mx: { xs: -1.5, sm: 0 }, px: { xs: 1.5, sm: 0 }, '&::-webkit-scrollbar': { display: 'none' }, ...sx }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <Chip key={o.key} label={o.count === undefined ? o.label : `${o.label} ${o.count}`}
            onClick={() => onChange(active && o.key !== fallback ? fallback : o.key)}
            color={active ? o.color || 'primary' : 'default'} variant={active ? 'filled' : 'outlined'}
            sx={{ fontWeight: 600, flexShrink: 0 }} />
        );
      })}
    </Stack>
  );
}
