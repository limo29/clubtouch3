import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  LinearProgress,
  Divider,
  Alert,
  Tab,
  Tabs,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  EmojiEvents,
  Timer,
  CalendarToday,
  AttachMoney,
  ShoppingCart,
  TrendingUp,
  Refresh,
  Celebration,
  LocalFireDepartment,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import api from '../services/api';
import { API_ENDPOINTS, WS_URL } from '../config/api';
import { getToken } from '../services/api';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const Highscore = () => {
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [viewType, setViewType] = useState('DAILY');
  const [viewMode, setViewMode] = useState('AMOUNT');
  const [liveUpdate, setLiveUpdate] = useState(null);
  const [celebration, setCelebration] = useState(false);

  // Fetch highscores
  const { data: highscoresData, isLoading, refetch } = useQuery({
    queryKey: ['highscores', viewType, viewMode],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.HIGHSCORE, {
        params: { type: viewType, mode: viewMode }
      });
      return response.data;
    },
  });

  // Initialize WebSocket connection
  useEffect(() => {
    const token = getToken();
    const newSocket = io(WS_URL, {
      auth: { token }
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    });

    newSocket.on('highscore:update', (data) => {
      console.log('Highscore update received:', data);
      queryClient.invalidateQueries(['highscores']);
      setLiveUpdate(data);
      setCelebration(true);
      setTimeout(() => setCelebration(false), 3000);
    });

    newSocket.on('sale:new', (data) => {
      console.log('New sale:', data);
      queryClient.invalidateQueries(['highscores']);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [queryClient]);

  const highscore = highscoresData || { entries: [] };

  const formatValue = (value) => {
    if (viewMode === 'AMOUNT') {
      return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
      }).format(value);
    }
    return `${value} Stück`;
  };

  const getRankIcon = (rank) => {
    switch (rank) {
      case 1:
        return <EmojiEvents sx={{ color: '#FFD700' }} />;
      case 2:
        return <EmojiEvents sx={{ color: '#C0C0C0' }} />;
      case 3:
        return <EmojiEvents sx={{ color: '#CD7F32' }} />;
      default:
        return null;
    }
  };

  const getRankStyle = (rank) => {
    switch (rank) {
      case 1:
        return { 
          backgroundColor: '#FFF3E0', 
          borderLeft: '4px solid #FFD700',
          fontWeight: 'bold' 
        };
      case 2:
        return { 
          backgroundColor: '#F5F5F5', 
          borderLeft: '4px solid #C0C0C0',
          fontWeight: 'bold' 
        };
      case 3:
        return { 
          backgroundColor: '#EFEBE9', 
          borderLeft: '4px solid #CD7F32',
          fontWeight: 'bold' 
        };
      default:
        return {};
    }
  };

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h4" display="flex" alignItems="center">
          <EmojiEvents sx={{ mr: 1, fontSize: 40 }} />
          Highscore
        </Typography>
        <Box display="flex" alignItems="center" gap={2}>
          {connected ? (
            <Chip
              icon={<TrendingUp />}
              label="Live"
              color="success"
              size="small"
            />
          ) : (
            <Chip
              label="Offline"
              color="default"
              size="small"
            />
          )}
          <Tooltip title="Aktualisieren">
            <IconButton onClick={() => refetch()}>
              <Refresh />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Celebration Animation */}
      {celebration && (
        <Alert 
          severity="success" 
          icon={<Celebration />}
          sx={{ mb: 2, animation: 'pulse 1s infinite' }}
        >
          Highscore wurde aktualisiert!
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Controls */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6}>
                <ToggleButtonGroup
                  value={viewType}
                  exclusive
                  onChange={(e, value) => value && setViewType(value)}
                  fullWidth
                >
                  <ToggleButton value="DAILY">
                    <Timer sx={{ mr: 1 }} />
                    Tageswertung
                  </ToggleButton>
                  <ToggleButton value="YEARLY">
                    <CalendarToday sx={{ mr: 1 }} />
                    Jahreswertung
                  </ToggleButton>
                </ToggleButtonGroup>
              </Grid>
              <Grid item xs={12} sm={6}>
                <ToggleButtonGroup
                  value={viewMode}
                  exclusive
                  onChange={(e, value) => value && setViewMode(value)}
                  fullWidth
                >
                  <ToggleButton value="AMOUNT">
                    <AttachMoney sx={{ mr: 1 }} />
                    Nach Umsatz
                  </ToggleButton>
                  <ToggleButton value="COUNT">
                    <ShoppingCart sx={{ mr: 1 }} />
                    Nach Anzahl
                  </ToggleButton>
                </ToggleButtonGroup>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Highscore List */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {viewType === 'DAILY' ? 'Tages' : 'Jahres'}-Highscore
                {highscore.startDate && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Seit {format(new Date(highscore.startDate), 'dd.MM.yyyy HH:mm', { locale: de })}
                  </Typography>
                )}
              </Typography>
              
              {isLoading ? (
                <LinearProgress />
              ) : highscore.entries.length === 0 ? (
                <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                  Noch keine Einträge vorhanden
                </Typography>
              ) : (
                <List>
                  {highscore.entries.map((entry, index) => (
                    <React.Fragment key={entry.customerId}>
                      <ListItem
                        sx={{
                          ...getRankStyle(entry.rank),
                          borderRadius: 1,
                          mb: 1,
                          transition: 'all 0.3s',
                          '&:hover': {
                            transform: 'translateX(5px)',
                          },
                        }}
                      >
                        <ListItemAvatar>
                          <Avatar sx={{ bgcolor: 'primary.main' }}>
                            {getRankIcon(entry.rank) || entry.rank}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Box display="flex" alignItems="center" gap={1}>
                              {entry.customerNickname || entry.customerName}
                              {entry.rank === 1 && (
                                <LocalFireDepartment sx={{ color: 'error.main', fontSize: 20 }} />
                              )}
                            </Box>
                          }
                          secondary={
                            <Box>
                              <Typography variant="body2" color="text.secondary">
                                {entry.transactionCount} Transaktionen
                              </Typography>
                              {viewMode === 'AMOUNT' && entry.totalItems && (
                                <Typography variant="caption" color="text.secondary">
                                  {entry.totalItems} Artikel gekauft
                                </Typography>
                              )}
                              {viewMode === 'COUNT' && entry.totalAmount && (
                                <Typography variant="caption" color="text.secondary">
                                  {formatValue(entry.totalAmount)} ausgegeben
                                </Typography>
                              )}
                            </Box>
                          }
                        />
                        <Typography variant="h6" color="primary">
                          {formatValue(entry.score)}
                        </Typography>
                      </ListItem>
                      {index < highscore.entries.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Statistics */}
        <Grid item xs={12} md={4}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Statistiken
                  </Typography>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Zeitraum
                    </Typography>
                    <Typography variant="body1">
                      {viewType === 'DAILY' ? 'Heute' : 'Dieses Jahr'}
                    </Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Wertung
                    </Typography>
                    <Typography variant="body1">
                      {viewMode === 'AMOUNT' ? 'Nach Umsatz' : 'Nach Anzahl'}
                    </Typography>
                  </Box>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Letzte Aktualisierung
                    </Typography>
                    <Typography variant="body1">
                      {highscore.lastUpdated
                        ? format(new Date(highscore.lastUpdated), 'dd.MM.yyyy HH:mm:ss', { locale: de })
                        : '-'
                      }
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Top Performer Card */}
            {highscore.entries.length > 0 && (
              <Grid item xs={12}>
                <Card sx={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom sx={{ color: 'white' }}>
                      🏆 Aktueller Spitzenreiter
                    </Typography>
                    <Typography variant="h4" sx={{ color: 'white' }}>
                      {highscore.entries[0].customerNickname || highscore.entries[0].customerName}
                    </Typography>
                    <Typography variant="h5" sx={{ color: 'white', mt: 1 }}>
                      {formatValue(highscore.entries[0].score)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            )}

            {/* Info Card */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    <strong>Hinweis:</strong> Der Tages-Highscore wird automatisch um 12:00 Uhr mittags zurückgesetzt. 
                    Nur Artikel, die für den Highscore zählen, werden berücksichtigt.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Highscore;
