import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Box, Grid, Card, CardContent, TextField, InputAdornment, Tabs, Tab, Typography,
  Avatar, Stack, IconButton, List, ListItem, ListItemText, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, MenuItem, Chip, useMediaQuery, Divider, Collapse,
  Snackbar, Alert
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Search, Female, Male, Person, ShoppingCart, AttachMoney,
  History, AccountBalanceWallet, LocalBar, Remove, DeleteOutline, Add,
  CreditCard, Savings, Close, TrendingUp, TrendingDown, RestoreFromTrash
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { useOffline } from '../context/OfflineContext';

/* Helpers */
const num = (v) => { if (v === null || v === undefined) return 0; if (typeof v === 'number') return v; const x = parseFloat(String(v).replace(',', '.')); return Number.isNaN(x) ? 0 : x; };
const money = (v) => `€${num(v).toFixed(2)}`;
const withinHours = (date, h) => { const d = new Date(date); if (Number.isNaN(d.getTime())) return false; return Date.now() - d.getTime() <= h * 60 * 60 * 1000; };
const isToday = (d) => { const date = new Date(d); const today = new Date(); return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(); };

/* Change Calculator */
function ChangeCalculator({ total, open, onClose, autoHideMs = 20000 }) {
  const [cash, setCash] = useState('');
  const [lastTs, setLastTs] = useState(Date.now());
  const timerRef = useRef(null);
  const received = num(cash);
  const change = Math.max(0, received - num(total));
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const idle = Date.now() - lastTs;
      if (idle >= autoHideMs) onClose?.();
      else timerRef.current = setTimeout(tick, 1000);
    };
    timerRef.current = setTimeout(tick, 1000);
    return () => clearTimeout(timerRef.current);
  }, [open, lastTs, autoHideMs, onClose]);
  const poke = () => setLastTs(Date.now());
  const quicks = [5, 10, 20, 50, 100].map(v => ({ val: v, label: `€${v}` }));
  return (
    <Collapse in={open}>
      <Box sx={{ mt: 1.5, p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }} onMouseMove={poke} onKeyDown={poke}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
          <TextField label="Gegeben (bar)" value={cash} onChange={(e) => { setCash(e.target.value); poke(); }} inputMode="decimal" fullWidth size="small" InputProps={{ startAdornment: <InputAdornment position="start">€</InputAdornment> }} />
          <Typography variant="h6" sx={{ minWidth: 160, textAlign: { xs: 'left', sm: 'right' }, fontWeight: 800 }}>
            Wechselgeld: {money(change)}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {quicks.map(q => (<Button key={q.val} size="small" variant="outlined" onClick={() => { setCash(String(q.val)); poke(); }}>{q.label}</Button>))}
          <Button size="small" onClick={onClose} sx={{ ml: 'auto' }}>Ausblenden</Button>
        </Stack>
      </Box>
    </Collapse>
  );
}

