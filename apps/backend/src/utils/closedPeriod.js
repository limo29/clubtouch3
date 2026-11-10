/**
 * Weiche Sperre für abgeschlossene Geschäftsjahre.
 *
 * Ein geschlossenes Geschäftsjahr (FiscalYear.closed, Snapshot in YearEndReport.detailsJson) ist von den
 * Kassenprüfern unterschrieben. Schreibende Aktionen, deren für EÜR/Kasse/Bank maßgebliches Datum (vor ODER
 * nach der Änderung) in einem solchen Jahr liegt, werden nicht verboten, aber:
 *   1. ohne Bestätigung → 409 { error, code: 'CLOSED_PERIOD', fiscalYear } und nichts wird geändert,
 *   2. mit Header `X-Confirm-Closed-Period: 1` → ausgeführt und in derselben DB-Transaktion als
 *      AuditLog `CLOSED_PERIOD_CHANGE` protokolliert (je betroffenem Jahr ein Eintrag).
 * Das Jahresabschluss-PDF eines geschlossenen Jahres listet diese Einträge als „Nachträgliche Änderungen“.
 *
 * Ablauf im Service (innerhalb von prisma.$transaction):
 *   const years = await closedPeriod.guard([altesDatum, neuesDatum], confirmed, tx);   // wirft 409
 *   … ändern …
 *   await closedPeriod.logChange(tx, years, { userId, entityType, entityId, operation, description, … });
 */
const prisma = require('./prisma');
const { parseLocalDate, endOfLocalDay } = require('./businessDay');

const ACTION = 'CLOSED_PERIOD_CHANGE';
const CONFIRM_HEADER = 'X-Confirm-Closed-Period';
const CACHE_MS = 10 * 1000;

let cache = null; // { at, years: [{ id, name, startDate, endDate, start, end }] }

/** Geschlossene Jahre (kurz gecacht; closeFiscalYear ruft invalidate()). */
async function getClosedYears(client = prisma) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.years;
  const rows = await client.fiscalYear.findMany({
    where: { closed: true },
    select: { id: true, name: true, startDate: true, endDate: true },
    orderBy: { startDate: 'asc' },
  });
  // Gleiche Grenzen wie die EÜR des Jahres: Starttag 00:00 bis Endtag 23:59:59.999 (lokal)
  const years = rows.map((fy) => ({ ...fy, start: parseLocalDate(fy.startDate), end: endOfLocalDay(fy.endDate) }));
  cache = { at: Date.now(), years };
  return years;
}

function invalidate() { cache = null; }

/** Geschlossenes Geschäftsjahr, in dem `date` liegt, sonst null. */
async function findClosedYear(date, client) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  const years = await getClosedYears(client);
  return years.find((fy) => t >= fy.start.getTime() && t <= fy.end.getTime()) || null;
}

