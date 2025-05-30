import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  TextField,
  Divider,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  Download,
  DateRange,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../services/api';
import { format } from 'date-fns';

const ProfitLoss = () => {
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().getFullYear(), 0, 1), // 1. Januar
    endDate: new Date()
  });

  // Fetch profit/loss data
  const { data: profitLossData, isLoading } = useQuery({
    queryKey: ['profit-loss', dateRange],
    queryFn: async () => {
      const response = await api.get('/purchases/profit-loss', {
        params: {
          startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
          endDate: format(dateRange.endDate, 'yyyy-MM-dd')
        }
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

  const downloadEUR = async () => {
    try {
      const response = await api.get('/exports/eur', {
        params: {
          startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
          endDate: format(dateRange.endDate, 'yyyy-MM-dd')
        },
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `EUR_${format(dateRange.startDate, 'yyyy-MM-dd')}_${format(dateRange.endDate, 'yyyy-MM-dd')}.pdf`;
      link.click();
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const summary = profitLossData?.summary || { totalIncome: 0, totalExpenses: 0, profit: 0 };
  const incomeByCategory = profitLossData?.details?.incomeByCategory || [];
  const expensesBySupplier = profitLossData?.details?.expensesBySupplier || [];

  // Prepare chart data
  const chartData = incomeByCategory.map(cat => ({
    category: cat.category,
    Einnahmen: parseFloat(cat.amount),
  }));

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Einnahmen-Überschuss-Rechnung (EÜR)
      </Typography>

      {/* Date Range Selector */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item>
            <DatePicker
              label="Von"
              value={dateRange.startDate}
              onChange={(date) => setDateRange({ ...dateRange, startDate: date })}
              renderInput={(params) => <TextField {...params} />}
            />
          </Grid>
          <Grid item>
            <DatePicker
              label="Bis"
              value={dateRange.endDate}
              onChange={(date) => setDateRange({ ...dateRange, endDate: date })}
              renderInput={(params) => <TextField {...params} />}
            />
          </Grid>
          <Grid item>
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={downloadEUR}
            >
              PDF Export
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <TrendingUp sx={{ color: 'success.main', mr: 2 }} />
                <Typography color="textSecondary">Einnahmen</Typography>
              </Box>
              <Typography variant="h4" color="success.main">
                {formatCurrency(summary.totalIncome)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <TrendingDown sx={{ color: 'error.main', mr: 2 }} />
                <Typography color="textSecondary">Ausgaben</Typography>
              </Box>
              <Typography variant="h4" color="error.main">
                {formatCurrency(summary.totalExpenses)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <AccountBalance sx={{ color: summary.profit >= 0 ? 'success.main' : 'error.main', mr: 2 }} />
                <Typography color="textSecondary">Gewinn/Verlust</Typography>
              </Box>
              <Typography 
                variant="h4" 
                color={summary.profit >= 0 ? 'success.main' : 'error.main'}
              >
                {formatCurrency(summary.profit)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Income by Category */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Einnahmen nach Kategorie
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Kategorie</TableCell>
                      <TableCell align="right">Betrag</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {incomeByCategory.map((cat) => (
                      <TableRow key={cat.category}>
                        <TableCell>{cat.category}</TableCell>
                        <TableCell align="right">
                          {formatCurrency(cat.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell><strong>Gesamt</strong></TableCell>
                      <TableCell align="right">
                        <strong>{formatCurrency(summary.totalIncome)}</strong>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Expenses by Supplier */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Ausgaben nach Lieferant
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Lieferant</TableCell>
                      <TableCell align="right">Anzahl</TableCell>
                      <TableCell align="right">Betrag</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {expensesBySupplier.map((supplier) => (
                      <TableRow key={supplier.supplier}>
                        <TableCell>{supplier.supplier}</TableCell>
                        <TableCell align="right">{supplier.count}</TableCell>
                        <TableCell align="right">
                          {formatCurrency(supplier.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2}><strong>Gesamt</strong></TableCell>
                      <TableCell align="right">
                        <strong>{formatCurrency(summary.totalExpenses)}</strong>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
                  
{profitLossData?.details?.incomeByType && (
  <Grid item xs={12} md={6}>
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Einnahmen nach Typ
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Typ</TableCell>
                <TableCell align="right">Betrag</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>Barverkäufe & Kundenkonto</TableCell>
                <TableCell align="right">
                  {formatCurrency(profitLossData.details.incomeByType.transactions)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Bezahlte Rechnungen</TableCell>
                <TableCell align="right">
                  {formatCurrency(profitLossData.details.incomeByType.invoices)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><strong>Gesamt</strong></TableCell>
                <TableCell align="right">
                  <strong>{formatCurrency(summary.totalIncome)}</strong>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  </Grid>
)}
 

        {/* Chart */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Einnahmen nach Kategorie
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" />
                  <YAxis />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="Einnahmen" fill="#4caf50" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProfitLoss;
