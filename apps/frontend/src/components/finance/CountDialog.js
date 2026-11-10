/**
 * Zählmodus „Kasse zählen“ (Handy/Tablet Vollbild):
 *  1. Zählen – je Nennwert ein Zahlenfeld (Enter springt weiter), −/+ und „+10“;
 *     Ist/Soll/Differenz bleiben unten sichtbar. Differenz erst, wenn etwas gezählt ist.
 *     Ohne bisherige Zählung: standardmäßig als Anfangsbestand (Soll = Ist, keine Differenz).
 *     Bei Differenz ist eine Notiz Pflicht.
 *  2. Ergebnis – Differenz bzw. Anfangsbestand, Vorschlag „über dem Wechselgeld-Sockel zur Bank bringen“, PDF.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, Switch,
  TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Add, Close, PictureAsPdf, Remove, Savings } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { money, num } from '../../utils/format';
import { apiErrorMessage, downloadFile } from '../../utils/download';
import { format } from 'date-fns';

const BILLS = [200, 100, 50, 20, 10, 5];
const COINS = [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const ALL = [...BILLS, ...COINS];
const label = (d) => (d >= 1 ? `${d} €` : `${Math.round(d * 100)} ct`);
const round2 = (v) => Math.round(num(v) * 100) / 100;
const signed = (v) => (num(v) > 0.004 ? '+' : '') + money(v);
const empty = () => Object.fromEntries(ALL.map((d) => [String(d), '']));

function DenomRow({ d, value, onChange, inputRef, onEnter }) {
  const n = Math.trunc(num(value));
  const set = (v) => onChange(String(d), v <= 0 ? '' : String(v));
  const btn = { border: '1px solid', borderColor: 'divider', flexShrink: 0 };
  // Box mit gap statt Stack-spacing: Stack überschreibt sonst das margin-left:auto des Betrags
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1 }, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ width: { xs: 44, sm: 52 }, fontWeight: 800, flexShrink: 0 }}>{label(d)}</Typography>
      <IconButton aria-label={`${label(d)} weniger`} onClick={() => set(n - 1)} disabled={n <= 0} size="small" sx={{ ...btn, display: { xs: 'none', sm: 'inline-flex' } }}><Remove fontSize="small" /></IconButton>
      <TextField inputRef={inputRef} value={value} placeholder="0" size="small"
        inputProps={{ inputMode: 'numeric', 'aria-label': `Anzahl ${label(d)}`, style: { textAlign: 'center', fontWeight: 700, fontSize: '1.1rem' } }}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(String(d), e.target.value.replace(/\D/g, '').slice(0, 5))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        sx={{ width: { xs: 64, sm: 76 }, flexShrink: 0 }} />
      <IconButton aria-label={`${label(d)} mehr`} onClick={() => set(n + 1)} size="small" sx={btn}><Add fontSize="small" /></IconButton>
      <Button size="small" variant="text" aria-label={`${label(d)} plus zehn`} onClick={() => set(n + 10)} sx={{ minWidth: 0, px: 0.75, whiteSpace: 'nowrap', flexShrink: 0 }}>+10</Button>
      <Typography sx={{ ml: 'auto', pl: 1, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: n ? 'text.primary' : 'text.disabled' }}>
        {money(n * d)}
      </Typography>
    </Box>
  );
}

export default function CountDialog({ open, onClose, preview, float = 0, canSetFloat, onBookDeposit }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const qc = useQueryClient();
  const [counts, setCounts] = useState(empty);
  const [note, setNote] = useState('');
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [floatDraft, setFloatDraft] = useState('');
  const refs = useRef([]);

  const firstCount = preview && !preview.hasBaseline;
  useEffect(() => {
    if (!open) return;
    setCounts(empty()); setNote(''); setResult(null); setTouched(false); setError(null);
    setOpening(!!firstCount);
    setFloatDraft(float ? String(float).replace('.', ',') : '');
    setTimeout(() => refs.current[0]?.focus(), 200);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pieces = ALL.reduce((s, d) => s + Math.trunc(num(counts[String(d)])), 0);
  const counted = useMemo(() => round2(ALL.reduce((s, d) => s + Math.trunc(num(counts[String(d)])) * d, 0)), [counts]);
  const expected = num(preview?.expectedTotal);
  const diff = round2(counted - expected);
  const hasDiff = !opening && pieces > 0 && Math.abs(diff) >= 0.005;
  const noteMissing = hasDiff && note.trim().length < 3;

  const save = useMutation({
    mutationFn: async () => {
      const denominations = Object.fromEntries(ALL.map((d) => [String(d), Math.trunc(num(counts[String(d)]))]));
      return (await api.post('/cash-counts', { denominations, note: note.trim() || undefined, isOpening: opening })).data.cashCount;
    },
    onSuccess: (cc) => {
      qc.invalidateQueries({ queryKey: ['cash-counts'] });
      setResult(cc);
    },
    onError: async (err) => setError(await apiErrorMessage(err, 'Zählung konnte nicht gespeichert werden.')),
  });

  const saveFloat = useMutation({
    mutationFn: async (v) => (await api.put('/cash-counts/settings', { float: v })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-counts', 'settings'] }),
  });

  const submit = (e) => {
    e.preventDefault(); e.stopPropagation();
    setTouched(true);
    if (pieces === 0 || noteMissing) return;
    save.mutate();
  };
  const focusNext = (i) => (i + 1 < ALL.length ? refs.current[i + 1]?.focus() : document.getElementById('count-note')?.focus());

  const currentFloat = num(saveFloat.data?.float ?? float);
  const resultTotal = num(result?.countedTotal);
  const skim = round2(resultTotal - currentFloat);

  return (
    <Dialog open={open} onClose={() => onClose(!!result)} fullScreen={fullScreen} maxWidth="md" fullWidth
      PaperProps={{ component: 'form', onSubmit: submit, noValidate: true }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Savings color="primary" />
        <Box sx={{ flex: 1 }}>
          {result ? (result.isOpening ? 'Anfangsbestand gespeichert' : 'Zählung gespeichert') : 'Kasse zählen'}
          {!result && preview && (
            <Typography variant="body2" color="text.secondary">
              {firstCount ? 'Erste Zählung – noch kein Anfangsbestand' : `Soll seit ${preview.since ? format(new Date(preview.since), 'dd.MM. HH:mm') : 'Beginn'}: ${money(expected)}`}
            </Typography>
          )}
        </Box>
        <IconButton aria-label="Schließen" onClick={() => onClose(!!result)}><Close /></IconButton>
      </DialogTitle>

      {!result ? (
        <>
          <DialogContent dividers>
            {firstCount && canSetFloat && (
              <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Stack direction="row" alignItems="center" spacing={1} component="label" sx={{ cursor: 'pointer' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight={700}>Als Anfangsbestand speichern</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Die gezählte Summe wird Ausgangspunkt für das Kassen-Soll. Es entsteht keine Differenz.
                    </Typography>
                  </Box>
                  <Switch checked={opening} onChange={(e) => setOpening(e.target.checked)} />
                </Stack>
              </Box>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 4 }}>
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Scheine</Typography>
                {BILLS.map((d, i) => (
                  <DenomRow key={d} d={d} value={counts[String(d)]} onChange={(k, v) => setCounts((c) => ({ ...c, [k]: v }))}
                    inputRef={(el) => { refs.current[i] = el; }} onEnter={() => focusNext(i)} />
                ))}
              </Box>
              <Box sx={{ mt: { xs: 2, md: 0 } }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Münzen</Typography>
                {COINS.map((d, j) => {
                  const i = BILLS.length + j;
                  return (
                    <DenomRow key={d} d={d} value={counts[String(d)]} onChange={(k, v) => setCounts((c) => ({ ...c, [k]: v }))}
                      inputRef={(el) => { refs.current[i] = el; }} onEnter={() => focusNext(i)} />
                  );
                })}
              </Box>
            </Box>
            <TextField id="count-note" label={hasDiff ? 'Notiz – woher kommt die Differenz?' : 'Notiz (optional)'} value={note}
              onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={1} sx={{ mt: 2 }}
              error={touched && noteMissing} helperText={touched && noteMissing ? 'Bei einer Differenz bitte kurz begründen.' : ' '} />
            {touched && pieces === 0 && <Alert severity="warning">Noch nichts gezählt.</Alert>}
            {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          </DialogContent>

          {/* feste Summenleiste */}
          <Box sx={{ px: { xs: 2, sm: 3 }, py: 1.5, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', pb: { xs: 'calc(12px + env(safe-area-inset-bottom, 0px))', sm: 1.5 } }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: opening ? '1fr' : '1.2fr 1fr 1fr', sm: opening ? '1fr auto' : '1.4fr 1fr 1fr auto' }, columnGap: 2, rowGap: 1.25, alignItems: 'center' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>IST</Typography>
                <Typography variant="h5" sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{money(counted)}</Typography>
              </Box>
              {!opening && (
                <>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>SOLL</Typography>
                    <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{preview ? money(expected) : '…'}</Typography>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>DIFFERENZ</Typography>
                    <Typography sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: pieces === 0 ? 'text.disabled' : hasDiff ? 'error.main' : 'success.main' }}>
                      {pieces === 0 ? '–' : signed(diff)}
                    </Typography>
                  </Box>
                </>
              )}
              <Button type="submit" variant="contained" size="large" disabled={save.isPending || !preview}
                sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, py: { xs: 1.25, sm: 1 } }}>
                {save.isPending ? 'Speichert…' : 'Speichern'}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">{pieces} Scheine/Münzen · Enter springt zum nächsten Feld</Typography>
          </Box>
        </>
      ) : (
        <>
          <DialogContent dividers>
            <Stack spacing={2} alignItems="stretch">
              {result.isOpening ? (
                <Box sx={{ textAlign: 'center', p: 2 }}>
                  <Typography color="text.secondary">Anfangsbestand der Kasse</Typography>
                  <Typography variant="h3" sx={{ fontWeight: 900 }}>{money(result.countedTotal)}</Typography>
                  <Typography variant="body2" color="text.secondary">Ab jetzt rechnet das Kassen-Soll von diesem Betrag aus.</Typography>
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" justifyContent="center" spacing={4} sx={{ mb: 1 }}>
                    <Box><Typography variant="caption" color="text.secondary">SOLL</Typography><Typography fontWeight={700}>{money(result.expectedTotal)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">IST</Typography><Typography fontWeight={700}>{money(result.countedTotal)}</Typography></Box>
                  </Stack>
                  <Typography variant="h3" sx={{ fontWeight: 900, color: Math.abs(num(result.difference)) < 0.005 ? 'success.main' : 'error.main' }}>{signed(result.difference)}</Typography>
                  <Chip size="small" sx={{ mt: 1 }} color={Math.abs(num(result.difference)) < 0.005 ? 'success' : 'error'}
                    label={Math.abs(num(result.difference)) < 0.005 ? 'Kasse stimmt' : num(result.difference) > 0 ? 'Überschuss' : 'Fehlbetrag'} />
                </Box>
              )}

              {/* Abschöpfen */}
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
                {currentFloat > 0 ? (
                  skim > 0.004 ? (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography fontWeight={700}>{money(skim)} zur Bank bringen?</Typography>
                        <Typography variant="body2" color="text.secondary">Dann bleiben {money(currentFloat)} Wechselgeld in der Kasse.</Typography>
                      </Box>
                      <Button variant="contained" onClick={() => onBookDeposit({ amount: skim, note: 'Abschöpfen nach Kassenzählung' })}>Einzahlung buchen</Button>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">Die Kasse liegt bei oder unter dem Wechselgeld-Sockel von {money(currentFloat)} – nichts abzuschöpfen.</Typography>
                  )
                ) : canSetFloat ? (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={700}>Wechselgeld-Sockel festlegen</Typography>
                      <Typography variant="body2" color="text.secondary">Betrag, der immer in der Kasse bleibt. Den Rest schlägt die App nach dem Zählen zur Einzahlung vor.</Typography>
                    </Box>
                    <TextField size="small" value={floatDraft} onChange={(e) => setFloatDraft(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="100"
                      InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment> }} sx={{ width: 120 }} />
                    <Button variant="outlined" disabled={!num(floatDraft) || saveFloat.isPending} onClick={() => saveFloat.mutate(num(floatDraft))}>Speichern</Button>
                  </Stack>
                ) : null}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 } }}>
            <Button startIcon={<PictureAsPdf />} onClick={() => downloadFile(`/cash-counts/${result.id}/pdf`, { filename: `Kassenzaehlung_${format(new Date(result.countedAt), 'yyyy-MM-dd_HHmm')}.pdf` })} sx={{ mr: 'auto' }}>
              PDF
            </Button>
            <Button variant="contained" onClick={() => onClose(true)}>Fertig</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
