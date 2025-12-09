import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { API_BASE_URL } from "../config/api";
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Stack,
  Grid,
  CircularProgress,
  Alert,
  Tooltip,
  Divider,
  useMediaQuery,
} from "@mui/material";
import {
  CheckCircle as CheckIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  FileUpload as UploadIcon,
  ExpandMore,
  ExpandLess,
} from "@mui/icons-material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useTheme, alpha } from "@mui/material/styles";

/* ---------------- helpers ---------------- */
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const formatCurrency = (amount) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    num(amount)
  );



/* ---------------- StatCard ---------------- */


/* ---------------- StatusChip ---------------- */
function StatusChip({ document, onToggle, disabled }) {
  if (document.type === "LIEFERSCHEIN") return <span>–</span>;
  const isPaid = !!document.paid;
  return (
    <Tooltip
      title={
        disabled
          ? ""
          : isPaid
            ? "Klicken, um als »nicht bezahlt« zu markieren"
            : "Klicken, um als »bezahlt« zu markieren"
      }
    >
      <span>
        <Chip
          size="small"
          clickable
          onClick={disabled ? undefined : onToggle}
          color={isPaid ? "success" : "error"}
          label={isPaid ? "bezahlt" : "nicht bezahlt"}
          sx={{ cursor: disabled ? "default" : "pointer" }}
        />
      </span>
    </Tooltip>
  );
}

/* ---------------- NachweisIcon ---------------- */
/* ---------------- Helpers ---------------- */
// Versucht, eine valide URL für den Nachweis zu bauen
// API_BASE_URL ist z.B. "/api" oder "http://localhost:3001/api"
// Wir nehmen an, dass uploads unter "/uploads" liegen (Root-Level vom Backend)

function getNachweisFullUrl(path) {
  if (!path) return null;
  // Wenn schon absolute URL
  if (path.startsWith("http")) return path;

  // Pfad sanitizen (Backslashes weg)
  const cleanPath = path.replace(/\\/g, "/");
  const normalizedPath = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;

  // EXPLICIT DEV FIX: 
  // Da der CRA Dev Server (localhost:3000) bei direkten Dateipfaden oft index.html ausliefert (SPA Fallback),
  // was zum Redirect aufs Dashboard führt, erzwingen wir hier den direkten Backend-Port (3001).
  if (process.env.NODE_ENV === "development" && API_BASE_URL.startsWith("/")) {
    return `http://localhost:3001${normalizedPath}`;
  }

  // Wenn wir im Dev-Mode sind (via Proxy), reicht der Pfad oft
  // Aber um sicherzugehen, versuchen wir die Origin aus der API_URL zu holen, falls vorhanden
  if (API_BASE_URL.startsWith("http")) {
    // z.B. http://localhost:3001/api -> http://localhost:3001
    try {
      const urlObj = new URL(API_BASE_URL);
      return `${urlObj.origin}${normalizedPath}`;
    } catch (e) {
      return normalizedPath;
    }
  }

  return normalizedPath;
}

