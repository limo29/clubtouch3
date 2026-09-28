/**
 * Belegliste mit Nachweis-Vorschau (Bild/PDF).
 * Props:
 *   fetchUrl   – API-Pfad für GET (Belegliste), z.B. '/purchase-documents/receipts'
 *   zipUrl     – API-Pfad für ZIP-Download
 *   params?    – Query-Params für beide Endpunkte, z.B. { startDate, endDate }
 *   title?     – Überschrift
 *   onSummary? – Callback(summary, missingNumbers) nach dem ersten Laden
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  FormControlLabel, Grid, IconButton, Skeleton, Stack, Switch, Table,
  TableBody, TableCell, TableHead, TableRow, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import {
  ChevronLeft, ChevronRight, Close, Download, Image as ImageIcon,
  OpenInNew, PictureAsPdf, Warning,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../../services/api';
import { money } from '../../utils/format';
import { downloadFile, apiErrorMessage } from '../../utils/download';

const fmtDate = (d) => (d ? format(new Date(d), 'dd.MM.yyyy') : '—');

const PAYMENT_LABELS = {
  CASH: 'Bar',
  ACCOUNT: 'Kundenkonto',
  INVOICE: 'Rechnung',
  TRANSFER: 'Überweisung',
};

function TypeChip({ type }) {
  return (
    <Chip
      label={type === 'RECHNUNG' ? 'Rechnung' : 'Lieferschein'}
      size="small"
      color={type === 'RECHNUNG' ? 'primary' : 'default'}
      variant="outlined"
    />
  );
}

function PaidChip({ doc }) {
  if (doc.type === 'LIEFERSCHEIN') return <Typography component="span" variant="body2">–</Typography>;
  if (doc.paid) return <Chip label="bezahlt" size="small" color="success" />;
  return <Chip label="offen" size="small" color="warning" />;
}

function NachweisCell({ doc }) {
  if (doc.hasNachweis) {
    if (doc.nachweisMime === 'application/pdf') {
      return <PictureAsPdf sx={{ color: 'primary.main', fontSize: 20, verticalAlign: 'middle' }} />;
    }
    return <ImageIcon sx={{ color: 'primary.main', fontSize: 20, verticalAlign: 'middle' }} />;
  }
  if (doc.nachweisMissingFile) {
    return <Typography component="span" variant="body2" sx={{ color: 'error.main', whiteSpace: 'nowrap' }}>Datei fehlt</Typography>;
  }
  return <Typography component="span" variant="body2" sx={{ color: 'error.main' }}>fehlt</Typography>;
}

/**
 * PDF als Blob laden und über eine Objekt-URL einbetten.
 * Eine iframe-Navigation schickt `Accept: text/html`; der CRA-Dev-Proxy reicht solche
 * Requests nicht ans Backend weiter, sondern liefert die SPA (index.html). fetch() schickt
 * einen Wildcard-Accept-Header und wird korrekt proxied; hinter nginx funktioniert beides.
 */
function usePdfBlobUrl(url) {
  const [state, setState] = useState({ blobUrl: null, loading: !!url, error: false });
  useEffect(() => {
    if (!url) { setState({ blobUrl: null, loading: false, error: false }); return undefined; }
    let active = true;
    let objectUrl = null;
    setState({ blobUrl: null, loading: true, error: false });
    fetch(url, { headers: { Accept: 'application/pdf,*/*' } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
        setState({ blobUrl: objectUrl, loading: false, error: false });
      })
      .catch(() => { if (active) setState({ blobUrl: null, loading: false, error: true }); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return state;
}

function PdfFrame({ url, title }) {
  const { blobUrl, loading, error } = usePdfBlobUrl(url);
  if (loading) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>PDF wird geladen …</Typography>
      </Box>
    );
  }
  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        PDF konnte nicht geladen werden. <Button size="small" onClick={() => window.open(url, '_blank', 'noopener')}>In neuem Tab öffnen</Button>
      </Alert>
    );
  }
  return (
    <iframe
      src={blobUrl}
      title={title}
      style={{ width: '100%', height: '70vh', border: 'none', display: 'block' }}
    />
  );
}

function PreviewContent({ doc, zoomed, setZoomed }) {
  if (!doc.nachweisUrl) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Warning sx={{ fontSize: 48, color: 'text.disabled', display: 'block', mx: 'auto', mb: 1 }} />
        <Typography color="text.secondary">Kein Nachweis hochgeladen</Typography>
      </Box>
    );
  }
  if (doc.nachweisMime === 'application/pdf') {
    return <PdfFrame url={doc.nachweisUrl} title={`Nachweis ${doc.documentNumber}`} />;
  }
  return (
    <Box
      sx={{
        overflow: zoomed ? 'auto' : 'hidden',
        maxHeight: zoomed ? '70vh' : 'none',
        cursor: zoomed ? 'zoom-out' : 'zoom-in',
        lineHeight: 0,
      }}
      onClick={() => setZoomed((z) => !z)}
    >
      <img
        src={doc.nachweisUrl}
        alt={`Nachweis ${doc.documentNumber}`}
        style={{ maxWidth: zoomed ? 'none' : '100%', height: 'auto', display: 'block' }}
      />
    </Box>
  );
}

