import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Chip, useMediaQuery } from '@mui/material';
import { Undo, WarningAmber, CheckCircle, AccountBalanceWallet, LocalBar } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@mui/material/styles';
import api from '../../services/api';
import { useSales } from '../../context/SalesContext';
import { alpha } from '@mui/material/styles';

const LastTransactionDisplay = () => {
    const { lastTransaction, clearLastTransaction } = useSales();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const queryClient = useQueryClient();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    if (!lastTransaction) return null;

    const { id, type, description, amount, customerName, timestamp, isTopUp, itemCount, customerId } = lastTransaction;

    // Mobile Text Logic
    const mobileText = isTopUp
        ? `${new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)} von ${customerName}`
        : `${itemCount}x 🍺 ${type === 'CUSTOMER' ? 'an ' + customerName : (type === 'OWNER' ? 'Wirt' : 'Bar')}`;

    const displayText = isMobile ? mobileText : description;

    // determine colors based on type
    // CASH = Success/Green
    // ACCOUNT/CUSTOMER = Info/Blue
    // OWNER = Warning/Orange
    // TOPUP = Secondary/Purple

    let color = 'success';
    let icon = <CheckCircle fontSize="small" />;

    if (isTopUp) {
        color = 'secondary';
        icon = <AccountBalanceWallet fontSize="small" />;
    } else if (type === 'ACCOUNT' || type === 'CUSTOMER') {
        color = 'primary'; // or info
        icon = <AccountBalanceWallet fontSize="small" />;
    } else if (type === 'OWNER') {
        color = 'warning';
        icon = <LocalBar fontSize="small" />;
    }

    const handleRevoke = () => {
        setConfirmOpen(true);
    };

    const handleConfirmRevoke = async () => {
        try {
            if (isTopUp) {
                // For TopUp we need the topUpId. Assuming 'id' in lastTransaction passed is the topUp ID or we have a way to cancel it.
                // The implementation plan mentioned: /customers/{customerId}/topup/{topUpId}/cancel
                // We need to ensure lastTransaction HAS the correct ID for the mutation.
                // If the Sales.js passes the transaction ID, we might need to use the generic cancel if it's a global transaction,
                // OR specific topup cancel if it's special. 
                // However, the backend usually has a unified transaction ID or specific endpoints.
                // Let's assume we use the endpoint defined in Sales.js:
                // cancelTopUpMutation: api.post(`/customers/${historyCustomer.id}/topup/${topUpId}/cancel`)
                // Wait, if we don't have customerId easily, we might need to rely on the transaction ID if the backend supports it.
                // Re-checking Sales.js... it uses `cancelTransactionMutation` for sales and `cancelTopUpMutation` for topups.

                if (customerId) {
                    await api.post(`/customers/${customerId}/topup/${id}/cancel`);
                } else {
                    // Fallback or error
                    console.error("Missing customerId for TopUp cancellation");
                }
            } else {
                await api.post(`/transactions/${id}/cancel`);
            }

            // Success
            queryClient.invalidateQueries(['customers-sales']);
            queryClient.invalidateQueries(['customer-history']);
            clearLastTransaction();
            setConfirmOpen(false);
        } catch (error) {
            console.error("Failed to revoke", error);
            // Optional: Show error feedback
        }
    };

    return (
        <>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    bgcolor: (theme) => alpha(theme.palette[color].main, 0.1),
                    border: '1px solid',
                    borderColor: (theme) => alpha(theme.palette[color].main, 0.3),
                    borderRadius: 2,
                    px: 1.5,
                    py: 0.5,
                    mx: 2,
                    // Glassmorphism effect
                    backdropFilter: 'blur(4px)',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', mr: 2, color: `${color}.main` }}>
                    {icon}
                    <Typography
                        variant="body2"
                        sx={{
                            fontWeight: 700,
                            ml: 1,
                            whiteSpace: 'nowrap',
                            maxWidth: isMobile ? 180 : 'none',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}
                    >
                        {displayText}
                    </Typography>
                </Box>

                <Button
                    size="small"
                    variant="outlined"
                    color={color}
                    onClick={handleRevoke}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        height: 28,
                        minWidth: 'auto',
                        px: isMobile ? 1 : 1.5,
                        borderColor: (theme) => alpha(theme.palette[color].main, 0.5),
                        '&:hover': {
                            bgcolor: (theme) => alpha(theme.palette[color].main, 0.2),
                            borderColor: `${color}.main`,
                        }
                    }}
                >
                    {isMobile ? <Undo fontSize="small" /> : <><Undo sx={{ mr: 1, fontSize: '1.1rem' }} /> Rückgängig</>}
                </Button>
            </Box>

            <Dialog
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                PaperProps={{
                    sx: {
                        borderRadius: 3,
                        p: 1,
                        minWidth: 320
                    }
                }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
                    <WarningAmber /> Transaktion stornieren?
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body1">
                        Möchtest du <b>{description}</b> wirklich stornieren?
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Der Betrag wird dem Konto (falls vorhanden) bzw. der Kasse wieder gutgeschrieben.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)} color="inherit">
                        Abbrechen
                    </Button>
                    <Button
                        onClick={handleConfirmRevoke}
                        variant="contained"
                        color="error"
                        autoFocus
                    >
                        Stornieren bestätigen
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default LastTransactionDisplay;
