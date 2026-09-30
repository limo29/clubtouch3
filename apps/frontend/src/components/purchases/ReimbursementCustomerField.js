/**
 * Kundenauswahl für „Ausgelegt – dem Kundenkonto gutschreiben“ (paymentMethod ACCOUNT bei Lieferantenrechnungen).
 * Der volle Rechnungsbetrag wird dem gewählten Kunden als Auslage gutgeschrieben (Backend: purchaseDocumentService).
 * Genutzt in Einkauf anlegen, Einkauf bearbeiten und im „Bezahlt“-Dialog der Einkaufsliste.
 */
import React from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../config/api';
import { money, num } from '../../utils/format';

export const PAYMENT_METHOD_LABELS = {
  CASH: 'Bar',
  TRANSFER: 'Überweisung',
  ACCOUNT: 'Ausgelegt – dem Kundenkonto gutschreiben',
};

// kurze Form für Listen/Chips
export const paymentMethodShort = (m) => (m === 'ACCOUNT' ? 'Auslage' : PAYMENT_METHOD_LABELS[m] || m || '—');

const customerLabel = (c) => (c ? (c.nickname ? `${c.name} (${c.nickname})` : c.name) : '');

export default function ReimbursementCustomerField({ value, onChange, disabled, error, helperText, size = 'small' }) {
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers-list', 'auslage'], // eigener Unterschlüssel: Reports nutzt ['customers-list'] mit Rohdaten
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.CUSTOMERS);
      const list = Array.isArray(res.data?.customers) ? res.data.customers : [];
      return list.filter((c) => c.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    },
  });
  const selected = customers.find((c) => c.id === value) || null;

  return (
    <Autocomplete
      options={customers}
      value={selected}
      loading={isLoading}
      disabled={disabled}
      onChange={(e, c) => onChange(c ? c.id : '')}
      getOptionLabel={customerLabel}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      renderOption={(props, c) => {
        const { key, ...rest } = props;
        return (
          <li key={c.id} {...rest}>
            {customerLabel(c)}&nbsp;<span style={{ opacity: 0.6 }}>· {money(num(c.balance))}</span>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Wer hat ausgelegt?"
          size={size}
          // nur das Sternchen: die Pflicht prüft das Formular selbst (deutsche Meldung statt Browser-Sprechblase)
          InputLabelProps={{ ...params.InputLabelProps, required: true }}
          error={error}
          helperText={helperText ?? 'Der volle Rechnungsbetrag wird dem Kundenkonto gutgeschrieben.'}
        />
      )}
    />
  );
}
