// src/pages/Sales.jsx
import React, { useMemo, useState } from 'react';
import {
  Box, Grid, Card, CardContent, TextField, InputAdornment, Tabs, Tab, Typography,
  Avatar, Stack, IconButton, List, ListItem, ListItemText, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, MenuItem, Chip, useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Search, Female, Male, Person, ShoppingCart, AttachMoney,
  History, AccountBalanceWallet
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

/* ---------------- Helpers ---------------- */
const num = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const x = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(x) ? 0 : x;
};
const money = (v) => `€${num(v).toFixed(2)}`;
const withinHours = (date, h) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() <= h * 60 * 60 * 1000;
};

const Sales = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const queryClient = useQueryClient();

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [articleSearch, setArticleSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState([]);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpMethod, setTopUpMethod] = useState('CASH');

  const [showMoreGirls, setShowMoreGirls] = useState(false);
  const [showMoreBoys, setShowMoreBoys] = useState(false);
  const MOBILE_LIMIT = 12; // pro Geschlecht

  /* ---------------- Daten laden ---------------- */
  const { data: customersData = { customers: [] } } = useQuery({
    queryKey: ['customers-sales'],
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.CUSTOMERS);
      const customers = Array.isArray(res.data?.customers) ? res.data.customers : [];
      return {
        customers: customers.map(c => ({
          ...c,
          balance: num(c.balance),
          lastActivity: c.lastActivity || c.updatedAt || c.createdAt,
          isRecent: withinHours(c.lastActivity || c.updatedAt || c.createdAt, 24)
        }))
      };
    }
  });

  // WICHTIG: eigener Key + Normalisierung
  const { data: articlesRaw } = useQuery({
    queryKey: ['articles', 'sales'],
    queryFn: async () => (await api.get(API_ENDPOINTS.ARTICLES)).data
  });

  const articles = useMemo(() => {
    const raw = Array.isArray(articlesRaw)
      ? articlesRaw
      : (articlesRaw?.articles ?? []);
    return (raw || [])
      .filter(a => a?.active)
      .map(a => ({
        ...a,
        price: num(a.price),
        unitsPerPurchase: num(a.unitsPerPurchase),
        purchaseUnit: a.purchaseUnit || null,
        unit: a.unit || 'Stück',
      }));
  }, [articlesRaw]);

  /* ---------------- Mutations ---------------- */
  const topUpMutation = useMutation({
    mutationFn: async (data) =>
      api.post(`/customers/${data.customerId}/topup`, {
        amount: num(data.amount),
        method: data.method,
        reference: data.reference
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(['customers-sales']);
      setShowTopUp(false);
      setTopUpAmount('');
    }
  });

  const quickSaleMutation = useMutation({
    mutationFn: async (data) => api.post(API_ENDPOINTS.TRANSACTIONS, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customers-sales']);
      queryClient.invalidateQueries(['articles', 'sales']);
      setCart([]);
    }
  });

  /* ---------------- Logik ---------------- */
  const handleCashSale = () => {
    if (!cart.length) return;
    quickSaleMutation.mutate({
      paymentMethod: 'CASH',
      items: cart.map(i => ({ articleId: i.id, quantity: i.quantity }))
    });
  };

  const handleQuickSale = (customer) => {
    if (!cart.length) return;
    quickSaleMutation.mutate({
      paymentMethod: 'ACCOUNT',
      customerId: customer.id,
      items: cart.map(i => ({ articleId: i.id, quantity: i.quantity }))
    });
  };

  const filteredCustomers = useMemo(() => {
    const s = customerSearch.toLowerCase();
    const matches = customersData.customers.filter(c =>
      c.name.toLowerCase().includes(s) ||
      (c.nickname && c.nickname.toLowerCase().includes(s))
    );
    return matches.sort((a, b) => {
      if (a.isRecent !== b.isRecent) return a.isRecent ? -1 : 1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });
  }, [customersData.customers, customerSearch]);

  const girls = filteredCustomers.filter(c => c.gender === 'FEMALE');
  const boys  = filteredCustomers.filter(c => c.gender === 'MALE');
  const other = filteredCustomers.filter(c => !c.gender || c.gender === 'OTHER');

  const categories = useMemo(
    () => ['all', ...new Set((articles || []).map(a => a.category).filter(Boolean))],
    [articles]
  );

  const filteredArticles = (articles || []).filter(a =>
    (selectedCategory === 'all' || a.category === selectedCategory) &&
    a.name.toLowerCase().includes(articleSearch.toLowerCase())
  );

  // +1 Stück oder +1 Kiste
  const addToCart = (a, opts = {}) => {
    const isCrate = !!opts.crate && a.unitsPerPurchase > 1;
    const addQty = isCrate ? a.unitsPerPurchase : 1;

    const exists = cart.find(i => i.id === a.id);
    exists
      ? setCart(cart.map(i => i.id === a.id ? { ...i, quantity: num(i.quantity) + addQty } : i))
      : setCart([...cart, { ...a, quantity: addQty }]);
  };

  const updateQty = (id, qty) =>
    qty <= 0
      ? setCart(cart.filter(i => i.id !== id))
      : setCart(cart.map(i => (i.id === id ? { ...i, quantity: qty } : i)));

  const total = cart.reduce((s, i) => s + num(i.price) * num(i.quantity), 0);

  /* ---------------- UI Bausteine ---------------- */
  const GenderHeader = ({ icon, label, count }) => (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      {icon}
      <Typography variant="subtitle2">{label} ({count})</Typography>
    </Stack>
  );

  const CustomerCard = ({ customer }) => (
    <Card
      onClick={() => setSelectedCustomer(customer)}
      sx={{
        p: 1,
        border: selectedCustomer?.id === customer.id ? '2px solid #1976d2' : '1px solid #e0e0e0',
        cursor: 'pointer',
        '&:hover': { boxShadow: 3 },
        backgroundColor: customer.isRecent ? 'rgba(76, 175, 80, 0.08)' : 'background.paper',
        maxWidth: '100%'
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <Avatar
            sx={{
              bgcolor: customer.gender === 'FEMALE' ? 'pink.main' : customer.gender === 'MALE' ? 'blue.main' : 'grey.500',
              flexShrink: 0
            }}
          >
            {customer.gender === 'FEMALE' ? <Female /> : customer.gender === 'MALE' ? <Male /> : <Person />}
          </Avatar>

          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {customer.nickname || customer.name}
            </Typography>
            {customer.nickname && (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {customer.name}
              </Typography>
            )}
            {customer.isRecent && (
              <Chip size="small" color="success" label="aktiv (24h)" sx={{ mt: 0.5, maxWidth: '100%', overflow: 'hidden' }} />
            )}
          </Box>
        </Stack>

        <Typography
          fontWeight={700}
          color={customer.balance < 5 ? 'error' : 'primary'}
          sx={{ flexShrink: 0, pl: 1, whiteSpace: 'nowrap' }}
        >
          €{customer.balance.toFixed(2)}
        </Typography>
      </Stack>

      {selectedCustomer?.id === customer.id && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setShowTopUp(true); }}>
            <AccountBalanceWallet />
          </IconButton>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); /* Verlauf */ }}>
            <History />
          </IconButton>
        </Stack>
      )}
    </Card>
  );

  const renderGenderList = (list, gender) => {
    const limit = isMobile && !((gender === 'FEMALE' && showMoreGirls) || (gender === 'MALE' && showMoreBoys))
      ? list.slice(0, MOBILE_LIMIT)
      : list;

    return (
      <>
        <Stack spacing={1}>
          {limit.map(c => <CustomerCard key={c.id} customer={c} />)}
        </Stack>
        {isMobile && list.length > MOBILE_LIMIT && (
          <Button
            sx={{ mt: 1 }}
            fullWidth
            size="small"
            variant="outlined"
            onClick={() => gender === 'FEMALE' ? setShowMoreGirls(v => !v) : setShowMoreBoys(v => !v)}
          >
            {((gender === 'FEMALE' && showMoreGirls) || (gender === 'MALE' && showMoreBoys))
              ? 'Weniger anzeigen' : 'Mehr anzeigen'}
          </Button>
        )}
      </>
    );
  };

  /* ---------------- Render ---------------- */
  return (
    <Box sx={{ pb: 2 }}>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: '380px 1fr 380px' }
        }}
      >
        {/* Kunden (links) */}
        <Card sx={{ position: { md: 'sticky' }, top: 88, height: { md: 'calc(100vh - 120px)' }, overflow: 'hidden' }}>
          <CardContent sx={{ pb: 1 }}>
            <TextField
              placeholder="Kunde suchen…"
              size="small"
              fullWidth
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
            />
          </CardContent>

          <Box sx={{ p: 2, pt: 0, overflowY: 'auto', height: { md: '100%' } }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6} sx={{ minWidth: 0 }}>
                <GenderHeader icon={<Female sx={{ color: 'pink.main' }} />} label="Mädels" count={girls.length} />
                {renderGenderList(girls, 'FEMALE')}
              </Grid>
              <Grid item xs={12} md={6} sx={{ minWidth: 0 }}>
                <GenderHeader icon={<Male sx={{ color: 'blue.main' }} />} label="Jungs" count={boys.length} />
                {renderGenderList(boys, 'MALE')}
              </Grid>

              {other.length > 0 && (
                <Grid item xs={12} sx={{ minWidth: 0 }}>
                  <GenderHeader icon={<Person />} label="Andere" count={other.length} />
                  <Stack spacing={1}>
                    {other.map(c => <CustomerCard key={c.id} customer={c} />)}
                  </Stack>
                </Grid>
              )}
            </Grid>
          </Box>
        </Card>

        {/* Artikel (Mitte) */}
        <Card sx={{ position: { md: 'sticky' }, top: 88, height: { md: 'calc(100vh - 120px)' }, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <TextField
              placeholder="Artikel suchen…"
              size="small"
              fullWidth
              value={articleSearch}
              onChange={e => setArticleSearch(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
            />
            <Tabs
              value={selectedCategory}
              onChange={(e, v) => setSelectedCategory(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ mt: 1 }}
            >
              {categories.map(c => <Tab key={c} value={c} label={c === 'all' ? 'Alle' : c} />)}
            </Tabs>
          </Box>

          <Box sx={{ p: 2, overflowY: 'auto' }}>
            <Grid container spacing={1.5}>
              {(filteredArticles || []).map(a => (
                <Grid item xs={6} sm={4} md={3} lg={2} key={a.id}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { transform: 'scale(1.03)' },
                      transition: 'transform .15s'
                    }}
                    onClick={() => addToCart(a)}
                  >
                    {a.imageMedium && (
                      <Box
                        component="img"
                        src={a.imageMedium}
                        alt={a.name}
                        loading="lazy"
                        sx={{ width: '100%', height: 140, objectFit: 'cover' }}
                      />
                    )}
                    <CardContent sx={{ p: 1.25 }}>
                      <Typography noWrap fontSize={14} fontWeight={600}>{a.name}</Typography>
                      <Typography fontWeight={800} color="primary" fontSize={16}>
                        {money(a.price)}
                      </Typography>
                      {num(a.stock) <= num(a.minStock) && (
                        <Chip size="small" color="warning" label="Niedrig" sx={{ mt: 0.5 }} />
                      )}
                      {Number(a.stock) <= 0 && (
                        <Chip size="small" color="error" label="Bestand ≤ 0" sx={{ mt: 0.5 }} />
                       )}

                      {a.purchaseUnit && a.unitsPerPurchase > 1 && (
                        <Button
                          size="small"
                          variant="outlined"
                          sx={{ mt: 0.75 }}
                          onClick={(e) => { e.stopPropagation(); addToCart(a, { crate: true }); }}
                        >
                          +1 {a.purchaseUnit} (×{a.unitsPerPurchase})
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Card>

        {/* Warenkorb (rechts) */}
        <Card sx={{ position: { md: 'sticky' }, top: 88, height: { md: 'calc(100vh - 120px)' }, display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ flex: 1, overflowY: 'auto' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              <ShoppingCart sx={{ verticalAlign: 'middle', mr: 1 }} />
              Warenkorb
            </Typography>

            {!cart.length && (
              <Typography sx={{ textAlign: 'center', mt: 3, color: 'text.secondary' }}>
                Warenkorb ist leer
              </Typography>
            )}

            <List dense sx={{ '& .MuiListItem-root': { py: 1.25 } }}>
              {cart.map(i => (
                <ListItem
                  key={i.id}
                  secondaryAction={
                    <Stack direction="row" spacing={1}>
                      <IconButton
                        onClick={() => updateQty(i.id, num(i.quantity) - 1)}
                        sx={{
                          bgcolor: 'grey.200',
                          width: 40, height: 40, borderRadius: '50%',
                          '&:hover': { bgcolor: 'grey.300' }
                        }}
                      >
                        –
                      </IconButton>
                      <IconButton
                        onClick={() => updateQty(i.id, num(i.quantity) + 1)}
                        sx={{
                          bgcolor: 'primary.main', color: '#fff',
                          width: 40, height: 40, borderRadius: '50%',
                          '&:hover': { bgcolor: 'primary.dark' }
                        }}
                      >
                        +
                      </IconButton>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={<Typography fontSize={15} fontWeight={600}>{i.name}</Typography>}
                    secondary={
                      <Stack spacing={0.5}>
                        <Typography fontSize={14}>{num(i.quantity)} × {money(i.price)}</Typography>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                          <Button size="small" variant="outlined" onClick={() => updateQty(i.id, num(i.quantity) + 1)}>
                            +1 {i.unit || 'Stück'}
                          </Button>
                          {i.purchaseUnit && i.unitsPerPurchase > 1 && (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => updateQty(i.id, num(i.quantity) + num(i.unitsPerPurchase))}
                            >
                              +1 {i.purchaseUnit} (×{i.unitsPerPurchase})
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </CardContent>

          {cart.length > 0 && (
            <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', background: 'background.paper' }}>
              <Typography variant="h5" align="right" gutterBottom sx={{ fontWeight: 800 }}>
                Gesamt: {money(total)}
              </Typography>

              <Button
                fullWidth
                size="large"
                sx={{ py: 1.2 }}
                variant="contained"
                color="success"
                onClick={handleCashSale}
                startIcon={<AttachMoney />}
              >
                Bar bezahlen
              </Button>

              {selectedCustomer && (
                <Button
                  fullWidth
                  size="large"
                  sx={{ mt: 1, py: 1.2 }}
                  variant="contained"
                  disabled={num(selectedCustomer.balance) < num(total)}
                  onClick={() => handleQuickSale(selectedCustomer)}
                >
                  Auf {selectedCustomer.nickname || selectedCustomer.name} buchen
                </Button>
              )}
            </Box>
          )}
        </Card>
      </Box>

      {/* TopUp Modal */}
      <Dialog open={showTopUp} onClose={() => setShowTopUp(false)}>
        <DialogTitle>Guthaben aufladen – {selectedCustomer?.nickname || selectedCustomer?.name}</DialogTitle>
        <DialogContent>
          <TextField
            label="Betrag"
            type="number"
            value={topUpAmount}
            onChange={e => setTopUpAmount(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start">€</InputAdornment> }}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
            {[5, 10, 20, 50].map(v => (
              <Button key={v} variant="outlined" onClick={() => setTopUpAmount(String(v))}>
                💶 {v}
              </Button>
            ))}
          </Stack>
          <TextField
            select
            label="Zahlungsart"
            value={topUpMethod}
            onChange={e => setTopUpMethod(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
          >
            <MenuItem value="CASH">Bar</MenuItem>
            <MenuItem value="TRANSFER">Überweisung</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowTopUp(false)}>Abbrechen</Button>
          <Button
            variant="contained"
            disabled={!topUpAmount || num(topUpAmount) <= 0}
            onClick={() => topUpMutation.mutate({
              customerId: selectedCustomer.id,
              amount: num(topUpAmount),
              method: topUpMethod
            })}
          >
            Aufladen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Sales;
