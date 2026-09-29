import React from 'react';
import { Box, Button, Paper, Stack } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

/**
 * Filterleiste der Listenseiten: Controls links (umbrechend), „Filter zurücksetzen“ rechts.
 *
 * Props:
 *  - children          Filter-Controls (DatePicker, Autocomplete, TextField …)
 *  - hasActiveFilters  steuert, ob der Reset-Button aktiv ist
 *  - onReset
 *  - resetLabel        Standard „Filter zurücksetzen“
 */
export default function FilterBar({ children, hasActiveFilters = false, onReset, resetLabel = 'Filter zurücksetzen', sx }) {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mb: 3,
        borderRadius: 3,
        border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
        bgcolor: 'background.paper',
        ...sx,
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
        <Box sx={{ display: 'flex', gap: 2, width: { xs: '100%', sm: 'auto' }, flexWrap: 'wrap', flex: 1 }}>
          {children}
        </Box>
        {onReset && (
          <Button
            variant="text"
            size="small"
            onClick={onReset}
            disabled={!hasActiveFilters}
            sx={{ ml: 'auto !important', width: { xs: '100%', sm: 'auto' }, flexShrink: 0 }}
          >
            {resetLabel}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
