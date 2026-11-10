// Datumsfelder, die beim Tippen nie ein ungültiges Datum nach außen geben.
//
// Die MUI-Felder melden während der Tastatureingabe (z. B. "15.0M.JJJJ") ein "Invalid Date". Die Seiten
// formatieren den Wert aber direkt weiter (format(), toISOString()), was dann mit "Invalid time value"
// die ganze App abstürzen ließ. Deshalb: ungültige Zwischenstände werden nicht weitergereicht, der letzte
// gültige Wert bleibt, bis das Datum vollständig ist. Leeren (null) geht weiterhin durch.
// Immer diese Varianten importieren, nicht die aus @mui/x-date-pickers.
import React from 'react';
import {
  DatePicker as MuiDatePicker,
  DateTimePicker as MuiDateTimePicker,
  MobileDatePicker as MuiMobileDatePicker,
  DesktopDatePicker as MuiDesktopDatePicker,
} from '@mui/x-date-pickers';

// Auch halb getippte Jahre ("20" = Jahr 0020) sind noch kein brauchbares Datum
const isInvalid = (v) => v instanceof Date
  && (Number.isNaN(v.getTime()) || v.getFullYear() < 1990 || v.getFullYear() > 2200);

const safe = (Picker) => {
  const Safe = React.forwardRef(({ onChange, onAccept, ...rest }, ref) => (
    <Picker
      ref={ref}
      {...rest}
      onChange={onChange && ((v, ctx) => { if (!isInvalid(v)) onChange(v, ctx); })}
      onAccept={onAccept && ((v, ctx) => { if (!isInvalid(v)) onAccept(v, ctx); })}
    />
  ));
  Safe.displayName = `Safe(${Picker.displayName || Picker.name || 'Picker'})`;
  return Safe;
};

export const DatePicker = safe(MuiDatePicker);
export const DateTimePicker = safe(MuiDateTimePicker);
export const MobileDatePicker = safe(MuiMobileDatePicker);
export const DesktopDatePicker = safe(MuiDesktopDatePicker);
