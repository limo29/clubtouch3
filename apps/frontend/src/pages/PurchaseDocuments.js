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
} from "@mui/material";
import {
  CheckCircle as CheckIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  FileUpload as UploadIcon,
} from "@mui/icons-material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { format } from "date-fns";
import { de } from "date-fns/locale";

// --- Helper: Format Currency ---
const formatCurrency = (amount) => {
  const num = parseFloat(amount);
  if (isNaN(num) || num === 0) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(num);
};

// --- StatCard ---
function StatCard({ title, value, ...props }) {
  return (
    <Paper
      elevation={1}
      sx={{
        p: 3,
        textAlign: "center",
        borderRadius: 2,
        border: "1px solid #f0f0f0",
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        bgcolor: props.bgColor || "background.paper",
      }}
    >
      <Typography
        variant="h2"
        sx={{
          fontSize: { xs: "2.5rem", sm: "3rem" },
          fontWeight: 700,
          color:
            props.color === "success"
              ? "success.main"
              : props.color === "error"
              ? "error.main"
              : "text.primary",
          mb: 0.5,
        }}
      >
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
        {title}
      </Typography>
    </Paper>
  );
}

// --- StatusChip (toggle paid/unpaid) ---
function StatusChip({ document, onToggle, disabled }) {
  if (document.type === "LIEFERSCHEIN") {
    return <Typography variant="body2" color="text.secondary">–</Typography>;
  }

  const isPaid = document.paid;
  const props = isPaid
    ? { label: "bezahlt", color: "success", title: "Klicken, um als 'nicht bezahlt' zu markieren" }
    : { label: "nicht bezahlt", color: "error", title: "Klicken, um als 'bezahlt' zu markieren" };

  return (
    <Tooltip title={props.title}>
      <Chip
        size="small"
        label={props.label}
        color={props.color}
        onClick={onToggle}
        disabled={disabled}
        sx={{ cursor: disabled ? "default" : "pointer", "&:hover": { opacity: disabled ? 1 : 0.8 } }}
      />
    </Tooltip>
  );
}

