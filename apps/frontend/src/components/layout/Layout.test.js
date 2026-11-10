// Navigation im Layout: Menüpunkte je Rolle. Die Rechte kommen aus config/permissions.js (echt, nicht gemockt),
// damit der Test auffällt, wenn Menü und Rechtetabelle auseinanderlaufen.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';
import { can as roleCan } from '../../config/permissions';

let mockRole = 'ADMIN';

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => {
    const { can } = jest.requireActual('../../config/permissions');
    return {
      logout: jest.fn(),
      isAdmin: mockRole === 'ADMIN',
      user: { name: 'Testnutzer', role: mockRole },
      can: (permission) => can(mockRole, permission),
    };
  },
}));

jest.mock('../../context/OfflineContext', () => ({
  useOffline: () => ({ isOnline: true, queue: [], failed: [] }),
}));

jest.mock('../../theme', () => ({
  useColorMode: () => ({ mode: 'dark', resolvedMode: 'dark', setMode: jest.fn(), toggleMode: jest.fn() }),
}));

// Eigene Datenabfragen dieser Bausteine gehören nicht in den Layout-Test
jest.mock('../offline/OfflineStatus', () => () => null);
jest.mock('../common/ChangePasswordDialog', () => () => null);

const renderLayout = (role) => {
  mockRole = role;
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Layout />
    </MemoryRouter>
  );
};

// Der Drawer wird je nach Breite doppelt gerendert (mobil + fest), daher getAllByText
const shown = (text) => screen.queryAllByText(text).length > 0;
const openGroup = (text) => fireEvent.click(screen.getAllByText(text)[0]);

describe('Navigation im Layout', () => {
  test('Admin sieht alle Hauptpunkte und Gruppen', () => {
    renderLayout('ADMIN');
    ['Verkauf', 'Dashboard', 'Clubscore', 'Werbung', 'Finanzen', 'Verwaltung'].forEach((label) => {
      expect(shown(label)).toBe(true);
    });
  });

  test('Gruppen zeigen ihre Unterpunkte', () => {
    renderLayout('ADMIN');
    if (!shown('Einkauf')) openGroup('Finanzen');
    ['Einkauf', 'Kundenrechnungen', 'Transaktionen', 'Kasse & Bank', 'Kassenprüfung', 'Berichte'].forEach((label) => {
      expect(shown(label)).toBe(true);
    });
    if (!shown('Artikel')) openGroup('Verwaltung');
    ['Artikel', 'Kunden', 'Benutzer'].forEach((label) => {
      expect(shown(label)).toBe(true);
    });
  });

  test('Kassenprüfer sieht keinen Verkauf, Kassierer keine Benutzerverwaltung', () => {
    expect(roleCan('ACCOUNTANT', 'sell')).toBe(false);
    const { unmount } = renderLayout('ACCOUNTANT');
    expect(shown('Verkauf')).toBe(false);
    expect(shown('Dashboard')).toBe(true);
    unmount();

    renderLayout('CASHIER');
    expect(shown('Verkauf')).toBe(true);
    if (!shown('Artikel')) openGroup('Verwaltung');
    expect(shown('Benutzer')).toBe(false);
  });
});
