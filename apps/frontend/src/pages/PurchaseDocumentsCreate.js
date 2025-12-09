import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm, Controller, useFieldArray } from "react-hook-form";
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
  Grid,
  Autocomplete,
  CircularProgress,
  Alert,
  FormControlLabel,
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
import { useTheme, alpha } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

/* -------------------------------------------------------------------------- */
/*                              ArtikelCard                                   */
/* -------------------------------------------------------------------------- */

const PlaceholderImage = () => (
  <Box
    sx={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      bgcolor: "grey.100",
      color: "grey.300",
    }}
  >
    <svg
      width="40%"
      height="40%"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <path d="M7 2v6" />
      <path d="M13 2v6" />
      <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
    </svg>
  </Box>
);

function ArtikelCard({ control, index, article, getValues, setValue }) {
  const theme = useTheme();

  const baseUnit = article?.unit || "Flasche";
  const purchaseUnit = article?.purchaseUnit || "Kiste";
  const factor = Number(article?.unitsPerPurchase) || 0;

  const handleIncrement = (field, amount) => {
    const fieldName = `items.${index}.${field}`;
    const current = Number(getValues(fieldName) || 0);
    setValue(fieldName, Math.max(0, current + amount), { shouldValidate: true, shouldDirty: true });
  };

  const handleInputChange = (field, event) => {
    const fieldName = `items.${index}.${field}`;
    const value = parseInt(event.target.value, 10) || 0;
    setValue(fieldName, Math.max(0, value), { shouldValidate: true, shouldDirty: true });
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        borderRadius: 3,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        border: "1px solid",
        borderColor: "divider",
        transition: "all 0.2s ease-in-out",
        "&:hover": {
          borderColor: "primary.main",
          boxShadow: theme.shadows[4],
          transform: "translateY(-2px)",
        },
      }}
    >
      {/* Bild & Badge */}
      <Box
        sx={{
          position: "relative",
          width: "100%",
          aspectRatio: "1", // Square for consistent grid look
          mb: 1.5,
          borderRadius: 2,
          overflow: "hidden",
          bgcolor: "background.paper",
        }}
      >
        {article?.imageSmall || article?.imageThumbnail ? (
          <img
            src={article.imageSmall || article.imageThumbnail}
            alt={article.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: "8px",
            }}
          />
        ) : (
          <PlaceholderImage />
        )}

        {/* Info Chip f. Faktor */}
        {factor > 1 && (
          <Box
            sx={{
              position: "absolute",
              top: 6,
              right: 6,
              bgcolor: "background.paper",
              boxShadow: 1,
              borderRadius: 1.5,
              px: 0.8,
              py: 0.25,
              fontSize: "0.65rem",
              fontWeight: 700,
              color: "text.secondary",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            1{purchaseUnit.charAt(0)}={factor}
          </Box>
        )}
      </Box>

      {/* Titel */}
      <Typography
        variant="subtitle2"
        fontWeight={700}
        align="center"
        sx={{
          mb: 1.5,
          lineHeight: 1.25,
          height: "2.5em", // Fixed height for 2 lines
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          px: 0.5,
        }}
        title={article?.name}
      >
        {article?.name || "Artikel"}
      </Typography>

      <Divider sx={{ width: "100%", mb: 1.5, opacity: 0.5 }} />

      {/* Inputs */}
      <Stack spacing={1} width="100%" mt="auto">
        <QuantityRow
          label={purchaseUnit}
          fieldName={`items.${index}.kisten`}
          control={control}
          handleIncrement={handleIncrement}
          handleInputChange={handleInputChange}
          color="primary"
        />

        <QuantityRow
          label={baseUnit}
          fieldName={`items.${index}.flaschen`}
          control={control}
          handleIncrement={handleIncrement}
          handleInputChange={handleInputChange}
          color="secondary"
        />
      </Stack>
    </Paper>
  );
}