// --- NachweisIcon (view/upload proof) ---
function NachweisIcon({ nachweisUrl, onClickUpload }) {
  return nachweisUrl ? (
    <Tooltip title="Nachweis ansehen">
      <IconButton href={nachweisUrl} target="_blank" size="small" color="success">
        <CheckIcon />
      </IconButton>
    </Tooltip>
  ) : (
    <Tooltip title="Nachweis hochladen/bearbeiten">
      <IconButton size="small" color="default" onClick={onClickUpload}>
        <UploadIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

export default function PurchaseDocuments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({ startDate: null, endDate: null });
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null); // track which row is deleting

  const { data: documentsData, isLoading, isError, error } = useQuery({
    queryKey: ["purchaseDocuments", filters],
    queryFn: async () => {
      const params = {};
      if (filters.startDate) params.startDate = format(filters.startDate, "yyyy-MM-dd");
      if (filters.endDate) params.endDate = format(filters.endDate, "yyyy-MM-dd");
      const response = await api.get("/purchase-documents", { params });
      return response.data;
    },
  });

  const documents = documentsData?.documents || [];

  // --- Mutations ---
  const markAsPaidMutation = useMutation({
    mutationFn: ({ id, paymentMethod }) => api.post(`/purchase-documents/${id}/mark-paid`, { paymentMethod }),
    onSuccess: () => queryClient.invalidateQueries(["purchaseDocuments"]),
    onError: (err) => alert("Fehler: " + (err.response?.data?.error || err.message)),
  });

  const markAsUnpaidMutation = useMutation({
    mutationFn: (id) => api.post(`/purchase-documents/${id}/mark-unpaid`),
    onSuccess: () => queryClient.invalidateQueries(["purchaseDocuments"]),
    onError: (err) => alert("Fehler: " + (err.response?.data?.error || err.message)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/purchase-documents/${id}`),
    onSuccess: () => {
      setDeletingId(null);
      queryClient.invalidateQueries(["purchaseDocuments"]);
    },
    onError: (err) => {
      setDeletingId(null);
      alert("Fehler: " + (err.response?.data?.error || err.message));
    },
  });

  // --- Toggle Paid/Unpaid ---
  const handleTogglePaidStatus = (document) => {
    if (document.type !== "RECHNUNG") return;
    if (deletingId) return; // do not toggle while deleting any row

    if (document.paid) {
      if (window.confirm("Soll dieser Beleg wirklich als 'nicht bezahlt' markiert werden?")) {
        markAsUnpaidMutation.mutate(document.id);
      }
    } else {
      markAsPaidMutation.mutate({ id: document.id, paymentMethod: "TRANSFER" });
    }
  };

  // --- Edit / Upload ---
  const handleEdit = (documentId) => {
    if (deletingId) return;
    navigate(`/PurchaseDocuments/edit/${documentId}`);
  };

  // --- Delete with smart warning ---
  const handleDelete = (document) => {
    if (deletingId) return;

    const hasItems = (document?._count?.items || 0) > 0 || document.type === "LIEFERSCHEIN";
    const linkedCount = document?.lieferscheine?.length || 0;

    let warning = `Soll der Beleg "${document.documentNumber}" wirklich endgültig gelöscht werden?\n\n`;
    if (linkedCount > 0) {
      warning += `Es sind ${linkedCount} Lieferscheine verknüpft. Die Verknüpfungen werden aufgehoben.\n`;
    }
    if (hasItems) {
      warning += `\nACHTUNG: Alle zugehörigen Wareneingänge werden aus dem Lagerbestand storniert!`;
    }

    if (window.confirm(warning)) {
      setDeletingId(document.id);
      deleteMutation.mutate(document.id);
    }
  };

  // --- Statistics ---
  const statistics = useMemo(() => {
    if (!documents) return { offeneRechnungen: 0, ohneNachweis: 0, lieferscheineOhneRechnung: 0 };

    const rechnungen = documents.filter((d) => d.type === "RECHNUNG");
    const offeneRechnungen = rechnungen.filter((r) => !r.paid).length;
    const ohneNachweis = documents.filter((d) => !d.nachweisUrl).length;
    const lieferscheineOhneRechnung = documents.filter((d) => d.type === "LIEFERSCHEIN").length;

    return { offeneRechnungen, ohneNachweis, lieferscheineOhneRechnung };
  }, [documents]);

  // --- Helpers ---
  const toggleRow = (id) => {
    const newExpanded = new Set(expandedRows);
    newExpanded.has(id) ? newExpanded.delete(id) : newExpanded.add(id);
    setExpandedRows(newExpanded);
  };

  const handleFilterChange = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const resetFilters = () => setFilters({ startDate: null, endDate: null });

  const formatDocumentDate = (dateString) => {
    try {
      return format(new Date(dateString), "dd.MM.yyyy", { locale: de });
    } catch {
      return "Ungültiges Datum";
    }
  };

  const isAnyMutationLoading =
    markAsPaidMutation.isLoading || markAsUnpaidMutation.isLoading || deleteMutation.isLoading;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Einkäufe & Lieferscheine
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Übersicht über alle Rechnungen und zugehörige Lieferscheine
        </Typography>
      </Box>

      {/* Stats */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="offene Rechnungen" value={isLoading ? "..." : statistics.offeneRechnungen} color="error" bgColor="#fef2f2" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="ohne Nachweis" value={isLoading ? "..." : statistics.ohneNachweis} color="warning" bgColor="#fffbeb" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Lieferscheine nicht zugeordnet" value={isLoading ? "..." : statistics.lieferscheineOhneRechnung} color="info" bgColor="#eff6ff" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", justifyContent: "center" }}>
            <Button
              variant="outlined"
              color="success"
              startIcon={<AddIcon />}
              fullWidth
              sx={{ py: 1.5 }}
              onClick={() => navigate("/PurchaseDocumentsCreate", { state: { type: "RECHNUNG" } })}
            >
              neue Rechnung
            </Button>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<AddIcon />}
              fullWidth
              sx={{ py: 1.5 }}
              onClick={() => navigate("/PurchaseDocumentsCreate", { state: { type: "LIEFERSCHEIN" } })}
            >
              neuer Lieferschein
            </Button>
          </Box>
        </Grid>
      </Grid>

      {/* Filter */}
      <Paper elevation={1} sx={{ p: 3, mb: 3, borderRadius: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }}>
          <DatePicker label="Von" value={filters.startDate} onChange={(d) => handleFilterChange("startDate", d)} slotProps={{ textField: { size: "small" } }} sx={{ minWidth: 150 }} />
          <DatePicker label="Bis" value={filters.endDate} onChange={(d) => handleFilterChange("endDate", d)} slotProps={{ textField: { size: "small" } }} sx={{ minWidth: 150 }} />
          <Button variant="outlined" onClick={resetFilters}>
            Filter zurücksetzen
          </Button>
        </Stack>
      </Paper>

      {isLoading && <CircularProgress sx={{ display: "block", mx: "auto", my: 4 }} />}
      {isError && <Alert severity="error">Fehler beim Laden der Belege: {error.response?.data?.error || error.message}</Alert>}

      {/* Table */}
      <TableContainer component={Paper} elevation={1} sx={{ borderRadius: 2, overflowX: "auto" }}>
        <Table sx={{ minWidth: 800 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: "grey.50" }}>
              <TableCell sx={{ fontWeight: 600, width: "20%" }}>Belegnummer</TableCell>
              <TableCell sx={{ fontWeight: 600, width: "20%" }}>Lieferant</TableCell>
              <TableCell sx={{ fontWeight: 600, textAlign: "center", width: "10%" }}>Nachweis</TableCell>
              <TableCell sx={{ fontWeight: 600, textAlign: "right", width: "15%" }}>Betrag</TableCell>
              <TableCell sx={{ fontWeight: 600, width: "15%" }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600, width: "10%" }}>Datum</TableCell>
              <TableCell sx={{ fontWeight: 600, textAlign: "center", width: "10%" }}>Aktionen</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {documents.map((item) => {
              const isRowDeleting = deletingId === item.id;

              return (
                <React.Fragment key={item.id}>
                  <TableRow
                    hover
                    sx={{
                      "& > *": { borderBottom: "unset" },
                      cursor: item.lieferscheine?.length > 0 ? "pointer" : "default",
                      bgcolor: item.type === "LIEFERSCHEIN" ? "grey.50" : "inherit",
                      opacity: isRowDeleting ? 0.6 : 1,
                    }}
                    onClick={(e) => {
                      if (e.target.closest("button") || e.target.closest("a") || e.target.closest(".MuiChip-root")) return;
                      item.lieferscheine?.length > 0 && toggleRow(item.id);
                    }}
                  >
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {item.lieferscheine?.length > 0 && (
                          <Typography variant="body2" sx={{ width: "10px" }}>
                            {expandedRows.has(item.id) ? "−" : "+"}
                          </Typography>
                        )}
                        <Typography variant="body2" fontWeight={item.type === "RECHNUNG" ? 600 : 400}>
                          {item.documentNumber}
                        </Typography>
                      </Box>
                    </TableCell>

                    <TableCell>{item.supplier}</TableCell>

                    <TableCell align="center">
                      <NachweisIcon nachweisUrl={item.nachweisUrl} onClickUpload={() => handleEdit(item.id)} />
                    </TableCell>

                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={item.type === "RECHNUNG" ? 600 : 400}>
                        {formatCurrency(item.totalAmount)}
                      </Typography>
                    </TableCell>

                    <TableCell>
                      <StatusChip
                        document={item}
                        onToggle={() => handleTogglePaidStatus(item)}
                        disabled={isAnyMutationLoading || !!deletingId}
                      />
                    </TableCell>

                    <TableCell>
                      <Typography variant="body2">{formatDocumentDate(item.documentDate)}</Typography>
                    </TableCell>

                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        <Tooltip title="Bearbeiten & Lieferscheine zuordnen">
                          <span>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleEdit(item.id)}
                              disabled={isAnyMutationLoading || !!deletingId}
                              aria-label="Bearbeiten"
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>

                        <Tooltip title={isRowDeleting ? "Löschen..." : "Löschen"}>
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDelete(item)}
                              disabled={isAnyMutationLoading || !!deletingId}
                              aria-label="Löschen"
                            >
                              {isRowDeleting ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>

                  {/* Lieferschein rows */}
                  {expandedRows.has(item.id) &&
                    item.lieferscheine?.map((lieferschein) => {
                      const isChildDeleting = deletingId === lieferschein.id;
                      return (
                        <TableRow key={lieferschein.id} sx={{ bgcolor: "grey.50", opacity: isChildDeleting ? 0.6 : 1 }}>
                          <TableCell>
                            <Box sx={{ display: "flex", alignItems: "center", pl: 3, gap: 1 }}>
                              <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.5 }}>
                                └
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {lieferschein.documentNumber}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>{lieferschein.supplier}</TableCell>
                          <TableCell align="center">
                            <NachweisIcon
                              nachweisUrl={lieferschein.nachweisUrl}
                              onClickUpload={() => handleEdit(lieferschein.id)}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" color="text.secondary">
                              {formatCurrency(lieferschein.totalAmount)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              –{/* Lieferscheine haben keinen Status */}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{formatDocumentDate(lieferschein.documentDate)}</Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Stack direction="row" spacing={0.5} justifyContent="center">
                              <Tooltip title="Bearbeiten">
                                <span>
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    onClick={() => handleEdit(lieferschein.id)}
                                    disabled={isAnyMutationLoading || !!deletingId}
                                    aria-label="Bearbeiten"
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>

                              <Tooltip title={isChildDeleting ? "Löschen..." : "Löschen"}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => handleDelete(lieferschein)}
                                    disabled={isAnyMutationLoading || !!deletingId}
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
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
