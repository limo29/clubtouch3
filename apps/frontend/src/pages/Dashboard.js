import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  IconButton,
  Alert,
  Button,
  Skeleton,
  Stack,
  Divider,
} from "@mui/material";
import {
  AttachMoney,
  People,
  Inventory,
  TrendingUp,
  Warning,
  EmojiEvents,
  LocalDrink,
  Refresh,
  ShoppingCart,
  ReceiptLong,
  Description,
} from "@mui/icons-material";
import { useTheme, alpha } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import api from "../services/api";
import { API_ENDPOINTS } from "../config/api";

/* -------------------------------- helpers -------------------------------- */
const money = (n) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(+n) ? +n : 0
  );

const SafeVal = ({ loading, value, fallback = "—", variant = "h4" }) =>
  loading ? (
    <Skeleton width={120} height={36} />
  ) : (
    <Typography
      variant={variant}
      sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}
    >
      {value ?? fallback}
    </Typography>
  );

function tint(theme, colorKey) {
  const c = theme.palette[colorKey]?.main || theme.palette.primary.main;
  return theme.palette.mode === "dark" ? alpha(c, 0.18) : alpha(c, 0.12);
}

/* ------------------------------ Data fetches ------------------------------ */
export default function Dashboard() {
  const theme = useTheme();
  const navigate = useNavigate();

  const {
    data: dailySummary,
    isLoading: loadingSummary,
    isError: errorSummary,
    refetch: refetchSummary,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ["daily-summary"],
    queryFn: async () => (await api.get(API_ENDPOINTS.DAILY_SUMMARY)).data,
    refetchOnWindowFocus: false,
    refetchInterval: 60_000, // live-ish each minute
  });

  const {
    data: lowStock,
    isLoading: loadingLowStock,
    isError: errorLowStock,
  } = useQuery({
    queryKey: ["low-stock"],
    queryFn: async () => (await api.get(API_ENDPOINTS.ARTICLES_LOW_STOCK)).data,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const {
    data: lowBalance,
    isLoading: loadingLowBalance,
    isError: errorLowBalance,
  } = useQuery({
    queryKey: ["low-balance"],
    queryFn: async () => (await api.get(API_ENDPOINTS.CUSTOMERS_LOW_BALANCE)).data,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const {
    data: highscore,
    isLoading: loadingHighscore,
    isError: errorHighscore,
  } = useQuery({
    queryKey: ["highscore-dashboard"],
    queryFn: async () =>
      (await api.get(API_ENDPOINTS.HIGHSCORE, { params: { type: "DAILY", mode: "AMOUNT" } }))
        .data,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  /* ------------------------------ Derived data ----------------------------- */
  const sum = dailySummary?.summary || {
    totalRevenue: 0,
    cashRevenue: 0,
    accountRevenue: 0,
    totalTransactions: 0,
  };

  const topArticles = dailySummary?.topArticles || [];
  const pieData =
    sum.cashRevenue + sum.accountRevenue > 0
      ? [
        { name: "Bar", value: sum.cashRevenue, color: theme.palette.success.main },
        { name: "Kundenkonto", value: sum.accountRevenue, color: theme.palette.primary.main },
      ]
      : [];

  const avgTicket = useMemo(() => {
    if (!sum.totalTransactions) return 0;
    return sum.totalRevenue / sum.totalTransactions;
  }, [sum.totalRevenue, sum.totalTransactions]);

  const activeCustomers = lowBalance?.customers?.length ?? 0;
  const lowBalanceCount = (lowBalance?.customers || []).filter((c) => (c.balance ?? 0) < 5).length;
  const lowStockCount = lowStock?.count ?? (lowStock?.articles?.length ?? 0);

  const lastUpdated =
    dataUpdatedAt && !loadingSummary ? new Date(dataUpdatedAt).toLocaleTimeString("de-DE") : null;

  /* --------------------------------- UI ----------------------------------- */
  return (
    <Box sx={{ px: { xs: 1, md: 2 } }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="h4" fontWeight={800}>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {lastUpdated ? `Stand: ${lastUpdated}` : ""}
          </Typography>
        </Stack>
        <IconButton onClick={() => refetchSummary()} aria-label="Aktualisieren">
          <Refresh />
        </IconButton>
      </Box>

      {/* Inline errors (non-blocking) */}
      <Stack spacing={1} sx={{ mb: 2 }}>
        {errorSummary && <Alert severity="error">Tagesdaten konnten nicht geladen werden.</Alert>}
        {errorLowStock && <Alert severity="error">Niedrige Bestände konnten nicht geladen werden.</Alert>}
        {errorLowBalance && <Alert severity="error">Kundenguthaben konnten nicht geladen werden.</Alert>}
        {errorHighscore && <Alert severity="error">Highscore konnte nicht geladen werden.</Alert>}
      </Stack>

      {/* KPI cards */}
      <Grid container spacing={2} alignItems="stretch">
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
                <Box
                  sx={{
                    bgcolor: tint(theme, "primary"),
                    color: theme.palette.primary.main,
                    p: 1,
                    borderRadius: 2,
                  }}
                >
                  <AttachMoney />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Heutiger Umsatz
                </Typography>
              </Stack>
              <SafeVal loading={loadingSummary} value={money(sum.totalRevenue)} />
              <Typography variant="caption" color="text.secondary">
                {loadingSummary ? <Skeleton width={120} /> : `${sum.totalTransactions} Transaktionen`}
              </Typography>
              <Divider sx={{ my: 1.25 }} />
              <Typography variant="caption" color="text.secondary">
                {loadingSummary ? <Skeleton width={140} /> : `Ø Bon: ${money(avgTicket)}`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
                <Box
                  sx={{
                    bgcolor: tint(theme, "success"),
                    color: theme.palette.success.main,
                    p: 1,
                    borderRadius: 2,
                  }}
                >
                  <People />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Aktive Kunden
                </Typography>
              </Stack>
              <SafeVal loading={loadingLowBalance} value={activeCustomers} />
              <Typography variant="caption" color="warning.main" fontWeight={700}>
                {loadingLowBalance ? <Skeleton width={120} /> : `${lowBalanceCount} mit niedrigem Guthaben`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
                <Box
                  sx={{
                    bgcolor: tint(theme, "warning"),
                    color: theme.palette.warning.main,
                    p: 1,
                    borderRadius: 2,
                  }}
                >
                  <Inventory />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Niedriger Bestand
                </Typography>
              </Stack>
              <SafeVal loading={loadingLowStock} value={lowStockCount} />
              <Typography variant="caption" color="text.secondary">
                {loadingLowStock ? <Skeleton width={120} /> : `Artikel betroffen`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
                <Box
                  sx={{
                    bgcolor: tint(theme, "info"),
                    color: theme.palette.info.main,
                    p: 1,
                    borderRadius: 2,
                  }}
                >
                  <TrendingUp />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Top Artikel
                </Typography>
              </Stack>
              <SafeVal
                loading={loadingSummary}
                value={topArticles[0]?.name || "—"}
                variant="h6"
              />
              <Typography variant="caption" color="text.secondary">
                {loadingSummary ? (
                  <Skeleton width={140} />
                ) : (
                  `${topArticles[0]?.quantity_sold ?? 0}× verkauft`
                )}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Umsatzverteilung */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="h6">Umsatzverteilung</Typography>
                <Chip size="small" label={loadingSummary ? "…" : money(sum.totalRevenue)} />
              </Stack>

              {loadingSummary ? (
                <Skeleton variant="rounded" height={220} />
              ) : pieData.length ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((e, i) => (
                          <Cell key={i} fill={e.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => money(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box mt={1}>
                    {pieData.map((e) => (
                      <Stack
                        key={e.name}
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ mb: 0.5 }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: e.color }} />
                          <Typography variant="body2">{e.name}</Typography>
                        </Stack>
                        <Typography variant="body2" fontWeight={700}>
                          {money(e.value)}
                        </Typography>
                      </Stack>
                    ))}
                  </Box>
                </>
              ) : (
                <Box height={220} display="flex" alignItems="center" justifyContent="center">
                  <Typography color="text.secondary">Keine Daten</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Top Artikel heute */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Top Artikel heute
              </Typography>

              {loadingSummary ? (
                <Stack spacing={1}>
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} height={46} />
                  ))}
                </Stack>
              ) : topArticles.length ? (
                <List dense>
                  {topArticles.slice(0, 5).map((a, idx) => (
                    <ListItem key={a.id} sx={{ py: 0.5 }}>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: theme.palette.primary.light }}>
                          <LocalDrink />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={a.name}
                        secondary={`${a.quantity_sold}× — ${money(a.revenue)}`}
                      />
                      {idx === 0 && <Chip size="small" label="TOP" color="primary" />}
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                  Noch keine Verkäufe heute
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Highscore */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <EmojiEvents />
                <Typography variant="h6">Highscore heute</Typography>
              </Stack>
              {loadingHighscore ? (
                <Stack spacing={1}>
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} height={46} />
                  ))}
                </Stack>
              ) : (highscore?.entries || []).length ? (
                <List dense>
                  {highscore.entries.slice(0, 5).map((e) => (
                    <ListItem key={e.customerId} sx={{ py: 0.5 }}>
                      <ListItemAvatar>
                        <Avatar
                          sx={{
                            bgcolor:
                              e.rank <= 3 ? theme.palette.warning.light : theme.palette.grey[400],
                          }}
                        >
                          {e.rank}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={e.customerNickname || e.customerName}
                        secondary={money(e.score)}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                  Noch keine Einträge
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Warnungen + Quick Actions */}
        <Grid item xs={12} md={8}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <Warning />
                <Typography variant="h6">Hinweise</Typography>
              </Stack>

              <Stack spacing={1}>
                {/* Low stock */}
                {loadingLowStock ? (
                  <Skeleton height={24} />
                ) : (lowStock?.articles || []).length > 0 ? (
                  <>
                    <Typography variant="body2" color="warning.main" fontWeight={700}>
                      Niedriger Bestand bei {lowStock.articles.length} Artikeln
                    </Typography>
                    <List dense>
                      {lowStock.articles.slice(0, 3).map((a) => (
                        <ListItem key={a.id} sx={{ py: 0.25 }}>
                          <ListItemText
                            primary={a.name}
                            secondary={`Bestand: ${a.stock} • Min: ${a.minStock}`}
                          />
                        </ListItem>
                      ))}
                    </List>
                    {lowStock.articles.length > 3 && (
                      <Typography variant="caption" color="text.secondary">
                        …und {lowStock.articles.length - 3} weitere
                      </Typography>
                    )}
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Keine Bestandswarnungen 🎉
                  </Typography>
                )}

                <Divider sx={{ my: 1 }} />

                {/* Low balance */}
                {loadingLowBalance ? (
                  <Skeleton height={24} />
                ) : (lowBalance?.customers || []).length > 0 ? (
                  <>
                    <Typography variant="body2" color="info.main" fontWeight={700}>
                      Niedriges Guthaben bei {lowBalance.customers.length} Kund:innen
                    </Typography>
                    <List dense>
                      {lowBalance.customers.slice(0, 3).map((c) => (
                        <ListItem key={c.id} sx={{ py: 0.25 }}>
                          <ListItemText primary={c.name} secondary={money(c.balance)} />
                        </ListItem>
                      ))}
                    </List>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Keine Guthabenwarnungen 🎉
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick actions */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Schnellzugriff
              </Typography>
              <Stack spacing={1}>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<ShoppingCart />}
                  onClick={() => navigate("/sales")}
                >
                  Verkauf öffnen
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<ReceiptLong />}
                  onClick={() => navigate("/transactions")}
                >
                  Transaktionen ansehen
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<Description />}
                  onClick={() => navigate("/PurchaseDocumentsCreate")}
                >
                  Einkauf/Lieferschein erfassen
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
