/**
 * Kassenprüfung (Route /profit-loss): Geschäftsjahre anlegen, abschließen (CloseYearStepper),
 * Jahresabschluss-PDF und Belege je Jahr prüfen.
 * Die EÜR-Vorschau liegt unter Berichte („Einnahmen & Ausgaben“), die Bank-Abstimmung unter Kasse & Bank;
 * alte Links /profit-loss?tab=eur bzw. ?tab=kasse werden dorthin umgeleitet.
 */
import React, { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Table, TableBody, TableCell, TableHead, TableRow, Button, IconButton,
  TextField, Alert, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Stack, useTheme, useMediaQuery,
} from '@mui/material';
import { Close, Add, PictureAsPdf, Lock, ReceiptLong } from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../services/api';
import CloseYearStepper from '../components/finance/CloseYearStepper';
import ReceiptReview from '../components/finance/ReceiptReview';
import { fmtDate, signedMoney } from '../components/finance/FinanceBits';
import { money, num } from '../utils/format';
import { downloadFile, apiErrorMessage } from '../utils/download';

/* ------------------------------- Geschäftsjahre ------------------------------- */

function FiscalYearsSection({ fiscalYears, error, onClose, onNew, onReceipts }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [dlError, setDlError] = useState(null);

  const downloadReport = async (fy) => {
    try {
      setDlError(null);
      await downloadFile(`/accounting/fiscal-years/${fy.id}/report`, { filename: `Jahresabschluss_${fy.name || fy.id}.pdf` });
    } catch (err) {
      setDlError(await apiErrorMessage(err, 'PDF konnte nicht geladen werden.'));
    }
  };

  const actions = (fy) => (
    <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
      {!fy.closed && <Button size="small" variant="contained" startIcon={<Lock />} onClick={() => onClose(fy)}>Abschließen</Button>}
      <Button size="small" variant="outlined" startIcon={<ReceiptLong />} onClick={() => onReceipts(fy)}>Belege</Button>
      <Button size="small" variant="outlined" startIcon={<PictureAsPdf />} onClick={() => downloadReport(fy)}>{fy.closed ? 'PDF' : 'Entwurf-PDF'}</Button>
    </Stack>
  );
  const status = (fy) => (fy.closed ? <Chip color="success" size="small" label="Abgeschlossen" /> : <Chip size="small" label="Offen" />);

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Ein Geschäftsjahr wird mit Kassenzählung, Bankständen, Belegprüfung und Inventur abgeschlossen und eingefroren.
          Laufende Zahlen: Berichte → „Einnahmen &amp; Ausgaben“, Kontostand und Bank-Abstimmung: Kasse &amp; Bank.
        </Typography>
        <Button variant="contained" startIcon={<Add />} onClick={onNew} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Neues Jahr</Button>
      </Stack>
      {error && <Alert severity="error">Fehler beim Laden der Geschäftsjahre.</Alert>}
      {dlError && <Alert severity="error" onClose={() => setDlError(null)}>{dlError}</Alert>}
      {fiscalYears.length === 0 ? (
        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>Noch keine Geschäftsjahre.</Typography>
      ) : isMobile ? (
        <Stack spacing={1.5}>
          {fiscalYears.map((fy) => (
            <Card key={fy.id} variant="outlined">
              <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="h6">{fy.name}</Typography>
                  {status(fy)}
                </Stack>
                <Typography variant="body2" color="text.secondary" gutterBottom>{fmtDate(fy.startDate)} – {fmtDate(fy.endDate)}</Typography>
                {fy.closed && fy.report && (
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Überschuss {signedMoney(fy.report.profit)} · Kasse {money(fy.report.cashOnHand)}
                  </Typography>
                )}
                {actions(fy)}
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Zeitraum</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Überschuss</TableCell>
                <TableCell align="right">Kasse</TableCell>
                <TableCell align="right">Aktionen</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fiscalYears.map((fy) => (
                <TableRow key={fy.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{fy.name}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(fy.startDate)} – {fmtDate(fy.endDate)}</TableCell>
                  <TableCell>{status(fy)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: fy.report ? (num(fy.report.profit) >= 0 ? 'success.main' : 'error.main') : 'text.disabled' }}>
                    {fy.report ? signedMoney(fy.report.profit) : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{fy.report ? money(fy.report.cashOnHand) : '—'}</TableCell>
                  <TableCell align="right">{actions(fy)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}

/* ---------------------------------- Seite ---------------------------------- */

export default function ProfitLoss() {
  const qc = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // Alte Tabs sind umgezogen: EÜR → Berichte, Kasse & Bank → /cash-count?tab=bank
  useEffect(() => {
    if (tabParam === 'eur') navigate('/reports?report=eur', { replace: true });
    else if (tabParam === 'kasse') navigate('/cash-count?tab=bank', { replace: true });
  }, [tabParam, navigate]);
  const [receiptsFy, setReceiptsFy] = useState(null);

  const { data: fyData, error: fyError } = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: async () => (await api.get('/accounting/fiscal-years')).data,
  });
  const fiscalYears = fyData?.fiscalYears || [];

  const [openNew, setOpenNew] = useState(false);
  const [newFy, setNewFy] = useState({ name: '', startDate: null, endDate: null });
  const [createError, setCreateError] = useState(null);
  const [closeTarget, setCloseTarget] = useState(null);

  const createFY = useMutation({
    mutationFn: async () => (await api.post('/accounting/fiscal-years', {
      name: newFy.name,
      startDate: newFy.startDate ? format(newFy.startDate, 'yyyy-MM-dd') : null,
      endDate: newFy.endDate ? format(newFy.endDate, 'yyyy-MM-dd') : null,
    })).data,
    onSuccess: (data) => {
      setOpenNew(false);
      setCreateError(null);
      setNewFy({ name: '', startDate: null, endDate: null });
      qc.invalidateQueries({ queryKey: ['fiscal-years'] });
      if (data?.fiscalYear) setCloseTarget(data.fiscalYear);
    },
    onError: async (err) => setCreateError(await apiErrorMessage(err, 'Geschäftsjahr konnte nicht angelegt werden.')),
  });

  return (
    <Box>
      <FiscalYearsSection fiscalYears={fiscalYears} error={fyError} onClose={setCloseTarget} onNew={() => setOpenNew(true)} onReceipts={setReceiptsFy} />

      <Dialog open={!!receiptsFy} onClose={() => setReceiptsFy(null)} maxWidth="xl" fullWidth fullScreen={isMobile}>
        <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', minHeight: isMobile ? '100vh' : '80vh' }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>Belege prüfen · {receiptsFy?.name}</Typography>
            <IconButton onClick={() => setReceiptsFy(null)} aria-label="Schließen"><Close /></IconButton>
          </Stack>
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {receiptsFy && (
              <ReceiptReview
                fetchUrl={`/accounting/fiscal-years/${receiptsFy.id}/receipts`}
                zipUrl={`/accounting/fiscal-years/${receiptsFy.id}/receipts.zip`}
                title={`Belege ${fmtDate(receiptsFy.startDate)} – ${fmtDate(receiptsFy.endDate)}`}
              />
            )}
          </Box>
        </Box>
      </Dialog>

      <Dialog open={openNew} onClose={() => setOpenNew(false)} maxWidth="sm" fullWidth fullScreen={isPhone}>
        <DialogTitle>Geschäftsjahr anlegen</DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mt: 1 }}>{createError}</Alert>}
          <TextField label="Name" fullWidth sx={{ mt: 2 }} value={newFy.name} onChange={(e) => setNewFy((f) => ({ ...f, name: e.target.value }))} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
            <DatePicker label="Start" value={newFy.startDate} onChange={(d) => setNewFy((f) => ({ ...f, startDate: d }))} slotProps={{ textField: { fullWidth: true } }} />
            <DatePicker label="Ende" value={newFy.endDate} onChange={(d) => setNewFy((f) => ({ ...f, endDate: d }))} slotProps={{ textField: { fullWidth: true } }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNew(false)}>Abbrechen</Button>
          <Button onClick={() => createFY.mutate()} disabled={!newFy.name || !newFy.startDate || !newFy.endDate || createFY.isPending} variant="contained">
            {createFY.isPending ? 'Speichert…' : 'Anlegen'}
          </Button>
        </DialogActions>
      </Dialog>

      <CloseYearStepper open={!!closeTarget} fy={closeTarget} onClose={() => setCloseTarget(null)} />
    </Box>
  );
}
