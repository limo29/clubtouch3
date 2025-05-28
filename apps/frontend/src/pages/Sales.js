import React, { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  CardContent,
  CardMedia,
  Typography,
  Button,
  Box,
  TextField,
  InputAdornment,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Alert,
  Tab,
  Tabs,
  Paper,
  Autocomplete,
  Divider,
} from '@mui/material';
import {
  Search,
  Add,
  Remove,
  Delete,
  ShoppingCart,
  AttachMoney,
  AccountBalanceWallet,
  LocalDrink,
  Fastfood,
  Category,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

const Sales = () => {
  const queryClient = useQueryClient();
  const [cart, setCart] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [checkoutDialog, setCheckoutDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

// Fetch articles
const { data: articles = [] } = useQuery({
  queryKey: ['articles'],
  queryFn: async () => {
    const response = await api.get(API_ENDPOINTS.ARTICLES);
    // Stelle sicher, dass der Preis eine Zahl ist
    return response.data.articles.map(article => {
      const price = parseFloat(article.price); // Konvertiere den Preis zu einer Fließkommazahl
      return {
        ...article,
        price: isNaN(price) ? 0 : price // Wenn Konvertierung fehlschlägt (NaN), setze Preis auf 0 (oder einen anderen Standardwert/Fehlerbehandlung)
      };
    });
  },
});

// Fetch customers
const { data: customers = [] } = useQuery({
  queryKey: ['customers'], // Beachte: Wenn du hier 'searchTerm' oder Ähnliches im Key hast, berücksichtige das.
                          // Für das Autocomplete in Sales.js war es aber, glaube ich, nur ['customers'].
  queryFn: async () => {
    const response = await api.get(API_ENDPOINTS.CUSTOMERS); // Oder der spezifische Endpunkt, den dieses Autocomplete verwendet

    // Überprüfe, ob die Datenstruktur wie erwartet ist
    if (response.data && Array.isArray(response.data.customers)) {
      // Konvertiere 'balance' für jeden Kunden in eine Zahl
      return response.data.customers.map(customer => {
        const balance = parseFloat(customer.balance); // Konvertiere balance
        return {
          ...customer,
          // Stelle sicher, dass balance eine Zahl ist, ansonsten setze einen Standardwert (z.B. 0)
          balance: isNaN(balance) ? 0 : balance
        };
      });
    }
    return []; // Gib ein leeres Array zurück, falls die Daten nicht wie erwartet sind
  },
});

  // Get unique categories
  const categories = ['all', ...new Set(articles.map(a => a.category))];

  // Filter articles
  const filteredArticles = articles.filter(article => {
    if (!article.active) return false;
    if (selectedCategory !== 'all' && article.category !== selectedCategory) return false;
    if (searchTerm && !article.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Create sale mutation
  const createSaleMutation = useMutation({
    mutationFn: async (saleData) => {
      const response = await api.post(API_ENDPOINTS.TRANSACTIONS, saleData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['articles']);
      queryClient.invalidateQueries(['customers']);
      setCart([]);
      setSelectedCustomer(null);
      setCheckoutDialog(false);
      setSuccessMessage('Verkauf erfolgreich abgeschlossen!');
      setTimeout(() => setSuccessMessage(''), 3000);
    },
  });

  // Cart functions
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

  const handleCheckout = () => {
    if (cart.length === 0) return;
    
    if (paymentMethod === 'ACCOUNT' && !selectedCustomer) {
      alert('Bitte wähle einen Kunden für die Zahlung per Kundenkonto');
      return;
    }
    
    setCheckoutDialog(true);
  };

  const confirmCheckout = async () => {
    const saleData = {
      paymentMethod,
      customerId: selectedCustomer?.id || null,
      items: cart.map(item => ({
        articleId: item.id,
        quantity: item.quantity,
      })),
    };
    
    createSaleMutation.mutate(saleData);
  };

  // Category icons
  const getCategoryIcon = (category) => {
    switch (category.toLowerCase()) {
      case 'getränke':
        return <LocalDrink />;
      case 'snacks':
      case 'essen':
        return <Fastfood />;
      default:
        return <Category />;
    }
  };

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Left side - Articles */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <TextField
              placeholder="Artikel suchen..."
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
              sx={{ mb: 2 }}
            />
            
            <Tabs
              value={selectedCategory}
              onChange={(e, value) => setSelectedCategory(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ mb: 2 }}
            >
              {categories.map(category => (
                <Tab
                  key={category}
                  label={category === 'all' ? 'Alle' : category}
                  value={category}
                  icon={category === 'all' ? null : getCategoryIcon(category)}
                  iconPosition="start"
                />
              ))}
            </Tabs>
          </Paper>

          <Grid container spacing={2}>
            {filteredArticles.map(article => (
              <Grid item xs={6} sm={4} md={3} key={article.id}>
                <Card
                  sx={{
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                    '&:hover': {
                      transform: 'scale(1.05)',
                      boxShadow: 3,
                    },
                  }}
                  onClick={() => addToCart(article)}
                >
                  {article.imageUrl && (
                    <CardMedia
                      component="img"
                      height="100"
                      image={article.imageUrl}
                      alt={article.name}
                    />
                  )}
                  <CardContent sx={{ p: 1.5 }}>
                    <Typography variant="body2" noWrap>
                      {article.name}
                    </Typography>
                    <Typography variant="h6" color="primary">
                      €{article.price.toFixed(2)}
                    </Typography>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        Bestand: {article.stock}
                      </Typography>
                      {article.stock <= article.minStock && (
                        <Chip
                          label="Niedrig"
                          size="small"
                          color="warning"
                        />
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Grid>

        {/* Right side - Cart */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, position: 'sticky', top: 80 }}>
            <Typography variant="h6" gutterBottom>
              <ShoppingCart sx={{ mr: 1, verticalAlign: 'middle' }} />
              Warenkorb
            </Typography>
            
            <Divider sx={{ my: 2 }} />
            
            {cart.length === 0 ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                Warenkorb ist leer
              </Typography>
            ) : (
              <>
                <List>
                  {cart.map(item => (
                    <ListItem key={item.id} sx={{ px: 0 }}>
                      <ListItemText
                        primary={item.name}
                        secondary={`€${item.price.toFixed(2)} x ${item.quantity} = €${(item.price * item.quantity).toFixed(2)}`}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          size="small"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        >
                          <Remove />
                        </IconButton>
                        <Typography component="span" sx={{ mx: 1 }}>
                          {item.quantity}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={item.quantity >= item.stock}
                        >
                          <Add />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => removeFromCart(item.id)}
                          color="error"
                        >
                          <Delete />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
                
                <Divider sx={{ my: 2 }} />
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="h5" align="right" gutterBottom>
                    Gesamt: €{getTotalAmount().toFixed(2)}
                  </Typography>
                </Box>
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    Zahlungsart:
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Button
                        fullWidth
                        variant={paymentMethod === 'CASH' ? 'contained' : 'outlined'}
                        onClick={() => {
                          setPaymentMethod('CASH');
                          setSelectedCustomer(null);
                        }}
                        startIcon={<AttachMoney />}
                      >
                        Bar
                      </Button>
                    </Grid>
                    <Grid item xs={6}>
                      <Button
                        fullWidth
                        variant={paymentMethod === 'ACCOUNT' ? 'contained' : 'outlined'}
                        onClick={() => setPaymentMethod('ACCOUNT')}
                        startIcon={<AccountBalanceWallet />}
                      >
                        Kundenkonto
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
                
                {paymentMethod === 'ACCOUNT' && (
                  <Box sx={{ mb: 2 }}>
                    <Autocomplete
                      options={customers}
                      getOptionLabel={(option) => 
                        `${option.name} ${option.nickname ? `(${option.nickname})` : ''} - €${option.balance.toFixed(2)}`
                      }
                      value={selectedCustomer}
                      onChange={(e, value) => setSelectedCustomer(value)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Kunde auswählen"
                          variant="outlined"
                          size="small"
                        />
                      )}
                    />
                    {selectedCustomer && selectedCustomer.balance < getTotalAmount() && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        Nicht genügend Guthaben!
                      </Alert>
                    )}
                  </Box>
                )}
                
                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  onClick={handleCheckout}
                  disabled={
                    cart.length === 0 ||
                    (paymentMethod === 'ACCOUNT' && (!selectedCustomer || selectedCustomer.balance < getTotalAmount()))
                  }
                >
                  Bezahlen
                </Button>
              </>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Success Message */}
      {successMessage && (
        <Alert
          severity="success"
          sx={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 1000,
          }}
        >
          {successMessage}
        </Alert>
      )}

      {/* Checkout Dialog */}
      <Dialog open={checkoutDialog} onClose={() => setCheckoutDialog(false)}>
        <DialogTitle>Verkauf bestätigen</DialogTitle>
        <DialogContent>
          <Typography variant="h6" gutterBottom>
            Gesamtbetrag: €{getTotalAmount().toFixed(2)}
          </Typography>
          <Typography>
            Zahlungsart: {paymentMethod === 'CASH' ? 'Bar' : 'Kundenkonto'}
          </Typography>
          {selectedCustomer && (
            <Typography>
              Kunde: {selectedCustomer.name}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCheckoutDialog(false)}>Abbrechen</Button>
          <Button
            onClick={confirmCheckout}
            variant="contained"
            disabled={createSaleMutation.isLoading}
          >
            {createSaleMutation.isLoading ? 'Verarbeite...' : 'Bestätigen'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Sales;