const QuantityRow = ({
  label,
  fieldName,
  control,
  handleIncrement,
  handleInputChange,
  color = "primary"
}) => {
  const fieldKey = fieldName.split(".").pop();
  const theme = useTheme();

  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ width: 45, textTransform: "uppercase" }}>
        {label}
      </Typography>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          bgcolor: alpha(theme.palette[color].main, 0.08),
          borderRadius: 50,
          p: 0.5,
          border: "1px solid",
          borderColor: alpha(theme.palette[color].main, 0.2)
        }}
      >
        <IconButton
          size="small"
          onClick={() => handleIncrement(fieldKey, -1)}
          sx={{
            width: 28, height: 28,
            bgcolor: "background.paper",
            boxShadow: 1,
            "&:hover": { bgcolor: "white" }
          }}
        >
          <Typography fontWeight={700} lineHeight={1}>-</Typography>
        </IconButton>

        <Controller
          name={fieldName}
          control={control}
          defaultValue={0}
          render={({ field }) => (
            <input
              {...field}
              type="number"
              min="0"
              onChange={(e) => handleInputChange(fieldKey, e)}
              value={field.value ?? 0}
              style={{
                width: 50,
                textAlign: "center",
                border: "none",
                background: "transparent",
                outline: "none",
                fontWeight: 700,
                fontSize: "1rem",
                fontFamily: "inherit"
              }}
            />
          )}
        />

        <IconButton
          size="small"
          onClick={() => handleIncrement(fieldKey, 1)}
          sx={{
            width: 28, height: 28,
            bgcolor: theme.palette[color].main,
            color: "white",
            boxShadow: 2,
            "&:hover": { bgcolor: theme.palette[color].dark }
          }}
        >
          <Typography fontWeight={700} lineHeight={1}>+</Typography>
        </IconButton>
      </Box>
    </Stack>
  );
};

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
  const initializedRef = useRef(false);

  /* ---------------------------- React Hook Form --------------------------- */
  const {
    control,
    handleSubmit,
    watch,
    getValues,
    setValue,
  } = useForm({
    defaultValues: {
      documentDate: new Date(),
      supplier: null,
      description: "",
      totalAmount: "",
      paid: false,
      paymentMethod: "TRANSFER",
      items: [], // wichtig: leer; füllen wir nach Artikelladung
    },
  });

  const { fields, replace } = useFieldArray({ control, name: "items" });
  const watchedPaid = watch("paid");

  /* ------------------------------- Queries -------------------------------- */
  const { data: suppliersData, isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api.get("/purchase-documents/suppliers").then((res) => res.data),
  });
  const suppliers = suppliersData?.suppliers || [];

  // WICHTIG: eigener Key + Normalisierung
  const { data: articlesRaw, isLoading: isLoadingArticles } = useQuery({
    queryKey: ["articles", "purchase"],
    queryFn: () => api.get("/articles").then((res) => res.data),
  });

  const articles = useMemo(() => {
    const raw = Array.isArray(articlesRaw)
      ? articlesRaw
      : (articlesRaw?.articles ?? []);
    return (raw || []).map((a) => ({
      ...a,
      // Fallbacks, damit UI stabil bleibt
      unit: a.unit || "Flasche",
      purchaseUnit: a.purchaseUnit || "Kiste",
      unitsPerPurchase: Number(a.unitsPerPurchase) || 0,
    }));
  }, [articlesRaw]);

  /* ---------------------------- Initialize Items -------------------------- */
  useEffect(() => {
    if (!initializedRef.current && Array.isArray(articles) && articles.length > 0) {
      replace(
        articles.map((a) => ({
          articleId: a.id,
          kisten: 0,
          flaschen: 0,
          _article: a, // nur für Anzeige
        }))
      );
      initializedRef.current = true;
    }
  }, [articles, replace]);

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
      queryClient.invalidateQueries(["purchaseDocuments"]);
      navigate("/purchases");
    },
    onError: (err) => console.error("Fehler beim Erstellen:", err),
  });

  /* ---------------------------- Delivery Notes ---------------------------- */
  const [selectedLieferscheine, setSelectedLieferscheine] = useState([]);
  const supplierValue = watch("supplier");

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
      alert("Bitte einen Lieferanten auswählen oder eintippen.");
      return;
    }

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

    const submittedItems = (data.items || [])
      .filter((i) => (i.kisten || 0) > 0 || (i.flaschen || 0) > 0)
      .map((i) => ({
        articleId: i.articleId,
        kisten: i.kisten || 0,
        flaschen: i.flaschen || 0,
      }));

    formData.append("items", JSON.stringify(submittedItems));
    mutation.mutate(formData);
  };

  /* ---------------------------- Layout states ----------------------------- */

  const showFloatingActions = useMediaQuery(theme.breakpoints.down("md"));

  /* ------------------------------------------------------------------------ */
  /*                              Render Layout                               */
  /* ------------------------------------------------------------------------ */

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmit)}
      sx={{ bgcolor: "background.default", pb: showFloatingActions ? 10 : 8 }}
    >
      {/* Header */}
      <Paper
        square
        elevation={0}
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 49,
          bgcolor: "background.paper",
          borderBottom: "1px solid #ededed",
          py: 2,
          px: { xs: 2, sm: 4, md: 6 },
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton color="primary" onClick={() => navigate("/purchases")}>
              <ArrowBackIcon />
            </IconButton>
            <Box>
              <Typography variant="overline" color="text.secondary">
                {isRechnung ? "Einkauf mit Wareneingang (Sofortkauf)" : "Wareneingang ohne Einkauf"}
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {isRechnung ? "Neuer Einkauf" : "Neuer Lieferschein"}
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
              disabled={mutation.isLoading || isLoadingArticles || !initializedRef.current}
            >
              {mutation.isLoading ? "Speichert..." : "Speichern"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Content */}
      <Box
        sx={{
          maxWidth: 1800,
          mx: "auto",
          mt: 3,
          px: { xs: 2, sm: 3 },
          display: "flex",
          flexDirection: { xs: "column", lg: "row" },
          gap: 3,
        }}
      >
        {/* Sidebar */}
        <Paper
          elevation={1}
          sx={{
            flexShrink: 0,
            width: { xs: "100%", lg: 300 },
            p: 3,
            borderRadius: 2,
            border: "1px solid #f0f0f0",
          }}
        >
          <Stack spacing={2.5}>
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

        {/* Articles Grid */}
        <Box flex={1}>
          {(isLoadingArticles && !initializedRef.current) && (
            <CircularProgress sx={{ display: "block", mx: "auto", my: 4 }} />
          )}

          {mutation.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Fehler: {mutation.error?.response?.data?.error || mutation.error?.message}
            </Alert>
          )}

          <Grid
            container
            spacing={2}
            sx={{ m: 0, width: "100%", boxSizing: "border-box" }}
          >
            {fields.map((fieldItem, index) => (
              <Grid
                item
                xs={12}
                sm={6}
                md={4}
                lg={3}
                key={fieldItem.id}
                sx={{ display: "flex", minWidth: 0 }}
              >
                <ArtikelCard
                  control={control}
                  index={index}
                  article={fieldItem._article}
                  getValues={getValues}
                  setValue={setValue}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
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
            borderTop: "1px solid #e0e0e0",
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
            disabled={mutation.isLoading || isLoadingArticles || !initializedRef.current}
            fullWidth
          >
            {mutation.isLoading ? "Speichert..." : "Speichern"}
          </Button>
        </Paper>
      )}
    </Box>
  );
}
