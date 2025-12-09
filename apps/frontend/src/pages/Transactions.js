import React, { useState } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Divider,
  Alert,
  MenuItem,
  Tooltip,
} from '@mui/material';
import {

  Cancel,
  Receipt,
  AttachMoney,
  AccountBalanceWallet,
  Info,
  FilterList,
  LocalBar,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const Transactions = () => {
  const queryClient = useQueryClient();
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [detailDialog, setDetailDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [filters, setFilters] = useState({
    startDate: null,
    endDate: null,
    paymentMethod: '',
    includeItems: true,
  });

  // Fetch transactions
  const { data: transactionsData } = useQuery({
    queryKey: ['transactions', filters],
    queryFn: async () => {
      const params = {
        includeItems: filters.includeItems,
      };

      if (filters.startDate) {
        params.startDate = format(filters.startDate, 'yyyy-MM-dd');
      }
      if (filters.endDate) {
        params.endDate = format(filters.endDate, 'yyyy-MM-dd');
      }
      if (filters.paymentMethod) {
        params.paymentMethod = filters.paymentMethod;
      }

      const response = await api.get(API_ENDPOINTS.TRANSACTIONS, { params });
      return response.data;
    },
  });

  // Fetch daily summary
  const { data: dailySummary } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.DAILY_SUMMARY);
      return response.data;
    },
  });

  // Cancel transaction mutation
  const cancelMutation = useMutation({
    mutationFn: async (transactionId) => {
      const response = await api.post(`${API_ENDPOINTS.TRANSACTIONS}/${transactionId}/cancel`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['transactions']);
      queryClient.invalidateQueries(['daily-summary']);
      setCancelDialog(false);
      setSelectedTransaction(null);
    },
  });

  const transactions = transactionsData?.transactions || [];

  const handleOpenDetail = (transaction) => {
    setSelectedTransaction(transaction);
    setDetailDialog(true);
  };

  const handleCloseDetail = () => {
    setDetailDialog(false);
    setSelectedTransaction(null);
  };

  const handleOpenCancel = (transaction) => {
    setSelectedTransaction(transaction);
    setCancelDialog(true);
  };

  const handleCloseCancel = () => {
    setCancelDialog(false);
    setSelectedTransaction(null);
  };

  const handleCancelTransaction = () => {
    if (selectedTransaction) {
      cancelMutation.mutate(selectedTransaction.id);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount);
  };

  const getPaymentMethodIcon = (method, type) => {
    if (type === 'OWNER_USE') return <LocalBar />;
    return method === 'CASH' ? <AttachMoney /> : <AccountBalanceWallet />;
  };

  const getPaymentMethodLabel = (method, type) => {
    if (type === 'OWNER_USE') return 'Auf den Wirt';
    return method === 'CASH' ? 'Bar' : 'Kundenkonto';
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Transaktionen
      </Typography>

      {/* Daily Summary Cards */}
      {dailySummary && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Heutiger Umsatz
                </Typography>
                <Typography variant="h4">
                  {formatCurrency(dailySummary.summary.totalRevenue)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {dailySummary.summary.totalTransactions} Transaktionen
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Bar-Umsatz
                </Typography>
                <Typography variant="h4">
                  {formatCurrency(dailySummary.summary.cashRevenue)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {dailySummary.summary.cashTransactions} Transaktionen
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Kundenkonto-Umsatz
                </Typography>
                <Typography variant="h4">
                  {formatCurrency(dailySummary.summary.accountRevenue)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {dailySummary.summary.accountTransactions} Transaktionen
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Storniert
                </Typography>
                <Typography variant="h4" color="error">
                  {dailySummary.summary.cancelledTransactions}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatCurrency(dailySummary.summary.cancelledRevenue)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <DatePicker
              label="Von"
              value={filters.startDate}
              onChange={(date) => setFilters({ ...filters, startDate: date })}
              renderInput={(params) => <TextField {...params} size="small" fullWidth />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <DatePicker
              label="Bis"
              value={filters.endDate}
              onChange={(date) => setFilters({ ...filters, endDate: date })}
              renderInput={(params) => <TextField {...params} size="small" fullWidth />}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              select
              label="Zahlungsart"
              value={filters.paymentMethod}
              onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })}
              size="small"
              fullWidth
            >
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="CASH">Bar</MenuItem>
              <MenuItem value="ACCOUNT">Kundenkonto</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Button
              variant="outlined"
              startIcon={<FilterList />}
              onClick={() => setFilters({
                startDate: null,
                endDate: null,
                paymentMethod: '',
                includeItems: true,
              })}
            >
              Filter zurücksetzen
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Transactions Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Datum & Zeit</TableCell>
              <TableCell>Kunde</TableCell>
              <TableCell>Artikel</TableCell>
              <TableCell>Betrag</TableCell>
              <TableCell>Zahlungsart</TableCell>
              <TableCell>Kassierer</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.map((transaction) => (
              <TableRow
                key={transaction.id}
                hover
                sx={{
                  cursor: 'pointer',
                  opacity: transaction.cancelled ? 0.6 : 1,
                }}
                onClick={() => handleOpenDetail(transaction)}
              >
                <TableCell>
                  <Typography variant="caption">
                    {transaction.id.substring(0, 8)}...
                  </Typography>
                </TableCell>
                <TableCell>
                  {format(new Date(transaction.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                </TableCell>
                <TableCell>
                  {transaction.customer ? transaction.customer.name : (transaction.type === 'OWNER_USE' ? 'Auf den Wirt' : 'Bar-Zahlung')}
                </TableCell>
                <TableCell>
                  {transaction.items?.length || 0} Artikel
                </TableCell>
                <TableCell>
                  <Typography
                    variant="body2"
                    color={transaction.type === 'REFUND' ? 'error' : 'primary'}
                  >
                    {transaction.type === 'REFUND' && '-'}
                    {formatCurrency(Math.abs(transaction.totalAmount))}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    icon={getPaymentMethodIcon(transaction.paymentMethod, transaction.type)}
                    label={getPaymentMethodLabel(transaction.paymentMethod, transaction.type)}
                    size="small"
                  />
                </TableCell>
                <TableCell>{transaction.user?.name || '-'}</TableCell>
                <TableCell>
                  {transaction.cancelled ? (
                    <Chip label="Storniert" size="small" color="error" />
                  ) : transaction.type === 'REFUND' ? (
                    <Chip label="Storno" size="small" color="warning" />
                  ) : (
                    <Chip label="Abgeschlossen" size="small" color="success" />
                  )}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Details">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDetail(transaction);
                      }}
                    >
                      <Info />
                    </IconButton>
                  </Tooltip>
                  {!transaction.cancelled && transaction.type === 'SALE' && (
                    <Tooltip title="Stornieren">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenCancel(transaction);
                        }}
                      >
                        <Cancel />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Transaction Detail Dialog */}
      <Dialog open={detailDialog} onClose={handleCloseDetail} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <Receipt sx={{ mr: 1 }} />
              Transaktionsdetails
            </Box>
            {selectedTransaction?.cancelled && (
              <Chip label="STORNIERT" color="error" />
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedTransaction && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Transaktions-ID
                </Typography>
                <Typography variant="body1" gutterBottom>
                  {selectedTransaction.id}
                </Typography>

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Datum & Zeit
                </Typography>
                <Typography variant="body1" gutterBottom>
                  {format(new Date(selectedTransaction.createdAt), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                </Typography>

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Kassierer
                </Typography>
                <Typography variant="body1" gutterBottom>
                  {selectedTransaction.user?.name || '-'}
                </Typography>
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Kunde
                </Typography>
                <Typography variant="body1" gutterBottom>
                  {selectedTransaction.customer ? selectedTransaction.customer.name : (selectedTransaction.type === 'OWNER_USE' ? 'Auf den Wirt' : 'Bar-Zahlung')}
                </Typography>

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Zahlungsart
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  {getPaymentMethodIcon(selectedTransaction.paymentMethod, selectedTransaction.type)}
                  <Typography variant="body1">
                    {getPaymentMethodLabel(selectedTransaction.paymentMethod, selectedTransaction.type)}
                  </Typography>
                </Box>

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  Gesamtbetrag
                </Typography>
                <Typography variant="h5" color="primary">
                  {formatCurrency(selectedTransaction.totalAmount)}
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Artikel
                </Typography>
                <List>
                  {selectedTransaction.items?.map((item) => (
                    <ListItem key={item.id} dense>
                      <ListItemText
                        primary={item.article.name}
                        secondary={`${item.quantity}x ${formatCurrency(item.pricePerUnit)} = ${formatCurrency(item.totalPrice)}`}
                      />
                    </ListItem>
                  ))}
                </List>
              </Grid>

              {selectedTransaction.cancelled && (
                <Grid item xs={12}>
                  <Alert severity="error">
                    Storniert am {format(new Date(selectedTransaction.cancelledAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                  </Alert>
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDetail}>Schließen</Button>
        </DialogActions>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelDialog} onClose={handleCloseCancel}>
        <DialogTitle>Transaktion stornieren</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Diese Aktion kann nicht rückgängig gemacht werden!
          </Alert>
          <Typography>
            Möchten Sie diese Transaktion wirklich stornieren?
          </Typography>
          {selectedTransaction && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Betrag: {formatCurrency(selectedTransaction.totalAmount)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Kunde: {selectedTransaction.customer?.name || 'Bar-Zahlung'}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCancel}>Abbrechen</Button>
          <Button
            onClick={handleCancelTransaction}
            color="error"
            variant="contained"
            disabled={cancelMutation.isLoading}
          >
            {cancelMutation.isLoading ? 'Storniere...' : 'Stornieren'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Transactions;
