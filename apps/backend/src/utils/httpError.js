/**
 * Fachliche Fehler mit HTTP-Status (Verkauf, Kunden, Artikel).
 * Services werfen `userError('…', 404)`, Controller antworten über `sendError`:
 * fachliche Fehler mit ihrem Status und der deutschen Meldung, alles andere generisch mit 500
 * (ohne Prisma-Text, der nur ins Server-Log geht).
 */
function userError(message, status = 400) {
  return Object.assign(new Error(message), { userError: true, status });
}

function sendError(res, error, fallbackMessage, logLabel) {
  if (error && error.userError) {
    // payload: Zusatzfelder, z. B. { code: 'CLOSED_PERIOD', fiscalYear } der Sperre abgeschlossener Jahre
    return res.status(error.status || 400).json({ error: error.message, ...(error.payload || {}) });
  }
  console.error(logLabel || fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

// Unique-Verletzung (Prisma P2002), optional auf ein bestimmtes Feld eingeschränkt
function isUniqueViolation(error, field) {
  if (!error || error.code !== 'P2002') return false;
  if (!field) return true;
  const target = error.meta && error.meta.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === 'string' ? target.includes(field) : true;
}

module.exports = { userError, sendError, isUniqueViolation };
