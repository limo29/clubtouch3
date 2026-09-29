import { format } from "date-fns";

/**
 * Hilfen rund um Einkaufsbelege (Rechnung / Lieferschein).
 */

const qtyFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** Summiert die gebuchten Positionen je Einheit: "43 Flasche, 20 Glas". Leer, wenn nichts gebucht. */
export function summarizeItems(items = []) {
  const byUnit = new Map();
  for (const it of items || []) {
    const q = Number(it?.quantity) || 0;
    if (!q) continue;
    const unit = it.unit || "Stk";
    byUnit.set(unit, (byUnit.get(unit) || 0) + q);
  }
  return [...byUnit.entries()].map(([unit, q]) => `${qtyFmt.format(q)} ${unit}`).join(", ");
}

/** "LS-2026-0001 vom 12.03.2026" */
export function lieferscheinLabel(ls) {
  if (!ls) return "";
  let d = "";
  try { d = format(new Date(ls.documentDate), "dd.MM.yyyy"); } catch { d = ""; }
  return d ? `${ls.documentNumber} vom ${d}` : ls.documentNumber;
}
