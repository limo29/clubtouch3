import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { format } from "date-fns";
import { de } from "date-fns/locale";

import {
  Box,
  Button,
  Paper,
  Typography,
  TextField,
  IconButton,
  Switch,
  Stack,
  InputAdornment,
  MenuItem,
  Autocomplete,
  CircularProgress,
  Alert,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Checkbox,
  Divider,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import {
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  CloudUpload as CloudUploadIcon,
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

import ArticleLinePicker from "../components/articles/ArticleLinePicker";
import { useArticleLines, toPurchasePayload, linesFromPurchaseItems } from "../hooks/useArticleLines";
import { useArticles } from "../hooks/useArticles";
import LinkedLieferscheineInfo from "../components/purchases/LinkedLieferscheineInfo";
import { invalidate } from '../utils/invalidate';
import ReimbursementCustomerField, { PAYMENT_METHOD_LABELS } from "../components/purchases/ReimbursementCustomerField";

/* -------------------------------------------------------------------------- */
/*                         Main Component: PurchaseDocumentEdit               */
/* -------------------------------------------------------------------------- */
export default function PurchaseDocumentEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();

  const showFloatingActions = useMediaQuery(theme.breakpoints.down("md"));

  const [file, setFile] = useState(null);
  const [formError, setFormError] = useState(null);
  const [linkedLieferscheinIds, setLinkedLieferscheinIds] = useState(new Set());
  const initializedRef = useRef(false);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
  };

  const { control, handleSubmit, reset, watch } = useForm({
    defaultValues: {
      documentDate: null,
      supplier: null,
      description: "",
      totalAmount: "",
      paid: false,
      paymentMethod: "TRANSFER",
      reimbursedCustomerId: "",
      dueDate: null,
    },
  });
  const watchedPaid = watch("paid");
  const watchedMethod = watch("paymentMethod");
  const watchedSupplier = watch("supplier");

  /* ------------------------------ Positionen ------------------------------ */
  const { lines, setLines, reset: resetLines } = useArticleLines([]);

  /* ------------------------------- Queries -------------------------------- */
  const { data: documentData, isLoading: isLoadingDocument, error: documentError } = useQuery({
    queryKey: ["purchaseDocument", id],
    queryFn: () => api.get(`/purchase-documents/${id}`).then((res) => res.data),
    enabled: !!id,
  });
  // Auslage ist bereits aufs Kundenkonto gebucht → Betrag, Zahlungsart und Kunde gesperrt,
  // bis der Beleg auf „offen" gesetzt wird (das bucht die Gutschrift zurück).
  const credited = !!(documentData?.paid && documentData?.paymentMethod === "ACCOUNT" && documentData?.reimbursedCustomerId);
  // Altbestand: vor der Auslage-Funktion als „Kundenkonto" bezahlt, ohne Kunde und ohne Gutschrift
  const legacyAccount = !!(documentData?.paid && documentData?.paymentMethod === "ACCOUNT" && !documentData?.reimbursedCustomerId);
  const lockMoney = credited && watchedPaid;

  // inkl. inaktive Artikel, damit bestehende Positionen inaktiver Artikel sichtbar bleiben
  const { allArticles, isLoading: isLoadingArticles } = useArticles({ activeOnly: false });

  const { data: suppliersData, isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api.get("/purchase-documents/suppliers").then((res) => res.data),
  });
  const suppliers = suppliersData?.suppliers || [];

  const { data: unassignedData, isLoading: isLoadingUnassigned } = useQuery({
    queryKey: ["unassignedLieferscheine", watchedSupplier],
    queryFn: () =>
      api.get(`/purchase-documents/unassigned?supplier=${watchedSupplier}`).then((res) => res.data),
    enabled: !!id && documentData?.type === "RECHNUNG" && !!watchedSupplier,
  });
  const unassignedLieferscheine = unassignedData?.documents || [];

  // Aktuell zugeordnete Lieferscheine (bereits verknüpfte + neu angehakte) für die Bestandsinfo
  const linkedLieferscheine = [...(documentData?.lieferscheine || []), ...unassignedLieferscheine]
    .filter((ls, idx, arr) => linkedLieferscheinIds.has(ls.id) && arr.findIndex((x) => x.id === ls.id) === idx);
  const ownLineCount = lines.filter((l) => (Number(l.crateQty) || 0) + (Number(l.baseQty) || 0) > 0).length;

  /* ---------------------------- Fill Form once ---------------------------- */
  useEffect(() => {
    if (initializedRef.current) return;
    if (!documentData) return;
    if (isLoadingArticles) return;

    reset({
      documentDate: new Date(documentData.documentDate),
      supplier: documentData.supplier,
      description: documentData.description || "",
      totalAmount: documentData.totalAmount || "",
      paid: documentData.paid || false,
      paymentMethod: documentData.paymentMethod || "TRANSFER",
      reimbursedCustomerId: documentData.reimbursedCustomerId || "",
      dueDate: documentData.dueDate ? new Date(documentData.dueDate) : null,
    });

    // Zeilen aus purchaseUnitQuantity / baseUnitQuantity der Positionen bauen
    resetLines(linesFromPurchaseItems(documentData.items || [], allArticles));

    if (documentData.lieferscheine) {
      setLinkedLieferscheinIds(new Set(documentData.lieferscheine.map((ls) => ls.id)));
    }

    initializedRef.current = true;
  }, [documentData, allArticles, isLoadingArticles, reset, resetLines]);

  /* ------------------------------ Mutations ------------------------------- */
  const mutation = useMutation({
    mutationFn: (formData) =>
      api.patch(`/purchase-documents/${id}`, formData, { headers: { "Content-Type": "multipart/form-data" } }),
    onSuccess: () => triggerLinkMutations(),
  });

  const linkMutation = useMutation({
    mutationFn: (ids) => api.post("/purchase-documents/link", { rechnungId: id, lieferscheinIds: ids }),
    onError: (err) => alert("Fehler beim Verknüpfen: " + err.message),
  });

  const unlinkMutation = useMutation({
    mutationFn: (ids) => api.post("/purchase-documents/unlink", { lieferscheinIds: ids }),
    onError: (err) => alert("Fehler beim Entknüpfen: " + err.message),
  });

  const onSubmit = (data) => {
    const isAuslage = documentData?.type === "RECHNUNG" && data.paid && data.paymentMethod === "ACCOUNT";
    if (isAuslage && !credited && !data.reimbursedCustomerId && !legacyAccount) {
      setFormError("Bitte wählen, wer die Rechnung ausgelegt hat.");
      return;
    }
    if (isAuslage && !credited && data.reimbursedCustomerId && !(Number(data.totalAmount) > 0)) {
      setFormError("Für eine Auslage muss der Gesamtbetrag größer als 0 sein.");
      return;
    }
    setFormError(null);
    const formData = new FormData();
    formData.append("documentDate", data.documentDate.toISOString());
    formData.append("supplier", data.supplier);
    formData.append("description", data.description || "");

    if (documentData?.type === "RECHNUNG") {
      formData.append("totalAmount", data.totalAmount || "0");
      formData.append("paid", data.paid);
      if (data.paid) formData.append("paymentMethod", data.paymentMethod);
      if (isAuslage && !credited && data.reimbursedCustomerId) formData.append("reimbursedCustomerId", data.reimbursedCustomerId);
      if (data.dueDate) formData.append("dueDate", data.dueDate.toISOString());
    }

    if (file) formData.append("nachweis", file);

    // Nur Zeilen mit Menge schicken. Sonst legt das Backend bei jedem
    // Speichern alle Artikel als Null-Positionen neu an (B13).
    formData.append("items", JSON.stringify(toPurchasePayload(lines)));

    mutation.mutate(formData);
  };

  const triggerLinkMutations = () => {
    const originalIds = new Set((documentData.lieferscheine || []).map((ls) => ls.id));
    const currentIds = linkedLieferscheinIds;

    const toLink = [...currentIds].filter((x) => !originalIds.has(x));
    const toUnlink = [...originalIds].filter((x) => !currentIds.has(x));

    const promises = [];
    if (toLink.length) promises.push(linkMutation.mutateAsync(toLink));
    if (toUnlink.length) promises.push(unlinkMutation.mutateAsync(toUnlink));

    Promise.all(promises).finally(() => {
      invalidate(queryClient, "purchases", "stock", "finance", "customers");
      navigate("/purchases");
    });
  };

  const handleToggleLieferschein = (xid) => {
    const next = new Set(linkedLieferscheinIds);
    next.has(xid) ? next.delete(xid) : next.add(xid);
    setLinkedLieferscheinIds(next);
  };

  const isSaving = mutation.isPending || linkMutation.isPending || unlinkMutation.isPending;

  if (isLoadingDocument || isLoadingArticles)
    return <CircularProgress sx={{ display: "block", mx: "auto", my: 10 }} />;
  if (documentError)
    return <Alert severity="error">Fehler beim Laden des Belegs: {documentError.message}</Alert>;

  /* ------------------------------------------------------------------------ */
  /*                                Render Layout                              */
  /* ------------------------------------------------------------------------ */

  const sidebar = (
    <Paper elevation={1} sx={{ height: "100%", overflowY: "auto", p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
      <Stack spacing={2.5}>
        {formError && <Alert severity="warning" onClose={() => setFormError(null)}>{formError}</Alert>}
        {mutation.isError && (
          <Alert severity="error">
            Fehler: {mutation.error?.response?.data?.error || mutation.error?.message}
          </Alert>
        )}

        <Controller name="documentDate" control={control} rules={{ required: true }} render={({ field }) => <DatePicker {...field} label="Belegdatum" value={field.value || new Date()} slotProps={{ textField: { size: "small", fullWidth: true, required: true } }} />} />
        <Controller
          name="supplier"
          control={control}
          rules={{ required: "Lieferant ist erforderlich" }}
          render={({ field, fieldState }) => (
            <Autocomplete
              value={field.value || null}
              onChange={(e, newVal) => field.onChange(newVal)}
              onInputChange={(e, val) => e && e.type === "change" && field.onChange(val)}
              options={suppliers}
              loading={isLoadingSuppliers}
              freeSolo
              getOptionLabel={(o) => o || ""}
              isOptionEqualToValue={(o, v) => o === v}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Lieferant"
                  size="small"
                  required
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                  InputProps={{ ...params.InputProps, endAdornment: <>{isLoadingSuppliers && <CircularProgress color="inherit" size={20} />}{params.InputProps.endAdornment}</> }}
                />
              )}
            />
          )}
        />

        <Button component="label" color={file ? "success" : "primary"} variant="outlined" size="small" startIcon={file ? <CheckCircleIcon /> : <CloudUploadIcon />} sx={{ textTransform: "none", justifyContent: "flex-start" }}>
          {file ? file.name : documentData?.nachweisUrl ? "Neue Datei hochladen" : "Nachweis hochladen..."}
          <input type="file" hidden accept="application/pdf,image/*" onChange={handleFileChange} />
        </Button>
        {documentData?.nachweisUrl && !file && (
          <Typography variant="caption">
            Aktuell:{" "}
            <a href={documentData.nachweisUrl} target="_blank" rel="noopener noreferrer">
              Datei ansehen
            </a>
          </Typography>
        )}

        {documentData?.type === "RECHNUNG" && (
          <>
            <Controller name="totalAmount" control={control} rules={{ required: "Betrag ist erforderlich", min: { value: 0, message: "Betrag muss positiv sein" } }} render={({ field, fieldState }) => (
              <TextField {...field} label="Betrag" type="number" size="small" fullWidth disabled={lockMoney} error={!!fieldState.error} helperText={fieldState.error?.message} InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment>, inputProps: { step: "0.01" } }} />
            )} />
            <Controller name="paid" control={control} render={({ field }) => <FormControlLabel control={<Switch {...field} checked={!!field.value} color="success" />} label="Bereits bezahlt" />} />
            {watchedPaid && (
              <Controller name="paymentMethod" control={control} render={({ field }) => (
                <TextField {...field} label="Zahlungsart" select size="small" fullWidth disabled={lockMoney}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([v, label]) => (
                    <MenuItem key={v} value={v}>{label}</MenuItem>
                  ))}
                </TextField>
              )} />
            )}
            {watchedPaid && watchedMethod === "ACCOUNT" && (
              <Controller name="reimbursedCustomerId" control={control} render={({ field }) => (
                <ReimbursementCustomerField
                  value={field.value}
                  onChange={field.onChange}
                  disabled={lockMoney}
                  helperText={legacyAccount && !field.value ? "Älterer Beleg ohne Gutschrift – Kunde wählen, um den Betrag jetzt gutzuschreiben." : undefined}
                />
              )} />
            )}
            {lockMoney && (
              <Alert severity="info">
                {documentData.totalAmount != null ? `${Number(documentData.totalAmount).toFixed(2).replace(".", ",")} € ` : ""}
                sind {documentData.reimbursedCustomer?.name ? `${documentData.reimbursedCustomer.name} ` : "dem Kunden "}
                gutgeschrieben. Betrag, Zahlungsart und Kunde lassen sich erst ändern, wenn der Beleg auf „offen" gesetzt wird
                (dabei wird die Gutschrift zurückgebucht).
              </Alert>
            )}
          </>
        )}
        <Controller name="description" control={control} render={({ field }) => <TextField {...field} label="Kommentar / Beschreibung" multiline minRows={2} size="small" fullWidth />} />

        {/* Lieferschein, der schon zu einer Rechnung gehört */}
        {documentData?.type === "LIEFERSCHEIN" && documentData?.rechnung && (
          <Alert severity="info">
            Dieser Lieferschein ist der Rechnung <strong>{documentData.rechnung.documentNumber}</strong> zugeordnet
            {documentData.rechnung.documentDate ? ` (${format(new Date(documentData.rechnung.documentDate), "dd.MM.yyyy", { locale: de })})` : ""}.
            Der Wareneingang ist über diesen Lieferschein gebucht.
          </Alert>
        )}

        {/* Lieferscheine zuordnen */}
        {documentData?.type === "RECHNUNG" && (
          <Box>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Lieferscheine zuordnen
            </Typography>
            {linkedLieferscheine.length > 0 && (
              <Box sx={{ mb: 1.5 }}>
                <LinkedLieferscheineInfo lieferscheine={linkedLieferscheine} ownLineCount={ownLineCount} />
              </Box>
            )}
            {isLoadingUnassigned && <CircularProgress size={20} />}
            <List dense disablePadding>
              {(documentData?.lieferscheine || []).map((ls) => (
                <ListItem key={ls.id} disablePadding>
                  <ListItemButton onClick={() => handleToggleLieferschein(ls.id)}>
                    <ListItemIcon>
                      <Checkbox edge="start" checked={linkedLieferscheinIds.has(ls.id)} tabIndex={-1} disableRipple />
                    </ListItemIcon>
                    <ListItemText primary={ls.documentNumber} secondary={format(new Date(ls.documentDate), "dd.MM.yy", { locale: de })} />
                  </ListItemButton>
                </ListItem>
              ))}

              {documentData?.lieferscheine?.length > 0 && unassignedLieferscheine.length > 0 && <Divider sx={{ my: 1 }} />}

              {unassignedLieferscheine.map((ls) => (
                <ListItem key={ls.id} disablePadding>
                  <ListItemButton onClick={() => handleToggleLieferschein(ls.id)}>
                    <ListItemIcon>
                      <Checkbox edge="start" checked={linkedLieferscheinIds.has(ls.id)} tabIndex={-1} disableRipple />
                    </ListItemIcon>
                    <ListItemText primary={ls.documentNumber} secondary={format(new Date(ls.documentDate), "dd.MM.yy", { locale: de })} />
                  </ListItemButton>
                </ListItem>
              ))}

              {!isLoadingUnassigned && (documentData?.lieferscheine?.length || 0) === 0 && unassignedLieferscheine.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  Keine Lieferscheine für "{watchedSupplier}" gefunden.
                </Typography>
              )}
            </List>
          </Box>
        )}
      </Stack>
    </Paper>
  );

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ height: "calc(100vh - 80px)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <Paper square elevation={0} sx={{ flexShrink: 0, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider", py: 1.5, px: { xs: 1, sm: 2 }, mb: 1.5, borderRadius: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton color="primary" onClick={() => navigate("/purchases")}>
              <ArrowBackIcon />
            </IconButton>
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, display: "block" }}>
                Einkauf · Beleg bearbeiten ({documentData?.documentNumber})
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {documentData?.type === "RECHNUNG" ? "Lieferantenrechnung" : "Lieferschein"}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ display: { xs: "none", md: "flex" } }}>
            <Button startIcon={<CancelIcon />} color="secondary" onClick={() => navigate("/purchases")}>
              Abbrechen
            </Button>
            <Button type="submit" startIcon={<SaveIcon />} color="primary" variant="contained" disabled={isSaving || !initializedRef.current}>
              {isSaving ? "Speichert..." : "Speichern"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Beleg | Artikel | Positionen */}
      <Box sx={{ flex: 1, minHeight: 0, pb: showFloatingActions ? 9 : 0 }}>
        <ArticleLinePicker
          mode="purchase"
          lines={lines}
          onChange={setLines}
          sidebar={sidebar}
          sidebarLabel="Beleg"
          linesLabel="Positionen"
        />
      </Box>

      {/* Floating Action Bar */}
      {showFloatingActions && (
        <Paper square elevation={10} sx={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 100, py: 1.5, px: 2, borderTop: "1px solid", borderColor: "divider", bgcolor: "background.paper", display: "flex", gap: 1 }}>
          <Button startIcon={<CancelIcon />} color="secondary" onClick={() => navigate("/purchases")} fullWidth>
            Abbrechen
          </Button>
          <Button type="submit" startIcon={<SaveIcon />} color="primary" variant="contained" disabled={isSaving || !initializedRef.current} fullWidth>
            {isSaving ? "Speichert..." : "Speichern"}
          </Button>
        </Paper>
      )}
    </Box>
  );
}
