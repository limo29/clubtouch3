import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

const OfflineContext = createContext();

export const useOffline = () => useContext(OfflineContext);

export const OfflineProvider = ({ children }) => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [queue, setQueue] = useState(() => {
        try {
            const saved = localStorage.getItem('offline_queue');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Failed to load offline queue details', e);
            return [];
        }
    });

    // Listener for network status
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Persist queue
    useEffect(() => {
        localStorage.setItem('offline_queue', JSON.stringify(queue));
    }, [queue]);

    const addTransaction = (data) => {
        const transaction = {
            ...data,
            offlineId: Date.now() + Math.random().toString(36).substr(2, 9),
            createdAt: new Date().toISOString()
        };
        setQueue(prev => [...prev, transaction]);
        return transaction;
    };

    const isSyncing = React.useRef(false);

    const removeTransaction = (offlineId) => {
        setQueue(prev => prev.filter(t => t.offlineId !== offlineId));
    };

    const syncQueue = useCallback(async () => {
        if (!queue.length || !isOnline || isSyncing.current) return;

        isSyncing.current = true;
        const tx = queue[0];

        try {
            // Exclude internal offline fields before sending
            const { offlineId, createdAt, ...payload } = tx;

            // Determine endpoint based on payload or defaults
            // Currently assuming mostly sales/transactions
            let endpoint = API_ENDPOINTS.TRANSACTIONS;

            // Handle TopUps if we support them offline (checking Sales.js structure)
            // Note: Sales.js uses /customers/:id/topup
            if (tx.isTopUp) {
                endpoint = `/customers/${tx.customerId}/topup`;
            }

            await api.post(endpoint, payload);

            // specific success, remove from queue
            // This will trigger a state update -> re-render -> useEffect -> syncQueue for next item
            removeTransaction(tx.offlineId);
        } catch (error) {
            console.error('Failed to sync transaction', tx, error);
            // If it's a validation error (400), we might want to move it to a "failed" list 
            // to avoid blocking the queue forever.
            if (error.response && error.response.status >= 400 && error.response.status < 500) {
                // Potentially remove bad requests to unblock queue?
                // For now, we leave it. User might need to clear data.
            }
        } finally {
            isSyncing.current = false;
        }
    }, [queue, isOnline]);

    // Auto-sync when coming online
    useEffect(() => {
        if (isOnline && queue.length > 0) {
            syncQueue();
        }
    }, [isOnline, queue.length, syncQueue]);

    const value = {
        isOnline,
        queue,
        addTransaction,
        syncQueue
    };

    return (
        <OfflineContext.Provider value={value}>
            {children}
        </OfflineContext.Provider>
    );
};
