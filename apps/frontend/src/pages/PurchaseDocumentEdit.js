import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm, Controller, useFieldArray } from "react-hook-form";
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
  Grid,
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

/* -------------------------------------------------------------------------- */
/*                              ArtikelCard + QuantityRow                     */
/* -------------------------------------------------------------------------- */
function ArtikelCard({ control, index, article, getValues, setValue }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const handleIncrement = (field, amount) => {
    const fieldName = `items.${index}.${field}`;
    const current = getValues(fieldName) || 0;
    setValue(fieldName, Math.max(0, current + amount), { shouldValidate: true, shouldDirty: true });
  };

  const handleInputChange = (field, event) => {
    const fieldName = `items.${index}.${field}`;
    const value = parseInt(event.target.value, 10) || 0;
    setValue(fieldName, Math.max(0, value), { shouldValidate: true, shouldDirty: true });
  };

  return (
    <Paper
      elevation={1}
      sx={{
        p: 2,
        borderRadius: 2,
        border: "1px solid #f0f0f0",
        width: "100%",
        minHeight: 280,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        boxShadow: 1,
        transition: "box-shadow 0.2s ease",
        "&:hover": { boxShadow: 3 },
      }}
    >
      <Box sx={{ width: "100%", aspectRatio: "4/3", mb: 1.5, borderRadius: 1, bgcolor: "#fafafa", overflow: "hidden" }}>
        <img
          src={article?.imageSmall || article?.imageThumbnail || "https://via.placeholder.com/400x300.png?text=Kein+Bild"}
          alt={article?.name || "Artikel"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </Box>

      <Typography
        variant={isMobile ? "body1" : "subtitle1"}
        fontWeight={600}
        align="center"
        sx={{
          minHeight: "2.5em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          lineHeight: 1.2,
          mb: 1.5,
          width: "100%",
        }}
      >
        {article?.name || "Unbenannter Artikel"}
      </Typography>

      <Stack spacing={1.5} width="100%">
        <QuantityRow
          label={article?.purchaseUnit || "Kisten"}
          fieldName={`items.${index}.kisten`}
          control={control}
          handleIncrement={handleIncrement}
          handleInputChange={handleInputChange}
          isMobile={isMobile}
        />
        <QuantityRow
          label={article?.unit || "Flaschen"}
          fieldName={`items.${index}.flaschen`}
          control={control}
          handleIncrement={handleIncrement}
          handleInputChange={handleInputChange}
          isMobile={isMobile}
        />
      </Stack>
    </Paper>
  );
}

const QuantityRow = ({ label, fieldName, control, handleIncrement, handleInputChange, isMobile }) => {
  const fieldKey = fieldName.split(".").pop();
  return (
    <Stack direction="row" alignItems="center" justifyContent="center" spacing={1} width="100%">
      <Typography
        variant="body2"
        sx={{ minWidth: "25%", textAlign: "right", fontSize: { xs: "0.75rem", sm: "0.875rem" }, pr: 0.5 }}
      >
        {label}
      </Typography>
      <IconButton
        size={isMobile ? "small" : "medium"}
        onClick={() => handleIncrement(fieldKey, -1)}
        sx={{ border: "1px solid #d0d0d0", borderRadius: 1, p: { xs: 0.3, sm: 0.5 } }}
      >
        <Typography variant="body2">-</Typography>
      </IconButton>
      <Controller
        name={fieldName}
        control={control}
        defaultValue={0}
        render={({ field }) => (
          <TextField
            {...field}
            type="number"
            size="small"
            onChange={(e) => handleInputChange(fieldKey, e)}
            value={field.value || 0}
            inputProps={{ min: 0, style: { textAlign: "center", fontSize: isMobile ? "0.75rem" : "0.875rem" } }}
            sx={{ width: "25%", minWidth: 40, "& .MuiInputBase-input": { py: { xs: 0.5, sm: 0.75 } } }}
          />
        )}
      />
      <IconButton
        size={isMobile ? "small" : "medium"}
        onClick={() => handleIncrement(fieldKey, 1)}
        sx={{ border: "1px solid #d0d0d0", borderRadius: 1, p: { xs: 0.3, sm: 0.5 } }}
      >
        <Typography variant="body2">+</Typography>
      </IconButton>
    </Stack>
  );
};

/* -------------------------------------------------------------------------- */
/*                         Main Component: PurchaseDocumentEdit               */
/* -------------------------------------------------------------------------- */
export default function PurchaseDocumentEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const showFloatingActions = useMediaQuery(theme.breakpoints.down("md"));

  const [file, setFile] = useState(null);
  const [linkedLieferscheinIds, setLinkedLieferscheinIds] = useState(new Set());

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
  };

  const {
    control,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
  } = useForm();

  const { fields } = useFieldArray({ control, name: "items" });
  const watchedPaid = watch("paid");
  const watchedSupplier = watch("supplier");

  /* ------------------------------- Queries -------------------------------- */
  const { data: documentData, isLoading: isLoadingDocument, error: documentError } = useQuery({
    queryKey: ["purchaseDocument", id],
    queryFn: () => api.get(`/purchase-documents/${id}`).then((res) => res.data),
    enabled: !!id,
  });

  const { data: articlesData, isLoading: isLoadingArticles } = useQuery({
    queryKey: ["articles"],
    queryFn: () => api.get("/articles").then((res) => res.data),
  });
  const articles = articlesData?.articles || [];

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

  /* ---------------------------- Fill Form --------------------------------- */
  useEffect(() => {
    if (documentData && articles.length > 0) {
      const defaultValues = {
        documentDate: new Date(documentData.documentDate),
        supplier: documentData.supplier,
        description: documentData.description || "",
        totalAmount: documentData.totalAmount || "",
        paid: documentData.paid || false,
        paymentMethod: documentData.paymentMethod || "TRANSFER",
        dueDate: documentData.dueDate ? new Date(documentData.dueDate) : null,
      };

      const oldItemMap = new Map();
      for (const oldItem of documentData.items) {
        oldItemMap.set(oldItem.articleId, {
          kisten: oldItem.purchaseUnitQuantity || 0,
          flaschen: oldItem.baseUnitQuantity || 0,
        });
      }

      defaultValues.items = articles.map((a) => {
        const oldData = oldItemMap.get(a.id);
        return { articleId: a.id, kisten: oldData?.kisten || 0, flaschen: oldData?.flaschen || 0, _article: a };
      });

      if (documentData.lieferscheine) {
        setLinkedLieferscheinIds(new Set(documentData.lieferscheine.map((ls) => ls.id)));
      }
      reset(defaultValues);
    }
  }, [documentData, articles, reset]);

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
    const formData = new FormData();
    formData.append("documentDate", data.documentDate.toISOString());
    formData.append("supplier", data.supplier);
    formData.append("description", data.description || "");

    if (documentData?.type === "RECHNUNG") {
      formData.append("totalAmount", data.totalAmount || "0");
      formData.append("paid", data.paid);
      if (data.paid) formData.append("paymentMethod", data.paymentMethod);
      if (data.dueDate) formData.append("dueDate", data.dueDate.toISOString());
    }

    if (file) formData.append("nachweis", file);

    const submittedItems = data.items.map((i) => ({
      articleId: i.articleId,
      kisten: i.kisten || 0,
      flaschen: i.flaschen || 0,
    }));
    formData.append("items", JSON.stringify(submittedItems));

    mutation.mutate(formData);
  };

  const triggerLinkMutations = () => {
    const originalIds = new Set(documentData.lieferscheine.map((ls) => ls.id));
    const currentIds = linkedLieferscheinIds;

    const toLink = [...currentIds].filter((id) => !originalIds.has(id));
    const toUnlink = [...originalIds].filter((id) => !currentIds.has(id));

    const promises = [];
    if (toLink.length) promises.push(linkMutation.mutateAsync(toLink));
    if (toUnlink.length) promises.push(unlinkMutation.mutateAsync(toUnlink));

    Promise.all(promises).finally(() => {
      queryClient.invalidateQueries(["purchaseDocuments"]);
      queryClient.invalidateQueries(["purchaseDocument", id]);
      navigate("/PurchaseDocuments");
    });
  };

  const handleToggleLieferschein = (id) => {
    const newSet = new Set(linkedLieferscheinIds);
    newSet.has(id) ? newSet.delete(id) : newSet.add(id);
    setLinkedLieferscheinIds(newSet);
  };

  const isLoading = mutation.isLoading || linkMutation.isLoading || unlinkMutation.isLoading;

  if (isLoadingDocument || isLoadingArticles)
    return <CircularProgress sx={{ display: "block", mx: "auto", my: 10 }} />;
  if (documentError)
    return <Alert severity="error">Fehler beim Laden des Belegs: {documentError.message}</Alert>;

  /* ------------------------------------------------------------------------ */
  /*                                Render Layout                              */
  /* ------------------------------------------------------------------------ */
  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ bgcolor: "background.default", pb: showFloatingActions ? 10 : 8 }}>
      {/* ================= Header ================= */}
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
            <IconButton color="primary" onClick={() => navigate("/PurchaseDocuments")}>
              <ArrowBackIcon />
            </IconButton>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Beleg bearbeiten ({documentData?.documentNumber})
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {documentData?.type === "RECHNUNG" ? "Rechnung" : "Lieferschein"}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ display: { xs: "none", md: "flex" } }}>
            <Button startIcon={<CancelIcon />} color="secondary" onClick={() => navigate("/PurchaseDocuments")}>
              Abbrechen
            </Button>
            <Button type="submit" startIcon={<SaveIcon />} color="primary" variant="contained" disabled={isLoading}>
              {isLoading ? "Speichert..." : "Speichern"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* ================= Content ================= */}
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
        <Box sx={{ flexShrink: 0, width: { xs: "100%", lg: 300 } }}>
          <Paper elevation={1} sx={{ p: 3, borderRadius: 2, border: "1px solid #f0f0f0" }}>
            <Stack spacing={2.5}>
              <Controller
                name="documentDate"
                control={control}
                rules={{ required: true }}
                render={({ field }) => <DatePicker {...field} label="Belegdatum" value={field.value || new Date()} slotProps={{ textField: { size: "small", fullWidth: true, required: true } }} />}
              />
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

              <Button
                component="label"
                color={file ? "success" : "primary"}
                variant="outlined"
                size="small"
                startIcon={file ? <CheckCircleIcon /> : <CloudUploadIcon />}
                sx={{ textTransform: "none", justifyContent: "flex-start" }}
              >
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
                  <Controller
                    name="totalAmount"
                    control={control}
                    rules={{ required: "Betrag ist erforderlich", min: { value: 0, message: "Betrag muss positiv sein" } }}
                    render={({ field, fieldState }) => (
                      <TextField
                        {...field}
                        label="Betrag"
                        type="number"
                        size="small"
                        fullWidth
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
                        InputProps={{ endAdornment: <InputAdornment position="end">€</InputAdornment>, inputProps: { step: "0.01" } }}
                      />
                    )}
                  />
                  <Controller
                    name="paid"
                    control={control}
                    render={({ field }) => <FormControlLabel control={<Switch {...field} checked={field.value} color="success" />} label="Bereits bezahlt" />}
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
              <Controller name="description" control={control} render={({ field }) => <TextField {...field} label="Kommentar / Beschreibung" multiline minRows={2} size="small" fullWidth />} />
            </Stack>
          </Paper>

          {/* Lieferschein assignment */}
          {documentData?.type === "RECHNUNG" && (
            <Paper elevation={1} sx={{ p: 2, mt: 3, borderRadius: 2, border: "1px solid #f0f0f0" }}>
              <Typography variant="h6" gutterBottom>
                Lieferscheine zuordnen
              </Typography>
              {isLoadingUnassigned && <CircularProgress size={20} />}
              <List dense>
                {documentData?.lieferscheine?.map((ls) => (
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

                {!isLoadingUnassigned && documentData?.lieferscheine?.length === 0 && unassignedLieferscheine.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                    Keine Lieferscheine für "{watchedSupplier}" gefunden.
                  </Typography>
                )}
              </List>
            </Paper>
          )}
        </Box>

        {/* Articles Grid */}
        <Box flex={1}>
          {isLoadingArticles && <CircularProgress sx={{ display: "block", mx: "auto", my: 4 }} />}
          {mutation.isError && <Alert severity="error" sx={{ mb: 2 }}>Fehler: {mutation.error?.response?.data?.error || mutation.error?.message}</Alert>}

          {documentData?.items.length > 0 || documentData?.type === "LIEFERSCHEIN" ? (
            <Grid container spacing={2} sx={{ m: 0, width: "100%", boxSizing: "border-box" }}>
              {fields.map((fieldItem, index) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={fieldItem.id} sx={{ display: "flex", minWidth: 0 }}>
                  <ArtikelCard control={control} index={index} article={fieldItem._article} getValues={getValues} setValue={setValue} />
                </Grid>
              ))}
            </Grid>
          ) : (
            <Alert severity="info">Dies ist eine Sammelrechnung. Die Artikelpositionen werden über die verknüpften Lieferscheine verwaltet.</Alert>
          )}
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
          <Button startIcon={<CancelIcon />} color="secondary" onClick={() => navigate("/PurchaseDocuments")} fullWidth>
            Abbrechen
          </Button>
          <Button type="submit" startIcon={<SaveIcon />} color="primary" variant="contained" disabled={isLoading} fullWidth>
            {isLoading ? "Speichert..." : "Speichern"}
          </Button>
        </Paper>
      )}
    </Box>
  );
}
