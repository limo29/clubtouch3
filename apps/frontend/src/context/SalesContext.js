import React, { createContext, useContext, useState } from 'react';

const SalesContext = createContext();

export const useSales = () => {
    const context = useContext(SalesContext);
    if (!context) {
        throw new Error('useSales must be used within a SalesProvider');
    }
    return context;
};

export const SalesProvider = ({ children }) => {
    const [lastTransaction, setLastTransaction] = useState(null);

    // Helper to clear transaction (can be called after timeout or manual dismiss if needed)
    const clearLastTransaction = () => setLastTransaction(null);

    const value = {
        lastTransaction,
        setLastTransaction,
        clearLastTransaction
    };

    return (
        <SalesContext.Provider value={value}>
            {children}
        </SalesContext.Provider>
    );
};
