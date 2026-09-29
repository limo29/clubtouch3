/**
 * Ganzzahl-Stepper "− [Feld] +" mit Einheiten-Kürzel.
 * Referenz-Optik der Positionszeile im ArticleLinePicker; wird auch in der
 * Kassenzählung (Stückelung) und der Inventur (Kisten + Stück) verwendet.
 *
 * Props: value, unit, onDelta(±1), onSet(int), deleteAtOne (Mülleimer statt Minus bei 1),
 * size (Kantenlänge px), showUnit, inputWidth, min (Standard 0).
 */
import React, { useState } from 'react';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import { Remove, Add, DeleteOutline } from '@mui/icons-material';
import { int, unitShort } from '../../utils/format';

export default function QuantityStepper({
  value,
  unit,
  onDelta,
  onSet,
  deleteAtOne = false,
  size = 40,
  showUnit = true,
  inputWidth = 44,
  min = 0,
  disabled = false,
  'aria-label': ariaLabel,
}) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft !== null) onSet(Math.max(min, int(draft)));
    setDraft(null);
  };
  const atOne = value === 1 && deleteAtOne;
  const label = ariaLabel || unit || 'Menge';
  return (
    <Stack direction="row" alignItems="center" spacing={0} sx={{ flexShrink: 0 }}>
      <IconButton
        onClick={() => onDelta(-1)}
        disabled={disabled || value <= min}
        color={atOne ? 'error' : 'default'}
        aria-label={`${label} verringern`}
        sx={{ width: size, height: size, border: '1px solid', borderColor: 'divider', borderRadius: '8px 0 0 8px' }}
      >
        {atOne ? <DeleteOutline fontSize="small" /> : <Remove fontSize="small" />}
      </IconButton>
      <Box
        component="input"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`Menge ${label}`}
        disabled={disabled}
        value={draft ?? value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        sx={{
          width: inputWidth, height: size, textAlign: 'center', fontWeight: 800, fontSize: '1rem', fontFamily: 'inherit',
          border: '1px solid', borderLeft: 0, borderRight: 0, borderColor: 'divider', bgcolor: 'transparent', color: 'text.primary', outline: 'none',
          '&:focus': { bgcolor: 'action.selected' },
          '&:disabled': { color: 'text.disabled' },
        }}
      />
      <IconButton
        onClick={() => onDelta(1)}
        disabled={disabled}
        aria-label={`${label} erhöhen`}
        sx={{ width: size, height: size, border: '1px solid', borderColor: 'divider', borderRadius: '0 8px 8px 0' }}
      >
        <Add fontSize="small" />
      </IconButton>
      {showUnit && unit && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.75, minWidth: 24, fontWeight: 700 }}>{unitShort(unit)}</Typography>
      )}
    </Stack>
  );
}
