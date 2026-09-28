// Zentrale Definition des Geschäftstags und lokales Datums-Parsing.
//
// Der Clubraum-Abend geht gerne bis in den Morgen. Deshalb beginnt ein
// Geschäftstag NICHT um Mitternacht, sondern um BUSINESS_DAY_START_HOUR.
// Ein Verkauf um 01:30 gehört zum Vortag. Das gilt für Tagesabschluss,
// Dashboard/Transaktionen-KPIs, Exporte und den Clubscore gleichermaßen.
//
// Zweites Problem, das hier gelöst wird: `new Date('2026-09-28')` ist in
// JavaScript UTC-Mitternacht, also 02:00 lokal (MESZ). Query-Parameter im
// Format YYYY-MM-DD müssen deshalb immer über parseLocalDate() laufen.

const BUSINESS_DAY_START_HOUR = 6;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 'YYYY-MM-DD' -> Date um 00:00 LOKAL.
 * Date-Objekte und vollständige ISO-Strings (mit Uhrzeit) werden unverändert
 * durchgereicht. null/undefined -> null.
 */
function parseLocalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return new Date(value.getTime());
  const m = DATE_ONLY.exec(String(value).trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Letzte Millisekunde des Kalendertags (lokal). */
function endOfLocalDay(date) {
  const d = parseLocalDate(date);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Fenster des Geschäftstags.
 *
 * Zwei Arten von Eingabe, die sich bewusst unterschiedlich verhalten:
 *  - Zeitstempel (Date-Objekt, z.B. `new Date()`): "In welchen Geschäftstag
 *    fällt dieser Moment?" Liegt er vor startHour, ist es noch der Vortag.
 *  - Reines Datum ('YYYY-MM-DD', so kommt es aus dem Datepicker): "Gib mir
 *    den Geschäftstag DIESES Kalendertags", also startHour dieses Tages bis
 *    startHour des Folgetags. Keine Verschiebung.
 *
 * @returns {{ start: Date, end: Date, businessDate: Date, startHour: number }}
 *   start  = businessDate @ startHour:00:00.000
 *   end    = start + 24h - 1ms
 *   businessDate = Kalendertag des Geschäftstags um 00:00 lokal
 */
function businessDayWindow(date = new Date(), startHour = BUSINESS_DAY_START_HOUR) {
  const isDateOnly = typeof date === 'string' && DATE_ONLY.test(date.trim());
  const ref = parseLocalDate(date) || new Date();
  const businessDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
  if (!isDateOnly && ref.getHours() < startHour) {
    businessDate.setDate(businessDate.getDate() - 1);
  }
  const start = new Date(businessDate);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setTime(end.getTime() - 1);
  return { start, end, businessDate, startHour };
}

/** 'YYYY-MM-DD' in LOKALER Zeit (nicht toISOString, das wäre UTC). */
function formatLocalDate(date) {
  const d = parseLocalDate(date);
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Anzeige-Label für die UI, z.B. "06:00 → 06:00". */
function businessDayLabel(startHour = BUSINESS_DAY_START_HOUR) {
  const h = String(startHour).padStart(2, '0');
  return `${h}:00 → ${h}:00`;
}

module.exports = {
  BUSINESS_DAY_START_HOUR,
  parseLocalDate,
  endOfLocalDay,
  businessDayWindow,
  formatLocalDate,
  businessDayLabel,
};
