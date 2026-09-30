/**
 * Zentrale Cache-Aktualisierung nach Änderungen.
 *
 * Der QueryClient hält Daten 5 Minuten für frisch (App.js). Eine Mutation muss
 * deshalb jede Liste neu laden, die ihre Daten anzeigt – auch auf anderen Seiten,
 * die unter eigenem Schlüssel laden (z. B. Kunden im Verkauf und in Rechnungen).
 * Statt einzelne Schlüssel an jeder Stelle zu pflegen, nennt man hier die Bereiche.
 */
const GROUPS = {
  purchases: [
    'purchase-documents', 'purchase-suppliers', 'suppliers', 'purchaseDocument',
    'unassignedLieferscheine', 'unassigned-lieferscheine', 'receipts',
  ],
  // alles, was Kassen-Soll, Bank, EÜR oder Jahresabschluss rechnet
  finance: [
    'profit-loss', 'bank-reconciliation', 'cash-counts', 'cash-movements',
    'fy-preview', 'fiscal-years', 'report-preview', 'daily-summary', 'open-invoices-dashboard',
  ],
  customers: [
    'customers', 'customers-sales', 'customers-invoice-pos', 'customers-list',
    'customer', 'customer-stats', 'customer-history', 'low-balance',
  ],
  stock: ['articles', 'low-stock'],
  sales: [
    'transactions', 'daily-summary', 'recent-transactions-dashboard', 'highscore-dashboard',
  ],
  invoices: ['invoices', 'invoice', 'open-invoices-dashboard'],
};

export function invalidate(queryClient, ...groups) {
  const keys = new Set(groups.flatMap((g) => GROUPS[g] || []));
  return queryClient.invalidateQueries({ predicate: (q) => keys.has(q.queryKey?.[0]) });
}
