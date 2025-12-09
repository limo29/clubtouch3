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
  Tooltip,
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
  LocalBar,
  ReceiptLong,
  Assessment,
  AccountBalance,
  Campaign,
} from "@mui/icons-material";
import { useTheme, alpha } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import api from "../services/api";
import { API_ENDPOINTS } from "../config/api";
import KPICard from '../components/common/KPICard';

/* -------------------------------- NavCard -------------------------------- */
const NavCard = ({ title, icon: Icon, color, to }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Paper
      onClick={() => navigate(to)}
      elevation={0}
      sx={{
        position: 'relative',
        cursor: "pointer",
        height: 0,
        paddingBottom: "100%", // Aspect ratio 1:1
        overflow: "hidden",
        borderRadius: 4,
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        // Dark Mode: Subtle translucent background with colored border
        // Light Mode: Vibrant solid gradient
        background: isDark
          ? `linear-gradient(135deg, ${alpha(color[0], 0.15)} 0%, ${alpha(color[1], 0.05)} 100%)`
          : `linear-gradient(135deg, ${color[0]} 0%, ${color[1]} 100%)`,
        border: isDark ? `1px solid ${alpha(color[0], 0.3)}` : 'none',
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        "&:hover": {
          transform: "translateY(-4px) scale(1.02)",
          boxShadow: isDark
            ? `0 12px 24px -4px ${alpha(color[0], 0.2)}`
            : `0 12px 24px -4px ${alpha(color[0], 0.5)}`,
          zIndex: 1,
        },
        "&:active": { transform: "scale(0.98)" },
      }}
    >
      {/* Content wrapper for absolute positioning inside the aspect-ratio hack */}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          p: 1,
        }}
      >
        <Box
          sx={{
            bgcolor: isDark ? alpha(color[0], 0.2) : "rgba(255,255,255,0.2)",
            borderRadius: "50%",
            p: 1.5,
            mb: 1.5,
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon sx={{ fontSize: { xs: 32, md: 40 }, color: isDark ? color[1] : "white" }} />
        </Box>
        <Typography
          variant="subtitle2"
          fontWeight={800}
          align="center"
          sx={{
            color: isDark ? color[1] : "white",
            textTransform: "uppercase",
            fontSize: { xs: "0.80rem", md: "0.9rem" },
            letterSpacing: "0.5px",
            lineHeight: 1.2,
            textShadow: isDark ? "none" : "0 2px 4px rgba(0,0,0,0.2)",
          }}
        >
          {title}
        </Typography>
      </Box>
    </Paper>
  );
};

