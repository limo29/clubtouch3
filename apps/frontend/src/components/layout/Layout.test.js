
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Layout from './Layout';
import * as router from 'react-router-dom';

// Mock useNavigate
const navigate = jest.fn();

beforeEach(() => {
    jest.spyOn(router, 'useNavigate').mockImplementation(() => navigate);
});

// Mock AuthContext
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        logout: jest.fn(),
        isAdmin: true, // Mock as admin to see all links
        user: { name: 'Test User' }
    })
}));

// Mock ColorModeContext
jest.mock('../../theme/ColorModeContext', () => ({
    useColorMode: () => ({
        mode: 'light',
        resolvedMode: 'light',
        setMode: jest.fn(),
        toggleMode: jest.fn()
    })
}));

describe('Navigation Layout', () => {
    test('renders top level items and groups', () => {
        render(
            <BrowserRouter>
                <Layout />
            </BrowserRouter>
        );

        // Top level
        expect(screen.getByText('Verkauf')).toBeInTheDocument();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Highscore')).toBeInTheDocument();
        expect(screen.getByText('Werbung')).toBeInTheDocument();

        // Groups
        expect(screen.getByText('Finanzen')).toBeInTheDocument();
        expect(screen.getByText('Verwaltung')).toBeInTheDocument();
    });

    test('groups expand and show children', () => {
        render(
            <BrowserRouter>
                <Layout />
            </BrowserRouter>
        );

        const finanzen = screen.getByText('Finanzen');
        fireEvent.click(finanzen);

        expect(screen.getByText('Rechnungen')).toBeInTheDocument();
        expect(screen.getByText('Ausgaben')).toBeInTheDocument();
        expect(screen.getByText('Transaktionen')).toBeInTheDocument();
        expect(screen.getByText('EÜR')).toBeInTheDocument();
        expect(screen.getByText('Berichte')).toBeInTheDocument();

        const verwaltung = screen.getByText('Verwaltung');
        fireEvent.click(verwaltung);

        expect(screen.getByText('Artikel')).toBeInTheDocument();
        expect(screen.getByText('Kunden')).toBeInTheDocument();
        expect(screen.getByText('Benutzer')).toBeInTheDocument(); // Admin only
    });
});
