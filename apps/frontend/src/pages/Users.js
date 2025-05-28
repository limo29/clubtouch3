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
  Chip,
  Grid,
  MenuItem,
  Alert,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import {
  Add,
  Edit,
  PersonOff,
  PersonAdd,
  AdminPanelSettings,
  PointOfSale,
  AccountBalance,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

const Users = () => {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  
  const { control, handleSubmit, reset, formState: { errors } } = useForm();

  // Fetch users
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await api.get(API_ENDPOINTS.USERS);
      return response.data;
    },
  });

  // Create/Update user mutation
  const userMutation = useMutation({
    mutationFn: async (data) => {
      if (editingUser) {
        const response = await api.put(`${API_ENDPOINTS.USERS}/${editingUser.id}`, data);
        return response.data;
      } else {
        const response = await api.post(API_ENDPOINTS.USERS, data);
        return response.data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      handleCloseDialog();
    },
  });

  // Toggle user status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async (userId) => {
      const response = await api.patch(`${API_ENDPOINTS.USERS}/${userId}/toggle-status`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
    },
  });

  const users = usersData?.users || [];

  const handleOpenDialog = (user = null) => {
    setEditingUser(user);
    if (user) {
      reset({
        name: user.name,
        email: user.email,
        role: user.role,
        password: '',
      });
    } else {
      reset({
        name: '',
        email: '',
        role: 'CASHIER',
        password: '',
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingUser(null);
    reset();
    setShowPassword(false);
  };

  const onSubmit = (data) => {
    // Remove empty password when editing
    if (editingUser && !data.password) {
      delete data.password;
    }
    
    userMutation.mutate(data);
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'ADMIN':
        return <AdminPanelSettings />;
      case 'CASHIER':
        return <PointOfSale />;
      case 'ACCOUNTANT':
        return <AccountBalance />;
      default:
        return null;
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'ADMIN':
        return 'Administrator';
      case 'CASHIER':
        return 'Kassierer';
      case 'ACCOUNTANT':
        return 'Buchhaltung';
      default:
        return role;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'ADMIN':
        return 'error';
      case 'CASHIER':
        return 'primary';
      case 'ACCOUNTANT':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Benutzerverwaltung
      </Typography>

      {/* Actions Bar */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => handleOpenDialog()}
        >
          Neuer Benutzer
        </Button>
      </Paper>

      {/* Warning for last admin */}
      {users.filter(u => u.role === 'ADMIN' && u.active).length === 1 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Achtung: Es gibt nur einen aktiven Administrator. Stellen Sie sicher, dass immer mindestens ein Administrator aktiv bleibt.
        </Alert>
      )}

      {/* Users Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>E-Mail</TableCell>
              <TableCell>Rolle</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Erstellt am</TableCell>
              <TableCell align="right">Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Typography variant="body2">
                    {user.name}
                    {user.id === currentUser?.id && (
                      <Chip label="Du" size="small" sx={{ ml: 1 }} />
                    )}
                  </Typography>
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Chip
                    icon={getRoleIcon(user.role)}
                    label={getRoleLabel(user.role)}
                    size="small"
                    color={getRoleColor(user.role)}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.active ? 'Aktiv' : 'Inaktiv'}
                    color={user.active ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  {new Date(user.createdAt).toLocaleDateString('de-DE')}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Bearbeiten">
                    <IconButton
                      size="small"
                      onClick={() => handleOpenDialog(user)}
                    >
                      <Edit />
                    </IconButton>
                  </Tooltip>
                  {user.id !== currentUser?.id && (
                    <Tooltip title={user.active ? 'Deaktivieren' : 'Aktivieren'}>
                      <IconButton
                        size="small"
                        color={user.active ? 'error' : 'success'}
                        onClick={() => toggleStatusMutation.mutate(user.id)}
                        disabled={
                          user.role === 'ADMIN' && 
                          user.active && 
                          users.filter(u => u.role === 'ADMIN' && u.active).length === 1
                        }
                      >
                        {user.active ? <PersonOff /> : <PersonAdd />}
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* User Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>
            {editingUser ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}
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
                  name="email"
                  control={control}
                  rules={{ 
                    required: 'E-Mail ist erforderlich',
                    pattern: {
                      value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                      message: 'Ungültige E-Mail-Adresse'
                    }
                  }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="E-Mail"
                      type="email"
                      error={!!errors.email}
                      helperText={errors.email?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="role"
                  control={control}
                  defaultValue="CASHIER"
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Rolle"
                      select
                    >
                      <MenuItem value="ADMIN">
                        <Box display="flex" alignItems="center">
                          <AdminPanelSettings sx={{ mr: 1 }} />
                          Administrator
                        </Box>
                      </MenuItem>
                      <MenuItem value="CASHIER">
                        <Box display="flex" alignItems="center">
                          <PointOfSale sx={{ mr: 1 }} />
                          Kassierer
                        </Box>
                      </MenuItem>
                      <MenuItem value="ACCOUNTANT">
                        <Box display="flex" alignItems="center">
                          <AccountBalance sx={{ mr: 1 }} />
                          Buchhaltung
                        </Box>
                      </MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Controller
                  name="password"
                  control={control}
                  rules={{ 
                    required: editingUser ? false : 'Passwort ist erforderlich',
                    minLength: {
                      value: 8,
                      message: 'Passwort muss mindestens 8 Zeichen lang sein'
                    }
                  }}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label={editingUser ? 'Neues Passwort (optional)' : 'Passwort'}
                      type={showPassword ? 'text' : 'password'}
                      error={!!errors.password}
                      helperText={errors.password?.message || (editingUser && 'Leer lassen, um Passwort nicht zu ändern')}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowPassword(!showPassword)}
                              edge="end"
                            >
                              {showPassword ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
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
              disabled={userMutation.isLoading}
            >
              {userMutation.isLoading ? 'Speichere...' : 'Speichern'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Users;