/* -------------------------------- helpers -------------------------------- */
const money = (n) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(+n) ? +n : 0
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

  // 5. Open Invoices
  const { data: openInvoicesData, isLoading: loadingInvoices } = useQuery({
    queryKey: ["open-invoices-dashboard"],
    queryFn: async () => {
      const res = await api.get("/purchase-documents", { params: { limit: 100 } });
      return res.data;
    },
    staleTime: 2 * 60_000,
  });

  // 6. Recent Transactions
  const { data: recentTransactionsData } = useQuery({
    queryKey: ["recent-transactions-dashboard"],
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.TRANSACTIONS, { params: { limit: 10, includeItems: true } });
      return res.data;
    },
    refetchInterval: 30_000,
  });

  /* ------------------------------ Derived data ----------------------------- */
  const sum = dailySummary?.summary || {
    totalRevenue: 0,
    cashRevenue: 0,
    accountRevenue: 0,
    ownerRevenue: 0,
    totalTransactions: 0,
  };

  const topArticles = dailySummary?.topArticles || [];

  // Clean Stacked Bar Data
  const pieData = [
    { name: "Bar", value: sum.cashRevenue, color: theme.palette.success.main },
    { name: "Kundenkonto", value: sum.accountRevenue, color: theme.palette.primary.main },
    { name: "Auf den Wirt", value: sum.ownerRevenue || 0, color: theme.palette.warning.main },
  ].filter(d => d.value > 0);

  const avgTicket = sum.totalTransactions ? sum.totalRevenue / sum.totalTransactions : 0;
  const lowBalanceCount = (lowBalance?.customers || []).filter((c) => (c.balance ?? 0) < 5).length;
  const lowStockCount = lowStock?.count ?? (lowStock?.articles?.length ?? 0);
  const openInvoicesCount = (openInvoicesData?.documents || []).filter(d => d.type === "RECHNUNG" && !d.paid).length;
  const recentTransactions = recentTransactionsData?.transactions || [];

  /* --------------------------------- UI ----------------------------------- */
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, pb: 8, pt: 4, width: "100%", maxWidth: "2000px", margin: "0 auto" }}>

      {/* 1. Navigation Grid (Left-Aligned Header removed) */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="overline" color="text.secondary" fontWeight={800} sx={{ mb: 2, display: "block", letterSpacing: "1.2px" }}>
          Schnellzugriff
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, 1fr)",
              sm: "repeat(4, 1fr)",
              lg: "repeat(8, 1fr)",
            },
            gap: 2,
          }}
        >
          {[
            { title: 'Verkauf', icon: LocalBar, color: ['#FFC107', '#FF9800'], to: '/sales' },
            { title: 'Einkauf', icon: ShoppingCart, color: ['#66BB6A', '#43A047'], to: '/purchases' },
            { title: 'Rechnungen', icon: ReceiptLong, color: ['#42A5F5', '#1E88E5'], to: '/invoices' },
            { title: 'Bestände', icon: Inventory, color: ['#26C6DA', '#00ACC1'], to: '/articles' },
            { title: 'Statistik', icon: Assessment, color: ['#AB47BC', '#8E24AA'], to: '/reports' },
            { title: 'Abrechnung', icon: AccountBalance, color: ['#EF5350', '#E53935'], to: '/profit-loss' },
            { title: 'Clubscore', icon: EmojiEvents, color: ['#29B6F6', '#039BE5'], to: '/highscore' },
            { title: 'Werbung', icon: Campaign, color: ['#EC407A', '#D81B60'], to: '/ads' },
          ].map((item) => (
            <NavCard key={item.title} {...item} />
          ))}
        </Box>
      </Box>

      {/* 2. KPI / Hero Section */}
      <Typography variant="overline" color="text.secondary" fontWeight={800} sx={{ mb: 2, display: "block", letterSpacing: "1.2px" }}>
        Übersicht
      </Typography>
      <Grid container spacing={3} sx={{ mb: 5 }} alignItems="stretch">
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Umsatz Heute"
            value={money(sum.totalRevenue)}
            icon={AttachMoney}
            color="primary"
            loading={loadingSummary}
            subTitle={`${sum.totalTransactions} Transaktionen | Ø ${money(avgTicket)}`}
            sx={{ height: "100%" }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Offene Rechnungen"
            value={openInvoicesCount}
            icon={ShoppingBasket}
            color={openInvoicesCount > 0 ? "warning" : "success"}
            loading={loadingInvoices}
            subTitle={openInvoicesCount > 0 ? "Zahlung ausstehend" : "Alles bezahlt"}
            sx={{ height: "100%" }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Lagerbestand"
            value={lowStockCount}
            icon={Inventory}
            color={lowStockCount > 0 ? "error" : "success"}
            loading={loadingLowStock}
            subTitle={lowStockCount > 0 ? "Artikel kritisch" : "Bestand OK"}
            sx={{ height: "100%" }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card
            elevation={0}
            sx={{
              height: "100%",
              borderRadius: 4,
              bgcolor: "background.paper",
              border: `1px solid ${theme.palette.divider}`,
              transition: "all 0.2s",
              "&:hover": { boxShadow: 4, borderColor: "primary.main" }
            }}
          >
            <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1.5, p: 3 }}>
              <Button
                variant="contained"
                fullWidth
                size="large"
                startIcon={<ShoppingCart />}
                onClick={() => navigate("/sales")}
                sx={{ borderRadius: 3, fontWeight: 700, py: 1.2 }}
              >
                Verkauf starten
              </Button>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<Description />}
                onClick={() => navigate("/purchases/create")}
                sx={{ borderRadius: 3, fontWeight: 700, border: "2px solid", "&:hover": { border: "2px solid" } }}
              >
                Einkauf erfassen
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>


      {/* 3. Detailed Content Grid (Refined Columns) */}
      <Grid container spacing={3}>

        {/* LEFT: Warnings & Ranking */}
        <Grid item xs={12} lg={4}>
          <Stack spacing={3}>
            {/* Warnings */}
            {(lowStockCount > 0 || lowBalanceCount > 0) ? (
              <Paper elevation={0} sx={{ p: 2, borderRadius: 4, bgcolor: alpha(theme.palette.warning.main, 0.05), border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}` }}>
                <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
                  <Warning color="warning" />
                  <Typography variant="h6" fontWeight={800}>Handlungsbedarf</Typography>
                </Stack>
                <List dense disablePadding>
                  {(lowStock?.articles || []).slice(0, 3).map((a) => (
                    <ListItem key={a.id} sx={{ px: 0 }}>
                      <ListItemText
                        primary={<Typography variant="body2" fontWeight={600}>{a.name}</Typography>}
                        secondary={`Bestand: ${a.stock} (Min: ${a.minStock})`}
                      />
                      <Chip label="Lager" size="small" color="error" sx={{ height: 20, fontSize: "0.65rem", fontWeight: 700 }} />
                    </ListItem>
                  ))}
                  {(lowBalance?.customers || []).filter(c => c.balance < 5).slice(0, 3).map((c) => (
                    <ListItem key={c.id} sx={{ px: 0 }}>
                      <ListItemText
                        primary={<Typography variant="body2" fontWeight={600}>{c.name}</Typography>}
                        secondary={`Guthaben: ${money(c.balance)}`}
                      />
                      <Chip label="Guthaben" size="small" color="warning" sx={{ height: 20, fontSize: "0.65rem", fontWeight: 700 }} />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            ) : (
              <Paper elevation={0} sx={{ p: 2, borderRadius: 4, border: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', gap: 2 }}>
                <CheckCircle color="success" />
                <Box>
                  <Typography variant="subtitle1" fontWeight={700}>Keine Warnungen</Typography>
                  <Typography variant="caption" color="text.secondary">System läuft optimal</Typography>
                </Box>
              </Paper>
            )}

            {/* Ranking Card (Moved to Left) */}
            <Paper elevation={0} sx={{ borderRadius: 4, border: `1px solid ${theme.palette.divider}`, p: 0, overflow: "hidden" }}>
              <Box sx={{ p: 2.5, bgcolor: "warning.main", color: "warning.contrastText" }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <EmojiEvents />
                  <Typography variant="h6" fontWeight={800}>Ranking Top 3</Typography>
                </Stack>
              </Box>
              <List sx={{ p: 0 }}>
                {(highscore?.entries || []).slice(0, 3).map((e) => (
                  <ListItem key={e.customerId} sx={{ px: 3, py: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: "background.default", color: "text.primary", fontWeight: 700 }}>{e.rank}</Avatar>
                    </ListItemAvatar>
                    <ListItemText primary={<Typography variant="body2" fontWeight={700}>{e.customerNickname || e.customerName}</Typography>} />
                    <Typography variant="body2" fontWeight={700}>{money(e.score)}</Typography>
                  </ListItem>
                ))}
              </List>
            </Paper>
          </Stack>
        </Grid>

        {/* MIDDLE: Top Articles */}
        <Grid item xs={12} md={6} lg={4}>
          <Paper elevation={0} sx={{ borderRadius: 4, border: `1px solid ${theme.palette.divider}`, height: "100%", overflow: "hidden" }}>
            <Box sx={{ p: 2.5, bgcolor: "background.default", borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="h6" fontWeight={800}>Bestseller</Typography>
            </Box>
            <List sx={{ p: 0 }}>
              {topArticles.slice(0, 8).map((a, i) => (
                <ListItem key={a.id} sx={{ px: 3, py: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
                  <Typography variant="h6" color="text.secondary" fontWeight={900} sx={{ width: 30, opacity: 0.5 }}>{i + 1}</Typography>
                  <ListItemText
                    primary={<Typography variant="body2" fontWeight={700}>{a.name}</Typography>}
                    secondary={`${a.quantity_sold} verkauft`}
                  />
                  <Typography variant="body2" fontWeight={700} color="primary.main">{money(a.revenue)}</Typography>
                </ListItem>
              ))}
              {topArticles.length === 0 && <Box p={4} textAlign="center" color="text.secondary">Keine Verkäufe</Box>}
            </List>
          </Paper>
        </Grid>

        {/* RIGHT: Live Feed & Distribution */}
        <Grid item xs={12} md={6} lg={4}>
          <Stack spacing={3}>

            {/* Live Feed */}
            <Paper elevation={0} sx={{ borderRadius: 4, border: `1px solid ${theme.palette.divider}`, overflow: "hidden", minHeight: 400 }}>
              <Box sx={{ p: 2.5, bgcolor: "background.default", borderBottom: `1px solid ${theme.palette.divider}` }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" fontWeight={800}>Live Feed</Typography>
                  <Chip label="Heute" size="small" sx={{ fontWeight: 700 }} />
                </Stack>
              </Box>
              <List sx={{ p: 0 }}>
                {recentTransactions.slice(0, 6).map((tx) => (
                  <ListItem key={tx.id} sx={{ borderBottom: `1px solid ${theme.palette.divider}`, "&:last-child": { borderBottom: 0 } }}>
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: tx.type === 'DEPOSIT' ? 'success.light' : 'primary.light', width: 36, height: 36 }}>
                        {tx.type === 'DEPOSIT' ? <AttachMoney sx={{ fontSize: 18 }} /> : <ShoppingCart sx={{ fontSize: 18 }} />}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={<Typography variant="body2" fontWeight={600}>{tx.customer?.name || "Unbekannt"}</Typography>}
                      secondary={format(new Date(tx.createdAt), 'HH:mm')}
                    />
                    <Typography variant="body2" fontWeight={700} color={tx.type === 'DEPOSIT' ? 'success.main' : 'text.primary'}>
                      {money(tx.totalAmount)}
                    </Typography>
                  </ListItem>
                ))}
                {recentTransactions.length === 0 && <Box p={4} textAlign="center" color="text.secondary">Keine Transaktionen</Box>}
              </List>
            </Paper>

            {/* Distribution Chart (Stacked Bar) */}
            <Paper elevation={0} sx={{ borderRadius: 4, border: `1px solid ${theme.palette.divider}`, p: 3 }}>
              <Typography variant="h6" fontWeight={800} gutterBottom>Umsatzverteilung</Typography>
              <Box sx={{ display: 'flex', gap: 1, height: 40, mt: 2, mb: 1, width: "100%" }}>
                {pieData.map((d, i) => (
                  d.value > 0 && (
                    <Tooltip key={d.name} title={`${d.name}: ${money(d.value)}`} arrow>
                      <Box
                        sx={{
                          flex: d.value,
                          bgcolor: d.color,
                          borderRadius: 1.5,
                          minWidth: 4,
                          position: 'relative',
                          '&:hover': { opacity: 0.9 }
                        }}
                      />
                    </Tooltip>
                  )
                ))}
              </Box>
              <Stack direction="row" spacing={2} mt={2} flexWrap="wrap">
                {pieData.map(d => (
                  <Stack key={d.name} direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: d.color }} />
                    <Typography variant="caption" fontWeight={700} noWrap>{d.name} ({money(d.value)})</Typography>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