function PreviewHeader({ doc, onClose, hasPrev, hasNext, onPrev, onNext }) {
  return (
    <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={700}>{doc.documentNumber}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {doc.supplier || '—'} · {fmtDate(doc.documentDate)}
          </Typography>
          {doc.type === 'RECHNUNG' && (
            <Typography variant="body2">
              {money(doc.totalAmount)} · {PAYMENT_LABELS[doc.paymentMethod] || '—'}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Vorschau schließen">
          <Close />
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
        <Button
          size="small"
          startIcon={<OpenInNew />}
          onClick={() => window.open(doc.nachweisUrl, '_blank', 'noopener')}
          disabled={!doc.nachweisUrl}
        >
          In neuem Tab öffnen
        </Button>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={onPrev} disabled={!hasPrev} aria-label="Vorheriger Beleg">
          <ChevronLeft />
        </IconButton>
        <IconButton size="small" onClick={onNext} disabled={!hasNext} aria-label="Nächster Beleg">
          <ChevronRight />
        </IconButton>
      </Stack>
    </Box>
  );
}

function MobileDocCard({ doc, selected, onClick }) {
  return (
    <Card
      variant="outlined"
      sx={{
        cursor: 'pointer',
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
      }}
      onClick={onClick}
    >
      <CardContent sx={{ '&:last-child': { pb: 1.5 }, py: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">{doc.documentNumber}</Typography>
              <TypeChip type={doc.type} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {fmtDate(doc.documentDate)} · {doc.supplier || '—'}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {doc.type === 'RECHNUNG' && (
                <Typography variant="body2">{money(doc.totalAmount)}</Typography>
              )}
              <PaidChip doc={doc} />
              {doc.paymentMethod && (
                <Typography variant="caption" color="text.secondary">
                  {PAYMENT_LABELS[doc.paymentMethod] || doc.paymentMethod}
                </Typography>
              )}
            </Stack>
          </Box>
          <Box sx={{ ml: 1, flexShrink: 0 }}>
            <NachweisCell doc={doc} />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function ReceiptReview({ fetchUrl, zipUrl, params, title, onSummary }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [onlyMissing, setOnlyMissing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [zoomed, setZoomed] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipError, setZipError] = useState(null);

  // Ref-Muster für onSummary, damit der Effekt nicht endlos läuft
  const onSummaryRef = useRef(onSummary);
  useEffect(() => { onSummaryRef.current = onSummary; });

  const { data, isLoading, error } = useQuery({
    queryKey: ['receipts', fetchUrl, params],
    queryFn: async () => (await api.get(fetchUrl, { params })).data,
    staleTime: 30000,
  });

  const documents = useMemo(() => data?.documents || [], [data]);
  const summary = data?.summary || {};

  const missingNumbers = useMemo(
    () => documents.filter((d) => !d.hasNachweis).map((d) => d.documentNumber).filter(Boolean),
    [documents]
  );

  useEffect(() => {
    if (!data) return;
    onSummaryRef.current?.(data.summary, missingNumbers);
  }, [data, missingNumbers]);

  const filtered = useMemo(
    () => (onlyMissing ? documents.filter((d) => !d.hasNachweis) : documents),
    [documents, onlyMissing]
  );

  const selectedIdx = useMemo(
    () => filtered.findIndex((d) => d.id === selectedId),
    [filtered, selectedId]
  );

  const selected = selectedIdx >= 0 ? filtered[selectedIdx] : null;

  // Auswahl zurücksetzen, wenn das Dokument nicht mehr in der gefilterten Liste ist
  useEffect(() => {
    if (selectedId && selectedIdx === -1) setSelectedId(null);
  }, [selectedId, selectedIdx]);

  // Zoom zurücksetzen bei Dokumentwechsel
  useEffect(() => { setZoomed(false); }, [selectedId]);

  const goToIdx = useCallback(
    (idx) => {
      if (idx >= 0 && idx < filtered.length) setSelectedId(filtered[idx].id);
    },
    [filtered]
  );

  // Tastaturnavigation
  useEffect(() => {
    if (!selectedId) return;
    const handler = (e) => {
      const idx = filtered.findIndex((d) => d.id === selectedId);
      if (e.key === 'ArrowLeft') goToIdx(idx - 1);
      else if (e.key === 'ArrowRight') goToIdx(idx + 1);
      else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, filtered, goToIdx]);

  const handleZip = async () => {
    try {
      setZipLoading(true);
      setZipError(null);
      await downloadFile(zipUrl, { params });
    } catch (err) {
      setZipError(await apiErrorMessage(err, 'ZIP konnte nicht erstellt werden.'));
    } finally {
      setZipLoading(false);
    }
  };

  const closePreview = () => setSelectedId(null);

  const hasPrev = selectedIdx > 0;
  const hasNext = selectedIdx >= 0 && selectedIdx < filtered.length - 1;

  const previewHeaderProps = selected
    ? {
        doc: selected,
        onClose: closePreview,
        hasPrev,
        hasNext,
        onPrev: () => goToIdx(selectedIdx - 1),
        onNext: () => goToIdx(selectedIdx + 1),
      }
    : null;

  if (isLoading) return <Skeleton variant="rounded" height={300} />;
  if (error) return <Alert severity="error">Fehler beim Laden der Belegliste.</Alert>;

  const showPanel = !!selected && !isMobile;

  return (
    <Box>
      {/* Kopfzeile */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'center' }}
        sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}
      >
        {title && <Typography variant="h6">{title}</Typography>}
        {data && (
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 160 }}>
            {summary.count} Belege · {summary.withNachweis} mit Nachweis ·{' '}
            <Box
              component="span"
              sx={{
                color: summary.withoutNachweis > 0 ? 'error.main' : 'text.secondary',
                fontWeight: summary.withoutNachweis > 0 ? 700 : 400,
              }}
            >
              {summary.withoutNachweis} ohne
            </Box>
            {' · '}{money(summary.totalAmount)}
          </Typography>
        )}
        <Button
          size="small"
          variant="outlined"
          startIcon={zipLoading ? <CircularProgress size={14} /> : <Download />}
          onClick={handleZip}
          disabled={zipLoading}
        >
          Nachweise als ZIP
        </Button>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
            />
          }
          label="nur ohne Nachweis"
          sx={{ ml: 0, mr: 0 }}
        />
      </Stack>

      {zipError && (
        <Alert severity="error" onClose={() => setZipError(null)} sx={{ mb: 1 }}>
          {zipError}
        </Alert>
      )}

      {summary.withoutNachweis > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>{summary.withoutNachweis} Belege ohne Nachweis:</strong>{' '}
          {missingNumbers.join(', ') || '—'}
        </Alert>
      )}

      {filtered.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {onlyMissing ? 'Alle Belege haben einen Nachweis.' : 'Keine Belege im Zeitraum.'}
        </Typography>
      )}

      {filtered.length > 0 && (
        <Grid container spacing={2}>
          {/* Tabelle / Karten */}
          <Grid size={{ xs: 12, md: showPanel ? 7 : 12 }}>
            {isMobile ? (
              <Stack spacing={1}>
                {filtered.map((doc) => (
                  <MobileDocCard
                    key={doc.id}
                    doc={doc}
                    selected={selectedId === doc.id}
                    onClick={() => setSelectedId(doc.id)}
                  />
                ))}
              </Stack>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Belegnummer</TableCell>
                      <TableCell>Typ</TableCell>
                      <TableCell>Datum</TableCell>
                      <TableCell>Lieferant</TableCell>
                      <TableCell align="right">Betrag</TableCell>
                      <TableCell>Bezahlt</TableCell>
                      <TableCell>Zahlungsart</TableCell>
                      <TableCell>Nachweis</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.map((doc) => (
                      <TableRow
                        key={doc.id}
                        hover
                        selected={selectedId === doc.id}
                        onClick={() => setSelectedId(doc.id)}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {doc.documentNumber}
                        </TableCell>
                        <TableCell>
                          <TypeChip type={doc.type} />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {fmtDate(doc.documentDate)}
                        </TableCell>
                        <TableCell
                          sx={{
                            maxWidth: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {doc.supplier || '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {doc.type === 'LIEFERSCHEIN' ? '–' : money(doc.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <PaidChip doc={doc} />
                        </TableCell>
                        <TableCell>{PAYMENT_LABELS[doc.paymentMethod] || '—'}</TableCell>
                        <TableCell>
                          <NachweisCell doc={doc} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Grid>

          {/* Vorschau-Panel (ab md) */}
          {showPanel && (
            <Grid size={{ xs: 12, md: 5 }}>
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  overflow: 'hidden',
                  position: 'sticky',
                  top: 16,
                }}
              >
                <PreviewHeader {...previewHeaderProps} />
                <Box sx={{ p: selected.nachweisMime && selected.nachweisMime !== 'application/pdf' ? 1 : 0 }}>
                  <PreviewContent doc={selected} zoomed={zoomed} setZoomed={setZoomed} />
                </Box>
              </Box>
            </Grid>
          )}
        </Grid>
      )}

      {/* Vorschau-Dialog (unter md) */}
      {isMobile && selected && (
        <Dialog open fullScreen onClose={closePreview}>
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <PreviewHeader {...previewHeaderProps} />
            <Box
              sx={{
                flex: 1,
                overflow: 'auto',
                p: selected.nachweisMime && selected.nachweisMime !== 'application/pdf' ? 1 : 0,
              }}
            >
              <PreviewContent doc={selected} zoomed={zoomed} setZoomed={setZoomed} />
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
}
