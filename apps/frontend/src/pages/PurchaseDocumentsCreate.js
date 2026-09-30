import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";

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
import { useArticleLines, toPurchasePayload } from "../hooks/useArticleLines";
import { useArticles } from "../hooks/useArticles";
import LinkedLieferscheineInfo from "../components/purchases/LinkedLieferscheineInfo";
import { invalidate } from '../utils/invalidate';

/* -------------------------------------------------------------------------- */
/*                         Main Component: PurchaseDocumentCreate             */
/* -------------------------------------------------------------------------- */

export default function PurchaseDocumentCreate() {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const documentType =
    location.state?.type === "LIEFERSCHEIN" ? "LIEFERSCHEIN" : "RECHNUNG";
  const isRechnung = documentType === "RECHNUNG";

  const [file, setFile] = useState(null);
  const [formError, setFormError] = useState(null);

  /* ---------------------------- React Hook Form --------------------------- */
  const { control, handleSubmit, watch } = useForm({
    defaultValues: {
      documentDate: new Date(),
      supplier: null,
      description: "",
      totalAmount: "",
      paid: false,
      paymentMethod: "TRANSFER",
    },
  });
  const watchedPaid = watch("paid");

  /* ------------------------------ Positionen ------------------------------ */
  const { lines, setLines } = useArticleLines([]);
  const { isLoading: isLoadingArticles } = useArticles();

  /* ------------------------------- Queries -------------------------------- */
  const { data: suppliersData, isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api.get("/purchase-documents/suppliers").then((res) => res.data),
  });
  const suppliers = suppliersData?.suppliers || [];

  /* ------------------------------ File Upload ----------------------------- */
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
  };

  /* ------------------------------ Mutation -------------------------------- */
  const mutation = useMutation({
    mutationFn: (formData) =>
      api.post("/purchase-documents", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    onSuccess: () => {
      invalidate(queryClient, "purchases", "stock", "finance");
      navigate("/purchases");
    },
    onError: (err) => console.error("Fehler beim Erstellen:", err),
  });

  /* ---------------------------- Delivery Notes ---------------------------- */
  const [selectedLieferscheine, setSelectedLieferscheine] = useState([]);
  const supplierValue = watch("supplier");

  // Positionen mit Menge > 0 auf der Rechnung selbst (für die Doppelbuchungs-Warnung)
  const ownLineCount = lines.filter((l) => (Number(l.crateQty) || 0) + (Number(l.baseQty) || 0) > 0).length;

  const { data: unassignedLieferscheine = [], isLoading: isLoadingUnassigned } = useQuery({
    queryKey: ["unassigned-lieferscheine", supplierValue],
    queryFn: async () => {
      if (!supplierValue) return [];
      const res = await api.get("/purchase-documents/unassigned", {
        params: { supplier: supplierValue },
      });
      return res.data.documents || [];
    },
    enabled: !!supplierValue && isRechnung,
  });

  /* ------------------------------ Submit ---------------------------------- */
  const onSubmit = (data) => {
    const supplierValue = data.supplier;

    if (typeof supplierValue !== "string" || !supplierValue.trim()) {
      setFormError("Bitte einen Lieferanten auswählen oder eintippen.");
      return;
    }
    setFormError(null);

    const formData = new FormData();
    formData.append("type", documentType);
    formData.append("documentDate", data.documentDate.toISOString());
    formData.append("supplier", supplierValue);
    formData.append("description", data.description || "");

    if (isRechnung) {
      formData.append("totalAmount", data.totalAmount || "0");
      formData.append("paid", data.paid);
      if (data.paid) formData.append("paymentMethod", data.paymentMethod);
      if (data.dueDate) formData.append("dueDate", data.dueDate.toISOString());

      // Lieferscheine hinzufügen
      if (selectedLieferscheine.length > 0) {
        const ids = selectedLieferscheine.map(l => l.id);
        formData.append("lieferscheinIds", JSON.stringify(ids));
      }
    }

    if (file) formData.append("nachweis", file);

    // Backend-Vertrag unverändert: [{ articleId, kisten, flaschen }]
    formData.append("items", JSON.stringify(toPurchasePayload(lines)));
    mutation.mutate(formData);
  };

  /* ---------------------------- Layout states ----------------------------- */

  const showFloatingActions = useMediaQuery(theme.breakpoints.down("md"));

  /* ------------------------------------------------------------------------ */
  /*                              Render Layout                               */
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

        <Controller
          name="documentDate"
          control={control}
          rules={{ required: true }}
          render={({ field }) => (
            <DatePicker
              {...field}
              label="Belegdatum"
              value={field.value || new Date()}
              slotProps={{
                textField: { size: "small", fullWidth: true, required: true },
              }}
            />
          )}
        />

        <Controller
          name="supplier"
          control={control}
          rules={{ required: "Lieferant ist erforderlich" }}
          render={({ field, fieldState }) => (
            <Autocomplete
              value={field.value || null}
              onChange={(e, newVal) => {
                field.onChange(newVal);
                setSelectedLieferscheine([]); // Reset selection on supplier change
              }}
              onInputChange={(e, val) =>
                e && e.type === "change" && field.onChange(val)
              }
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
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {isLoadingSuppliers && (
                          <CircularProgress color="inherit" size={20} />
                        )}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          )}
        />

        {/* Delivery Note Selection (Only for Invoices) */}
        {isRechnung && supplierValue && (
          <Autocomplete
            multiple
            options={unassignedLieferscheine}
            loading={isLoadingUnassigned || isLoadingSuppliers}
            noOptionsText="Keine offenen Lieferscheine gefunden"
            getOptionLabel={(option) => `${option.documentNumber} (${new Date(option.documentDate).toLocaleDateString()})`}
            value={selectedLieferscheine}
            onChange={(event, newValue) => {
              setSelectedLieferscheine(newValue);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="outlined"
                label="Offene Lieferscheine zuordnen"
                placeholder="Lieferscheine wählen"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {isLoadingUnassigned ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        )}

        {/* Regel: Lieferschein UND Rechnungspositionen buchen jeweils Bestand – Zuordnung ändert nichts */}
        {isRechnung && selectedLieferscheine.length > 0 && (
          <LinkedLieferscheineInfo lieferscheine={selectedLieferscheine} ownLineCount={ownLineCount} />
        )}

        <Button
          component="label"
          color={file ? "success" : "primary"}
          variant="outlined"
          size="small"
          startIcon={file ? <CheckCircleIcon /> : <CloudUploadIcon />}
          sx={{ textTransform: "none", justifyContent: "flex-start" }}
        >
          {file ? file.name : "Nachweis hochladen..."}
          <input
            type="file"
            hidden
            accept="application/pdf,image/*"
            onChange={handleFileChange}
          />
        </Button>

        {isRechnung && (
          <>
            <Controller
              name="totalAmount"
              control={control}
              rules={{
                required: "Betrag ist erforderlich",
                min: { value: 0, message: "Betrag muss positiv sein" },
              }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Betrag"
                  type="number"
                  size="small"
                  fullWidth
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                  InputProps={{
                    endAdornment: <InputAdornment position="end">€</InputAdornment>,
                    inputProps: { step: "0.01" },
                  }}
                />
              )}
            />

            <Controller
              name="paid"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch {...field} checked={field.value} color="success" />}
                  label="Bereits bezahlt"
                />
              )}
            />

            {watchedPaid && (
              <Controller
                name="paymentMethod"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Zahlungsart" select size="small" fullWidth>
                    <MenuItem value="CASH">Bar</MenuItem>
                    <MenuItem value="TRANSFER">Überweisung</MenuItem>
                    <MenuItem value="ACCOUNT">Kundenkonto</MenuItem>
                  </TextField>
                )}
              />
            )}
          </>
        )}

        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Kommentar / Beschreibung"
              multiline
              minRows={2}
              size="small"
              fullWidth
            />
          )}
        />
      </Stack>
    </Paper>
  );

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmit)}
      sx={{ height: "calc(100vh - 80px)", display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      {/* Header */}
      <Paper
        square
        elevation={0}
        sx={{ flexShrink: 0, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider", py: 1.5, px: { xs: 1, sm: 2 }, mb: 1.5, borderRadius: 2 }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton color="primary" onClick={() => navigate("/purchases")}>
              <ArrowBackIcon />
            </IconButton>
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, display: "block" }}>
                {isRechnung ? "Einkauf · Rechnung mit Wareneingang" : "Einkauf · Wareneingang, Rechnung folgt"}
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {isRechnung ? "Neue Lieferantenrechnung" : "Neuer Lieferschein"}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ display: { xs: "none", md: "flex" } }}>
            <Button startIcon={<CancelIcon />} color="secondary" onClick={() => navigate("/purchases")}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              startIcon={<SaveIcon />}
              color="primary"
              variant="contained"
              disabled={mutation.isPending || isLoadingArticles}
            >
              {mutation.isPending ? "Speichert..." : "Speichern"}
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
        <Paper
          square
          elevation={10}
          sx={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100,
            py: 1.5,
            px: 2,
            borderTop: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            gap: 1,
          }}
        >
          <Button
            startIcon={<CancelIcon />}
            color="secondary"
            onClick={() => navigate("/purchases")}
            fullWidth
          >
            Abbrechen
          </Button>
          <Button
            type="submit"
            startIcon={<SaveIcon />}
            color="primary"
            variant="contained"
            disabled={mutation.isPending || isLoadingArticles}
            fullWidth
          >
            {mutation.isPending ? "Speichert..." : "Speichern"}
          </Button>
        </Paper>
      )}
    </Box>
  );
}
