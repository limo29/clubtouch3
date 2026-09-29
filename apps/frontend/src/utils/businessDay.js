// Geschäftstag im Frontend: beginnt um 06:00 (Party geht über Mitternacht), Gegenstück zu
// apps/backend/src/utils/businessDay.js. Nur für Anzeige-Logik; Zahlen kommen immer vom Backend.
export const BUSINESS_DAY_START_HOUR = 6;

/** Beginn des Geschäftstags, in dem `now` liegt (vor 06:00 zählt noch der Vortag). */
export function businessDayStart(now = new Date(), startHour = BUSINESS_DAY_START_HOUR) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0, 0, 0);
  if (now.getHours() < startHour) start.setDate(start.getDate() - 1);
  return start;
}

/** Liegt `date` im aktuellen Geschäftstag? */
export function isCurrentBusinessDay(date, now = new Date()) {
  if (!date) return false;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  return d >= businessDayStart(now) && d <= now;
}
