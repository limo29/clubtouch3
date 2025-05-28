import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Button,
  TextField,
  MenuItem,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  IconButton,
  Divider,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Download,
  Description,
  TableChart,
  PictureAsPdf,
  DateRange,
  Receipt,
  Inventory,
  People,
  Assessment,
  AccountBalance,
  CalendarToday,
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

  // Fetch available exports
  const { data: exportsData } = useQuery({
    queryKey: ['exports'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.EXPORTS);
      return response.data;
    },
  });

  // Fetch customers for dropdown
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

      // Add parameters based on report type
      switch (selectedReport.id) {
        case 'transactions':
          if (parameters.startDate) {
            params.append('startDate', format(parameters.startDate, 'yyyy-MM-dd'));
          }
          if (parameters.endDate) {
            params.append('endDate', format(parameters.endDate, 'yyyy-MM-dd'));
          }
          break;
        
        case 'daily-summary':
          if (parameters.date) {
            params.append('date', format(parameters.date, 'yyyy-MM-dd'));
          }
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
          if (parameters.startDate) {
            params.append('startDate', format(parameters.startDate, 'yyyy-MM-dd'));
          }
          if (parameters.endDate) {
            params.append('endDate', format(parameters.endDate, 'yyyy-MM-dd'));
          }
          break;
      }

      // Add params to URL if any
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      // Download file
      const response = await api.get(url, {
        responseType: 'blob',
      });

      // Create download link
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers['content-disposition'];
      let filename = `export_${selectedReport.id}_${Date.now()}.${selectedReport.format.toLowerCase()}`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
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

  const getReportIcon = (reportId) => {
    switch (reportId) {
      case 'transactions':
        return <Receipt />;
      case 'inventory':
        return <Inventory />;
      case 'customers':
        return <People />;
      case 'daily-summary':
        return <CalendarToday />;
      case 'monthly-summary':
        return <Assessment />;
      case 'customer-statement':
        return <AccountBalance />;
      default:
        return <Description />;
    }
  };

  const getFormatIcon = (format) => {
    return format === 'CSV' ? <TableChart /> : <PictureAsPdf />;
  };

  const renderParameterInputs = () => {
    if (!selectedReport) return null;

    switch (selectedReport.id) {
      case 'transactions':
      case 'customer-statement':
        return (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="Von"
                value={parameters.startDate}
                onChange={(date) => setParameters({ ...parameters, startDate: date })}
                renderInput={(params) => <TextField {...params} fullWidth />}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="Bis"
                value={parameters.endDate}
                onChange={(date) => setParameters({ ...parameters, endDate: date })}
                renderInput={(params) => <TextField {...params} fullWidth />}
              />
            </Grid>
            {selectedReport.id === 'customer-statement' && (
              <Grid item xs={12}>
                <TextField
                  select
                  label="Kunde"
                  value={parameters.customerId}
                  onChange={(e) => setParameters({ ...parameters, customerId: e.target.value })}
                  fullWidth
                  required
                >
                  <MenuItem value="">Bitte wählen</MenuItem>
                  {customers.map((customer) => (
                    <MenuItem key={customer.id} value={customer.id}>
                      {customer.name} {customer.nickname && `(${customer.nickname})`}
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
            onChange={(date) => setParameters({ ...parameters, date })}
            renderInput={(params) => <TextField {...params} fullWidth />}
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
                onChange={(e) => setParameters({ ...parameters, year: parseInt(e.target.value) })}
                fullWidth
                inputProps={{ min: 2020, max: new Date().getFullYear() }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                label="Monat"
                value={parameters.month}
                onChange={(e) => setParameters({ ...parameters, month: parseInt(e.target.value) })}
                fullWidth
              >
                {[
                  { value: 1, label: 'Januar' },
                  { value: 2, label: 'Februar' },
                  { value: 3, label: 'März' },
                  { value: 4, label: 'April' },
                  { value: 5, label: 'Mai' },
                  { value: 6, label: 'Juni' },
                  { value: 7, label: 'Juli' },
                  { value: 8, label: 'August' },
                  { value: 9, label: 'September' },
                  { value: 10, label: 'Oktober' },
                  { value: 11, label: 'November' },
                  { value: 12, label: 'Dezember' },
                ].map((month) => (
                  <MenuItem key={month.value} value={month.value}>
                    {month.label}
                  </MenuItem>
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
      <Typography variant="h4" gutterBottom>
        Berichte & Exporte
      </Typography>

      <Grid container spacing={3}>
        {/* Export List */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Verfügbare Exporte
              </Typography>
              <List>
                {exports.map((export_) => (
                  <React.Fragment key={export_.id}>
                    <ListItem
                      button
                      selected={selectedReport?.id === export_.id}
                      onClick={() => setSelectedReport(export_)}
                    >
                      <ListItemIcon>
                        {getReportIcon(export_.id)}
                      </ListItemIcon>
                      <ListItemText
                        primary={export_.name}
                        secondary={export_.description}
                      />
                      <ListItemSecondaryAction>
                        <Chip
                          icon={getFormatIcon(export_.format)}
                          label={export_.format}
                          size="small"
                        />
                      </ListItemSecondaryAction>
                    </ListItem>
                    <Divider />
                  </React.Fragment>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* Parameter Form */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Export-Einstellungen
              </Typography>
              
              {selectedReport ? (
                <Box>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <strong>{selectedReport.name}</strong><br />
                    {selectedReport.description}
                  </Alert>
                  
                  <Box sx={{ mb: 3 }}>
                    {renderParameterInputs()}
                  </Box>
                  
                  {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                      {error}
                    </Alert>
                  )}
                  
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    startIcon={<Download />}
                    onClick={handleDownload}
                    disabled={downloading}
                  >
                    {downloading ? 'Wird heruntergeladen...' : 'Export herunterladen'}
                  </Button>
                </Box>
              ) : (
                <Alert severity="info">
                  Bitte wählen Sie einen Export aus der Liste aus.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Info Cards */}
        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    <TableChart sx={{ verticalAlign: 'middle', mr: 1 }} />
                    CSV-Exporte
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    CSV-Dateien können in Excel, LibreOffice oder anderen Tabellenkalkulationsprogrammen 
                    geöffnet werden. Ideal für weitere Auswertungen und Analysen.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    <PictureAsPdf sx={{ verticalAlign: 'middle', mr: 1 }} />
                    PDF-Berichte
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    PDF-Berichte sind formatiert und druckfertig. Perfekt für Archivierung, 
                    Buchhaltung oder Präsentationen.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    <DateRange sx={{ verticalAlign: 'middle', mr: 1 }} />
                    Zeiträume
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Viele Exporte unterstützen flexible Zeiträume. Wählen Sie Start- und 
                    Enddatum für genau die Daten, die Sie benötigen.
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

export default Reports;
