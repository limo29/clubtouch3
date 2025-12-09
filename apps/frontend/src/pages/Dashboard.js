import React from "react";
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
  Button,
  Skeleton,
  Stack,
  Divider,
  Paper,
} from "@mui/material";
import {
  AttachMoney,
  Inventory,
  Warning,
  EmojiEvents,
  Refresh,
  ShoppingCart,
  Description,
  ArrowForward,
  ShoppingBasket,
  NotificationsActive,
  CheckCircle,
} from "@mui/icons-material";
import { useTheme, alpha } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import api from "../services/api";
import { API_ENDPOINTS } from "../config/api";

/* -------------------------------- helpers -------------------------------- */
const money = (n) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(+n) ? +n : 0
  );

const SafeVal = ({ loading, value, fallback = "—", variant = "h4", color }) =>
  loading ? (
    <Skeleton width={120} height={36} />
  ) : (
    <Typography
      variant={variant}
      sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: color || "inherit" }}
    >
      {value ?? fallback}
    </Typography>
  );



/* ------------------------------ Data fetches ------------------------------ */
export default function Dashboard() {
  const theme = useTheme();
  const navigate = useNavigate();

  // 1. Daily Summary (Revenue, Top Articles)
  const {
    data: dailySummary,
    isLoading: loadingSummary,
    refetch: refetchSummary,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ["daily-summary"],
    queryFn: async () => (await api.get(API_ENDPOINTS.DAILY_SUMMARY)).data,
    refetchOnWindowFocus: false,
    refetchInterval: 60_000,
  });

  // 2. Low Stock
  const { data: lowStock, isLoading: loadingLowStock } = useQuery({
    queryKey: ["low-stock"],
    queryFn: async () => (await api.get(API_ENDPOINTS.ARTICLES_LOW_STOCK)).data,
    staleTime: 5 * 60_000,
  });

  // 3. Low Balance
  const { data: lowBalance } = useQuery({
    queryKey: ["low-balance"],
    queryFn: async () => (await api.get(API_ENDPOINTS.CUSTOMERS_LOW_BALANCE)).data,
    staleTime: 5 * 60_000,
  });

  // 4. Highscore
  const { data: highscore } = useQuery({
    queryKey: ["highscore-dashboard"],
    queryFn: async () =>
      (await api.get(API_ENDPOINTS.HIGHSCORE, { params: { type: "DAILY", mode: "AMOUNT" } }))
        .data,
    staleTime: 60_000,
  });

  // 5. Open Invoices (Fetch recent and filter client-side for now as a heuristic)
  const { data: openInvoicesData, isLoading: loadingInvoices } = useQuery({
    queryKey: ["open-invoices-dashboard"],
    queryFn: async () => {
      // Fetching without date limit to get "all relevant", assuming backend returns reasonable default limit
      const res = await api.get("/purchase-documents", { params: { limit: 100 } });
      return res.data;
    },
    staleTime: 2 * 60_000,
  });

  // 6. Recent Transactions
  const { data: recentTransactionsData, isLoading: loadingTransactions } = useQuery({
    queryKey: ["recent-transactions-dashboard"],
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.TRANSACTIONS, { params: { limit: 5, includeItems: true } });
      return res.data;
    },
    refetchInterval: 30_000,
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

  const avgTicket = sum.totalTransactions ? sum.totalRevenue / sum.totalTransactions : 0;
  // Wait, ACTIVE CUSTOMERS logic in previous code was:  activeCustomers = lowBalance?.customers?.length ?? 0; which is WRONG if endpoint is just low balance. 
  // But let's keep it consistent with previous logic or fix if obvious. 
  // Re-reading previous code: "const activeCustomers = lowBalance?.customers?.length ?? 0;" 
  // It seems "active customers" metric was mapped to "low balance" count? That seems like a bug in previous code or a misnaming. 
  // I will hide "Active Customers" if it's just "Low Balance" distinct count, to avoid confusion, or rename it.
  // Actually, let's keep it as "Low Balance Count" in the Warning section and maybe remove the dedicated card if it's redundant.
  // Replacing "Active Customers" card with something more useful or just keeping it as "Guthaben Monitor".

  const lowBalanceCount = (lowBalance?.customers || []).filter((c) => (c.balance ?? 0) < 5).length;
  const lowStockCount = lowStock?.count ?? (lowStock?.articles?.length ?? 0);

  const openInvoicesCount = (openInvoicesData?.documents || [])
    .filter(d => d.type === "RECHNUNG" && !d.paid).length;

  const recentTransactions = recentTransactionsData?.transactions || [];

  const lastUpdated =
    dataUpdatedAt && !loadingSummary ? new Date(dataUpdatedAt).toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' }) : null;

  /* --------------------------------- UI ----------------------------------- */
  return (
    <Box sx={{ px: { xs: 1, md: 3 }, pb: 4, width: "100%" }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} mt={1}>
        <Box>
          <Typography variant="h4" fontWeight={800} sx={{ letterSpacing: "-0.02em" }}>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {lastUpdated ? `Aktualisiert: ${lastUpdated}` : "Lädt..."}
          </Typography>
        </Box>
        <IconButton onClick={() => refetchSummary()} sx={{ bgcolor: "background.paper", boxShadow: 1 }}>
          <Refresh />
        </IconButton>
      </Box>

      {/* Hero Section: KPIs */}
      {/* Main Container uses full 12 cols, split 4 (hero) / 8 (health) on lg, 3/9 on xl */}
      <Grid container spacing={3} sx={{ mb: 4 }} alignItems="stretch">
        {/* HERO: Revenue (Takes 30-40% width on desktop) */}
        <Grid item xs={12} lg={4} xl={3}>
          <Paper
            elevation={4}
            sx={{
              p: 3,
              height: "100%",
              minHeight: 220,
              borderRadius: 4,
              background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
              color: "white",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "relative",
              overflow: "hidden"
            }}
          >
            {/* Background Decor */}
            <Box sx={{ position: "absolute", right: -20, top: -20, opacity: 0.1 }}>
              <AttachMoney sx={{ fontSize: 180 }} />
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ opacity: 0.8, textTransform: "uppercase", letterSpacing: "1px", color: "primary.main" }}>
                Umsatz Heute
              </Typography>
              <SafeVal loading={loadingSummary} value={money(sum.totalRevenue)} variant="h2" color="text.primary" />
            </Box>

            <Stack direction="row" spacing={3} sx={{ mt: 3, position: "relative", zIndex: 1 }}>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>Transaktionen</Typography>
                <Typography variant="h6" fontWeight={700}>
                  {loadingSummary ? <Skeleton width={40} sx={{ bgcolor: "white.alpha" }} /> : sum.totalTransactions}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>Ø Bon</Typography>
                <Typography variant="h6" fontWeight={700}>
                  {loadingSummary ? <Skeleton width={40} sx={{ bgcolor: "white.alpha" }} /> : money(avgTicket)}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>

        {/* Operational Health Row */}
        <Grid item xs={12} lg={8} xl={9}>
          <Grid container spacing={2} height="100%">

            {/* Open Invoices */}
            <Grid item xs={12} sm={6} md={4}>
              <Card sx={{ height: "100%", minHeight: 180, borderRadius: 3, border: "1px solid", borderColor: "divider" }} elevation={0}>
                <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "center" }}>
                  <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                    <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: openInvoicesCount > 0 ? alpha(theme.palette.warning.main, 0.1) : "action.hover", color: openInvoicesCount > 0 ? "warning.main" : "text.secondary" }}>
                      <ShoppingBasket fontSize="small" />

                    </Box>
                    <Typography variant="body2" fontWeight={600} color="text.secondary">Offene Rechnungen</Typography>
                  </Stack>
                  <SafeVal loading={loadingInvoices} value={openInvoicesCount} variant="h3" color={openInvoicesCount > 0 ? "warning.main" : "text.primary"} />
                  {openInvoicesCount > 0 && <Typography variant="body2" color="warning.main">Zahlung ausstehend</Typography>}
                </CardContent>
              </Card>
            </Grid>

            {/* Low Stock */}
            <Grid item xs={12} sm={6} md={4}>
              <Card sx={{ height: "100%", minHeight: 180, borderRadius: 3, border: "1px solid", borderColor: "divider" }} elevation={0}>
                <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "center" }}>
                  <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                    <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: alpha(theme.palette.error.main, 0.1), color: "error.main" }}>
                      <Inventory fontSize="small" />
                    </Box>
                    <Typography variant="body2" fontWeight={600} color="text.secondary">Lagerbestand</Typography>
                  </Stack>
                  <SafeVal loading={loadingLowStock} value={lowStockCount} variant="h3" color={lowStockCount > 0 ? "error.main" : "success.main"} />
                  {lowStockCount > 0 ? (
                    <Typography variant="body2" color="error.main">Artikel unter Mindestbestand</Typography>
                  ) : (
                    <Typography variant="body2" color="success.main">Alles im grünen Bereich</Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Quick Actions */}
            <Grid item xs={12} md={4}>
              <Card sx={{ height: "100%", minHeight: 180, borderRadius: 3, bgcolor: "background.default", border: `1px solid ${theme.palette.divider}` }} elevation={0}>
                <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <Stack spacing={2}>
                    <Button
                      variant="contained"
                      color="primary"
                      size="large"
                      fullWidth
                      startIcon={<ShoppingCart />}
                      onClick={() => navigate("/sales")}
                      sx={{ py: 1.5, fontWeight: 700, borderRadius: 2 }}
                    >
                      Kasse öffnen
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      fullWidth
                      startIcon={<Description />}
                      onClick={() => navigate("/purchases/create")}
                      sx={{ fontWeight: 600, borderRadius: 2 }}
                    >
                      Einkauf erfassen
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Grid>
      </Grid>

      <Grid container spacing={3}>

        {/* Left Col: Activity & Alerts (Takes roughly 40% width) */}
        <Grid item xs={12} lg={4} xl={5}>
          <Stack spacing={3} height="100%">

            {/* Live Feed */}
            <Card sx={{ borderRadius: 3, flexGrow: 1, display: "flex", flexDirection: "column" }} elevation={1}>
              <Box sx={{ p: 2.5, borderBottom: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <NotificationsActive color="primary" />
                  <Typography variant="h6" fontWeight={700}>Letzte Aktivitäten</Typography>
                </Stack>
                <Button size="small" endIcon={<ArrowForward />} onClick={() => navigate("/transactions")}>Alle</Button>
              </Box>
              <List disablePadding sx={{ flexGrow: 1, overflow: "auto", maxHeight: 500 }}>
                {loadingTransactions ? (
                  [...Array(3)].map((_, i) => <ListItem key={i}><Skeleton width="100%" height={40} /></ListItem>)
                ) : recentTransactions.length > 0 ? (
                  recentTransactions.map((tx, i) => (
                    <React.Fragment key={tx.id}>
                      <ListItem sx={{ py: 2, px: 2.5 }}>
                        <ListItemAvatar>
                          <Avatar sx={{ bgcolor: tx.type === 'DEPOSIT' ? 'success.light' : 'primary.light', width: 44, height: 44 }}>
                            {tx.type === 'DEPOSIT' ? <AttachMoney fontSize="small" /> : <ShoppingCart fontSize="small" />}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="body1" fontWeight={600} noWrap sx={{ maxWidth: "70%" }}>
                                {tx.items?.map(i => i.article?.name || i.snapshot_name || "Artikel").join(", ") || (tx.type === 'DEPOSIT' ? "Einzahlung" : "Transaktion")}
                              </Typography>
                              <Typography variant="body1" fontWeight={800} color={tx.type === 'DEPOSIT' ? "success.main" : "text.primary"}>
                                {tx.type === 'DEPOSIT' ? "+" : ""}{money(tx.totalAmount)}
                              </Typography>
                            </Stack>
                          }
                          secondary={
                            <Stack direction="row" justifyContent="space-between" mt={0.5}>
                              <Typography variant="body2" color="text.secondary">{tx.customer?.name || "Gast"}</Typography>
                              <Typography variant="caption" color="text.secondary">{format(new Date(tx.createdAt), 'HH:mm')}</Typography>
                            </Stack>
                          }
                        />
                      </ListItem>
                      {i < recentTransactions.length - 1 && <Divider variant="inset" component="li" />}
                    </React.Fragment>
                  ))
                ) : (
                  <Box sx={{ p: 4, textAlign: "center" }}>
                    <Typography color="text.secondary">Keine Aktivitäten heute</Typography>
                  </Box>
                )}
              </List>
            </Card>



          </Stack>
        </Grid>

        {/* Right Col: Stats & Lists (Takes remaining 60% width) */}
        <Grid item xs={12} lg={8} xl={7}>
          <Grid container spacing={3}>

            {/* Top Articles */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 3, height: "100%" }} elevation={1}>
                <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Typography variant="h6" fontWeight={700}>Top Artikel (Heute)</Typography>
                </Box>
                <List dense disablePadding>
                  {loadingSummary ? (
                    <Box p={2}><Skeleton height={100} /></Box>
                  ) : topArticles.slice(0, 5).map((a, i) => (
                    <ListItem key={a.id} sx={{ py: 1.5 }}>
                      <Stack direction="row" alignItems="center" spacing={2} width="100%">
                        <Avatar sx={{ bgcolor: i === 0 ? "warning.light" : "action.selected", width: 32, height: 32, fontSize: 14, color: i === 0 ? "warning.dark" : "text.secondary", fontWeight: 700 }}>{i + 1}</Avatar>
                        <ListItemText primary={a.name} secondary={<Typography variant="caption" color="text.secondary">{money(a.revenue)} Umsatz</Typography>} />
                        <Chip label={`${a.quantity_sold}x`} size="small" sx={{ fontWeight: 700, borderRadius: 1 }} />
                      </Stack>
                    </ListItem>
                  ))}
                  {topArticles.length === 0 && !loadingSummary && <Box p={3} textAlign="center"><Typography color="text.secondary">Keine Verkäufe</Typography></Box>}
                </List>
              </Card>
            </Grid>

            {/* Highscore Mini */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 3, height: "100%" }} elevation={1}>
                <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between" }}>
                  <Stack direction="row" spacing={1}>
                    <EmojiEvents color="warning" />
                    <Typography variant="h6" fontWeight={700}>Ranking (Heute)</Typography>
                  </Stack>
                  <Button size="small" onClick={() => navigate("/highscore")}>Details</Button>
                </Box>
                <List dense disablePadding>
                  {(highscore?.entries || []).slice(0, 5).map((e) => (
                    <ListItem key={e.customerId} sx={{ py: 1.5 }}>
                      <ListItemAvatar sx={{ minWidth: 40 }}>
                        <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: e.rank === 1 ? "warning.main" : "action.selected", color: e.rank === 1 ? "black" : "text.secondary", fontWeight: 700 }}>{e.rank}</Avatar>
                      </ListItemAvatar>
                      <ListItemText primary={e.customerNickname || e.customerName} />
                      <Typography variant="body2" fontWeight={700}>{money(e.score)}</Typography>
                    </ListItem>
                  ))}
                  {(highscore?.entries || []).length === 0 && <Box p={3} textAlign="center"><Typography color="text.secondary">Keine Einträge</Typography></Box>}
                </List>
              </Card>
            </Grid>

            {/* Handlungsbedarf (Warnings) - MOVED HERE */}
            <Grid item xs={12} md={6}>
              {(lowStockCount > 0 || lowBalanceCount > 0) ? (
                <Card sx={{ borderRadius: 3, border: "1px solid", borderColor: "warning.light", bgcolor: alpha(theme.palette.warning.main, 0.02), height: "100%" }} elevation={0}>
                  <CardContent>
                    <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                      <Warning color="warning" />
                      <Typography variant="h6" fontWeight={700}>Handlungsbedarf</Typography>
                    </Stack>
                    <Stack spacing={2}>
                      {/* Stock Warnings */}
                      {lowStockCount > 0 && (
                        <Box>
                          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase" }}>Kritischer Bestand</Typography>
                          <List dense>
                            {(lowStock?.articles || []).slice(0, 3).map(a => (
                              <ListItem key={a.id} disablePadding sx={{ py: 0.5 }}>
                                <ListItemText primary={a.name} secondary={<Typography variant="caption" color="error" fontWeight={600}>{a.stock} (Min: {a.minStock})</Typography>} />
                              </ListItem>
                            ))}
                          </List>
                          {(lowStock?.articles || []).length > 3 && <Button size="small" onClick={() => navigate("/articles")}>+ {(lowStock?.articles?.length || 0) - 3} weitere</Button>}
                        </Box>
                      )}
                      {/* Balance Warnings */}
                      {lowBalanceCount > 0 && (
                        <Box>
                          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase" }}>Guthaben niedrig</Typography>
                          <List dense>
                            {(lowBalance?.customers || []).filter(c => (c.balance ?? 0) < 5).slice(0, 3).map(c => (
                              <ListItem key={c.id} disablePadding sx={{ py: 0.5 }}>
                                <ListItemText primary={c.name} secondary={<Typography variant="caption" color="text.secondary">{money(c.balance)}</Typography>} />
                              </ListItem>
                            ))}
                          </List>
                          <Button size="small" onClick={() => navigate("/customers")}>Zur Kundenliste</Button>
                        </Box>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              ) : (
                <Card sx={{ borderRadius: 3, height: "100%", bgcolor: alpha(theme.palette.success.main, 0.05), border: `1px solid ${alpha(theme.palette.success.main, 0.1)}` }} elevation={0}>
                  <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                    <CheckCircle fontSize="large" color="success" sx={{ mb: 1, opacity: 0.8 }} />
                    <Typography variant="h6" fontWeight={700} color="success.main">Alles OK</Typography>
                    <Typography variant="body2" color="text.secondary">Kein Handlungsbedarf</Typography>
                  </CardContent>
                </Card>
              )}
            </Grid>

            {/* Distribution - MOVED TO GRID */}
            <Grid item xs={12} md={6}>
              <Card sx={{ borderRadius: 3, height: "100%" }} elevation={0}>
                <CardContent>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
                    <Typography variant="h6" fontWeight={700}>Umsatzverteilung</Typography>
                  </Stack>
                  {/* Horizontal Bar Chart */}
                  <Box sx={{ width: "100%", height: 30, bgcolor: "action.hover", borderRadius: 2, overflow: "hidden", display: "flex", mb: 2 }}>
                    {pieData.map(d => (
                      <Box key={d.name} sx={{
                        width: `${(d.value / sum.totalRevenue) * 100}%`,
                        bgcolor: d.color,
                        height: "100%",
                        transition: "width 0.5s ease"
                      }} />
                    ))}
                  </Box>
                  <Stack spacing={1}>
                    {pieData.map(d => (
                      <Stack key={d.name} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: d.color }} />
                          <Typography variant="body2">{d.name}</Typography>
                        </Stack>
                        <Typography variant="body2" fontWeight={700}>{money(d.value)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
}
