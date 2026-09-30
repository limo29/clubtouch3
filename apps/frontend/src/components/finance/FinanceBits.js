/**
 * Kleine Bausteine der Finanzseiten (Einnahmen & Ausgaben, Kasse & Bank, Kassenprüfung).
 */
import React from 'react';
import {
  Card, CardContent, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Stack,
} from '@mui/material';
import { format } from 'date-fns';
import { money, num } from '../../utils/format';

export const fmtDate = (d) => (d ? format(new Date(d), 'dd.MM.yyyy') : '—');
export const fmtDateTime = (d) => (d ? format(new Date(d), 'dd.MM.yyyy HH:mm') : '—');
export const signedMoney = (v) => (num(v) > 0 ? '+' : '') + money(v);

export function SectionCard({ title, action, children, sx }) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6">{title}</Typography>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

export function MiniStat({ label, value, sub, color = 'text.primary', dense = false }) {
  return (
    <Paper sx={{ p: 2, height: '100%', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, display: 'block', overflowWrap: 'anywhere' }}>{label}</Typography>
      <Typography variant={dense ? 'h6' : 'h5'} sx={{ fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

export function SimpleTable({ head, rows, empty = 'Keine Einträge', footer, maxHeight = 300 }) {
  return (
    <TableContainer sx={{ maxHeight }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>{head.map((h, i) => <TableCell key={i} align={i === 0 ? 'left' : 'right'}>{h}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={head.length} sx={{ color: 'text.secondary' }}>{empty}</TableCell></TableRow>
          ) : rows.map((r, ri) => (
            <TableRow key={ri}>
              {r.map((c, ci) => <TableCell key={ci} align={ci === 0 ? 'left' : 'right'} sx={{ whiteSpace: ci === 0 ? 'normal' : 'nowrap' }}>{c}</TableCell>)}
            </TableRow>
          ))}
          {footer && (
            <TableRow>
              {footer.map((c, ci) => <TableCell key={ci} align={ci === 0 ? 'left' : 'right'} sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{c}</TableCell>)}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
