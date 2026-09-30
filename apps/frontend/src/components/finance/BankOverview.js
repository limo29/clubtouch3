/**
 * Tab „Bank“ auf /cash-count (Kasse & Bank): Kontostände laut letztem Jahresabschluss,
 * Bank-Abstimmung und Kassenbewegungen für einen gemeinsamen Zeitraum.
 */
import React, { useMemo, useState } from 'react';
import { Box, Card, CardContent, Typography, Grid, Paper, Stack } from '@mui/material';
import { ArrowUpward, ArrowDownward, AddCircleOutline, RemoveCircleOutline } from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../../services/api';
import CashMovementList from './CashMovementList';
import BankReconciliation from './BankReconciliation';
import { SectionCard, SimpleTable, fmtDate } from './FinanceBits';
import { money, num } from '../../utils/format';

const MOVEMENT_TYPE_TILES = [
  { type: 'DEPOSIT_TO_BANK',      label: 'Einzahlungen auf Bank', icon: ArrowUpward,          color: 'info.main' },
  { type: 'WITHDRAWAL_FROM_BANK', label: 'Abhebungen von Bank',   icon: ArrowDownward,        color: 'primary.main' },
  { type: 'OTHER_INCOME',         label: 'Sonstige Einnahmen',    icon: AddCircleOutline,     color: 'success.main' },
  { type: 'OTHER_EXPENSE',        label: 'Sonstige Ausgaben',     icon: RemoveCircleOutline,  color: 'error.main' },
];

export default function BankOverview() {
  const [movRange, setMovRange] = useState({
    from: format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  });

  const { data: fyData } = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: async () => (await api.get('/accounting/fiscal-years')).data,
  });
  const lastClosed = (fyData?.fiscalYears || []).filter((f) => f.closed && f.report).sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
  const banks = lastClosed?.report?.bankAccountsJson || [];

  const { data: movData, isLoading: movLoading } = useQuery({
    queryKey: ['cash-movements', 'range', movRange.from, movRange.to],
    queryFn: async () => (await api.get('/cash-movements', { params: { from: movRange.from, to: movRange.to, limit: 500 } })).data,
    staleTime: 0,
  });
  const movements = useMemo(() => movData?.cashMovements || [], [movData]);

  // Bank-Abstimmung für denselben Zeitraum wie die Kassenbewegungen
  const { data: reconData, isLoading: reconLoading } = useQuery({
    queryKey: ['bank-reconciliation', movRange.from, movRange.to],
    queryFn: async () => (await api.get('/accounting/bank-reconciliation', { params: { startDate: movRange.from, endDate: movRange.to } })).data.bankReconciliation,
    staleTime: 0,
  });

  // Summen je Typ (nur nicht stornierte)
  const movSums = useMemo(() => {
    const active = movements.filter((m) => !m.cancelled);
    return MOVEMENT_TYPE_TILES.map((t) => {
      const items = active.filter((m) => m.type === t.type);
      return { ...t, total: items.reduce((s, m) => s + num(m.amount), 0), count: items.length };
    });
  }, [movements]);

  return (
    <Grid container spacing={3}>
      {/* Bankkonten */}
      <Grid size={{ xs: 12 }}>
        <SectionCard title="Bankkonten">
          {banks.length === 0 ? (
            <Typography color="text.secondary">Bankkonten werden beim Jahresabschluss erfasst. Noch kein abgeschlossenes Geschäftsjahr mit Konten.</Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" gutterBottom>Stand laut Abschluss „{lastClosed.name}" ({fmtDate(lastClosed.endDate)})</Typography>
              <SimpleTable
                head={['Konto', 'Saldo']}
                rows={banks.map((b) => [`${b.name || 'Konto'}${b.iban ? ` · ${b.iban}` : ''}`, money(b.balance)])}
                footer={['Gesamt', money(banks.reduce((a, b) => a + num(b.balance), 0))]}
              />
            </>
          )}
        </SectionCard>
      </Grid>

      {/* Bank-Abstimmung + Kassenbewegungen (gemeinsamer Zeitraum) */}
      <Grid size={{ xs: 12 }}>
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ flex: 1 }}>Bank-Abstimmung</Typography>
              <DatePicker
                label="Von"
                value={movRange.from ? new Date(movRange.from) : null}
                onChange={(d) => d && setMovRange((r) => ({ ...r, from: format(d, 'yyyy-MM-dd') }))}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="Bis"
                value={movRange.to ? new Date(movRange.to) : null}
                onChange={(d) => d && setMovRange((r) => ({ ...r, to: format(d, 'yyyy-MM-dd') }))}
                slotProps={{ textField: { size: 'small' } }}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Was auf dem Konto angekommen sein müsste, wenn nur die App gebucht hätte. Der Ist-Stand wird beim Jahresabschluss je Konto eingetragen.
            </Typography>
            <BankReconciliation data={reconData} loading={reconLoading} />
          </CardContent>
        </Card>
      </Grid>

      {/* Kassenbewegungen */}
      <Grid size={{ xs: 12 }}>
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ flex: 1 }}>Kassenbewegungen</Typography>
              <Typography variant="body2" color="text.secondary">Zeitraum wie bei der Bank-Abstimmung</Typography>
            </Stack>

            {/* Summen-Kacheln */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              {movSums.map((t) => {
                const Icon = t.icon;
                return (
                  <Grid key={t.type} size={{ xs: 12, sm: 6, md: 3 }}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, height: '100%' }}>
                      <Icon sx={{ color: t.color, fontSize: 28 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, display: 'block', overflowWrap: 'anywhere' }}>{t.label}</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{money(t.total)}</Typography>
                        <Typography variant="caption" color="text.secondary">{t.count} Buchung{t.count !== 1 ? 'en' : ''}</Typography>
                      </Box>
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>

            {/* Liste (read-only) */}
            <CashMovementList movements={movements} loading={movLoading} dense />
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
