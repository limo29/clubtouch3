/**
 * Was welche Rolle darf – Spiegel der authorize()-Regeln in apps/backend/src/routes.
 * Nur zum Ein- und Ausblenden in der Oberfläche; geprüft wird immer im Backend.
 * Abfrage über `can('sell')` aus useAuth().
 */
export const PERMISSIONS = {
  sell: ['ADMIN', 'CASHIER'],                      // Verkaufen, Verkauf stornieren
  editArticles: ['ADMIN', 'CASHIER'],              // Artikel anlegen, ändern, sortieren
  editCustomers: ['ADMIN', 'CASHIER'],             // Kunden und Gruppen anlegen/ändern, Guthaben aufladen
  customerContact: ['ADMIN', 'ACCOUNTANT', 'CASHIER'], // Anschrift, Telefon, E-Mail sehen und ändern
  deleteGroups: ['ADMIN'],
  editPurchases: ['ADMIN', 'CASHIER'],             // Lieferantenrechnungen und Lieferscheine anlegen/ändern
  deletePurchases: ['ADMIN', 'ACCOUNTANT'],
  editInvoices: ['ADMIN', 'CASHIER'],              // Kundenrechnungen anlegen/ändern, Status
  invoiceSettings: ['ADMIN'],
  manageFiscalYears: ['ADMIN', 'ACCOUNTANT'],      // Geschäftsjahr anlegen und abschließen
  cancelCashMovements: ['ADMIN', 'ACCOUNTANT'],
  editClubscore: ['ADMIN', 'CASHIER'],             // Ziele, Anzeige-Einstellung
  resetClubscore: ['ADMIN'],
  ads: ['ADMIN', 'CASHIER'],                       // Werbung / Slides
  financeReports: ['ADMIN', 'ACCOUNTANT'],         // Kundenliste, Monatsbericht, EÜR-Export
  users: ['ADMIN'],
};

export const can = (role, permission) => Boolean(PERMISSIONS[permission]?.includes(role));
