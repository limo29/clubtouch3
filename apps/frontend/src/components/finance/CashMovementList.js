/**
 * Gemeinsame Komponente für die Liste der Kassenbewegungen.
 * Props:
 *   movements  – Array der Bewegungen (API-Antwort)
 *   loading    – boolean
 *   onCancel   – function(movement) | undefined (undefined = read-only, kein Storno-Button)
 *   dense      – boolean (kleinere Darstellung)
 */
import React from 'react';
import {
  Box, Chip, IconButton, Skeleton, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Tooltip, Typography, Card, CardContent, useTheme, useMediaQuery,
} from '@mui/material';
import { Undo } from '@mui/icons-material';
import { format } from 'date-fns';
import { money, num } from '../../utils/format';

const fmtDateTime = (iso) => (iso ? format(new Date(iso), 'dd.MM.yyyy HH:mm') : '—');

const TYPE_META = {
  DEPOSIT_TO_BANK:     { label: 'Einzahlung auf Bank', color: 'info',    sign: -1 },
  WITHDRAWAL_FROM_BANK:{ label: 'Abhebung von Bank',   color: 'primary', sign: +1 },
  OTHER_INCOME:        { label: 'Sonstige Einnahme',   color: 'success', sign: +1 },
  OTHER_EXPENSE:       { label: 'Sonstige Ausgabe',    color: 'error',   sign: -1 },
};

function TypeChip({ type }) {
  const meta = TYPE_META[type] || { label: type, color: 'default' };
  return <Chip label={meta.label} color={meta.color} size="small" />;
}

function AmountCell({ movement }) {
  const meta = TYPE_META[movement.type] || { sign: 1 };
  const signed = meta.sign * num(movement.amount);
  const color = signed >= 0 ? 'success.main' : 'error.main';
  return (
    <Typography
      component="span"
      sx={{
        color,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        textDecoration: movement.cancelled ? 'line-through' : 'none',
        opacity: movement.cancelled ? 0.55 : 1,
      }}
    >
      {signed >= 0 ? '+' : ''}{money(signed)}
    </Typography>
  );
}

function CancelButton({ movement, onCancel }) {
  if (!onCancel || movement.cancelled) return null;
  return (
    <Tooltip title="Stornieren">
      <IconButton size="small" onClick={() => onCancel(movement)} aria-label="Kassenbewegung stornieren">
        <Undo fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function MobileCard({ movement, onCancel }) {
  const cancelled = movement.cancelled;
  return (
    <Card variant="outlined" sx={{ opacity: cancelled ? 0.65 : 1 }}>
      <CardContent sx={{ '&:last-child': { pb: 1.5 }, py: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
              <TypeChip type={movement.type} />
              {cancelled && <Chip label="storniert" size="small" color="default" />}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {fmtDateTime(movement.occurredAt)}
            </Typography>
            {(movement.bankAccount || movement.note) && (
              <Typography variant="body2" color="text.secondary" sx={{ textDecoration: cancelled ? 'line-through' : 'none' }}>
                {movement.bankAccount || movement.note}
              </Typography>
            )}
            <Typography variant="caption" color="text.disabled">
              {movement.user?.name || '—'}
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ ml: 1 }}>
            <AmountCell movement={movement} />
            <CancelButton movement={movement} onCancel={onCancel} />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function CashMovementList({ movements = [], loading, onCancel, dense }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (loading) return <Skeleton variant="rounded" height={dense ? 80 : 140} />;

  if (movements.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        Keine Kassenbewegungen im gewählten Zeitraum.
      </Typography>
    );
  }

  if (isMobile) {
    return (
      <Stack spacing={1}>
        {movements.map((m) => (
          <MobileCard key={m.id} movement={m} onCancel={onCancel} />
        ))}
      </Stack>
    );
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size={dense ? 'small' : 'medium'}>
        <TableHead>
          <TableRow>
            <TableCell>Datum/Uhrzeit</TableCell>
            <TableCell>Typ</TableCell>
            <TableCell align="right">Betrag</TableCell>
            <TableCell>Konto / Notiz</TableCell>
            <TableCell>Nutzer</TableCell>
            {onCancel && <TableCell align="right">Aktion</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {movements.map((m) => {
            const cancelled = m.cancelled;
            return (
              <TableRow
                key={m.id}
                sx={{
                  opacity: cancelled ? 0.6 : 1,
                  textDecoration: cancelled ? 'line-through' : 'none',
                }}
              >
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {fmtDateTime(m.occurredAt)}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <TypeChip type={m.type} />
                    {cancelled && <Chip label="storniert" size="small" color="default" />}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <AmountCell movement={m} />
                </TableCell>
                <TableCell
                  sx={{
                    maxWidth: 220,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textDecoration: cancelled ? 'line-through' : 'none',
                  }}
                >
                  {m.bankAccount || m.note || '—'}
                </TableCell>
                <TableCell>{m.user?.name || '—'}</TableCell>
                {onCancel && (
                  <TableCell align="right">
                    <CancelButton movement={m} onCancel={onCancel} />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
