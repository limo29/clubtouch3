/**
 * Zeilenmodell für "Artikel buchen" (Verkauf, Einkauf, Ausgangsrechnung).
 *
 * Eine Zeile hält Kisten und Einzelstücke GETRENNT:
 *   { key, articleId, name, unit, purchaseUnit, unitsPerPurchase, crateQty, baseQty, price, isFree, stock }
 * Der Verkauf setzt crateQty nie. Alle Operationen sind pure Funktionen
 * (lines → lines) und werden im Hook funktional angewendet (setLines(prev => ...)),
 * damit schnelle Doppeltipps keinen Klick verlieren.
 *
 * Serialisierer bilden auf die unveränderten Backend-Verträge ab:
 *   Verkauf  { articleId, quantity }
 *   Einkauf  { articleId, kisten, flaschen }
 *   Rechnung { articleId|null, description, quantity, pricePerUnit }
 */
import { useCallback, useMemo, useState } from 'react';
import { int, num } from '../utils/format';
import { crateFactor, fromBaseUnits, toBaseUnits } from '../utils/units';

const newKey = () =>
  `free-${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

/* ------------------------------ Zeile bauen ------------------------------ */

export const makeLine = (article, extra = {}) => ({
  key: article.id,
  articleId: article.id,
  name: article.name,
  unit: article.unit || 'Stück',
  purchaseUnit: article.purchaseUnit || 'Kiste',
  unitsPerPurchase: crateFactor(article),
  crateQty: 0,
  baseQty: 0,
  price: num(article.price),
  stock: num(article.stock),
  isFree: false,
  ...extra,
});

export const makeFreeLine = (extra = {}) => ({
  key: newKey(),
  articleId: null,
  name: '',
  unit: 'Stück',
  purchaseUnit: 'Kiste',
  unitsPerPurchase: 1,
  crateQty: 0,
  baseQty: 1,
  price: 0,
  stock: 0,
  isFree: true,
  ...extra,
});

/* ------------------------------- Kennzahlen ------------------------------ */

export const lineTotalQty = (line) => toBaseUnits(line.crateQty, line.baseQty, line.unitsPerPurchase);
export const lineAmount = (line) => num(line.price) * lineTotalQty(line);
export const linesTotalQty = (lines) => lines.reduce((s, l) => s + lineTotalQty(l), 0);
export const linesTotalAmount = (lines) => lines.reduce((s, l) => s + lineAmount(l), 0);
export const findLine = (lines, key) => lines.find((l) => l.key === key);

/* ---------------------------- pure Operationen --------------------------- */

const normalizeLine = (line) => ({
  ...line,
  crateQty: int(line.crateQty),
  baseQty: int(line.baseQty),
});

/** Zeilen ohne Menge entfernen (freie Zeilen mit Menge 0 ebenfalls) */
const prune = (lines) => lines.filter((l) => lineTotalQty(l) > 0);

/** Artikel hinzufügen: +units Einzelstücke und/oder +crates Kisten */
export const addArticle = (lines, article, { units = 1, crates = 0 } = {}) => {
  const exists = lines.find((l) => l.key === article.id && !l.isFree);
  if (exists) {
    return lines.map((l) =>
      l.key === article.id && !l.isFree
        ? normalizeLine({ ...l, baseQty: l.baseQty + units, crateQty: l.crateQty + crates })
        : l
    );
  }
  return [...lines, normalizeLine(makeLine(article, { baseQty: units, crateQty: crates }))];
};

/** Mengen relativ ändern; Zeile verschwindet, wenn Gesamtmenge 0 wird */
export const adjustLine = (lines, key, { baseDelta = 0, crateDelta = 0 } = {}) =>
  prune(
    lines.map((l) =>
      l.key === key
        ? normalizeLine({ ...l, baseQty: Math.max(0, l.baseQty + baseDelta), crateQty: Math.max(0, l.crateQty + crateDelta) })
        : l
    )
  );

/** Mengen absolut setzen (undefined = unverändert); Menge 0 gesamt entfernt die Zeile */
export const setLineQty = (lines, key, { baseQty, crateQty } = {}) =>
  prune(
    lines.map((l) =>
      l.key === key
        ? normalizeLine({
            ...l,
            baseQty: baseQty === undefined ? l.baseQty : int(baseQty),
            crateQty: crateQty === undefined ? l.crateQty : int(crateQty),
          })
        : l
    )
  );

export const setLinePrice = (lines, key, price) =>
  lines.map((l) => (l.key === key ? { ...l, price: Math.max(0, num(price)) } : l));

export const setLineName = (lines, key, name) =>
  lines.map((l) => (l.key === key ? { ...l, name } : l));

export const removeLine = (lines, key) => lines.filter((l) => l.key !== key);

export const addFreeLine = (lines) => [...lines, makeFreeLine()];

/* ------------------------------ Serialisierer ---------------------------- */

/** Verkauf: [{ articleId, quantity }] in Basiseinheiten */
export const toSalePayload = (lines) =>
  lines
    .filter((l) => l.articleId && lineTotalQty(l) > 0)
    .map((l) => ({ articleId: l.articleId, quantity: lineTotalQty(l) }));

/** Einkauf: [{ articleId, kisten, flaschen }] – Umrechnung macht das Backend */
export const toPurchasePayload = (lines) =>
  lines
    .filter((l) => l.articleId && (l.crateQty > 0 || l.baseQty > 0))
    .map((l) => ({ articleId: l.articleId, kisten: int(l.crateQty), flaschen: int(l.baseQty) }));

/** Rechnung: [{ articleId|null, description, quantity, pricePerUnit }] in Basiseinheiten */
export const toInvoicePayload = (lines) =>
  lines
    .filter((l) => lineTotalQty(l) > 0)
    .map((l) => ({
      articleId: l.isFree ? null : l.articleId,
      description: (l.name || '').trim() || 'Position',
      quantity: lineTotalQty(l),
      pricePerUnit: num(l.price),
    }));

/* ------------------------- Zeilen aus Bestandsdaten ---------------------- */

/** Einkaufsbeleg-Positionen (purchaseUnitQuantity / baseUnitQuantity) → Zeilen */
export const linesFromPurchaseItems = (items = [], articles = []) => {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const out = [];
  for (const it of items) {
    if (!it?.articleId) continue;
    const article = byId.get(it.articleId);
    const crateQty = int(it.purchaseUnitQuantity);
    const baseQty = int(it.baseUnitQuantity);
    if (crateQty <= 0 && baseQty <= 0) continue;
    if (article) {
      out.push(makeLine(article, { crateQty, baseQty }));
    } else {
      // Artikel inzwischen gelöscht/unbekannt: Zeile trotzdem zeigen, damit nichts verloren geht
      out.push(makeLine(
        { id: it.articleId, name: it.description, unit: it.baseUnit || it.unit, purchaseUnit: it.purchaseUnit, unitsPerPurchase: 1, price: 0, stock: 0 },
        { crateQty, baseQty }
      ));
    }
  }
  return out;
};

/** Rechnungspositionen (quantity in Basiseinheiten) → Zeilen, Menge in Kisten + Stück zerlegt */
export const linesFromInvoiceItems = (items = [], articles = []) => {
  const byId = new Map(articles.map((a) => [a.id, a]));
  return items.map((it) => {
    const article = it.articleId ? byId.get(it.articleId) : null;
    if (!article) {
      return makeFreeLine({
        key: it.articleId || `free-${it.id}`,
        articleId: it.articleId || null,
        name: it.description || '',
        baseQty: int(it.quantity),
        price: num(it.pricePerUnit),
        isFree: !it.articleId,
      });
    }
    const { crateQty, baseQty } = fromBaseUnits(it.quantity, crateFactor(article));
    return makeLine(article, { crateQty, baseQty, price: num(it.pricePerUnit) });
  });
};

/* --------------------------------- Hook ---------------------------------- */

export function useArticleLines(initial = []) {
  const [lines, setLines] = useState(initial);

  const ops = useMemo(() => ({
    addArticle: (article, opts) => setLines((prev) => addArticle(prev, article, opts)),
    addCrate: (article) => setLines((prev) => addArticle(prev, article, { units: 0, crates: 1 })),
    adjust: (key, deltas) => setLines((prev) => adjustLine(prev, key, deltas)),
    setQty: (key, qty) => setLines((prev) => setLineQty(prev, key, qty)),
    setPrice: (key, price) => setLines((prev) => setLinePrice(prev, key, price)),
    setName: (key, name) => setLines((prev) => setLineName(prev, key, name)),
    remove: (key) => setLines((prev) => removeLine(prev, key)),
    addFree: () => setLines((prev) => addFreeLine(prev)),
    clear: () => setLines([]),
  }), []);

  const reset = useCallback((next) => setLines(Array.isArray(next) ? next : []), []);

  const totalAmount = useMemo(() => linesTotalAmount(lines), [lines]);
  const totalQty = useMemo(() => linesTotalQty(lines), [lines]);

  return {
    lines,
    setLines,
    reset,
    ...ops,
    totalAmount,
    totalQty,
    count: lines.length,
    isEmpty: lines.length === 0,
    toSalePayload: () => toSalePayload(lines),
    toPurchasePayload: () => toPurchasePayload(lines),
    toInvoicePayload: () => toInvoicePayload(lines),
  };
}

export default useArticleLines;
