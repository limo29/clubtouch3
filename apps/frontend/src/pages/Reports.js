import React, { useState, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Button, TextField, MenuItem, Alert, List,
  ListItem, ListItemText, ListItemIcon, ListItemSecondaryAction, Divider, Chip, Paper, CircularProgress
} from '@mui/material';
import {
  Download, Description, TableChart, PictureAsPdf, Receipt, Inventory,
  People, Assessment, AccountBalance, CalendarToday, EuroSymbol
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { format } from 'date-fns';

// UI Components for "Premium" feel
const GlassCard = ({ children, sx = {}, ...props }) => (
  <Card
    sx={{
      background: 'rgba(255, 255, 255, 0.05)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: 3,
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
      ...sx
    }}
    {...props}
  >
    {children}
  </Card>
);

const Reports = () => {
  const [selectedReport, setSelectedReport] = useState(null);
  const [parameters, setParameters] = useState({
    startDate: null,
    endDate: null,
    customerId: '',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    date: new Date(),
    startHour: 6, // Default Geschäftstag-Start
  });
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  const { data: exportsData } = useQuery({
    queryKey: ['exports'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.EXPORTS);
      return response.data;
    },
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.CUSTOMERS);
      return response.data;
    },
  });

  // Preview Data Fetching
  const { data: previewData, isLoading: previewLoading } = useQuery({
    queryKey: ['report-preview', selectedReport?.id, parameters.date, parameters.startHour],
    queryFn: async () => {
      if (selectedReport?.id !== 'daily-summary' || !parameters.date) return null;
      const res = await api.get('/exports/daily-summary/preview', {
        params: {
          date: format(parameters.date, 'yyyy-MM-dd'),
          startHour: parameters.startHour
        }
      });
      return res.data;
    },
    enabled: selectedReport?.id === 'daily-summary' && !!parameters.date,
    staleTime: 5000
  });

  // Combine backend exports with manual "EÜR" if missing (frontend override)
  const exports = useMemo(() => {
    const list = exportsData?.exports || [];
    const hasEur = list.find(e => e.id === 'eur');
    if (!hasEur) {
      return [
        ...list,
        {
          id: 'eur',
          name: 'Einnahmen-Überschuss-Rechnung (EÜR)',
          description: 'Detaillierte Aufstellung aller Einnahmen und Ausgaben inkl. Gewinnermittlung.',
          format: 'PDF'
        }
      ];
    }
    return list;
  }, [exportsData]);

  const customers = customersData?.customers || [];

  const handleDownload = async () => {
    if (!selectedReport) return;
    setDownloading(true);
    setError(null);
    try {
      let url = `${API_ENDPOINTS.EXPORTS}/${selectedReport.id}`;
      // Special case for manual EÜR if not in backend list standard path (though usually it is /exports/eur)
      if (selectedReport.id === 'eur') {
        url = '/exports/eur';
      }

      const params = new URLSearchParams();

      switch (selectedReport.id) {
        case 'transactions':
          if (parameters.startDate) params.append('startDate', format(parameters.startDate, 'yyyy-MM-dd'));
          if (parameters.endDate) params.append('endDate', format(parameters.endDate, 'yyyy-MM-dd'));
          break;
        case 'daily-summary':
          if (parameters.date) params.append('date', format(parameters.date, 'yyyy-MM-dd'));
          if (parameters.startHour !== undefined) params.append('startHour', parameters.startHour);
          break;
        case 'monthly-summary':
          params.append('year', parameters.year);
          params.append('month', parameters.month);
          break;
        case 'customer-statement':
          if (!parameters.customerId) {
            setError('Bitte wählen Sie einen Kunden aus');
            setDownloading(false);
            return;
          }
          url = `${API_ENDPOINTS.EXPORTS}/customer/${parameters.customerId}/statement`;
          if (parameters.startDate) params.append('startDate', format(parameters.startDate, 'yyyy-MM-dd'));
          if (parameters.endDate) params.append('endDate', format(parameters.endDate, 'yyyy-MM-dd'));
          break;
        case 'eur':
          // Validierung
          if (!parameters.startDate || !parameters.endDate) {
            setError('Bitte Start- und Enddatum wählen');
            setDownloading(false);
            return;
          }
          params.append('startDate', format(parameters.startDate, 'yyyy-MM-dd'));
          params.append('endDate', format(parameters.endDate, 'yyyy-MM-dd'));
          break;
        default:
          break;
      }

      const queryString = params.toString();
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
      }

      const response = await api.get(url, { responseType: 'blob' });

      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;

      const cd = response.headers['content-disposition'];
      let filename = `export_${selectedReport.id}_${Date.now()}.${selectedReport.format?.toLowerCase?.() || 'pdf'}`;
      if (cd) {
        const m = cd.match(/filename="(.+)"/);
        if (m) filename = m[1];
      }
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setDownloading(false);
    } catch (err) {
      console.error('Download error:', err);
      setError('Fehler beim Download. Bitte überprüfen Sie die Parameter.');
      setDownloading(false);
    }
  };

  const getReportIcon = (id) => {
    switch (id) {
      case 'transactions': return <Receipt color="primary" />;
      case 'inventory': return <Inventory color="secondary" />;
      case 'customers': return <People color="info" />;
      case 'daily-summary': return <CalendarToday color="success" />;
      case 'monthly-summary': return <Assessment color="warning" />;
      case 'customer-statement': return <AccountBalance color="action" />;
      case 'eur': return <EuroSymbol color="error" />;
      default: return <Description />;
    }
  };

  const getFormatIcon = (format) => (format === 'CSV' ? <TableChart fontSize="small" /> : <PictureAsPdf fontSize="small" />);

  const renderParams = () => {
    if (!selectedReport) return null;
    switch (selectedReport.id) {
      case 'transactions':
      case 'customer-statement':
      case 'eur':
        return (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="Von"
                value={parameters.startDate}
                onChange={(d) => setParameters((p) => ({ ...p, startDate: d }))}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="Bis"
                value={parameters.endDate}
                onChange={(d) => setParameters((p) => ({ ...p, endDate: d }))}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            {selectedReport.id === 'customer-statement' && (
              <Grid item xs={12}>
                <TextField
                  select
                  label="Kunde"
                  value={parameters.customerId}
                  onChange={(e) => setParameters((p) => ({ ...p, customerId: e.target.value }))}
                  fullWidth
                  required
                >
                  <MenuItem value="">Bitte wählen</MenuItem>
                  {customers.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name} {c.nickname ? `(${c.nickname})` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            )}
          </Grid>
        );
      case 'daily-summary':
        return (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="Datum"
                value={parameters.date}
                onChange={(d) => setParameters((p) => ({ ...p, date: d }))}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Geschäftsbeginn (Stunde)"
                type="number"
                value={parameters.startHour}
                onChange={(e) => setParameters((p) => ({ ...p, startHour: parseInt(e.target.value) || 0 }))}
                fullWidth
                inputProps={{ min: 0, max: 23 }}
                helperText="Startzeit für den Geschäftstag (0-23 Uhr)"
              />
            </Grid>
          </Grid>
        );
      case 'monthly-summary':
        return (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Jahr"
                type="number"
                value={parameters.year}
                onChange={(e) => setParameters((p) => ({ ...p, year: parseInt(e.target.value) }))}
                fullWidth
                inputProps={{ min: 2020, max: new Date().getFullYear() + 1 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                label="Monat"
                value={parameters.month}
                onChange={(e) => setParameters((p) => ({ ...p, month: parseInt(e.target.value) }))}
                fullWidth
              >
                {[
                  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
                ].map((m, i) => (
                  <MenuItem key={i + 1} value={i + 1}>{m}</MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        );
      default:
        // Fallback for reports with no params
        return <Typography variant="body2" color="text.secondary">Keine Parameter erforderlich.</Typography>;
    }
  };

  // --- PREVIEW RENDERING ---
  const renderPreview = () => {
    if (selectedReport?.id !== 'daily-summary' || !previewData) return null;
    if (previewLoading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;

    const { summary, topArticles, hourlyDistribution } = previewData;
    const fmt = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);

    return (
      <Box sx={{ mt: 4, pt: 4, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <Typography variant="h6" gutterBottom sx={{ color: 'primary.light' }}>Vorschau (Tagesabschluss)</Typography>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} sm={3}>
            <GlassCard sx={{ p: 1, textAlign: 'center', bgcolor: 'rgba(33, 150, 243, 0.1)' }}>
              <Typography variant="caption" color="text.secondary">Umsatz Gesamt</Typography>
              <Typography variant="h6" color="white">{fmt(summary.totalRevenue)}</Typography>
            </GlassCard>
          </Grid>
          <Grid item xs={6} sm={3}>
            <GlassCard sx={{ p: 1, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Bar</Typography>
              <Typography variant="body1">{fmt(summary.cashRevenue)}</Typography>
            </GlassCard>
          </Grid>
          <Grid item xs={6} sm={3}>
            <GlassCard sx={{ p: 1, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Konto</Typography>
              <Typography variant="body1">{fmt(summary.accountRevenue)}</Typography>
            </GlassCard>
          </Grid>
          <Grid item xs={6} sm={3}>
            <GlassCard sx={{ p: 1, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Transaktionen</Typography>
              <Typography variant="body1">{summary.totalTransactions}</Typography>
            </GlassCard>
          </Grid>
        </Grid>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom color="text.secondary">Top Artikel</Typography>
            <Paper elevation={0} sx={{ bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 2, overflow: 'hidden' }}>
              {topArticles.length === 0 ? <Box p={2}><Typography variant="caption">Keine Verkäufe</Typography></Box> :
                topArticles.slice(0, 5).map((a, i) => (
                  <Box key={i} display="flex" justifyContent="space-between" sx={{
                    p: 1.5,
                    borderBottom: i < topArticles.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
                  }}>
                    <Typography variant="body2">{a.name}</Typography>
                    <Box textAlign="right">
                      <Typography variant="body2" fontWeight="bold">{a.quantity_sold}x</Typography>
                      <Typography variant="caption" color="text.secondary">{fmt(a.revenue)}</Typography>
                    </Box>
                  </Box>
                ))}
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom color="text.secondary">Verlauf (nach Stunden)</Typography>
            <Box sx={{ maxHeight: 300, overflowY: 'auto', bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 2, p: 2 }}>
              {hourlyDistribution.length === 0 ? <Typography variant="caption">Keine Daten</Typography> :
                hourlyDistribution.map((h, i) => (
                  <Box key={i} display="flex" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="caption" sx={{ width: 40 }}>{h.hour}:00</Typography>
                    <Box sx={{ flex: 1, mx: 1, height: 6, bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden' }}>
                      <Box sx={{ width: `${Math.min(100, (h.revenue / (summary.totalRevenue || 1)) * 100 * 1.5)}%`, height: '100%', bgcolor: 'primary.main' }} />
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 50, textAlign: 'right' }}>{fmt(h.revenue)}</Typography>
                  </Box>
                ))
              }
            </Box>
          </Grid>
        </Grid>
      </Box>
    );
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 } }}>
      <Typography variant="h3" gutterBottom sx={{ fontWeight: 700, mb: 4, background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Berichte & Exporte
      </Typography>

      <Grid container spacing={4}>
        <Grid item xs={12} md={5}>
          <GlassCard>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
                Verfügbare Berichte
              </Typography>
              <List sx={{ p: 0 }}>
                {exports.map((ex, index) => (
                  <React.Fragment key={ex.id}>
                    {index > 0 && <Divider sx={{ opacity: 0.1 }} />}
                    <ListItem
                      button
                      selected={selectedReport?.id === ex.id}
                      onClick={() => setSelectedReport(ex)}
                      sx={{
                        borderRadius: 2,
                        mb: 0.5,
                        transition: 'all 0.2s',
                        background: selectedReport?.id === ex.id ? 'rgba(33, 150, 243, 0.15)' : 'transparent',
                        '&:hover': {
                          background: selectedReport?.id === ex.id ? 'rgba(33, 150, 243, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                          transform: 'translateX(4px)'
                        },
                        borderLeft: selectedReport?.id === ex.id ? '4px solid #2196F3' : '4px solid transparent'
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>{getReportIcon(ex.id)}</ListItemIcon>
                      <ListItemText
                        primary={ex.name}
                        secondary={ex.description}
                        primaryTypographyProps={{ fontWeight: 600, color: 'text.primary' }}
                        secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary', noWrap: true }}
                      />
                      <ListItemSecondaryAction>
                        <Chip
                          icon={getFormatIcon(ex.format)}
                          label={ex.format}
                          size="small"
                          variant="outlined"
                          sx={{ borderColor: 'rgba(255,255,255,0.2)' }}
                        />
                      </ListItemSecondaryAction>
                    </ListItem>
                  </React.Fragment>
                ))}
              </List>
            </CardContent>
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={7}>
          <GlassCard sx={{ minHeight: 400, display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 3 }}>
                Einstellungen & Download
              </Typography>

              {selectedReport ? (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2,
                      mb: 4,
                      borderRadius: 2,
                      background: 'rgba(33, 150, 243, 0.1)',
                      border: '1px solid rgba(33, 150, 243, 0.2)'
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      {getReportIcon(selectedReport.id)}
                      <Typography variant="subtitle1" fontWeight={700}>
                        {selectedReport.name}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {selectedReport.description}
                    </Typography>
                  </Paper>

                  <Box sx={{ mb: 4, p: 2, borderRadius: 2, border: '1px dashed rgba(255,255,255,0.1)' }}>
                    {renderParams()}
                  </Box>

                  {error && (
                    <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                      {error}
                    </Alert>
                  )}

                  <Box sx={{ mt: 0 }}>
                    <Button
                      variant="contained"
                      size="large"
                      fullWidth
                      startIcon={downloading ? <CircularProgress size={20} color="inherit" /> : <Download />}
                      onClick={handleDownload}
                      disabled={downloading}
                      sx={{
                        py: 1.5,
                        borderRadius: 2,
                        fontSize: '1.1rem',
                        textTransform: 'none',
                        background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                        boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
                      }}
                    >
                      {downloading ? 'Wird erstellt...' : `Exportieren als ${selectedReport.format}`}
                    </Button>
                    <Typography variant="caption" display="block" textAlign="center" sx={{ mt: 1, color: 'text.disabled' }}>
                      Datei wird automatisch heruntergeladen sobald sie bereit ist.
                    </Typography>
                  </Box>

                  {/* PREVIEW SECTION */}
                  {renderPreview()}

                </Box>
              ) : (
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.5
                  }}
                >
                  <Description sx={{ fontSize: 64, mb: 2, color: 'text.secondary' }} />
                  <Typography variant="h6" color="text.secondary">
                    Bitte wählen Sie links einen Bericht aus
                  </Typography>
                </Box>
              )}
            </CardContent>
          </GlassCard>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Reports;
