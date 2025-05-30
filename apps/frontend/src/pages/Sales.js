import React, { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  TextField,
  InputAdornment,
  Chip,
  Avatar,
  Button,
  IconButton,
  Badge,
  Tooltip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  Tab,
  Tabs,
  alpha,
  MenuItem,
} from '@mui/material';
import {
  Search,
  Female,
  Male,
  Person,
  ShoppingCart,
  AccountBalanceWallet,
  History,
  Add,
  AttachMoney,
  Cancel,
  LocalDrink,
  Fastfood,
  Category,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

const Sales = () => {
  const queryClient = useQueryClient();
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [articleSearch, setArticleSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpMethod, setTopUpMethod] = useState('CASH');


// Fetch customers with enhanced data
const { data: customersData = { customers: [] } } = useQuery({
  queryKey: ['customers-sales'],
  queryFn: async () => {
    const response = await api.get(API_ENDPOINTS.CUSTOMERS);

    // Überprüfe, ob die Datenstruktur wie erwartet ist
    if (response.data && Array.isArray(response.data.customers)) {
      const processedCustomers = response.data.customers.map(customer => {
        const balance = parseFloat(customer.balance);
        return {
          ...customer,
          balance: isNaN(balance) ? 0 : balance // Konvertiere balance
        };
      });

      // Sortiere NACH der Konvertierung, falls die Sortierung von numerischen Werten abhängt (hier nicht der Fall)
      // oder wenn die ursprünglichen Werte für die Sortierung benötigt werden.
      // In diesem Fall sortieren wir nach Datum, was vorher geschehen kann.
      const sorted = processedCustomers.sort((a, b) =>
        new Date(b.lastActivity || b.createdAt) - new Date(a.lastActivity || a.createdAt)
      );
      return { customers: sorted };
    }
    return { customers: [] }; // Fallback, falls Datenstruktur unerwartet
  },
});

// Fetch articles
const { data: articles = [] } = useQuery({
  queryKey: ['articles'],
  queryFn: async () => {
    const response = await api.get(API_ENDPOINTS.ARTICLES);

    // Überprüfe, ob die Datenstruktur wie erwartet ist
    if (response.data && Array.isArray(response.data.articles)) {
      const activeArticles = response.data.articles.filter(a => a.active);

      // Konvertiere 'price' für jeden aktiven Artikel
      return activeArticles.map(article => {
        const price = parseFloat(article.price);
        return {
          ...article,
          price: isNaN(price) ? 0 : price // Konvertiere price
        };
      });
    }
    return []; // Fallback, falls Datenstruktur unerwartet
  },
});


// TopUp Mutation
const topUpMutation = useMutation({
  mutationFn: async (data) => {
    const response = await api.post(`/customers/${data.customerId}/topup`, {
      amount: parseFloat(data.amount),
      method: data.method,
      reference: data.reference
    });
    return response.data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries(['customers-sales']);
    setShowTopUp(false);
    setTopUpAmount('');
  },
});

// Füge Barverkauf-Funktion hinzu:
const handleCashSale = () => {
  if (cart.length === 0) return;
  
  const saleData = {
    paymentMethod: 'CASH',
    customerId: null,
    items: cart.map(item => ({
      articleId: item.id,
      quantity: item.quantity,
    })),
  };
  
  quickSaleMutation.mutate(saleData);
};


// Fetch customer transactions
const { data: customerTransactions = [] } = useQuery({
  queryKey: ['customer-transactions', selectedCustomer?.id],
  queryFn: async () => {
    if (!selectedCustomer) return [];
    const response = await api.get(API_ENDPOINTS.TRANSACTIONS, {
      params: {
        customerId: selectedCustomer.id,
        includeItems: true
      }
    });

    // Überprüfe, ob die Datenstruktur wie erwartet ist
    if (response.data && Array.isArray(response.data.transactions)) {
      return response.data.transactions.map(transaction => {
        const totalAmount = parseFloat(transaction.totalAmount);
        let processedItems = transaction.items || [];

        // Wenn 'includeItems: true' auch Preise pro Artikel liefert, die formatiert werden müssen:
        if (Array.isArray(transaction.items)) {
          processedItems = transaction.items.map(item => {
            // Annahme: Jedes Item könnte einen eigenen 'price' oder 'itemTotal' haben, der konvertiert werden muss.
            // Passe dies an die tatsächliche Struktur deiner 'item'-Objekte an.
            // Beispiel, falls ein Item einen eigenen Preis hat:
            const itemPrice = parseFloat(item.price); // oder item.unitPrice, item.lineTotal etc.
            return {
              ...item,
              price: isNaN(itemPrice) ? 0 : itemPrice // Ersetze 'price' mit dem tatsächlichen Feldnamen
              // Füge hier weitere Konvertierungen für Item-Eigenschaften hinzu, falls nötig
            };
          });
        }

        return {
          ...transaction,
          totalAmount: isNaN(totalAmount) ? 0 : totalAmount, // Konvertiere totalAmount
          items: processedItems // Füge die verarbeiteten Items hinzu
        };
      });
    }
    return []; // Fallback, falls Datenstruktur unerwartet
  },
  enabled: !!selectedCustomer && showHistory, // `showHistory` muss in deinem Komponenten-Scope definiert sein
});

  // Filter customers
  const filteredCustomers = customersData.customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (customer.nickname && customer.nickname.toLowerCase().includes(customerSearch.toLowerCase()))
  );

  // Separate by gender
  const femaleCustomers = filteredCustomers.filter(c => c.gender === 'FEMALE');
  const maleCustomers = filteredCustomers.filter(c => c.gender === 'MALE');
  const otherCustomers = filteredCustomers.filter(c => !c.gender || c.gender === 'OTHER');

  // Get unique categories
  const categories = ['all', ...new Set(articles.map(a => a.category))];

  // Filter articles
  const filteredArticles = articles.filter(article => {
    if (selectedCategory !== 'all' && article.category !== selectedCategory) return false;
    if (articleSearch && !article.name.toLowerCase().includes(articleSearch.toLowerCase())) return false;
    return true;
  });

  // Quick sale for customer
  const quickSaleMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(API_ENDPOINTS.TRANSACTIONS, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customers-sales']);
      queryClient.invalidateQueries(['articles']);
      setCart([]);
    },
  });

  const handleQuickSale = (customer) => {
    if (cart.length === 0) return;
    
    const saleData = {
      paymentMethod: 'ACCOUNT',
      customerId: customer.id,
      items: cart.map(item => ({
        articleId: item.id,
        quantity: item.quantity,
      })),
    };
    
    quickSaleMutation.mutate(saleData);
  };

  const CustomerCard = ({ customer }) => {
    const isRecent = new Date() - new Date(customer.lastActivity || customer.createdAt) < 5 * 60 * 1000; // 5 Minuten
    
    return (
      <Card
        sx={{
          cursor: 'pointer',
          transition: 'all 0.2s',
          border: selectedCustomer?.id === customer.id ? 2 : 0,
          borderColor: 'primary.main',
          backgroundColor: isRecent ? alpha('#4caf50', 0.1) : 'background.paper',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 3,
          },
        }}
        onClick={() => setSelectedCustomer(customer)}
      >
        <CardContent sx={{ p: 1.5 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <Avatar sx={{ width: 32, height: 32, mr: 1, bgcolor: getGenderColor(customer.gender) }}>
                {getGenderIcon(customer.gender)}
              </Avatar>
              <Box>
                <Typography variant="body2" fontWeight="bold">
                  {customer.nickname || customer.name}
                </Typography>
                {customer.nickname && (
                  <Typography variant="caption" color="text.secondary">
                    {customer.name}
                  </Typography>
                )}
              </Box>
            </Box>
            <Typography 
              variant="h6" 
              color={customer.balance < 5 ? 'error' : 'primary'}
              fontWeight="bold"
            >
              €{customer.balance.toFixed(2)}
            </Typography>
          </Box>
          
          {selectedCustomer?.id === customer.id && cart.length > 0 && (
            <Box mt={1} display="flex" gap={0.5}>
              <Button
                size="small"
                variant="contained"
                fullWidth
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuickSale(customer);
                }}
                disabled={customer.balance < getTotalAmount()}
              >
                €{getTotalAmount().toFixed(2)} buchen
              </Button>
            </Box>
          )}
          
          {selectedCustomer?.id === customer.id && (
            <Box mt={1} display="flex" gap={0.5}>
              <Tooltip title="Guthaben aufladen">
                <IconButton 
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTopUp(true);
                  }}
                >
                  <AccountBalanceWallet />
                </IconButton>
              </Tooltip>
              <Tooltip title="Verlauf">
                <IconButton 
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowHistory(true);
                  }}
                >
                  <History />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </CardContent>
      </Card>
    );
  };

  const getGenderIcon = (gender) => {
    switch (gender) {
      case 'FEMALE':
        return <Female />;
      case 'MALE':
        return <Male />;
      default:
        return <Person />;
    }
  };

  const getGenderColor = (gender) => {
    switch (gender) {
      case 'FEMALE':
        return 'pink.main';
      case 'MALE':
        return 'blue.main';
      default:
        return 'grey.500';
    }
  };

  const addToCart = (article) => {
    const existingItem = cart.find(item => item.id === article.id);
    if (existingItem) {
      updateQuantity(article.id, existingItem.quantity + 1);
    } else {
      setCart([...cart, { ...article, quantity: 1 }]);
    }
  };

  const updateQuantity = (articleId, newQuantity) => {
    if (newQuantity <= 0) {
      removeFromCart(articleId);
    } else {
      setCart(cart.map(item =>
        item.id === articleId ? { ...item, quantity: newQuantity } : item
      ));
    }
  };

  const removeFromCart = (articleId) => {
    setCart(cart.filter(item => item.id !== articleId));
  };

  const getTotalAmount = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  return (
    <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', gap: 2 }}>
      {/* Left - Customer Lists */}
      <Box sx={{ width: 600, display: 'flex', gap: 2 }}>
        {/* Female Customers */}
        <Box sx={{ flex: 1 }}>
          <Box sx={{ mb: 2, textAlign: 'center' }}>
            <Female sx={{ color: 'pink.main' }} />
            <Typography variant="subtitle2">Mädels ({femaleCustomers.length})</Typography>
          </Box>
          <Box sx={{ height: 'calc(100% - 60px)', overflowY: 'auto' }}>
            {femaleCustomers.map(customer => (
              <Box key={customer.id} mb={1}>
                <CustomerCard customer={customer} />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Male Customers */}
        <Box sx={{ flex: 1 }}>
          <Box sx={{ mb: 2, textAlign: 'center' }}>
            <Male sx={{ color: 'blue.main' }} />
            <Typography variant="subtitle2">Jungs ({maleCustomers.length})</Typography>
          </Box>
          <Box sx={{ height: 'calc(100% - 60px)', overflowY: 'auto' }}>
            {maleCustomers.map(customer => (
              <Box key={customer.id} mb={1}>
                <CustomerCard customer={customer} />
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Middle - Articles */}
      <Box sx={{ flex: 1 }}>
        <TextField
          placeholder="Artikel suchen..."
          size="small"
          fullWidth
          value={articleSearch}
          onChange={(e) => setArticleSearch(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
          }}
        />
        
        <Tabs
          value={selectedCategory}
          onChange={(e, value) => setSelectedCategory(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2 }}
        >
          {categories.map(category => (
            <Tab key={category} label={category === 'all' ? 'Alle' : category} value={category} />
          ))}
        </Tabs>

        <Grid container spacing={1} sx={{ height: 'calc(100% - 120px)', overflowY: 'auto' }}>
          {filteredArticles.map(article => (
            <Grid item xs={6} sm={4} md={3} key={article.id}>
              <Card
                sx={{
                  cursor: 'pointer',
                  transition: 'transform 0.2s',
                  '&:hover': {
                    transform: 'scale(1.05)',
                  },
                }}
                onClick={() => addToCart(article)}
              >
                {article.imageMedium && (
                  <Box
                    component="img"
                    src={article.imageMedium}
                    alt={article.name}
                    sx={{ width: '100%', height: 100, objectFit: 'cover' }}
                  />
                )}
                <CardContent sx={{ p: 1 }}>
                  <Typography variant="body2" noWrap>
                    {article.name}
                  </Typography>
                  <Typography variant="h6" color="primary">
                    €{article.price.toFixed(2)}
                  </Typography>
                  {article.stock <= article.minStock && (
                    <Chip label="Niedrig" size="small" color="warning" />
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Right - Cart */}
      <Box sx={{ width: 300 }}>
        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ flex: 1, overflowY: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              <ShoppingCart sx={{ mr: 1, verticalAlign: 'middle' }} />
              Warenkorb
            </Typography>
            
            {cart.length === 0 ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                Warenkorb ist leer
              </Typography>
            ) : (
              <List dense>
                {cart.map(item => (
                  <ListItem key={item.id}>
                    <ListItemText
                      primary={item.name}
                      secondary={`${item.quantity}x €${item.price.toFixed(2)}`}
                    />
                    <Box>
                      <IconButton size="small" onClick={() => updateQuantity(item.id, item.quantity - 1)}>
                        -
                      </IconButton>
                      <IconButton size="small" onClick={() => updateQuantity(item.id, item.quantity + 1)}>
                        +
                      </IconButton>
                    </Box>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
          
          {cart.length > 0 && (
  <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
    <Typography variant="h5" align="right" gutterBottom>
      Gesamt: €{getTotalAmount().toFixed(2)}
    </Typography>
    
    <Grid container spacing={1}>
      <Grid item xs={12}>
        <Button
          fullWidth
          variant="contained"
          color="success"
          onClick={handleCashSale}
          startIcon={<AttachMoney />}
        >
          Bar bezahlen
        </Button>
      </Grid>
      {selectedCustomer && (
        <Grid item xs={12}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => handleQuickSale(selectedCustomer)}
            disabled={selectedCustomer.balance < getTotalAmount()}
          >
            Auf {selectedCustomer.nickname || selectedCustomer.name} buchen
          </Button>
        </Grid>
      )}
    </Grid>
  </Box>
)}

        </Card>
      </Box>

      {/* History Dialog */}
      <Dialog open={showHistory} onClose={() => setShowHistory(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Transaktionsverlauf - {selectedCustomer?.name}
        </DialogTitle>
        <DialogContent>
          <List>
            {customerTransactions.map(transaction => (
              <ListItem key={transaction.id}>
                <ListItemText
                  primary={`€${transaction.totalAmount.toFixed(2)} - ${transaction.items?.length || 0} Artikel`}
                  secondary={new Date(transaction.createdAt).toLocaleString('de-DE')}
                />
                {!transaction.cancelled && (
                  <IconButton
                    color="error"
                    onClick={() => {
                      // Storno-Logik
                    }}
                  >
                    <Cancel />
                  </IconButton>
                )}
              </ListItem>
            ))}
          </List>
        </DialogContent>
      </Dialog>

      
<Dialog open={showTopUp} onClose={() => setShowTopUp(false)}>
  <DialogTitle>
    Guthaben aufladen - {selectedCustomer?.name}
  </DialogTitle>
  <DialogContent>
    <Grid container spacing={2} sx={{ mt: 1 }}>
      <Grid item xs={12}>
        <TextField
          label="Betrag"
          type="number"
          value={topUpAmount}
          onChange={(e) => setTopUpAmount(e.target.value)}
          fullWidth
          InputProps={{
            startAdornment: <InputAdornment position="start">€</InputAdornment>,
          }}
        />
      </Grid>
      <Grid item xs={12}>
        <TextField
          select
          label="Zahlungsart"
          value={topUpMethod}
          onChange={(e) => setTopUpMethod(e.target.value)}
          fullWidth
        >
          <MenuItem value="CASH">Bar</MenuItem>
          <MenuItem value="TRANSFER">Überweisung</MenuItem>
        </TextField>
      </Grid>
    </Grid>
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setShowTopUp(false)}>Abbrechen</Button>
    <Button
      onClick={() => {
        if (topUpAmount && parseFloat(topUpAmount) > 0) {
          topUpMutation.mutate({
            customerId: selectedCustomer.id,
            amount: topUpAmount,
            method: topUpMethod
          });
        }
      }}
      variant="contained"
      disabled={!topUpAmount || parseFloat(topUpAmount) <= 0}
    >
      Aufladen
    </Button>
  </DialogActions>
</Dialog>

    </Box>
  );
};

export default Sales;
