import React from 'react';
import { Paper, Table, TableContainer, TableHead, TableRow } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

/**
 * Tabellenrahmen der Listenseiten (Einkauf, Kundenrechnungen): runder Paper-Rahmen,
 * sticky Kopfzeile mit leicht getönter Fläche, Zeilen mit weicher Trennlinie.
 * Die Tabelle scrollt bei Bedarf horizontal im Container, nicht die Seite.
 *
 * <DocumentTable minWidth={800}>
 *   <DocumentTableHead><TableCell>…</TableCell></DocumentTableHead>
 *   <TableBody>…<TableRow sx={documentRowSx(theme)}>…</TableRow></TableBody>
 * </DocumentTable>
 */
export function DocumentTable({ children, minWidth = 800, sx }) {
  const theme = useTheme();
  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={{
        borderRadius: 3,
        border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
        overflow: 'auto',
        ...sx,
      }}
    >
      <Table stickyHeader sx={{ minWidth }}>{children}</Table>
    </TableContainer>
  );
}

export function DocumentTableHead({ children }) {
  const theme = useTheme();
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.04) } }}>
        {children}
      </TableRow>
    </TableHead>
  );
}

/** sx für normale Datenzeilen */
export const documentRowSx = (theme) => ({ '& td': { borderBottomColor: alpha(theme.palette.divider, 0.5) } });

/** sx für aufgeklappte Unterzeilen (Lieferscheine, Positionen) */
export const documentChildRowSx = (theme) => ({ bgcolor: alpha(theme.palette.action.hover, 0.05) });

export default DocumentTable;
