import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
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

function themeTint(theme, color, fallback) {
  // dezente Kartenhintergründe je nach Theme
  const map = {
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    info: theme.palette.info.main,
    error: theme.palette.error.main,
    primary: theme.palette.primary.main,
  };
  const base = map[color] || fallback || theme.palette.primary.main;
  return theme.palette.mode === "dark"
    ? alpha(base, 0.12)
    : alpha(base, 0.08);
}

/* ---------------- StatCard ---------------- */
function StatCard({ title, value, color = "primary" }) {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        textAlign: "center",
        borderRadius: 2,
        border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
        bgcolor: themeTint(theme, color),
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <Typography
        variant="h2"
        sx={{ fontSize: { xs: "2.4rem", sm: "3rem" }, fontWeight: 800, mb: 0.5 }}
      >
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
    </Paper>
  );
}

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
function NachweisIcon({ nachweisUrl, onClickUpload }) {
  return nachweisUrl ? (
    <Tooltip title="Nachweis ansehen">
      <IconButton
        href={nachweisUrl}
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
    <Tooltip title="Nachweis hochladen/bearbeiten">
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

  const documents = data?.documents || [];

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
    if (!isAnyMutating && !deletingId) navigate(`/PurchaseDocuments/edit/${id}`);
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

  /* -------- Render -------- */
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={800} gutterBottom>
          Einkäufe & Lieferscheine
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Übersicht über alle Einkäufe und zugehörige Lieferscheine
        </Typography>
      </Box>

      {/* Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Unbezahlt" value={isLoading ? "…" : stats.offeneRechnungen} color="error" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="ohne Nachweis" value={isLoading ? "…" : stats.ohneNachweis} color="warning" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Lieferscheine nicht zugeordnet"
            value={isLoading ? "…" : stats.lieferscheineOhneRechnung}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              height: "100%",
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
              display: "grid",
              gap: 1,
              alignContent: "center",
            }}
          >
            <Button
              variant="contained"
              color="success"
              startIcon={<AddIcon />}
              fullWidth
              onClick={() => navigate("/PurchaseDocumentsCreate", { state: { type: "RECHNUNG" } })}
            >
              neuer Einkauf
            </Button>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              fullWidth
              onClick={() => navigate("/PurchaseDocumentsCreate", { state: { type: "LIEFERSCHEIN" } })}
            >
              neuer Lieferschein
            </Button>
          </Paper>
        </Grid>
      </Grid>

      {/* Filter */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }}>
          <DatePicker
            label="Von"
            value={filters.startDate}
            onChange={(d) => handleFilterChange("startDate", d)}
            slotProps={{ textField: { size: "small" } }}
            sx={{ minWidth: 160 }}
          />
          <DatePicker
            label="Bis"
            value={filters.endDate}
            onChange={(d) => handleFilterChange("endDate", d)}
            slotProps={{ textField: { size: "small" } }}
            sx={{ minWidth: 160 }}
          />
          <Button variant="outlined" onClick={resetFilters}>
            Filter zurücksetzen
          </Button>
        </Stack>
      </Paper>

      {isLoading && <CircularProgress sx={{ display: "block", mx: "auto", my: 4 }} />}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Fehler beim Laden der Belege: {error?.response?.data?.error || error?.message}
        </Alert>
      )}

      {/* Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 2,
          border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
          overflowX: "auto",
        }}
      >
        <Table stickyHeader sx={{ minWidth: 860 }}>
          <TableHead>
            <TableRow
              sx={{
                bgcolor:
                  theme.palette.mode === "dark"
                    ? alpha("#fff", 0.06)
                    : alpha(theme.palette.background.paper, 1),
                "& th": { fontWeight: 700 },
                borderBottom: `1px solid ${theme.palette.divider}`,
              }}
            >
              <TableCell width="22%">Belegnummer</TableCell>
              <TableCell width="22%">Lieferant</TableCell>
              <TableCell align="center" width="10%">
                Nachweis
              </TableCell>
              <TableCell align="right" width="14%">
                Betrag
              </TableCell>
              <TableCell width="14%">Status</TableCell>
              <TableCell width="10%">Datum</TableCell>
              <TableCell align="center" width="8%">
                Aktionen
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {documents.map((doc) => {
              const isRowDeleting = deletingId === doc.id;
              const hasChildren = (doc.lieferscheine || []).length > 0;
              const expanded = expandedRows.has(doc.id);

              return (
                <React.Fragment key={doc.id}>
                  <TableRow
                    hover
                    sx={{
                      "& > *": { borderBottom: "unset" },
                      opacity: isRowDeleting ? 0.6 : 1,
                      transition: "background 120ms ease",
                      bgcolor:
                        doc.type === "LIEFERSCHEIN"
                          ? themeTint(theme, "info")
                          : "inherit",
                    }}
                  >
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {hasChildren ? (
                          <IconButton
                            size="small"
                            onClick={() => toggleRow(doc.id)}
                            aria-label={expanded ? "Zuklappen" : "Aufklappen"}
                          >
                            {expanded ? <ExpandLess /> : <ExpandMore />}
                          </IconButton>
                        ) : (
                          <Box sx={{ width: 40 }} />
                        )}
                        <Typography variant="body2" fontWeight={doc.type === "RECHNUNG" ? 700 : 500}>
                          {doc.documentNumber}
                        </Typography>
                      </Stack>
                    </TableCell>

                    <TableCell>{doc.supplier}</TableCell>

                    <TableCell align="center">
                      <NachweisIcon nachweisUrl={doc.nachweisUrl} onClickUpload={() => edit(doc.id)} />
                    </TableCell>

                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={doc.type === "RECHNUNG" ? 700 : 500}>
                        {formatCurrency(doc.totalAmount)}
                      </Typography>
                    </TableCell>

                    <TableCell>
                      <StatusChip document={doc} onToggle={() => togglePaidStatus(doc)} disabled={isAnyMutating || !!deletingId} />
                    </TableCell>

                    <TableCell>{fmtDate(doc.documentDate)}</TableCell>

                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        <Tooltip title="Bearbeiten & Lieferscheine zuordnen">
                          <span>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => edit(doc.id)}
                              disabled={isAnyMutating || !!deletingId}
                              aria-label="Bearbeiten"
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>

                        <Tooltip title={isRowDeleting ? "Löschen…" : "Löschen"}>
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => removeDoc(doc)}
                              disabled={isAnyMutating || !!deletingId}
                              aria-label="Löschen"
                            >
                              {isRowDeleting ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>

                  {/* Lieferscheine (Kinder) */}
                  {expanded &&
                    (doc.lieferscheine || []).map((ls) => {
                      const isChildDeleting = deletingId === ls.id;
                      return (
                        <TableRow key={ls.id} sx={{ opacity: isChildDeleting ? 0.6 : 1 }}>
                          <TableCell colSpan={1} sx={{ pl: 8 }}>
                            <Typography variant="body2" color="text.secondary">
                              {ls.documentNumber}
                            </Typography>
                          </TableCell>
                          <TableCell>{ls.supplier}</TableCell>
                          <TableCell align="center">
                            <NachweisIcon nachweisUrl={ls.nachweisUrl} onClickUpload={() => edit(ls.id)} />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" color="text.secondary">
                              {formatCurrency(ls.totalAmount)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              –{/* Lieferscheine haben keinen Zahlungsstatus */}
                            </Typography>
                          </TableCell>
                          <TableCell>{fmtDate(ls.documentDate)}</TableCell>
                          <TableCell align="center">
                            <Stack direction="row" spacing={0.5} justifyContent="center">
                              <Tooltip title="Bearbeiten">
                                <span>
                                  <IconButton
                                      size="small"
                                      color="primary"
                                      onClick={() => edit(ls.id)}
                                      disabled={isAnyMutating || !!deletingId}
                                      aria-label="Bearbeiten"
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title={isChildDeleting ? "Löschen…" : "Löschen"}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => removeDoc(ls)}
                                    disabled={isAnyMutating || !!deletingId}
                                    aria-label="Löschen"
                                  >
                                    {isChildDeleting ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  {expanded && hasChildren && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ py: 0.5 }}>
                        <Divider />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
