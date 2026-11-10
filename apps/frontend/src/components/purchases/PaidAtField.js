/**
 * „Bezahlt am“ für Lieferantenrechnungen: Datum der Zahlung (Vorgabe heute, nicht in der Zukunft).
 * Das Zahldatum bestimmt, in welchem Zeitraum die Ausgabe in der EÜR, im Kassen-Soll (bar)
 * und in der Bank-Abstimmung (Überweisung) zählt.
 */
import React from 'react';
import { DatePicker } from '../common/SafeDatePickers';

/** Gültiges Datum? (DatePicker liefert bei halber Eingabe ein Invalid Date) */
export const isValidPaidAt = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Datum aus dem Picker → ISO-Zeitpunkt fürs Backend: heute = jetzt, frühere Tage = 12:00 Uhr,
 * damit der Zeitpunkt sicher im gewählten Geschäftstag liegt (wie beim Zahldatum der Kundenrechnungen).
 */
export function toPaidAtIso(date) {
  if (!isValidPaidAt(date)) return undefined;
  const when = new Date(date);
  const now = new Date();
  if (when.toDateString() === now.toDateString() || when > now) return now.toISOString();
  when.setHours(12, 0, 0, 0);
  return when.toISOString();
}

export default function PaidAtField({ value, onChange, disabled, helperText }) {
  return (
    <DatePicker
      label="Bezahlt am"
      value={value || null}
      onChange={(v) => onChange(v)}
      disableFuture
      disabled={disabled}
      slotProps={{ textField: { size: 'small', fullWidth: true, helperText } }}
    />
  );
}
