/**
 * Zentrale Formatierungshelfer (de-DE).
 * Geld: "2,50 €", Mengen: ganze Zahlen, Einheiten mit Plural/Kurzform.
 */

const moneyFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const numberFormatter = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Tolerantes Parsen: Zahl, "2,50", "2.50", null → 0 */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const x = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(x) ? 0 : x;
};

/** Ganze, nicht-negative Menge: "2,7" → 2, -1 → 0 */
export const int = (v) => Math.max(0, Math.trunc(num(v)));

/** "2,50 €" */
export const money = (v) => moneyFormatter.format(num(v));

/** "1.234,5" */
export const fmtNumber = (v) => numberFormatter.format(num(v));

const PLURALS = {
  Kiste: 'Kisten',
  Flasche: 'Flaschen',
  Stück: 'Stück',
  Dose: 'Dosen',
  Fass: 'Fässer',
  Glas: 'Gläser',
  Packung: 'Packungen',
  Karton: 'Kartons',
  Tüte: 'Tüten',
  Beutel: 'Beutel',
  Liter: 'Liter',
  Portion: 'Portionen',
  Tablett: 'Tabletts',
  Palette: 'Paletten',
};

const SHORTS = {
  Kiste: 'Ki.',
  Flasche: 'Fl.',
  Stück: 'Stk.',
  Dose: 'Do.',
  Packung: 'Pck.',
  Karton: 'Kt.',
  Portion: 'Port.',
};

/** Einheit im Plural, wenn n !== 1 ("2 Kisten", "1 Kiste") */
export const unitLabel = (unit, n = 2) => {
  const u = unit || 'Stück';
  if (num(n) === 1) return u;
  return PLURALS[u] || u;
};

/** Kurzform der Einheit ("Fl.", "Stk."), Fallback: Einheit selbst */
export const unitShort = (unit) => SHORTS[unit || 'Stück'] || unit || 'Stück';

/** "3 Flaschen", "1 Kiste" */
export const qty = (n, unit) => `${fmtNumber(n)} ${unitLabel(unit, n)}`;

/** "3 Fl." */
export const qtyShort = (n, unit) => `${fmtNumber(n)} ${unitShort(unit)}`;
