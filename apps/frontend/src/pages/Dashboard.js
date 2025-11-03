import React from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  LinearProgress,
  IconButton,
  Divider,
} from '@mui/material';
import {
  AttachMoney,
  People,
  Inventory,
  TrendingUp,
  Warning,
  ShoppingCart,
  EmojiEvents,
  LocalDrink,
  Refresh,
  ArrowUpward,
  ArrowDownward,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const Dashboard = () => {
  // Fetch daily summary
  const { data: dailySummary, refetch: refetchSummary } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.DAILY_SUMMARY);
      return response.data;
    },
  });

  // Fetch low stock articles
  const { data: lowStock } = useQuery({
    queryKey: ['low-stock'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.ARTICLES_LOW_STOCK);
      return response.data;
    },
  });

  // Fetch low balance customers
  const { data: lowBalance } = useQuery({
    queryKey: ['low-balance'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.CUSTOMERS_LOW_BALANCE);
      return response.data;
    },
  });

  // Fetch highscore
  const { data: highscore } = useQuery({
    queryKey: ['highscore-dashboard'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.HIGHSCORE, {
        params: { type: 'DAILY', mode: 'AMOUNT' }
      });
      return response.data;
    },
  });

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount);
  };

  // Prepare pie chart data
  const pieData = dailySummary ? [
    { name: 'Bar', value: dailySummary.summary.cashRevenue, color: '#4CAF50' },
    { name: 'Kundenkonto', value: dailySummary.summary.accountRevenue, color: '#2196F3' },
  ] : [];

  const stats = [
    { 
      title: 'Heutiger Umsatz', 
      value: dailySummary ? formatCurrency(dailySummary.summary.totalRevenue) : '€ 0,00',
      icon: <AttachMoney />, 
      color: 'primary.main',
      change: dailySummary?.summary.totalTransactions || 0,
      changeLabel: 'Transaktionen'
    },
    { 
      title: 'Aktive Kunden', 
      value: lowBalance?.customers.length || '0',
      icon: <People />, 
      color: 'success.main',
      change: lowBalance?.customers.filter(c => c.balance < 5).length || 0,
      changeLabel: 'mit niedrigem Guthaben',
      changeColor: 'warning.main'
    },
    { 
      title: 'Niedriger Bestand', 
      value: lowStock?.count || '0',
      icon: <Inventory />, 
      color: 'warning.main',
      change: lowStock?.articles?.length || 0,
      changeLabel: 'Artikel betroffen'
    },
    { 
      title: 'Top Artikel', 
      value: dailySummary?.topArticles?.[0]?.name || '-',
      icon: <TrendingUp />, 
      color: 'info.main',
      change: dailySummary?.topArticles?.[0]?.quantity_sold || 0,
      changeLabel: 'mal verkauft'
    },
  ];

  return (
    <Box sx={{ px: { xs: 1, md: 2 } }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Dashboard
        </Typography>
        <IconButton onClick={() => refetchSummary()}>
          <Refresh />
        </IconButton>
      </Box>
      
      {/* Statistics Cards */}
      <Grid container spacing={3} alignItems="stretch">
        {stats.map((stat, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                  <Box
                    sx={{
                      backgroundColor: stat.color,
                      color: 'white',
                      borderRadius: 2,
                      p: 1,
                      mr: 2,
                    }}
                  >
                    {stat.icon}
                  </Box>
                  <Typography color="textSecondary" variant="body2">
                    {stat.title}
                  </Typography>
                </Box>
                <Typography variant="h4" component="div" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {stat.value}
                </Typography>
                {stat.change !== undefined && (
                  <Typography 
                    variant="caption" 
                    color={stat.changeColor || 'text.secondary'}
                  >
                    {stat.change} {stat.changeLabel}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}

        {/* Sales Distribution */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Umsatzverteilung
              </Typography>
              {pieData.length > 0 ? (
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
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Box height={200} display="flex" alignItems="center" justifyContent="center">
                  <Typography color="text.secondary">Keine Daten</Typography>
                </Box>
              )}
              <Box mt={2}>
                {pieData.map((entry) => (
                  <Box key={entry.name} display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                    <Box display="flex" alignItems="center">
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: entry.color,
                          mr: 1,
                        }}
                      />
                      <Typography variant="body2">{entry.name}</Typography>
                    </Box>
                    <Typography variant="body2">{formatCurrency(entry.value)}</Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Top Articles */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Top Artikel heute
              </Typography>
              {dailySummary?.topArticles?.length > 0 ? (
                <List>
                  {dailySummary.topArticles.slice(0, 5).map((article, index) => (
                    <ListItem key={article.id} dense>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: 'primary.light' }}>
                          <LocalDrink />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={article.name}
                        secondary={`${article.quantity_sold}x - ${formatCurrency(article.revenue)}`}
                      />
                      {index === 0 && <Chip label="TOP" size="small" color="primary" />}
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
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <EmojiEvents sx={{ verticalAlign: 'middle', mr: 1 }} />
                Highscore heute
              </Typography>
              {highscore?.entries?.length > 0 ? (
                <List>
                  {highscore.entries.slice(0, 5).map((entry) => (
                    <ListItem key={entry.customerId} dense>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: entry.rank <= 3 ? 'warning.light' : 'grey.300' }}>
                          {entry.rank}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={entry.customerNickname || entry.customerName}
                        secondary={formatCurrency(entry.score)}
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

        {/* Warnings */}
        <Grid item xs={12}>
          <Grid container spacing={2}>
            {/* Low Stock Warning */}
            {lowStock?.articles?.length > 0 && (
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 2, bgcolor: 'warning.light' }}>
                  <Box display="flex" alignItems="center" mb={1}>
                    <Warning sx={{ mr: 1 }} />
                    <Typography variant="h6">Niedriger Bestand</Typography>
                  </Box>
                  <List dense>
                    {lowStock.articles.slice(0, 3).map((article) => (
                      <ListItem key={article.id}>
                        <ListItemText
                          primary={article.name}
                          secondary={`Bestand: ${article.stock} / Min: ${article.minStock}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                  {lowStock.articles.length > 3 && (
                    <Typography variant="body2" color="text.secondary" align="center">
                      und {lowStock.articles.length - 3} weitere...
                    </Typography>
                  )}
                </Paper>
              </Grid>
            )}

            {/* Low Balance Warning */}
            {lowBalance?.customers?.length > 0 && (
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 2, bgcolor: 'info.light' }}>
                  <Box display="flex" alignItems="center" mb={1}>
                    <Warning sx={{ mr: 1 }} />
                    <Typography variant="h6">Niedriges Guthaben</Typography>
                  </Box>
                  <List dense>
                    {lowBalance.customers.slice(0, 3).map((customer) => (
                      <ListItem key={customer.id}>
                        <ListItemText
                          primary={customer.name}
                          secondary={`Guthaben: ${formatCurrency(customer.balance)}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                  {lowBalance.customers.length > 3 && (
                    <Typography variant="body2" color="text.secondary" align="center">
                      und {lowBalance.customers.length - 3} weitere...
                    </Typography>
                  )}
                </Paper>
              </Grid>
            )}
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
