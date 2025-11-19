import React, { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Button, TextField, MenuItem, Alert, List,
  ListItem, ListItemText, ListItemIcon, ListItemSecondaryAction, Divider, Chip
} from '@mui/material';
import {
  Download, Description, TableChart, PictureAsPdf, Receipt, Inventory,
  People, Assessment, AccountBalance, CalendarToday
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { format } from 'date-fns';

const Reports = () => {
  const [selectedReport, setSelectedReport] = useState(null);
  const [parameters, setParameters] = useState({
    startDate: null,
    endDate: null,
    customerId: '',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    date: new Date(),
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

  const exports = exportsData?.exports || [];
  const customers = customersData?.customers || [];

  const handleDownload = async () => {
    if (!selectedReport) return;
    setDownloading(true);
    setError(null);
    try {
      let url = `${API_ENDPOINTS.EXPORTS}/${selectedReport.id}`;
      const params = new URLSearchParams();

      switch (selectedReport.id) {
        case 'transactions':
          if (parameters.startDate) params.append('startDate', format(parameters.startDate, 'yyyy-MM-dd'));
          if (parameters.endDate) params.append('endDate', format(parameters.endDate, 'yyyy-MM-dd'));
          break;
        case 'daily-summary':
          if (parameters.date) params.append('date', format(parameters.date, 'yyyy-MM-dd'));
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
        // Optional: EÜR hier verfügbar machen (wenn backend-Liste ergänzt ist)
        case 'eur':
          if (parameters.startDate) params.append('startDate', format(parameters.startDate, 'yyyy-MM-dd'));
          if (parameters.endDate) params.append('endDate', format(parameters.endDate, 'yyyy-MM-dd'));
          break;
        default:
          break;
      }

      if (params.toString()) url += `?${params.toString()}`;

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
      setError('Fehler beim Download. Bitte versuchen Sie es erneut.');
      setDownloading(false);
    }
  };

  const getReportIcon = (id) => {
    switch (id) {
      case 'transactions': return <Receipt />;
      case 'inventory': return <Inventory />;
      case 'customers': return <People />;
      case 'daily-summary': return <CalendarToday />;
      case 'monthly-summary': return <Assessment />;
      case 'customer-statement': return <AccountBalance />;
      case 'eur': return <Assessment />;
      default: return <Description />;
    }
  };

  const getFormatIcon = (format) => (format === 'CSV' ? <TableChart /> : <PictureAsPdf />);

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
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="Bis"
                value={parameters.endDate}
                onChange={(d) => setParameters((p) => ({ ...p, endDate: d }))}
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
          <DatePicker
            label="Datum"
            value={parameters.date}
            onChange={(d) => setParameters((p) => ({ ...p, date: d }))}
          />
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
                inputProps={{ min: 2020, max: new Date().getFullYear() }}
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
        return null;
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Berichte & Exporte</Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Verfügbare Exporte</Typography>
              <List>
                {exports.map((ex) => (
                  <React.Fragment key={ex.id}>
                    <ListItem
                      button
                      selected={selectedReport?.id === ex.id}
                      onClick={() => setSelectedReport(ex)}
                    >
                      <ListItemIcon>{getReportIcon(ex.id)}</ListItemIcon>
                      <ListItemText primary={ex.name} secondary={ex.description} />
                      <ListItemSecondaryAction>
                        <Chip icon={getFormatIcon(ex.format)} label={ex.format} size="small" />
                      </ListItemSecondaryAction>
                    </ListItem>
                    <Divider />
                  </React.Fragment>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Export-Einstellungen</Typography>
              {selectedReport ? (
                <Box>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <strong>{selectedReport.name}</strong><br />
                    {selectedReport.description}
                  </Alert>

                  <Box sx={{ mb: 3 }}>{renderParams()}</Box>

                  {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    startIcon={<Download />}
                    onClick={handleDownload}
                    disabled={downloading}
                  >
                    {downloading ? 'Wird heruntergeladen…' : 'Export herunterladen'}
                  </Button>
                </Box>
              ) : (
                <Alert severity="info">Bitte wählen Sie einen Export aus der Liste aus.</Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Reports;
