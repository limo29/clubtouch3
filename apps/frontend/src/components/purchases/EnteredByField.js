import React from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

/**
 * „Eingetragen von“ für Einkaufsbelege: freier Name mit Auswahl der Namen, die schon Belege
 * eingetragen haben (häufigste zuerst). Am Gemeinschafts-Tablet ist das Benutzerkonto nicht die
 * Person, deshalb ist das Feld immer änderbar. Props: value (string), onChange(string).
 */
export default function EnteredByField({ value, onChange }) {
  const { data } = useQuery({
    queryKey: ['purchase-entered-by'],
    queryFn: async () => (await api.get('/purchase-documents/entered-by')).data,
  });
  const names = data?.names || [];

  return (
    <Autocomplete
      freeSolo
      options={names}
      value={value || null}
      onChange={(e, v) => onChange(v || '')}
      onInputChange={(e, v, reason) => { if (reason === 'input' || reason === 'clear') onChange(v); }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Eingetragen von"
          size="small"
          helperText="Wer hat den Beleg erfasst? Name auswählen oder eintippen."
        />
      )}
    />
  );
}
