/** Formatierung für den Clubscore (Geld/Mengen über utils/format.js). */
import { money, fmtNumber, num, unitLabel } from '../../utils/format';

export const isAmount = (mode) => String(mode).toUpperCase() === 'AMOUNT';

/** Wert einer Wertung: "12,50 €" bzw. "12 Stk" (Podium und Liste gleich) */
export const scoreText = (mode, v) => (isAmount(mode) ? money(v) : `${fmtNumber(Math.round(num(v)))} Stk`);

/** Abstand zum Vordermann: "+3,50 € bis Platz 3" (null bei Rang 1 oder ohne Abstand) */
export const gapText = (mode, entry, prevRank) => {
  const gap = num(entry?.gapToPrev);
  if (entry?.gapToPrev === null || entry?.gapToPrev === undefined || !prevRank) return null;
  if (gap <= 0) return `Gleichstand mit Platz ${prevRank}`;
  const v = isAmount(mode) ? money(gap) : `${fmtNumber(Math.ceil(gap))} Stk`;
  return `+${v} bis Platz ${prevRank}`;
};

export const displayName = (e) => (e?.customerNickname || e?.customerName || e?.name || '–');

export const timeHM = (d) => (d ? new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '');

export const dateDE = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : '');

/** "06:00" / "01.01." für die Statuszeile */
export const dayMonth = (d) => (d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '');

export const VIEW_LABELS = { amount: 'Umsatz', count: 'Anzahl', teams: 'Teams', rotate: 'Wechselnd' };

/** Zielmenge lesbar: Umsatz in €, Artikel in Basiseinheit, Kategorie in Stück */
export const goalValueText = (goal, v) => {
  if (goal?.kind === 'REVENUE') return money(v);
  const n = Math.round(num(v));
  if (goal?.kind === 'ARTICLE') return `${fmtNumber(n)} ${unitLabel(goal.unit || 'Stück', n)}`;
  return `${fmtNumber(n)} Stk`;
};
