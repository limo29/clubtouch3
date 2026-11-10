import React, { useState } from 'react';
import { Badge, Box, Button, Collapse, Stack, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { FilterList, FilterListOff } from '@mui/icons-material';
import StickyToolbar from './StickyToolbar';

/**
 * Filterleiste der Listenseiten (Einkauf, Kundenrechnungen) – im selben Stil wie Artikel, Kunden, Transaktionen.
 * Ab sm: bleibt beim Scrollen stehen, Controls links (umbrechend), „Filter zurücksetzen“ rechts nur bei aktiven Filtern.
 * Handy: Controls hinter „Suche & Filter“ eingeklappt, sonst füllten gestapelte Felder den halben Bildschirm.
 *
 * Props:
 *  - children          Filter-Controls (DatePicker, Autocomplete, TextField …)
 *  - hasActiveFilters  zeigt „Filter zurücksetzen“ und die Markierung auf dem Handy
 *  - onReset
 *  - resetLabel        Standard „Filter zurücksetzen“
 */
export default function FilterBar({ children, hasActiveFilters = false, onReset, resetLabel = 'Filter zurücksetzen', sx }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [open, setOpen] = useState(false);

  const reset = onReset && hasActiveFilters && (
    <Button size="small" variant="outlined" color="inherit" startIcon={<FilterListOff />} onClick={onReset}
      sx={{ flexShrink: 0, whiteSpace: 'nowrap', color: 'text.secondary', borderColor: 'divider' }}>
      {isMobile ? 'Zurücksetzen' : resetLabel}
    </Button>
  );

  if (isMobile) {
    return (
      <Box sx={{ mb: 2, ...sx }}>
        <Stack direction="row" spacing={1}>
          <Button fullWidth variant={open ? 'contained' : 'outlined'} color={open ? 'primary' : 'inherit'} onClick={() => setOpen((o) => !o)}
            startIcon={<Badge color="primary" variant="dot" invisible={!hasActiveFilters}><FilterList /></Badge>}
            sx={{ justifyContent: 'flex-start', borderColor: 'divider' }}>
            Suche &amp; Filter{hasActiveFilters ? ' (aktiv)' : ''}
          </Button>
          {reset}
        </Stack>
        <Collapse in={open}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1.5 }}>{children}</Box>
        </Collapse>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 1, ...sx }}>
      <StickyToolbar>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', flex: 1, alignItems: 'center' }}>{children}</Box>
          {reset}
        </Stack>
      </StickyToolbar>
    </Box>
  );
}
