/**
 * Bank-Abstimmung (Kassenprüfer-Sicht): Herleitung des Bank-Solls aus dem
 * Vorjahresabschluss und allen Überweisungs-/Bankbewegungen der App, optional
 * gegen den eingetragenen Kontostand (Ist) mit Differenz.
 *
 * Datenform = accountingService.getBankReconciliation (siehe Backend):
 *   { opening, openingSource, openingFiscalYear, inflows{bankDeposits,topUpsTransfer,invoicesPaid},
 *     outflows{purchasesTransfer,bankWithdrawals}, expected, movements[{date,kind,label,reference,amount}], notCovered }
 *
 * Props:
 *   data     Rückgabe des Endpoints (oder preview.bankReconciliation)
 *   actual   optional: Summe der eingetragenen Kontostände → zeigt Ist + Differenz
 *   compact  dichtere Darstellung (im Stepper)
 *   loading  Skeleton statt Inhalt
 */
import React, { useState } from 'react';
import {
  Box, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  Button, Collapse, Alert, Skeleton, Chip,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import { format } from 'date-fns';
import { money, num } from '../../utils/format';

const fmtDate = (d) => (d ? format(new Date(d), 'dd.MM.yyyy') : '—');
const signed = (v) => (num(v) > 0 ? '+' : '') + money(v);
const cnt = (x) => num(x?.count);
const tot = (x) => num(x?.total);

const KIND_LABEL = {
  DEPOSIT_TO_BANK: 'Einzahlung',
  WITHDRAWAL_FROM_BANK: 'Abhebung',
  TOPUP_TRANSFER: 'Aufladung',
  INVOICE_PAID: 'Ausgangsrechnung',
  PURCHASE_TRANSFER: 'Einkauf',
};

function Row({ label, value, strong, color, rule, indent, compact }) {
  return (
    <TableRow sx={rule ? { '& td': { borderTop: 2, borderTopColor: 'divider' } } : undefined}>
      <TableCell sx={{ border: 0, py: compact ? 0.5 : 0.75, pl: indent ? 3 : 2, fontWeight: strong ? 800 : 400 }}>{label}</TableCell>
      <TableCell align="right" sx={{ border: 0, py: compact ? 0.5 : 0.75, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 800 : 400, color }}>{value}</TableCell>
    </TableRow>
  );
}

export default function BankReconciliation({ data, actual, compact = false, loading = false }) {
  const [showMovements, setShowMovements] = useState(false);

  if (loading) return <Skeleton variant="rounded" height={compact ? 180 : 260} />;
  if (!data) return <Typography color="text.secondary">Keine Bank-Abstimmung verfügbar.</Typography>;

  const inf = data.inflows || {};
  const outf = data.outflows || {};
  const hasActual = actual !== undefined && actual !== null;
  const diff = hasActual ? num(actual) - num(data.expected) : 0;
  const diffOk = Math.abs(diff) < 0.005;
  const movements = Array.isArray(data.movements) ? data.movements : [];
  const net = movements.reduce((a, m) => a + num(m.amount), 0);

  const openingLabel = data.openingSource === 'VORJAHRESABSCHLUSS'
    ? `Bankstand laut Abschluss „${data.openingFiscalYear?.name || 'Vorjahr'}“ (${fmtDate(data.openingFiscalYear?.endDate)})`
    : 'Bankstand Vorjahr (kein abgeschlossenes Vorjahr, Start bei 0,00 €)';

  return (
    <Stack spacing={compact ? 1 : 1.5}>
      <Table size="small" aria-label="Herleitung Bank-Soll">
        <TableBody>
          <Row compact={compact} label={openingLabel} value={money(data.opening)} strong />
          <Row compact={compact} indent label={`+ Einzahlungen aus der Kasse (${cnt(inf.bankDeposits)})`} value={money(tot(inf.bankDeposits))} color="success.main" />
          <Row compact={compact} indent label={`+ Aufladungen per Überweisung (${cnt(inf.topUpsTransfer)})`} value={money(tot(inf.topUpsTransfer))} color="success.main" />
          <Row compact={compact} indent label={`+ Bezahlte Ausgangsrechnungen (${cnt(inf.invoicesPaid)})`} value={money(tot(inf.invoicesPaid))} color="success.main" />
          <Row compact={compact} indent label={`− Einkäufe per Überweisung (${cnt(outf.purchasesTransfer)})`} value={money(-tot(outf.purchasesTransfer))} color="error.main" />
          <Row compact={compact} indent label={`− Abhebungen für die Kasse (${cnt(outf.bankWithdrawals)})`} value={money(-tot(outf.bankWithdrawals))} color="error.main" />
          <Row compact={compact} label="Bank-Soll laut App" value={money(data.expected)} strong rule />
          {hasActual && (
            <>
              <Row compact={compact} label="Eingetragene Kontostände (Ist)" value={money(actual)} strong />
              <Row
                compact={compact}
                label="Differenz (Ist − Soll)"
                value={signed(diff)}
                strong
                color={diffOk ? 'success.main' : 'warning.main'}
              />
            </>
          )}
        </TableBody>
      </Table>

      {hasActual && !diffOk && (
        <Alert severity="info" sx={{ py: 0 }}>
          Eine Differenz ist normal, wenn Buchungen außerhalb der App laufen (Beiträge, Spenden, Gebühren). Sie sollte sich mit dem Kontoauszug erklären lassen.
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary">
        {data.notCovered || 'Nicht enthalten: Bankgebühren, Zinsen, Mitgliedsbeiträge, Spenden und alles, was nicht über die App gebucht wurde.'}
      </Typography>

      <Box>
        <Button
          size="small"
          onClick={() => setShowMovements((v) => !v)}
          endIcon={showMovements ? <ExpandLess /> : <ExpandMore />}
          aria-expanded={showMovements}
        >
          {movements.length} Bankbewegung{movements.length === 1 ? '' : 'en'} {showMovements ? 'ausblenden' : 'anzeigen'}
        </Button>
        <Collapse in={showMovements} unmountOnExit>
          <TableContainer sx={{ maxHeight: 320, overflowX: 'auto' }}>
            <Table size="small" stickyHeader sx={{ minWidth: 520 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Datum</TableCell>
                  <TableCell>Vorgang</TableCell>
                  <TableCell>Referenz</TableCell>
                  <TableCell align="right">Betrag ±</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {movements.length === 0 ? (
                  <TableRow><TableCell colSpan={4} sx={{ color: 'text.secondary' }}>Keine Bankbewegungen über die App im Zeitraum.</TableCell></TableRow>
                ) : movements.map((m) => (
                  <TableRow key={`${m.kind}-${m.id}`} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(m.date)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Chip size="small" variant="outlined" label={KIND_LABEL[m.kind] || m.kind} />
                        <span>{m.label}</span>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{m.reference || '—'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: num(m.amount) < 0 ? 'error.main' : 'success.main' }}>{signed(m.amount)}</TableCell>
                  </TableRow>
                ))}
                {movements.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={3} sx={{ fontWeight: 800 }}>Netto</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{signed(net)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Collapse>
      </Box>
    </Stack>
  );
}
