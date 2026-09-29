import React from 'react';
import { Box, Paper, Stack } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

/**
 * Karte für Belege in schmalen Viewports (unter `md`): runder Rahmen mit farbigem
 * Typ-Streifen links. Inhalt kommt als children (Stack mit spacing 1.5).
 *
 * Props:
 *  - stripColor  Theme-Farbe des Streifens, z.B. 'primary.main' / 'info.main' / 'success.main'
 */
export default function MobileDocumentCard({ stripColor = 'primary.main', children, sx }) {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        mb: 2,
        p: 2,
        borderRadius: 3,
        border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
        position: 'relative',
        overflow: 'hidden',
        ...sx,
      }}
    >
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: stripColor }} />
      <Stack spacing={1.5} sx={{ pl: 1 }}>
        {children}
      </Stack>
    </Paper>
  );
}
