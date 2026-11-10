/**
 * „Als bezahlt markieren“ für Lieferantenrechnungen aus der Einkaufsliste:
 * Zahlungsart und Zahldatum („Bezahlt am“, Vorgabe heute) wählen; bei „Ausgelegt“ zusätzlich den
 * Kunden, dem der volle Betrag gutgeschrieben wird.
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Stack, Alert, Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ReimbursementCustomerField, { PAYMENT_METHOD_LABELS } from './ReimbursementCustomerField';
import PaidAtField, { isValidPaidAt, toPaidAtIso } from './PaidAtField';
import { money, num } from '../../utils/format';

export default function MarkPaidDialog({ document, onClose, onConfirm, pending, error }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [method, setMethod] = useState('TRANSFER');
  const [customerId, setCustomerId] = useState('');
  const [paidAt, setPaidAt] = useState(() => new Date());
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    if (document) {
      setMethod('TRANSFER');
      setCustomerId('');
      setPaidAt(new Date());
      setLocalError(null);
    }
  }, [document]);

  const submit = (e) => {
    e.preventDefault();
    if (method === 'ACCOUNT' && !customerId) {
      setLocalError('Bitte wählen, wer die Rechnung ausgelegt hat.');
      return;
    }
    if (!isValidPaidAt(paidAt) || paidAt > new Date()) {
      setLocalError('Bitte ein gültiges Zahldatum wählen (nicht in der Zukunft).');
      return;
    }
    setLocalError(null);
    onConfirm({
      paymentMethod: method,
      reimbursedCustomerId: method === 'ACCOUNT' ? customerId : undefined,
      paidAt: toPaidAtIso(paidAt),
    });
  };

  return (
    <Dialog
      open={!!document}
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      fullScreen={fullScreen}
      PaperProps={{ component: 'form', onSubmit: submit }}
    >
      <DialogTitle>Als bezahlt markieren</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {document && (
            <Typography variant="body2" color="text.secondary">
              {document.documentNumber} · {document.supplier} · <strong>{money(num(document.totalAmount))}</strong>
            </Typography>
          )}
          <TextField select label="Zahlungsart" size="small" fullWidth value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([v, label]) => (
              <MenuItem key={v} value={v}>{label}</MenuItem>
            ))}
          </TextField>
          <PaidAtField value={paidAt} onChange={(v) => { setPaidAt(v); setLocalError(null); }} />
          {method === 'ACCOUNT' && <ReimbursementCustomerField value={customerId} onChange={(v) => { setCustomerId(v); setLocalError(null); }} />}
          {(localError || error) && <Alert severity="warning">{localError || error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>Abbrechen</Button>
        <Button type="submit" variant="contained" color="success" disabled={pending}>
          Bezahlt
        </Button>
      </DialogActions>
    </Dialog>
  );
}