/** Alle (verschiedenen) geschlossenen Jahre, die eines der Daten treffen. */
async function findClosedYears(dates, client) {
  const out = [];
  for (const d of dates || []) {
    const fy = await findClosedYear(d, client);
    if (fy && !out.some((x) => x.id === fy.id)) out.push(fy);
  }
  return out;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const fmtEUR = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

const publicYear = (fy) => ({ id: fy.id, name: fy.name, startDate: fy.startDate, endDate: fy.endDate });

/** 409-Fehler; passt zu allen sendError-Varianten (userError/status bzw. userFacing/statusCode). */
function closedPeriodError(fy) {
  const msg = `Das Geschäftsjahr „${fy.name}“ (${fmtDate(fy.startDate)} – ${fmtDate(fy.endDate)}) ist abgeschlossen. `
    + 'Diese Änderung betrifft eine Buchung aus diesem Zeitraum. Sie wird nur nach Bestätigung ausgeführt und im '
    + 'Kassenprüfungsbericht als nachträgliche Änderung ausgewiesen.';
  return Object.assign(new Error(msg), {
    userError: true, status: 409, userFacing: true, statusCode: 409,
    code: 'CLOSED_PERIOD',
    payload: { code: 'CLOSED_PERIOD', fiscalYear: publicYear(fy) },
  });
}

/**
 * Prüft die Daten gegen geschlossene Jahre. Ohne Bestätigung → wirft 409 (closedPeriodError).
 * @returns {Promise<Array>} betroffene Jahre (leer = offener Zeitraum)
 */
async function guard(dates, confirmed, client) {
  const years = await findClosedYears(dates, client);
  if (years.length && !confirmed) throw closedPeriodError(years[0]);
  return years;
}

/** Bestätigung aus dem Request (Header statt Body, weil auch multipart und DELETE betroffen sind). */
function isConfirmed(req) {
  const v = req && typeof req.get === 'function' ? req.get(CONFIRM_HEADER) : undefined;
  return v === '1' || String(v).toLowerCase() === 'true';
}

/** Antwortet auf einen 409-Sperrfehler; true, wenn behandelt. Für Controller mit eigenem sendError. */
function sendClosedPeriod(res, error) {
  if (!error || error.code !== 'CLOSED_PERIOD') return false;
  res.status(409).json({ error: error.message, ...(error.payload || {}) });
  return true;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Protokolliert die Änderung je betroffenem geschlossenen Jahr (innerhalb der DB-Transaktion `client`).
 * entry: { userId, entityType, entityId, operation, description, kind?, amountBefore?, amountAfter?, effect?, details? }
 *   kind: 'income' (Vorgabe) oder 'expense' – ob die Beträge Einnahmen oder Ausgaben der EÜR sind
 *   amountBefore/amountAfter: EÜR-Betrag der Buchung im abgeschlossenen Jahr vorher/nachher (positiv; null = keine EÜR-Buchung)
 *   effect: Auswirkung auf den Überschuss (Vorgabe aus den Beträgen), null = ergebnisneutral (Guthaben, Bank, Entwurf)
 */
async function logChange(client, years, entry) {
  if (!years || !years.length) return;
  const { userId, entityType, entityId, operation, description, details } = entry;
  for (const fy of years) {
    // Beträge dürfen Funktionen (fy) => Zahl sein, wenn sie vom Jahr abhängen (z. B. Zahldatum im Jahr oder nicht)
    const val = (v) => (typeof v === 'function' ? v(fy) : v);
    const amountBefore = val(entry.amountBefore) ?? null;
    const amountAfter = val(entry.amountAfter) ?? null;
    const effect = val(entry.effect);
    // effect = Auswirkung auf den Überschuss des Jahres: Einnahme nachher - vorher, bei Ausgaben umgekehrt
    const sign = entry.kind === 'expense' ? -1 : 1;
    const eff = effect !== undefined
      ? (effect === null ? null : round2(effect))
      : (amountBefore === null && amountAfter === null ? null : round2(sign * (Number(amountAfter || 0) - Number(amountBefore || 0))));
    await client.auditLog.create({
      data: {
        userId,
        action: ACTION,
        entityType,
        entityId: String(entityId),
        changes: {
          fiscalYearId: fy.id,
          fiscalYearName: fy.name,
          operation,
          description,
          // Betrag der Buchung in diesem Jahr (EÜR) vor/nach der Änderung; kind sagt, ob Einnahme oder Ausgabe
          amountBefore: amountBefore === null ? null : round2(amountBefore),
          amountAfter: amountAfter === null ? null : round2(amountAfter),
          kind: amountBefore === null && amountAfter === null ? null : (entry.kind === 'expense' ? 'expense' : 'income'),
          effect: eff,
          ...(details ? { details } : {}),
        },
      },
    });
  }
}

/** Liegt `date` im (geschlossenen) Jahr fy? */
function inYear(date, fy) {
  if (!date || !fy) return false;
  const t = new Date(date).getTime();
  return t >= fy.start.getTime() && t <= fy.end.getTime();
}

/** Anzahl der protokollierten nachträglichen Änderungen je Geschäftsjahr-ID. */
async function countByYear(client = prisma) {
  const rows = await client.$queryRaw`
    SELECT changes->>'fiscalYearId' AS id, COUNT(*)::int AS n
    FROM "AuditLog" WHERE action = ${ACTION}
    GROUP BY changes->>'fiscalYearId'`;
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/** Protokollierte Änderungen eines Jahres, älteste zuerst, mit Benutzername. */
async function listForYear(fiscalYearId, client = prisma) {
  return client.auditLog.findMany({
    where: { action: ACTION, changes: { path: ['fiscalYearId'], equals: fiscalYearId } },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { name: true } } },
  });
}

module.exports = {
  ACTION, CONFIRM_HEADER,
  getClosedYears, invalidate, findClosedYear, findClosedYears,
  guard, isConfirmed, closedPeriodError, sendClosedPeriod, logChange, inYear,
  countByYear, listForYear, fmtDate, fmtEUR,
};
