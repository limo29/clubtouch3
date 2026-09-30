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
  Divider,
} from '@mui/material';
import {
  Add,
  Edit,
  Search,
  Person,
  Receipt,
  EmojiEvents,
  TrendingUp,
  AccountBalanceWallet,
  Warning,
  ContactMail,
  Groups,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import KPICard from '../components/common/KPICard';
import { invalidate } from '../utils/invalidate';
import { useAuth } from '../context/AuthContext';
import GroupBadge from '../components/customers/GroupBadge';
import GroupManagerDialog from '../components/customers/GroupManagerDialog';

const Customers = () => {
  const queryClient = useQueryClient();
  const { isAdmin, isAccountant } = useAuth();
  const canSeeContact = isAdmin || isAccountant;
  const [openDialog, setOpenDialog] = useState(false);
  const [openTopUpDialog, setOpenTopUpDialog] = useState(false);
  const [openDetailDialog, setOpenDetailDialog] = useState(false);
  const [openGroupManager, setOpenGroupManager] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const { control, handleSubmit, reset, formState: { errors } } = useForm();
  const { control: topUpControl, handleSubmit: handleTopUpSubmit, reset: resetTopUp } = useForm();

  // Gruppen laden (für Filter und Formular-Dropdown)
  const { data: groupsData } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.CUSTOMER_GROUPS);
      return res.data;
    },
  });
  const groups = groupsData?.groups || [];

  // Fetch customers
  const { data: customersData } = useQuery({
    queryKey: ['customers', searchTerm, groupFilter],
    queryFn: async () => {
      const params = {};
      if (searchTerm) params.search = searchTerm;
      if (groupFilter) params.groupId = groupFilter;
      const response = await api.get(API_ENDPOINTS.CUSTOMERS, { params });
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
      const payload = {
        ...data,
        groupId: data.groupId || null,
        isGroupAccount: !!data.isGroupAccount,
      };
      if (editingCustomer) {
        const response = await api.put(`${API_ENDPOINTS.CUSTOMERS}/${editingCustomer.id}`, payload);
        return response.data;
      } else {
        const response = await api.post(API_ENDPOINTS.CUSTOMERS, payload);
        return response.data;
      }
    },
    onSuccess: () => {
      invalidate(queryClient, 'customers', 'finance');
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
      invalidate(queryClient, 'customers', 'finance');
    }
  });

  // Top up mutation
  const topUpMutation = useMutation({
    mutationFn: async ({ customerId, ...data }) => {
      const response = await api.post(`${API_ENDPOINTS.CUSTOMERS}/${customerId}/topup`, data);
      return response.data;
    },
    onSuccess: () => {
      invalidate(queryClient, 'customers', 'finance');
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
        gender: customer.gender || 'OTHER',
        active: customer.active !== false,
        groupId: customer.groupId || '',
        isGroupAccount: !!customer.isGroupAccount,
        company: customer.company || '',
        street: customer.street || '',
        zip: customer.zip || '',
        city: customer.city || '',
        phone: customer.phone || '',
        email: customer.email || '',
      });
    } else {
      reset({
        name: '',
        nickname: '',
        gender: 'OTHER',
        active: true,
        groupId: '',
        isGroupAccount: false,
        company: '',
        street: '',
        zip: '',
        city: '',
        phone: '',
        email: '',
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

      {/* Statistics Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }} alignItems="stretch">
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard
            title="Kunden gesamt"
            value={customers.length}
            icon={Person}
            color="primary"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard
            title="Gesamtguthaben"
            value={formatCurrency(customers.reduce((sum, c) => sum + parseFloat(c.balance), 0))}
            icon={AccountBalanceWallet}
            color="success"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard
            title="Ø Guthaben"
            value={customers.length > 0
              ? formatCurrency(customers.reduce((sum, c) => sum + parseFloat(c.balance), 0) / customers.length)
              : formatCurrency(0)
            }
            icon={TrendingUp}
            color="info"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KPICard
            title="Niedriges Guthaben"
            value={lowBalanceData?.count || 0}
            icon={Warning}
            color="warning"
            subTitle={lowBalanceData?.count > 0 ? "Handlungsbedarf" : "Alles OK"}
          />
        </Grid>
      </Grid>

      {/* Actions Bar */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size="grow">
            <TextField
              placeholder="Kunde suchen..."
              variant="outlined"
              size="small"
              fullWidth
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
          {groups.length > 0 && (
            <Grid size={{ xs: 12, sm: 'auto' }}>
              <TextField
                select
                label="Gruppe"
                size="small"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="">Alle Gruppen</MenuItem>
                {groups.map((g) => (
                  <MenuItem key={g.id} value={g.id}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <GroupBadge group={g} size={20} tooltip={false} />
                      {g.name}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          )}
          <Grid>
            <Button
              variant="outlined"
              startIcon={<Groups />}
              onClick={() => setOpenGroupManager(true)}
            >
              Gruppen
            </Button>
          </Grid>
          <Grid>
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
                    {customer.group && (
                      <Box sx={{ mr: 1, flexShrink: 0 }}>
                        <GroupBadge group={customer.group} size={28} />
                      </Box>
                    )}
                    <Avatar sx={{ mr: 2, bgcolor: 'primary.main', flexShrink: 0 }}>
                      <Person />
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                        <Typography variant="body2" fontWeight="bold" noWrap>
                          {customer.name}
                        </Typography>
                        {customer.isGroupAccount && (
                          <Chip
                            label="Gruppenkonto"
                            size="small"
                            sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }}
                          />
                        )}
                      </Box>
                      {isMobile && customer.nickname && (
                        <Typography variant="caption" display="block" color="text.secondary" noWrap>
                          {customer.nickname}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ ml: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
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
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="name"
                  control={control}
                  rules={{ required: 'Name ist erforderlich' }}
                  render={({ field }) => (
                    <TextField
                      fullWidth
                      {...field}
                      label="Name"
                      error={!!errors.name}
                      helperText={errors.name?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="nickname"
                  control={control}
                  defaultValue=""
                  render={({ field }) => (
                    <TextField
                      fullWidth
                      {...field}
                      label="Spitzname (optional)"
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
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
              <Grid size={{ xs: 12 }}>
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

              {/* Gruppe */}
              <Grid size={{ xs: 12 }}>
                <Divider><Typography variant="caption" color="text.secondary">Team / Gruppe (optional)</Typography></Divider>
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="groupId"
                  control={control}
                  defaultValue=""
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Gruppe"
                      select
                      fullWidth
                    >
                      <MenuItem value="">– keine –</MenuItem>
                      {groups.map((g) => (
                        <MenuItem key={g.id} value={g.id}>
                          <Box display="flex" alignItems="center" gap={1}>
                            <GroupBadge group={g} size={20} tooltip={false} />
                            {g.name}
                          </Box>
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="isGroupAccount"
                  control={control}
                  defaultValue={false}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                      label="Gruppenkonto (mehrere buchen auf dieses Konto)"
                    />
                  )}
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -0.5 }}>
                  Zählt in der Team-Wertung, aber nicht als Kopf bei „pro Kopf"
                </Typography>
              </Grid>

              {canSeeContact && (
                <>
                  <Grid size={{ xs: 12 }}>
                    <Divider><Typography variant="caption" color="text.secondary">Kontaktdaten (optional)</Typography></Divider>
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <Controller
                      name="company"
                      control={control}
                      defaultValue=""
                      render={({ field }) => (
                        <TextField fullWidth {...field} label="Firma / Anschriftzusatz" />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <Controller
                      name="street"
                      control={control}
                      defaultValue=""
                      render={({ field }) => (
                        <TextField fullWidth {...field} label="Straße" />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Controller
                      name="zip"
                      control={control}
                      defaultValue=""
                      render={({ field }) => (
                        <TextField fullWidth {...field} label="PLZ" />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 8 }}>
                    <Controller
                      name="city"
                      control={control}
                      defaultValue=""
                      render={({ field }) => (
                        <TextField fullWidth {...field} label="Ort" />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Controller
                      name="phone"
                      control={control}
                      defaultValue=""
                      render={({ field }) => (
                        <TextField fullWidth {...field} label="Telefon" type="tel" />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Controller
                      name="email"
                      control={control}
                      defaultValue=""
                      render={({ field }) => (
                        <TextField fullWidth {...field} label="E-Mail" type="email" />
                      )}
                    />
                  </Grid>
                </>
              )}

            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Abbrechen</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={customerMutation.isPending}
            >
              {customerMutation.isPending ? 'Speichere...' : 'Speichern'}
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
              <Grid size={{ xs: 12 }}>
                <Typography variant="body2" color="text.secondary">
                  Aktuelles Guthaben: {selectedCustomer && formatCurrency(selectedCustomer.balance)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12 }}>
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
                      fullWidth
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
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="method"
                  control={topUpControl}
                  defaultValue="CASH"
                  render={({ field }) => (
                    <TextField
                      fullWidth
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
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="reference"
                  control={topUpControl}
                  defaultValue=""
                  render={({ field }) => (
                    <TextField
                      fullWidth
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
              disabled={topUpMutation.isPending}
            >
              {topUpMutation.isPending ? 'Verarbeite...' : 'Aufladen'}
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
              <Grid size={{ xs: 12 }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 4 }}>
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
                  <Grid size={{ xs: 12, sm: 4 }}>
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
                  <Grid size={{ xs: 12, sm: 4 }}>
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
              <Grid size={{ xs: 12, md: 6 }}>
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
              <Grid size={{ xs: 12, md: 6 }}>
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
              <Grid size={{ xs: 12 }}>
                <Typography variant="h6" gutterBottom>
                  <TrendingUp sx={{ verticalAlign: 'middle', mr: 1 }} />
                  Letzte Aufladungen
                </Typography>
                <List>
                  {customerDetails.accountTopUps.slice(0, 5).map((topUp) => (
                    <ListItem key={topUp.id} dense>
                      <ListItemText
                        primary={formatCurrency(topUp.amount)}
                        secondary={`${new Date(topUp.createdAt).toLocaleString('de-DE')} - ${topUp.method === 'CASH' ? 'Bar' : topUp.method === 'REIMBURSEMENT' ? 'Auslage (Einkauf)' : 'Überweisung'}`}
                      />
                      {topUp.reference && (
                        <Chip label={topUp.reference} size="small" />
                      )}
                    </ListItem>
                  ))}
                </List>
              </Grid>
            )}
          {canSeeContact && customerDetails && (customerDetails.company || customerDetails.street || customerDetails.zip || customerDetails.city || customerDetails.phone || customerDetails.email) && (
              <Grid size={{ xs: 12 }}>
                <Divider sx={{ mb: 1 }} />
                <Typography variant="h6" gutterBottom>
                  <ContactMail sx={{ verticalAlign: 'middle', mr: 1 }} />
                  Kontaktdaten
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {(customerDetails.company || customerDetails.street || customerDetails.zip || customerDetails.city) && (
                    <Box>
                      {customerDetails.company && <Typography variant="body2">{customerDetails.company}</Typography>}
                      {customerDetails.street && <Typography variant="body2">{customerDetails.street}</Typography>}
                      {(customerDetails.zip || customerDetails.city) && (
                        <Typography variant="body2">{[customerDetails.zip, customerDetails.city].filter(Boolean).join(' ')}</Typography>
                      )}
                    </Box>
                  )}
                  {customerDetails.phone && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Telefon</Typography>
                      <Typography variant="body2">{customerDetails.phone}</Typography>
                    </Box>
                  )}
                  {customerDetails.email && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">E-Mail</Typography>
                      <Typography variant="body2">{customerDetails.email}</Typography>
                    </Box>
                  )}
                </Box>
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
      {/* Gruppen-Manager */}
      <GroupManagerDialog
        open={openGroupManager}
        onClose={() => setOpenGroupManager(false)}
      />
    </Box>
  );
};

export default Customers;