/* ---------------- NachweisIcon ---------------- */
function NachweisIcon({ nachweisUrl, onClickUpload }) {
  const fullUrl = getNachweisFullUrl(nachweisUrl);

  return fullUrl ? (
    <Tooltip title="Nachweis ansehen">
      <IconButton
        href={fullUrl}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        color="success"
        aria-label="Nachweis ansehen"
      >
        <CheckIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  ) : (
    <Tooltip title="Nachweis direkt hochladen">
      <IconButton
        size="small"
        color="default"
        onClick={onClickUpload}
        aria-label="Nachweis hochladen"
      >
        <UploadIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

/* ================== Page ================== */
export default function PurchaseDocuments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();

  const [filters, setFilters] = useState({ startDate: null, endDate: null });
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);
  const [uploadDocId, setUploadDocId] = useState(null);
  const fileInputRef = React.useRef(null);

  /* -------- Query -------- */
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["purchase-documents", filters],
    queryFn: async () => {
      const params = {};
      if (filters.startDate) params.startDate = format(filters.startDate, "yyyy-MM-dd");
      if (filters.endDate) params.endDate = format(filters.endDate, "yyyy-MM-dd");
      const res = await api.get("/purchase-documents", { params });
      const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
      // Sort: newest first
      docs.sort(
        (a, b) =>
          new Date(b.documentDate || b.createdAt || 0) -
          new Date(a.documentDate || a.createdAt || 0)
      );
      return { documents: docs };
    },
    keepPreviousData: true,
  });

  const documents = useMemo(() => data?.documents || [], [data]);

  /* -------- Mutations -------- */
  const markPaid = useMutation({
    mutationFn: ({ id, paymentMethod }) =>
      api.post(`/purchase-documents/${id}/mark-paid`, { paymentMethod }),
    onSuccess: () => queryClient.invalidateQueries(["purchase-documents"]),
  });

  const markUnpaid = useMutation({
    mutationFn: (id) => api.post(`/purchase-documents/${id}/mark-unpaid`),
    onSuccess: () => queryClient.invalidateQueries(["purchase-documents"]),
  });

  const del = useMutation({
    mutationFn: (id) => api.delete(`/purchase-documents/${id}`),
    onSuccess: () => {
      setDeletingId(null);
      queryClient.invalidateQueries(["purchase-documents"]);
    },
    onError: () => setDeletingId(null),
  });

  const isAnyMutating = markPaid.isLoading || markUnpaid.isLoading || del.isLoading;

  /* -------- Handlers -------- */
  const togglePaidStatus = (doc) => {
    if (doc.type !== "RECHNUNG" || isAnyMutating || deletingId) return;
    if (doc.paid) {
      if (window.confirm("Als »nicht bezahlt« markieren?")) markUnpaid.mutate(doc.id);
    } else {
      // Standard: Überweisung – passe an, wenn Barzahlung möglich sein soll
      markPaid.mutate({ id: doc.id, paymentMethod: "TRANSFER" });
    }
  };

  const edit = (id) => {
    if (!isAnyMutating && !deletingId) navigate(`/purchases/edit/${id}`);
  };

  const removeDoc = (doc) => {
    if (isAnyMutating || deletingId) return;
    const linkedLs = doc?.lieferscheine?.length || 0;
    const hasStock = (doc?._count?.items || 0) > 0 || doc.type === "LIEFERSCHEIN";
    let text = `Beleg „${doc.documentNumber}“ wirklich endgültig löschen?\n\n`;
    if (linkedLs > 0) text += `Es sind ${linkedLs} Lieferscheine verknüpft (Verknüpfungen werden aufgehoben).\n`;
    if (hasStock) text += `ACHTUNG: Zugehörige Wareneingänge werden aus dem Lagerbestand storniert!\n`;
    if (window.confirm(text)) {
      setDeletingId(doc.id);
      del.mutate(doc.id);
    }
  };

  const toggleRow = (id) => {
    const s = new Set(expandedRows);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpandedRows(s);
  };

  const handleFilterChange = (k, v) => setFilters((p) => ({ ...p, [k]: v }));
  const resetFilters = () => {
    setFilters({ startDate: null, endDate: null });
    queryClient.invalidateQueries(["purchase-documents"]);
  };

  const fmtDate = (d) => {
    try {
      return format(new Date(d), "dd.MM.yyyy", { locale: de });
    } catch {
      return "—";
    }
  };

  /* -------- Upload Handler -------- */
  const handleUploadTrigger = (id) => {
    setUploadDocId(id);
    // Timeout, damit State gesetzt ist
    setTimeout(() => {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }, 0);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !uploadDocId) return;

    const formData = new FormData();
    formData.append("nachweis", file);

    try {
      await api.patch(`/purchase-documents/${uploadDocId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      queryClient.invalidateQueries(["purchase-documents"]);
    } catch (err) {
      console.error("Upload error:", err);
      window.alert("Fehler beim Hochladen des Nachweises.");
    } finally {
      setUploadDocId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* -------- Stats -------- */
  const stats = useMemo(() => {
    const re = documents.filter((d) => d.type === "RECHNUNG");
    const offeneRechnungen = re.filter((r) => !r.paid).length;
    const ohneNachweis = documents.filter((d) => !d.nachweisUrl).length;
    // „nicht zugeordnet“ = Lieferscheine ohne verknüpfte Rechnung
    const lieferscheineOhneRechnung = documents
      .filter((d) => d.type === "LIEFERSCHEIN" && !d.invoiceId)
      .length;
    return { offeneRechnungen, ohneNachweis, lieferscheineOhneRechnung };
  }, [documents]);

  /* -------- Mobile Card Component -------- */
  const MobileDocumentCard = ({ doc }) => {
    const hasChildren = (doc.lieferscheine || []).length > 0;
    const [expanded, setExpanded] = useState(false);
    const isRechnung = doc.type === "RECHNUNG";

    return (
      <Paper
        sx={{
          mb: 2,
          p: 2,
          borderRadius: 3,
          border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
          position: "relative",
          overflow: "hidden",
        }}
        elevation={0}
      >
        {/* Type Indicator Strip */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            bgcolor: isRechnung ? "primary.main" : "info.main",
          }}
        />

        <Stack spacing={1.5} sx={{ pl: 1 }}>
          {/* Header: Number & Date */}
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="subtitle2" color="text.secondary" fontSize={11}>
                {doc.type}
              </Typography>
              <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                {doc.documentNumber}
              </Typography>
              <Typography variant="body2" fontWeight={500} color="text.primary">
                {doc.supplier}
              </Typography>
            </Box>
            <Stack alignItems="flex-end">
              <Typography variant="body2" fontWeight={600} color={isRechnung ? "text.primary" : "text.secondary"}>
                {fmtDate(doc.documentDate)}
              </Typography>
              {isRechnung && (
                <Typography variant="h6" color="primary.main" fontWeight={800} sx={{ mt: 0.5 }}>
                  {formatCurrency(doc.totalAmount)}
                </Typography>
              )}
            </Stack>
          </Stack>

          <Divider sx={{ borderStyle: "dashed" }} />

          {/* Actions Row */}
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center">
              <StatusChip document={doc} onToggle={() => togglePaidStatus(doc)} disabled={isAnyMutating || !!deletingId} />
              <NachweisIcon nachweisUrl={doc.nachweisUrl} onClickUpload={() => handleUploadTrigger(doc.id)} />
            </Stack>

            <Stack direction="row" spacing={0}>
              <IconButton size="small" onClick={() => edit(doc.id)} disabled={isAnyMutating || !!deletingId}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => removeDoc(doc)} disabled={isAnyMutating || !!deletingId}>
                {deletingId === doc.id ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>

          {/* Children / Linked Documents */}
          {hasChildren && (
            <Box sx={{ bgcolor: alpha(theme.palette.background.default, 0.5), mx: -2, px: 2, py: 1, mt: 1 }}>
              <Button
                size="small"
                fullWidth
                onClick={() => setExpanded(!expanded)}
                endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
                sx={{ justifyContent: "space-between", textTransform: "none", color: "text.secondary" }}
              >
                {doc.lieferscheine.length} Lieferschein(e) verknüpft
              </Button>
              {expanded && (
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {doc.lieferscheine.map((ls) => (
                    <Box key={ls.id} sx={{ p: 1, border: "1px solid #eee", borderRadius: 2, bgcolor: "background.paper" }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={600}>{ls.documentNumber}</Typography>
                        <Typography variant="caption">{fmtDate(ls.documentDate)}</Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">{ls.supplier}</Typography>
                        <Stack direction="row" spacing={1}>
                          <NachweisIcon nachweisUrl={ls.nachweisUrl} onClickUpload={() => handleUploadTrigger(ls.id)} />
                          <IconButton size="small" sx={{ p: 0.5 }} onClick={() => edit(ls.id)}>
                            <EditIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Stack>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          )}
        </Stack>
      </Paper>
    );
  };

  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  /* -------- Render -------- */
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, width: "100%", pb: 10, overflowX: "hidden" }}>
      {/* Header */}
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h4" fontWeight={800} sx={{ letterSpacing: "-0.02em" }}>
              Einkäufe
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Verwaltung aller Rechnungen und Lieferscheine
            </Typography>
          </Box>
        </Stack>

        {/* Mobile Action Buttons (visible only on mobile) */}
        <Stack spacing={2} sx={{ mt: 3, display: { xs: "flex", md: "none" } }}>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            startIcon={<AddIcon />}
            onClick={() => navigate("/purchases/create", { state: { type: "RECHNUNG" } })}
            sx={{ py: 1.5, fontWeight: 700, boxShadow: theme.shadows[4] }}
          >
            Neuer Einkauf
          </Button>
          <Button
            variant="outlined"
            fullWidth
            size="large"
            startIcon={<AddIcon />}
            onClick={() => navigate("/purchases/create", { state: { type: "LIEFERSCHEIN" } })}
            sx={{ py: 1.5, color: "text.primary", borderColor: "divider" }}
          >
            Lieferschein
          </Button>
        </Stack>
      </Box>

      {/* Quick Stats & Actions Grid */}
      <Grid container spacing={2} sx={{ mb: 3 }} alignItems="stretch">
        <Grid item xs={6} md={3}>
          <Paper sx={{ p: 2, height: "100%", borderRadius: 3, bgcolor: alpha(theme.palette.error.main, 0.1), border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`, display: "flex", flexDirection: "column", justifyContent: "center" }} elevation={0}>
            <Typography variant="caption" fontWeight={700} color="error.dark">OFFEN / UNBEZAHLT</Typography>
            <Typography variant="h4" fontWeight={800} color="error.main">{stats.offeneRechnungen}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={3}>
          <Paper sx={{ p: 2, height: "100%", borderRadius: 3, bgcolor: alpha(theme.palette.warning.main, 0.1), border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`, display: "flex", flexDirection: "column", justifyContent: "center" }} elevation={0}>
            <Typography variant="caption" fontWeight={700} color="warning.dark">OHNE NACHWEIS</Typography>
            <Typography variant="h4" fontWeight={800} color="warning.main">{stats.ohneNachweis}</Typography>
          </Paper>
        </Grid>

        {/* Desktop Action Buttons: Visible only on md+ */}
        <Grid item xs={6} md={3} sx={{ display: { xs: "none", md: "block" } }}>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            onClick={() => navigate("/purchases/create", { state: { type: "RECHNUNG" } })}
            sx={{
              height: "100%",
              borderRadius: 3,
              fontSize: "1.1rem",
              fontWeight: 800,
              textTransform: "none",
              boxShadow: theme.shadows[8],
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1
            }}
          >
            <AddIcon fontSize="large" />
            Neuer Einkauf
          </Button>
        </Grid>
        <Grid item xs={6} md={3} sx={{ display: { xs: "none", md: "block" } }}>
          <Button
            variant="outlined"
            color="inherit"
            fullWidth
            onClick={() => navigate("/purchases/create", { state: { type: "LIEFERSCHEIN" } })}
            sx={{
              height: "100%",
              borderRadius: 3,
              fontSize: "1.1rem",
              fontWeight: 600,
              textTransform: "none",
              border: `2px solid ${theme.palette.divider}`,
              color: "text.primary",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              "&:hover": {
                borderColor: "text.primary",
                bgcolor: "action.hover"
              }
            }}
          >
            <AddIcon fontSize="medium" />
            Lieferschein
          </Button>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper elevation={0} sx={{ p: 2, mb: 3, borderRadius: 3, border: `1px solid ${alpha(theme.palette.divider, 0.8)}`, bgcolor: "background.paper" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
          <Box sx={{ display: "flex", gap: 2, width: { xs: "100%", sm: "auto" }, flexWrap: "wrap" }}>
            <DatePicker
              label="Von"
              value={filters.startDate}
              onChange={(d) => handleFilterChange("startDate", d)}
              slotProps={{ textField: { size: "small", fullWidth: true, sx: { minWidth: 120, flex: 1 } } }}
            />
            <DatePicker
              label="Bis"
              value={filters.endDate}
              onChange={(d) => handleFilterChange("endDate", d)}
              slotProps={{ textField: { size: "small", fullWidth: true, sx: { minWidth: 120, flex: 1 } } }}
            />
          </Box>
          <Button variant="text" size="small" onClick={resetFilters} sx={{ ml: "auto !important", width: { xs: "100%", sm: "auto" } }}>
            Filter zurücksetzen
          </Button>
        </Stack>
      </Paper>

      {/* Loading / Error */}
      {isLoading && <CircularProgress sx={{ display: "block", mx: "auto", my: 4 }} />}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Fehler beim Laden der Belege: {error?.response?.data?.error || error?.message}
        </Alert>
      )}

      {/* Content Switcher: Mobile Cards vs Desktop Table */}
      {!isLoading && !isError && (
        <>
          {isMobile ? (
            <Box>
              {documents.map(doc => <MobileDocumentCard key={doc.id} doc={doc} />)}
              {documents.length === 0 && <Typography align="center" color="text.secondary" sx={{ py: 4 }}>Keine Belege gefunden</Typography>}
            </Box>
          ) : (
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
                overflow: "hidden"
              }}
            >
              <Table stickyHeader sx={{ minWidth: 800 }}>
                <TableHead>
                  <TableRow sx={{ "& th": { fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.04) } }}>
                    <TableCell width="20%">Belegnummer</TableCell>
                    <TableCell width="20%">Lieferant</TableCell>
                    <TableCell align="center" width="10%">Nachweis</TableCell>
                    <TableCell align="right" width="15%">Betrag</TableCell>
                    <TableCell width="15%">Status</TableCell>
                    <TableCell width="10%">Datum</TableCell>
                    <TableCell align="center" width="10%">Aktion</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {documents.map((doc) => {
                    const isRowDeleting = deletingId === doc.id;
                    const hasChildren = (doc.lieferscheine || []).length > 0;
                    const expanded = expandedRows.has(doc.id);

                    return (
                      <React.Fragment key={doc.id}>
                        <TableRow hover sx={{ "& td": { borderBottomColor: alpha(theme.palette.divider, 0.5) } }}>
                          <TableCell>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <IconButton
                                size="small"
                                onClick={() => toggleRow(doc.id)}
                                disabled={!hasChildren}
                                sx={{ visibility: hasChildren ? 'visible' : 'hidden' }}
                              >
                                {expanded ? <ExpandLess /> : <ExpandMore />}
                              </IconButton>
                              <Box>
                                <Chip
                                  label={doc.type === "RECHNUNG" ? "EK" : "LS"}
                                  size="small"
                                  color={doc.type === "RECHNUNG" ? "primary" : "default"}
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: 9, mr: 1 }}
                                />
                                <Typography component="span" variant="body2" fontWeight={600}>
                                  {doc.documentNumber}
                                </Typography>
                              </Box>
                            </Stack>
                          </TableCell>
                          <TableCell>{doc.supplier}</TableCell>
                          <TableCell align="center">
                            <NachweisIcon nachweisUrl={doc.nachweisUrl} onClickUpload={() => handleUploadTrigger(doc.id)} />
                          </TableCell>
                          <TableCell align="right">
                            {doc.type === "RECHNUNG" ? (
                              <Typography variant="body2" fontWeight={700}>
                                {formatCurrency(doc.totalAmount)}
                              </Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">-</Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusChip document={doc} onToggle={() => togglePaidStatus(doc)} disabled={isAnyMutating || !!deletingId} />
                          </TableCell>
                          <TableCell>{fmtDate(doc.documentDate)}</TableCell>
                          <TableCell align="center">
                            <IconButton size="small" color="primary" onClick={() => edit(doc.id)} sx={{ mr: 1 }}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" color="error" onClick={() => removeDoc(doc)}>
                              {isRowDeleting ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                            </IconButton>
                          </TableCell>
                        </TableRow>

                        {/* Expanded Children */}
                        {expanded && (doc.lieferscheine || []).map(ls => (
                          <TableRow key={ls.id} sx={{ bgcolor: alpha(theme.palette.action.hover, 0.05) }}>
                            <TableCell colSpan={7} sx={{ py: 1, px: 0 }}>
                              <Box sx={{ pl: 8, pr: 2, display: 'flex', alignItems: 'center', justifyContent: "space-between" }}>
                                <Stack direction="row" spacing={2} alignItems="center">
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>↳ {ls.documentNumber}</Typography>
                                  <Typography variant="body2" color="text.secondary">{ls.supplier}</Typography>
                                  <Typography variant="caption" color="text.secondary">{fmtDate(ls.documentDate)}</Typography>
                                </Stack>
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mr: 4 }}>
                                    <Typography variant="caption">Nachweis:</Typography>
                                    <NachweisIcon nachweisUrl={ls.nachweisUrl} onClickUpload={() => handleUploadTrigger(ls.id)} />
                                  </Stack>
                                  <IconButton size="small" onClick={() => edit(ls.id)} sx={{ padding: 0.5 }}><EditIcon sx={{ fontSize: 18 }} /></IconButton>
                                  <IconButton size="small" color="error" onClick={() => removeDoc(ls)} sx={{ padding: 0.5 }}><DeleteIcon sx={{ fontSize: 18 }} /></IconButton>
                                </Stack>
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      {/* Hidden File Input for Direct Upload */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileChange}
        accept="application/pdf,image/*"
      />
    </Box>
  );
}
