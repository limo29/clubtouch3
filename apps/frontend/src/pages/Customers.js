import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Grid,
  InputAdornment,
  Alert,
  Chip,
  MenuItem,
  List,
  ListItem,
  ListItemText,
  Avatar,
  useMediaQuery,
  useTheme,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Add,
  Edit,
  Search,
  Person,
  Receipt,
  EmojiEvents,
  TrendingUp,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

const Customers = () => {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [openTopUpDialog, setOpenTopUpDialog] = useState(false);
  const [openDetailDialog, setOpenDetailDialog] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const { control, handleSubmit, reset, formState: { errors } } = useForm();
  const { control: topUpControl, handleSubmit: handleTopUpSubmit, reset: resetTopUp } = useForm();

  // Fetch customers
  const { data: customersData } = useQuery({
    queryKey: ['customers', searchTerm],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.CUSTOMERS, {
        params: searchTerm ? { search: searchTerm } : {}
      });
      return response.data;
    },
  });

  // Fetch low balance customers
  const { data: lowBalanceData } = useQuery({
    queryKey: ['customers', 'low-balance'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.CUSTOMERS_LOW_BALANCE);
      return response.data;
    },
  });

  // Fetch customer details
  const { data: customerDetails } = useQuery({
    queryKey: ['customer', selectedCustomer?.id],
    queryFn: async () => {
      if (!selectedCustomer) return null;
      const response = await api.get(`${API_ENDPOINTS.CUSTOMERS}/${selectedCustomer.id}`);
      return response.data.customer;
    },
    enabled: !!selectedCustomer,
  });

  // Fetch customer stats
  const { data: customerStats } = useQuery({
    queryKey: ['customer-stats', selectedCustomer?.id],
    queryFn: async () => {
      if (!selectedCustomer) return null;
      const response = await api.get(`${API_ENDPOINTS.CUSTOMERS}/${selectedCustomer.id}/stats`);
      return response.data;
    },
    enabled: !!selectedCustomer,
  });

  // Create/Update customer mutation
  const customerMutation = useMutation({
    mutationFn: async (data) => {
      if (editingCustomer) {
        const response = await api.put(`${API_ENDPOINTS.CUSTOMERS}/${editingCustomer.id}`, data);
        return response.data;
      } else {
        const response = await api.post(API_ENDPOINTS.CUSTOMERS, data);
        return response.data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customers']);
      handleCloseDialog();
    },
  });

  const toggleClientStatus = useMutation({
    mutationFn: async (customer) => {
      await api.put(`${API_ENDPOINTS.CUSTOMERS}/${customer.id}`, {
        active: customer.active === false ? true : false
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customers']);
    }
  });

  // Top up mutation
  const topUpMutation = useMutation({
    mutationFn: async ({ customerId, ...data }) => {
      const response = await api.post(`${API_ENDPOINTS.CUSTOMERS}/${customerId}/topup`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customers']);
      queryClient.invalidateQueries(['customer']);
      handleCloseTopUpDialog();
    },
  });

  const customers = customersData?.customers || [];

  // In der handleOpenDialog Funktion
  const handleOpenDialog = (customer = null) => {
    setEditingCustomer(customer);
    if (customer) {
      reset({
        name: customer.name,
        nickname: customer.nickname || '',
        gender: customer.gender || 'OTHER', // NEU
        active: customer.active !== false,
      });
    } else {
      reset({
        name: '',
        nickname: '',
        gender: 'OTHER', // NEU
        active: true,
      });
    }
    setOpenDialog(true);
  };


  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingCustomer(null);
    reset();
  };

  const handleOpenTopUpDialog = (customer) => {
    setSelectedCustomer(customer);
    resetTopUp({
      amount: '',
      method: 'CASH',
      reference: '',
    });
    setOpenTopUpDialog(true);
  };

  const handleCloseTopUpDialog = () => {
    setOpenTopUpDialog(false);
    resetTopUp();
  };

  const handleOpenDetailDialog = (customer) => {
    setSelectedCustomer(customer);
    setOpenDetailDialog(true);
  };

  const handleCloseDetailDialog = () => {
    setOpenDetailDialog(false);
    setSelectedCustomer(null);
  };

  const onSubmit = (data) => {
    customerMutation.mutate(data);
  };

  const onTopUpSubmit = (data) => {
    topUpMutation.mutate({
      customerId: selectedCustomer.id,
      amount: parseFloat(data.amount),
      method: data.method,
      reference: data.reference || null,
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount);
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Kundenverwaltung
      </Typography>

      {/* Statistics Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Kunden gesamt
              </Typography>
              <Typography variant="h4">
                {customers.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Gesamtguthaben
              </Typography>
              <Typography variant="h4">
                {formatCurrency(customers.reduce((sum, c) => sum + parseFloat(c.balance), 0))}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Durchschn. Guthaben
              </Typography>
              <Typography variant="h4">
                {customers.length > 0
                  ? formatCurrency(customers.reduce((sum, c) => sum + parseFloat(c.balance), 0) / customers.length)
                  : formatCurrency(0)
                }
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Niedriges Guthaben
              </Typography>
              <Typography variant="h4" color="warning.main">
                {lowBalanceData?.count || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Actions Bar */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item flex={1}>
            <TextField
              placeholder="Kunde suchen..."
              variant="outlined"
              size="small"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => handleOpenDialog()}
            >
              Neuer Kunde
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Low Balance Alert */}
      {lowBalanceData?.count > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>{lowBalanceData.count} Kunden</strong> haben ein Guthaben unter €{lowBalanceData.threshold}!
        </Alert>
      )}

      {/* Customers Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name / Status</TableCell>
              {!isMobile && <TableCell>Spitzname</TableCell>}
              <TableCell align="right">Guthaben</TableCell>
              {!isMobile && <TableCell align="right">Letzte Transaktion</TableCell>}
              {!isMobile && <TableCell align="right">Transaktionen</TableCell>}
              {!isMobile && <TableCell>Erstellt am</TableCell>}
              <TableCell align="right">Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {customers.map((customer) => (
              <TableRow
                key={customer.id}
                hover
                sx={{
                  cursor: 'pointer',
                  bgcolor: customer.active === false ? 'rgba(255, 0, 0, 0.08)' : 'inherit'
                }}
                onClick={() => handleOpenDetailDialog(customer)}
              >
                <TableCell>
                  <Box display="flex" alignItems="center">
                    <Avatar sx={{ mr: 2, bgcolor: 'primary.main' }}>
                      <Person />
                    </Avatar>
                    <Box>
                      <Typography variant="body2" fontWeight="bold">
                        {customer.name}
                      </Typography>
                      {isMobile && customer.nickname && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {customer.nickname}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ ml: 2 }} onClick={(e) => e.stopPropagation()}>
                      <Tooltip title={customer.active !== false ? "Aktiv" : "Versteckt"}>
                        <Switch
                          size="small"
                          checked={customer.active !== false}
                          onChange={() => toggleClientStatus.mutate(customer)}
                          color="primary"
                        />
                      </Tooltip>
                    </Box>
                  </Box>
                </TableCell>
                {!isMobile && <TableCell>{customer.nickname || '-'}</TableCell>}
                <TableCell align="right">
                  <Typography
                    variant="body2"
                    color={parseFloat(customer.balance) < 5 ? 'error' : 'inherit'}
                    fontWeight={parseFloat(customer.balance) < 5 ? 'bold' : 'normal'}
                  >
                    {formatCurrency(customer.balance)}
                  </Typography>
                </TableCell>
                {!isMobile && <TableCell align="right">
                  {customer.lastActivity ? new Date(customer.lastActivity).toLocaleDateString('de-DE') : '-'}
                </TableCell>}
                {!isMobile && <TableCell align="right">{customer._count?.transactions || 0}</TableCell>}
                {!isMobile && <TableCell>
                  {new Date(customer.createdAt).toLocaleDateString('de-DE')}
                </TableCell>}
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenDialog(customer);
                    }}
                  >
                    <Edit />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Customer Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            {editingCustomer ? 'Kunde bearbeiten' : 'Neuer Kunde'}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Controller
                  name="name"
                  control={control}
                  rules={{ required: 'Name ist erforderlich' }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Name"
                      error={!!errors.name}
                      helperText={errors.name?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="nickname"
                  control={control}
                  defaultValue=""
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Spitzname (optional)"
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="gender"
                  control={control}
                  defaultValue="OTHER"
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Geschlecht"
                      select
                      fullWidth
                    >
                      <MenuItem value="FEMALE">Weiblich</MenuItem>
                      <MenuItem value="MALE">Männlich</MenuItem>
                      <MenuItem value="OTHER">Andere/Nicht angegeben</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="active"
                  control={control}
                  defaultValue={true}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="Aktiv (im Verkauf anzeigen)"
                    />
                  )}
                />
              </Grid>

            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Abbrechen</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={customerMutation.isLoading}
            >
              {customerMutation.isLoading ? 'Speichere...' : 'Speichern'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Top Up Dialog */}
      <Dialog open={openTopUpDialog} onClose={handleCloseTopUpDialog}>
        <form onSubmit={handleTopUpSubmit(onTopUpSubmit)}>
          <DialogTitle>
            Guthaben aufladen: {selectedCustomer?.name}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Aktuelles Guthaben: {selectedCustomer && formatCurrency(selectedCustomer.balance)}
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="amount"
                  control={topUpControl}
                  rules={{
                    required: 'Betrag ist erforderlich',
                    min: { value: 0.01, message: 'Betrag muss größer als 0 sein' },
                    max: { value: 500, message: 'Maximalbetrag ist €500' }
                  }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Betrag"
                      type="number"
                      inputProps={{ step: 0.01, min: 0.01, max: 500 }}
                      error={!!errors.amount}
                      helperText={errors.amount?.message}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">€</InputAdornment>,
                      }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="method"
                  control={topUpControl}
                  defaultValue="CASH"
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Zahlungsart"
                      select
                    >
                      <MenuItem value="CASH">Bar</MenuItem>
                      <MenuItem value="TRANSFER">Überweisung</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="reference"
                  control={topUpControl}
                  defaultValue=""
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Referenz/Bemerkung (optional)"
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseTopUpDialog}>Abbrechen</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={topUpMutation.isLoading}
            >
              {topUpMutation.isLoading ? 'Verarbeite...' : 'Aufladen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Customer Detail Dialog */}
      <Dialog open={openDetailDialog} onClose={handleCloseDetailDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <Avatar sx={{ mr: 2, bgcolor: 'primary.main' }}>
                <Person />
              </Avatar>
              <Box>
                <Typography variant="h6">
                  {selectedCustomer?.name}
                </Typography>
                {selectedCustomer?.nickname && (
                  <Typography variant="body2" color="text.secondary">
                    "{selectedCustomer.nickname}"
                  </Typography>
                )}
              </Box>
            </Box>
            <Typography variant="h5" color="primary">
              {selectedCustomer && formatCurrency(selectedCustomer.balance)}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={3}>
            {/* Statistics */}
            {customerStats && (
              <Grid item xs={12}>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <Card>
                      <CardContent>
                        <Typography color="textSecondary" gutterBottom variant="body2">
                          Gesamtausgaben
                        </Typography>
                        <Typography variant="h6">
                          {formatCurrency(customerStats.totalSpent)}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Card>
                      <CardContent>
                        <Typography color="textSecondary" gutterBottom variant="body2">
                          Anzahl Käufe
                        </Typography>
                        <Typography variant="h6">
                          {customerStats.transactionCount}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Card>
                      <CardContent>
                        <Typography color="textSecondary" gutterBottom variant="body2">
                          Durchschnitt pro Kauf
                        </Typography>
                        <Typography variant="h6">
                          {customerStats.transactionCount > 0
                            ? formatCurrency(customerStats.totalSpent / customerStats.transactionCount)
                            : formatCurrency(0)
                          }
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </Grid>
            )}

            {/* Favorite Articles */}
            {customerStats?.favoriteArticles?.length > 0 && (
              <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>
                  <EmojiEvents sx={{ verticalAlign: 'middle', mr: 1 }} />
                  Lieblingsartikel
                </Typography>
                <List>
                  {customerStats.favoriteArticles.map((article, index) => (
                    <ListItem key={article.id} dense>
                      <ListItemText
                        primary={`${index + 1}. ${article.name}`}
                        secondary={`${article.total_quantity}x gekauft (${formatCurrency(article.total_spent)})`}
                      />
                    </ListItem>
                  ))}
                </List>
              </Grid>
            )}

            {/* Recent Transactions */}
            {customerDetails?.transactions?.length > 0 && (
              <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>
                  <Receipt sx={{ verticalAlign: 'middle', mr: 1 }} />
                  Letzte Transaktionen
                </Typography>
                <List>
                  {customerDetails.transactions.slice(0, 5).map((transaction) => (
                    <ListItem key={transaction.id} dense>
                      <ListItemText
                        primary={`${transaction.items.length} Artikel`}
                        secondary={new Date(transaction.createdAt).toLocaleString('de-DE')}
                      />
                      <Typography variant="body2" color={transaction.cancelled ? 'error' : 'primary'}>
                        {transaction.cancelled && 'STORNIERT '}
                        {formatCurrency(transaction.totalAmount)}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              </Grid>
            )}

            {/* Recent Top Ups */}
            {customerDetails?.accountTopUps?.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  <TrendingUp sx={{ verticalAlign: 'middle', mr: 1 }} />
                  Letzte Aufladungen
                </Typography>
                <List>
                  {customerDetails.accountTopUps.slice(0, 5).map((topUp) => (
                    <ListItem key={topUp.id} dense>
                      <ListItemText
                        primary={formatCurrency(topUp.amount)}
                        secondary={`${new Date(topUp.createdAt).toLocaleString('de-DE')} - ${topUp.method === 'CASH' ? 'Bar' : 'Überweisung'}`}
                      />
                      {topUp.reference && (
                        <Chip label={topUp.reference} size="small" />
                      )}
                    </ListItem>
                  ))}
                </List>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleOpenTopUpDialog(selectedCustomer)}>
            Guthaben aufladen
          </Button>
          <Button onClick={handleCloseDetailDialog}>Schließen</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Customers;
