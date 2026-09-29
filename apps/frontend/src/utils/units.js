/**
 * Umrechnung Kisten (Einkaufseinheit) <-> Basiseinheit (Flasche/Stück).
 * Der Kistenfaktor ist immer >= 1, damit "1 Kiste" nie still 0 Stück bucht.
 */
import { num, qty, qtyShort, unitLabel } from './format';

/** Kistenfaktor eines Artikels, nie < 1 */
export const crateFactor = (article) => Math.max(1, num(article?.unitsPerPurchase) || 1);

/** Hat der Artikel eine sinnvolle Kiste (Faktor > 1)? */
export const hasCrate = (article) => crateFactor(article) > 1;

/** Kisten + Einzelstücke → Basiseinheiten */
export const toBaseUnits = (crateQty, baseQty, factor) =>
  Math.max(0, num(crateQty)) * Math.max(1, num(factor) || 1) + Math.max(0, num(baseQty));

/** Basiseinheiten → { crateQty, baseQty } (größtmögliche Kistenzahl) */
export const fromBaseUnits = (total, factor) => {
  const f = Math.max(1, num(factor) || 1);
  const t = Math.max(0, num(total));
  if (f <= 1) return { crateQty: 0, baseQty: t };
  return { crateQty: Math.floor(t / f), baseQty: t - Math.floor(t / f) * f };
};

/**
 * Menge einer Zeile lesbar machen:
 *   "2 Kisten + 3 Fl. = 43 Flaschen" | "2 Kisten = 40 Flaschen" | "3 Flaschen"
 * line: { crateQty, baseQty, unit, purchaseUnit, unitsPerPurchase }
 */
export const describeLineQty = (line) => {
  const crateQty = Math.max(0, num(line?.crateQty));
  const baseQty = Math.max(0, num(line?.baseQty));
  const factor = crateFactor(line);
  const unit = line?.unit || 'Stück';
  const purchaseUnit = line?.purchaseUnit || 'Kiste';
  const total = toBaseUnits(crateQty, baseQty, factor);

  if (crateQty <= 0) return qty(baseQty, unit);
  const crates = `${crateQty} ${unitLabel(purchaseUnit, crateQty)}`;
  if (baseQty <= 0) return `${crates} = ${qty(total, unit)}`;
  return `${crates} + ${qtyShort(baseQty, unit)} = ${qty(total, unit)}`;
};