const Sales = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const queryClient = useQueryClient();

  // Booking Target State: 'CASH', 'OWNER', 'CUSTOMER'
  const [bookingTarget, setBookingTarget] = useState({ type: 'CASH' });

  // Mobile Tab State
  const [mobileTab, setMobileTab] = useState(1); // Default to Products on mobile

  const [overdraftDialog, setOverdraftDialog] = useState({ open: false, type: 'WARNING', balance: 0, newBalance: 0, amount: 0, limit: 10 });

  const [customerSearch, setCustomerSearch] = useState('');
  const [articleSearch, setArticleSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState([]);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpMethod, setTopUpMethod] = useState('CASH');
  const [showChangeCalc, setShowChangeCalc] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyCustomer, setHistoryCustomer] = useState(null);

  // Feedback Snackbar
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const showFeedback = (message, severity = 'success') => setSnackbar({ open: true, message, severity });
  const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));

  /* Data Fetching */
  const { data: customersData = { customers: [] } } = useQuery({
    queryKey: ['customers-sales'],
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.CUSTOMERS);
      const customers = Array.isArray(res.data?.customers) ? res.data.customers : [];
      return { customers: customers.map(c => ({ ...c, balance: num(c.balance), lastActivity: c.lastActivity || c.updatedAt || c.createdAt, isRecent: withinHours(c.lastActivity || c.updatedAt || c.createdAt, 24) })) };
    }
  });

  const { data: articlesRaw } = useQuery({
    queryKey: ['articles', 'sales'],
    queryFn: async () => (await api.get(API_ENDPOINTS.ARTICLES)).data
  });

  // Keep target selection in sync if customer updates (e.g. balance change)
  useEffect(() => {
    if (bookingTarget.type === 'CUSTOMER' && bookingTarget.data?.id && customersData?.customers) {
      const updated = customersData.customers.find(c => c.id === bookingTarget.data.id);
      if (updated) setBookingTarget(prev => ({ ...prev, data: updated }));
    }
  }, [customersData, bookingTarget.data?.id, bookingTarget.type]);

  const articles = useMemo(() => {
    const raw = Array.isArray(articlesRaw) ? articlesRaw : (articlesRaw?.articles ?? []);
    return (raw || [])
      .filter(a => a?.active)
      .map(a => ({ ...a, price: num(a.price), unit: a.unit || 'Stück', stock: num(a.stock), minStock: num(a.minStock) }));
  }, [articlesRaw]);

  // History Query
  const { data: historyData, refetch: refetchHistory, isFetching: historyLoading } = useQuery({
    queryKey: ['customer-history', historyCustomer?.id],
    enabled: !!historyCustomer?.id,
    queryFn: async () => {
      const res = await api.get(`/customers/${historyCustomer.id}/history`, { params: { limit: 50 } });
      return Array.isArray(res.data) ? res.data : [];
    }
  });

  /* Mutations */
  const cancelTransactionMutation = useMutation({
    mutationFn: async (id) => api.post(`/transactions/${id}/cancel`),
    onSuccess: () => { queryClient.invalidateQueries(['customers-sales']); refetchHistory(); }
  });

  const cancelTopUpMutation = useMutation({
    mutationFn: async (topUpId) => api.post(`/customers/${historyCustomer.id}/topup/${topUpId}/cancel`),
    onSuccess: () => { queryClient.invalidateQueries(['customers-sales']); refetchHistory(); }
  });

  const topUpMutation = useMutation({
    mutationFn: async (data) => api.post(`/customers/${data.customerId}/topup`, { amount: num(data.amount), method: data.method, reference: data.reference }),
    onSuccess: () => { queryClient.invalidateQueries(['customers-sales']); setShowTopUp(false); setTopUpAmount(''); }
  });

  const quickSaleMutation = useMutation({
    mutationFn: async (data) => api.post(API_ENDPOINTS.TRANSACTIONS, data),
    onSuccess: () => { queryClient.invalidateQueries(['customers-sales']); queryClient.invalidateQueries(['articles', 'sales']); setCart([]); setShowChangeCalc(false); }
  });

  /* Logic & Actions */
  const { isOnline, addTransaction } = useOffline();

  const handleBooking = () => {
    if (!cart.length) return;
    const items = cart.map(i => ({ articleId: i.id, quantity: i.quantity }));

    // Offline Handling
    // Offline Handling
    if (!isOnline) {
      if (bookingTarget.type === 'CASH') {
        addTransaction({ paymentMethod: 'CASH', items });
        setCart([]);
        showFeedback('Offline: Buchung wurde gespeichert', 'info');
      } else if (bookingTarget.type === 'CUSTOMER' && bookingTarget.data) {
        addTransaction({ paymentMethod: 'ACCOUNT', customerId: bookingTarget.data.id, items });

        // Optimistic Update
        queryClient.setQueryData(['customers-sales'], (old) => {
          if (!old || !old.customers) return old;
          return {
            ...old,
            customers: old.customers.map(c =>
              c.id === bookingTarget.data.id
                ? { ...c, balance: c.balance - total, lastActivity: new Date().toISOString() }
                : c
            )
          };
        });

        setCart([]);
        showFeedback(`Offline: Buchung für ${bookingTarget.data.nickname || bookingTarget.data.name} gespeichert`, 'info');
      } else if (bookingTarget.type === 'OWNER') {
        addTransaction({ type: 'OWNER_USE', paymentMethod: 'CASH', customerId: null, items });
        setCart([]);
        showFeedback('Offline: Wirt-Buchung gespeichert', 'info');
      }
      return;
    }

    if (bookingTarget.type === 'CASH') {
      quickSaleMutation.mutate({ paymentMethod: 'CASH', items });
    } else if (bookingTarget.type === 'CUSTOMER' && bookingTarget.data) {
      const allowedOverdraft = 10.0;
      const currentBalance = bookingTarget.data.balance;
      const amount = total;
      const newBalance = currentBalance - amount;

      if (newBalance < -allowedOverdraft) {
        setOverdraftDialog({
          open: true,
          type: 'BLOCK',
          balance: currentBalance,
          newBalance: newBalance,
          amount: amount,
          limit: allowedOverdraft
        });
        return;
      }

      if (newBalance < 0) {
        setOverdraftDialog({
          open: true,
          type: 'WARNING',
          balance: currentBalance,
          newBalance: newBalance,
          amount: amount,
          limit: allowedOverdraft,
          onConfirm: () => {
            quickSaleMutation.mutate({ paymentMethod: 'ACCOUNT', customerId: bookingTarget.data.id, items });
            setOverdraftDialog(prev => ({ ...prev, open: false }));
          }
        });
        return;
      }
      quickSaleMutation.mutate({ paymentMethod: 'ACCOUNT', customerId: bookingTarget.data.id, items });
    } else if (bookingTarget.type === 'OWNER') {
      if (window.confirm('Wirklich "Auf den Wirt" buchen?')) {
        quickSaleMutation.mutate({ type: 'OWNER_USE', paymentMethod: 'CASH', customerId: null, items });
      }
    }
  };

  const addToCart = (a) => {
    const exists = cart.find(i => i.id === a.id);
    exists ? setCart(cart.map(i => i.id === a.id ? { ...i, quantity: num(i.quantity) + 1 } : i)) : setCart([...cart, { ...a, quantity: 1 }]);
  };

  const updateQty = (id, delta) => {
    setCart(prev => prev.map(i => {
      if (i.id !== id) return i;
      const newQty = Math.max(0, num(i.quantity) + delta);
      return { ...i, quantity: newQty };
    }).filter(i => i.quantity > 0));
  };

  const total = cart.reduce((s, i) => s + num(i.price) * num(i.quantity), 0);

  // Targets
  const setTargetCash = () => { setBookingTarget({ type: 'CASH' }); if (isMobile) setMobileTab(2); };
  const setTargetOwner = () => { setBookingTarget({ type: 'OWNER' }); if (isMobile) setMobileTab(2); };
  const setTargetCustomer = (c) => { setBookingTarget({ type: 'CUSTOMER', data: c }); if (isMobile) setMobileTab(1); };

  const isTargetSelected = (type, id) => {
    if (bookingTarget.type !== type) return false;
    if (type === 'CUSTOMER') return bookingTarget.data?.id === id;
    return true;
  };

  const handleOpenHistory = async (customer) => { setHistoryCustomer(customer); setShowHistory(true); await refetchHistory(); };

  // Filtered Data
  // Filtered Data
  const filteredCustomers = useMemo(() => {
    const s = customerSearch.toLowerCase();

    // 1. Alle Kunden, die zur Suche passen
    const matches = customersData.customers.filter(c =>
      c.active !== false && ( // Nur aktive Kunden anzeigen
        c.name.toLowerCase().includes(s) || (c.nickname && c.nickname.toLowerCase().includes(s))
      )
    );

    // 2. Sortiere alle alphabetisch
    const alphabetical = [...matches].sort((a, b) => {
      const nameA = (a.nickname || a.name).toLowerCase();
      const nameB = (b.nickname || b.name).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    // 3. Finde aktive Kunden (Heute was gekauft)
    // backend update sorgt dafür, dass lastActivity bei jedem Kauf gesetzt wird
    const activeToday = alphabetical.filter(c => isToday(c.lastActivity));

    // 4. Markiere diese als "Special Highlight" Kopien
    const activeCopies = activeToday.map(c => ({ ...c, _specialActive: true }));

    // 5. Array Zusammensetzen: Aktive (oben) + Alphabetisch (unten)
    return [...activeCopies, ...alphabetical];
  }, [customersData.customers, customerSearch]);

  const categories = useMemo(() => ['all', ...new Set((articles || []).map(a => a.category).filter(Boolean))], [articles]);
  const filteredArticles = (articles || [])
    .filter(a => (selectedCategory === 'all' || a.category === selectedCategory) && a.name.toLowerCase().includes(articleSearch.toLowerCase()))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));

  // Alphabet Quick Nav
  const alphabet = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const scrollToLetter = (letter) => {
    const target = filteredCustomers.find(c => {
      if (c._specialActive) return false; // Überspringe die "Doppelten" oben
      const name = c.nickname || c.name;
      if (letter === '#') return !/^[A-Z]/i.test(name);
      return name.toUpperCase().startsWith(letter);
    });
    if (target) {
      const el = document.getElementById(`customer-${target.id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  /* Sub-Components */
  const CustomerRow = ({ customer }) => {
    const isSelected = isTargetSelected('CUSTOMER', customer.id);
    return (
      <Card
        id={customer._specialActive ? undefined : `customer-${customer.id}`}
        onClick={() => setTargetCustomer(customer)}
        sx={{
          p: 1.5,
          border: isSelected ? '2px solid' : '1px solid',
          borderColor: isSelected ? 'primary.main' : (customer._specialActive ? 'rgba(76, 175, 80, 0.3)' : 'divider'),
          cursor: 'pointer',
          bgcolor: isSelected
            ? 'action.selected'
            : customer._specialActive
              ? 'rgba(46, 125, 50, 0.3)'
              : customer.isRecent
                ? 'rgba(76, 175, 80, 0.02)'
                : 'background.paper',
          '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
          mb: 1
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1.5 }}>
          <Avatar sx={{
            width: 44, height: 44, fontSize: '1.1rem',
            bgcolor: customer.gender === 'FEMALE' ? 'pink.main' : customer.gender === 'MALE' ? 'blue.main' : 'grey.600',
            fontWeight: 800, border: '2px solid', borderColor: 'background.paper'
          }}>
            {(customer.nickname?.[0] || customer.name?.[0] || '?').toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap variant="body1" sx={{ fontWeight: 600, fontSize: '1rem' }}>{customer.nickname || customer.name}</Typography>
            {customer.nickname && (<Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{customer.name}</Typography>)}
          </Box>
          <Typography variant="body1" fontWeight={800} color={customer.balance < 5 ? 'error' : 'success.main'} sx={{ flexShrink: 0 }}>
            {money(customer.balance)}
          </Typography>
        </Stack>
        {
          isSelected && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, justifyContent: 'flex-end', borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
              <Button size="small" variant="outlined" color="inherit" startIcon={<History />} onClick={(e) => { e.stopPropagation(); handleOpenHistory(customer); }}>Verlauf</Button>
              <Button size="small" variant="outlined" color="inherit" startIcon={<AccountBalanceWallet />} onClick={(e) => { e.stopPropagation(); setShowTopUp(true); }}>Aufladen</Button>
            </Stack>
          )
        }
      </Card >
    );
  };

  return (
    <Box sx={{ pb: 0, height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      {/* Mobile Tab Navigation */}
      {isMobile && (
        <Box sx={{ mb: 1.5 }}>
          <Tabs
            value={mobileTab}
            onChange={(e, v) => setMobileTab(v)}
            variant="fullWidth"
            indicatorColor="primary"
            textColor="primary"
            sx={{
              bgcolor: 'background.paper', borderRadius: 2, boxShadow: 1,
              '& .MuiTab-root': { fontWeight: 700 }
            }}
          >
            <Tab label="Kunden" />
            <Tab label="Artikel" />
            <Tab label={`Warenkorb (${cart.reduce((a, c) => a + c.quantity, 0)})`} />
          </Tabs>
        </Box>
      )}

      <Box sx={{
        display: isMobile ? 'block' : 'grid',
        gap: 2,
        gridTemplateColumns: { md: '280px 1fr 280px', lg: '340px 1fr 320px' },
        height: isMobile ? 'calc(100% - 64px)' : '100%',
        overflow: 'hidden'
      }}>

        {/* LEFT COLUMN: CUSTOMERS */}
        <Box sx={{ display: (isMobile && mobileTab !== 0) ? 'none' : 'block', height: '100%', overflow: 'hidden' }}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
              <Stack spacing={1.5} sx={{ mb: 2 }}>
                <Button variant={isTargetSelected('CASH') ? 'contained' : 'outlined'} color="success" fullWidth size="large" startIcon={<AttachMoney />} onClick={setTargetCash} sx={{ justifyContent: 'flex-start', fontWeight: 'bold' }}>
                  Bar bezahlen
                </Button>
                <Button variant={isTargetSelected('OWNER') ? 'contained' : 'outlined'} color="warning" fullWidth size="large" startIcon={<LocalBar />} onClick={setTargetOwner} sx={{ justifyContent: 'flex-start', fontWeight: 'bold' }}>
                  Auf den Wirt
                </Button>
              </Stack>
              <TextField placeholder="Kunde suchen…" size="small" fullWidth value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} />
            </Box>
            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <Stack sx={{ width: 40, overflowY: 'auto', alignItems: 'center', py: 1, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.default', '&::-webkit-scrollbar': { display: 'none' } }} spacing={0}>
                {alphabet.map(char => (
                  <Box key={char} onClick={() => scrollToLetter(char)}
                    sx={{
                      cursor: 'pointer', fontWeight: 900, fontSize: '0.9rem', color: 'text.secondary', width: '100%', textAlign: 'center', py: 0.75,
                      '&:hover': { color: 'primary.main', bgcolor: 'action.hover' }
                    }}>
                    {char}
                  </Box>
                ))}
              </Stack>
              <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5 }}>
                {filteredCustomers.map(c => <CustomerRow key={c._specialActive ? `active-${c.id}` : c.id} customer={c} />)}
              </Box>
            </Box>
          </Card>
        </Box>

        {/* MIDDLE COLUMN: ARTICLES */}
        <Box sx={{ display: (isMobile && mobileTab !== 1) ? 'none' : 'block', height: '100%', overflow: 'hidden' }}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <TextField placeholder="Artikel suchen…" size="small" fullWidth value={articleSearch} onChange={e => setArticleSearch(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} />
              <Tabs value={selectedCategory} onChange={(e, v) => setSelectedCategory(v)} variant="scrollable" scrollButtons="auto" sx={{ mt: 1, minHeight: 48, '& .MuiTab-root': { minHeight: 48, fontSize: '1rem', fontWeight: 600 } }}>
                {categories.map(c => <Tab key={c} value={c} label={c === 'all' ? 'Alle' : c} />)}
              </Tabs>
            </Box>
            <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 2,
                pb: 2
              }}>
                {(filteredArticles || []).map(a => {
                  const cartItem = cart.find(i => i.id === a.id);
                  const qty = cartItem ? cartItem.quantity : 0;
                  return (
                    <Card key={a.id} sx={{
                      height: '100%', display: 'flex', flexDirection: 'column', cursor: 'pointer', position: 'relative',
                      '&:hover': { transform: 'scale(1.02)', boxShadow: 6, zIndex: 2 }, transition: 'all .2s',
                      border: '1px solid', borderColor: 'divider'
                    }} onClick={() => addToCart(a)}>
                      <Box sx={{
                        height: 160,
                        background: 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)', // Default fallback gradient
                        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden'
                      }}>
                        {a.imageMedium ? (
                          <Box component="img" src={a.imageMedium} alt={a.name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none'; }} />
                        ) : (
                          <LocalBar sx={{ fontSize: 64, color: 'rgba(255,255,255,0.2)' }} />
                        )}

                        {/* Price Badge */}
                        <Box sx={{ position: 'absolute', bottom: 0, right: 0, bgcolor: 'rgba(0,0,0,0.85)', color: '#fff', px: 1.5, py: 0.5, borderTopLeftRadius: 8, fontWeight: 900, fontSize: '1.1rem' }}>
                          {money(a.price)}
                        </Box>
                        {/* Quantity Badge Overlay */}
                        {qty > 0 && (
                          <Box sx={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            bgcolor: 'primary.main',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            boxShadow: 3,
                            border: '2px solid #fff'
                          }}>
                            {qty}
                          </Box>
                        )}
                      </Box>
                      <CardContent sx={{ p: 2, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 80 }}>
                        <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2, mb: 0.5, fontSize: '1.05rem', wordBreak: 'break-word' }}>{a.name}</Typography>
                        <Box sx={{ mt: 'auto' }}>
                          {a.stock <= 0 && <Chip size="small" color="error" label="Leer" sx={{ alignSelf: 'flex-start', fontWeight: 'bold' }} />}
                        </Box>
                      </CardContent>
                    </Card>
                  );
                })}
              </Box>
            </Box>
          </Card>
        </Box>

        {/* RIGHT COLUMN: CART */}
        <Box sx={{ display: (isMobile && mobileTab !== 2) ? 'none' : 'block', height: '100%', overflow: 'hidden' }}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', position: 'relative' }}>
            <CardContent sx={{ p: 2, flex: 1, overflowY: 'auto' }}>
              {/* Mobile Customer Balance Display */}
              {isMobile && bookingTarget.type === 'CUSTOMER' && bookingTarget.data && (
                <Card variant="outlined" sx={{ mb: 2, bgcolor: 'primary.lighter', borderColor: 'primary.main' }}>
                  <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold">Aktuelles Guthaben</Typography>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="body1" fontWeight="bold">{bookingTarget.data.nickname || bookingTarget.data.name}</Typography>
                      <Typography variant="h5" fontWeight={900} color={bookingTarget.data.balance < 0 ? 'error.main' : 'success.main'}>
                        {money(bookingTarget.data.balance)}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              )}

              <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center' }}>
                <ShoppingCart sx={{ mr: 1 }} /> Warenkorb
              </Typography>
              {!cart.length ? (
                <Box sx={{ textAlign: 'center', mt: 8, opacity: 0.4 }}>
                  <ShoppingCart sx={{ fontSize: 64, mb: 2 }} />
                  <Typography variant="h6">Leer</Typography>
                </Box>
              ) : (
                <List disablePadding>
                  {cart.map(i => (
                    <ListItem key={i.id} sx={{ py: 1.5, px: 0, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body1" fontWeight={700}>{i.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{money(i.price)} | Sum: {money(i.price * i.quantity)}</Typography>
                      </Box>
                      <Stack direction="row" alignItems="center" spacing={0}>
                        <IconButton onClick={() => updateQty(i.id, -1)} color={i.quantity === 1 ? 'error' : 'default'} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px 0 0 8px' }}>
                          {i.quantity === 1 ? <DeleteOutline /> : <Remove />}
                        </IconButton>
                        <Box sx={{ minWidth: 40, textAlign: 'center', fontWeight: 800, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {i.quantity}
                        </Box>
                        <IconButton onClick={() => updateQty(i.id, 1)} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '0 8px 8px 0' }}>
                          <Add />
                        </IconButton>
                      </Stack>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
            <Box sx={{ p: 2, bgcolor: 'background.default', borderTop: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Button size="small" onClick={() => setShowChangeCalc(v => !v)}>Wechselgeld</Button>
                <Stack alignItems="flex-end">
                  <Typography variant="caption" color="text.secondary">Gesamt</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 900, color: 'primary.main' }}>{money(total)}</Typography>
                </Stack>
              </Stack>
              <ChangeCalculator total={total} open={showChangeCalc} onClose={() => setShowChangeCalc(false)} />
              <Button
                fullWidth
                variant="contained"
                size="large"
                disabled={!cart.length}
                color={
                  bookingTarget.type === 'CUSTOMER'
                    ? (bookingTarget.data && (bookingTarget.data.balance - total < 0)
                      ? (bookingTarget.data.balance - total < -10 ? 'error' : 'warning')
                      : 'primary')
                    : bookingTarget.type === 'OWNER' ? 'warning' : 'success'
                }
                onClick={handleBooking}
                sx={{ py: 2, fontWeight: 800, fontSize: '1.2rem', boxShadow: 6, borderRadius: 2 }}
              >
                {bookingTarget.type === 'CASH' && 'Bar bezahlen'}
                {bookingTarget.type === 'OWNER' && 'Auf Wirt buchen'}
                {bookingTarget.type === 'CUSTOMER' && (() => {
                  if (!bookingTarget.data) return 'Kunde?';
                  const newBal = bookingTarget.data.balance - total;
                  const name = bookingTarget.data.nickname || bookingTarget.data.name.split(' ')[0];
                  if (newBal < -10) return `Limit Exceeded! (${money(newBal)})`;
                  if (newBal < 0) return `Überziehen: ${name}`;
                  return `Buchen: ${name}`;
                })()}
              </Button>
              {bookingTarget.type === 'CUSTOMER' && bookingTarget.data && (bookingTarget.data.balance - total < 0) && (
                <Typography variant="caption" color="error" display="block" textAlign="center" sx={{ mt: 1, fontWeight: 'bold' }}>
                  {bookingTarget.data.balance - total < -10
                    ? 'Buchung nicht möglich: Kreditlimit überschritten!'
                    : 'Achtung: Konto wird überzogen!'}
                </Typography>
              )}
              {bookingTarget.type === 'CUSTOMER' && !bookingTarget.data && (
                <Typography variant="caption" color="error" display="block" textAlign="center" sx={{ mt: 1, fontWeight: 'bold' }}>Bitte wählen Sie links einen Kunden</Typography>
              )}
            </Box>
          </Card>
        </Box>
      </Box>

      {/* Dialogs */}
      <Dialog open={showTopUp} onClose={() => setShowTopUp(false)} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 3, p: 2 } }}>
        <DialogTitle sx={{ textAlign: 'center', fontWeight: 800, fontSize: '1.5rem', pb: 0 }}>Guthaben aufladen</DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {/* User Info Header */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
            <Avatar sx={{
              width: 64, height: 64, mb: 1,
              bgcolor: bookingTarget.data?.gender === 'FEMALE' ? 'pink.main' : 'blue.main',
              fontWeight: 800, fontSize: '1.5rem'
            }}>
              {(bookingTarget.data?.nickname?.[0] || bookingTarget.data?.name?.[0] || '?').toUpperCase()}
            </Avatar>
            <Typography variant="h6" fontWeight={700}>{bookingTarget.data?.nickname || bookingTarget.data?.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              Aktuell: <Box component="span" sx={{ color: bookingTarget.data?.balance < 0 ? 'error.main' : 'success.main', fontWeight: 800 }}>{money(bookingTarget.data?.balance)}</Box>
            </Typography>
          </Box>

          {/* Amount Input */}
          <TextField
            label="Betrag"
            type="number"
            value={topUpAmount}
            onChange={e => setTopUpAmount(e.target.value)}
            fullWidth
            placeholder="0.00"
            InputProps={{
              startAdornment: <InputAdornment position="start"><Typography fontWeight={800}>€</Typography></InputAdornment>,
              sx: { fontSize: '1.5rem', fontWeight: 700, textAlign: 'center' }
            }}
            sx={{ mb: 4 }}
          />

          {/* Quick Amounts - Banknotes */}
          <Grid container spacing={2} sx={{ mb: 4 }}>
            {[5, 10, 20, 50].map(v => (
              <Grid item xs={6} md={3} key={v}>
                <Button
                  fullWidth
                  onClick={() => setTopUpAmount(String(v))}
                  sx={{
                    p: 1.5, // Added padding to shrink the image area
                    borderRadius: 2,
                    overflow: 'hidden',
                    border: '2px solid',
                    borderColor: topUpAmount === String(v) ? 'primary.main' : 'transparent',
                    boxShadow: 3,
                    transition: 'transform 0.1s',
                    '&:active': { transform: 'scale(0.95)' },
                    '&:hover': { transform: 'scale(1.02)' }
                  }}
                >
                  <Box
                    component="img"
                    src={`/assets/images/euro_${v}.png`}
                    alt={`€${v}`}
                    sx={{ width: '100%', maxWidth: 140, height: 'auto', display: 'block', mx: 'auto' }}
                  />
                </Button>
              </Grid>
            ))}
          </Grid>

          {/* Method Selection - Subtle */}
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, opacity: 0.8 }}>
            <Typography variant="caption" color="text.secondary">Methode:</Typography>
            <Box sx={{ display: 'flex', bgcolor: 'action.hover', borderRadius: 1, p: 0.5 }}>
              <Button
                size="small"
                variant={topUpMethod === 'CASH' ? 'contained' : 'text'}
                color={topUpMethod === 'CASH' ? 'success' : 'inherit'}
                onClick={() => setTopUpMethod('CASH')}
                sx={{ py: 0.5, minWidth: 60, fontWeight: 700 }}
              >
                Bar
              </Button>
              <Button
                size="small"
                variant={topUpMethod === 'TRANSFER' ? 'contained' : 'text'}
                color={topUpMethod === 'TRANSFER' ? 'info' : 'inherit'}
                onClick={() => setTopUpMethod('TRANSFER')}
                sx={{ py: 0.5, minWidth: 80, fontWeight: 700 }}
              >
                Überweisung
              </Button>
            </Box>
          </Box>

        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, display: 'flex', gap: 2 }}>
          <Button onClick={() => setShowTopUp(false)} variant="text" color="inherit" fullWidth sx={{ py: 1.5 }}>Abbrechen</Button>
          <Button
            variant="contained"
            fullWidth
            size="large"
            disabled={!num(topUpAmount) || num(topUpAmount) <= 0}
            onClick={() => {
              if (!isOnline) {
                const amount = num(topUpAmount);
                addTransaction({
                  isTopUp: true,
                  customerId: bookingTarget.data.id,
                  amount: amount,
                  method: topUpMethod,
                  reference: `Offline TopUp ${new Date().toLocaleTimeString()}`
                });

                // Optimistic Update
                queryClient.setQueryData(['customers-sales'], (old) => {
                  if (!old || !old.customers) return old;
                  return {
                    ...old,
                    customers: old.customers.map(c =>
                      c.id === bookingTarget.data.id
                        ? { ...c, balance: c.balance + amount }
                        : c
                    )
                  };
                });

                setShowTopUp(false);
                setTopUpAmount('');
                showFeedback('Offline: Aufladung gespeichert', 'info');
                return;
              }
              topUpMutation.mutate({ customerId: bookingTarget.data.id, amount: num(topUpAmount), method: topUpMethod });
            }}
            sx={{ py: 1.5, fontWeight: 800, borderRadius: 2, boxShadow: 4 }}
          >
            Aufladen
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showHistory} onClose={() => setShowHistory(false)} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 3, maxHeight: '80vh' } }}>
        <DialogTitle sx={{ px: 3, pt: 3, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h5" fontWeight={800}>buchungsverlauf</Typography>
            <Typography variant="body2" color="text.secondary">{historyCustomer?.name}</Typography>
          </Box>
          <IconButton onClick={() => setShowHistory(false)}><Close /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 3, pb: 3 }}>
          {historyLoading ? (
            <Box sx={{ p: 4, textAlign: 'center' }}><Typography>Lade Verlauf...</Typography></Box>
          ) : (historyData?.length ? (
            <List sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {historyData.map(t => {
                const isTopUp = t.type === 'TOPUP';
                const isPositive = isTopUp;
                return (
                  <Card key={t.id} elevation={0} sx={{
                    border: '1px solid', borderColor: 'divider',
                    bgcolor: t.cancelled ? 'action.hover' : 'background.paper',
                    opacity: t.cancelled ? 0.6 : 1,
                    position: 'relative', overflow: 'hidden'
                  }}>
                    <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, '&:last-child': { pb: 2 } }}>
                      <Box sx={{
                        width: 48, height: 48, borderRadius: '50%',
                        bgcolor: t.cancelled ? 'action.disabledBackground' : (isPositive ? 'success.lighter' : 'error.lighter'),
                        color: t.cancelled ? 'text.disabled' : (isPositive ? 'success.main' : 'error.main'),
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                      }}>
                        {t.cancelled ? <Close /> : (isPositive ? <TrendingUp /> : <TrendingDown />)}
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body1" fontWeight={700} noWrap sx={{ textDecoration: t.cancelled ? 'line-through' : 'none' }}>
                          {isTopUp ? 'Guthaben' : 'Einkauf'} {t.method === 'TRANSFER' && '(Überweisung)'}
                        </Typography>

                        {/* Sold Items List */}
                        {!isTopUp && t.items && t.items.length > 0 && (
                          <Typography variant="body2" color="text.secondary" sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            my: 0.5,
                            fontWeight: 500,
                            fontSize: '0.85rem',
                            lineHeight: 1.3
                          }}>
                            {t.items.map(i => `${i.quantity}x ${i.article?.name || i.name || '?'}`).join(', ')}
                          </Typography>
                        )}

                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="caption" color="text.secondary" fontWeight="bold">
                            {new Date(t.date).toLocaleDateString()}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                          {t.cancelled && <Chip label="STORNIERT" size="small" color="default" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 800 }} />}
                        </Stack>
                      </Box>

                      <Stack alignItems="flex-end" spacing={0.5}>
                        <Typography variant="h6" fontWeight={800} color={t.cancelled ? 'text.disabled' : (isPositive ? 'success.main' : 'error.main')} sx={{ textDecoration: t.cancelled ? 'line-through' : 'none' }}>
                          {isPositive ? '+' : '-'} {money(Math.abs(t.cancelled && t.originalAmount ? t.originalAmount : t.amount))}
                        </Typography>
                        {!t.cancelled && (
                          <Button
                            variant="outlined"
                            color="error"
                            startIcon={<RestoreFromTrash />}
                            onClick={() => { if (window.confirm('Transaktion stornieren?')) t.type === 'TOPUP' ? cancelTopUpMutation.mutate(t.id) : cancelTransactionMutation.mutate(t.id) }}
                            sx={{ fontSize: '0.75rem', py: 0.5, px: 2, fontWeight: 700, borderWidth: 2, '&:hover': { borderWidth: 2 } }}
                          >
                            Storno
                          </Button>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </List>
          ) : (
            <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
              <History sx={{ fontSize: 64, mb: 2 }} />
              <Typography>Keine Einträge gefunden</Typography>
            </Box>
          ))}
        </DialogContent>
      </Dialog>
      <Dialog open={overdraftDialog.open} onClose={() => setOverdraftDialog(p => ({ ...p, open: false }))} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ textAlign: 'center', fontWeight: 900, color: overdraftDialog.type === 'BLOCK' ? 'error.main' : 'warning.main', fontSize: '1.4rem' }}>
          {overdraftDialog.type === 'BLOCK' ? 'Buchung abgelehnt' : 'Konto überziehen?'}
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', py: 2 }}>
          {overdraftDialog.type === 'BLOCK' ? (
            <Box>
              <Typography variant="body1" sx={{ mb: 2, fontWeight: 'bold' }}>Das Kreditlimit von {money(overdraftDialog.limit)} wird überschritten.</Typography>
              <Card variant="outlined" sx={{ bgcolor: 'error.lighter', borderColor: 'error.main', mb: 2 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="body2">Aktuell:</Typography>
                    <Typography variant="body2" fontWeight="bold">{money(overdraftDialog.balance)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="body2">Einkauf:</Typography>
                    <Typography variant="body2" fontWeight="bold">-{money(overdraftDialog.amount)}</Typography>
                  </Stack>
                  <Divider sx={{ my: 1 }} />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" fontWeight="bold">Neu:</Typography>
                    <Typography variant="body2" fontWeight="900" color="error.main">{money(overdraftDialog.newBalance)}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Box>
          ) : (
            <Box>
              <Typography variant="body1" sx={{ mb: 2 }}>Der Kontostand wird negativ. Möchtest du den Betrag anschreiben?</Typography>
              <Card variant="outlined" sx={{ bgcolor: 'warning.lighter', borderColor: 'warning.main', mb: 2 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="body2">Aktuell:</Typography>
                    <Typography variant="body2" fontWeight="bold">{money(overdraftDialog.balance)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="body2">Einkauf:</Typography>
                    <Typography variant="body2" fontWeight="bold">-{money(overdraftDialog.amount)}</Typography>
                  </Stack>
                  <Divider sx={{ my: 1 }} />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" fontWeight="bold">Neu:</Typography>
                    <Typography variant="body2" fontWeight="900" color="warning.dark">{money(overdraftDialog.newBalance)}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 2, px: 2, gap: 1 }}>
          {overdraftDialog.type === 'BLOCK' ? (
            <Button variant="contained" color="error" fullWidth onClick={() => setOverdraftDialog(p => ({ ...p, open: false }))} sx={{ fontWeight: 800 }}>Verstanden</Button>
          ) : (
            <>
              <Button variant="outlined" color="inherit" fullWidth onClick={() => setOverdraftDialog(p => ({ ...p, open: false }))}>Abbrechen</Button>
              <Button variant="contained" color="warning" fullWidth onClick={overdraftDialog.onConfirm} sx={{ fontWeight: 800 }}>Trotzdem buchen</Button>
            </>
          )}
        </DialogActions>
      </Dialog>
      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%', fontWeight: 'bold', boxShadow: 6 }} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};
export default Sales;
