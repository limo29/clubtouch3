/**
 * Felder, die die Offline-Warteschlange des Frontends mitschickt (Verkauf, Aufladung):
 * - clientId: Idempotenzschlüssel (8–64 Zeichen). Dieselbe clientId wird nur einmal gebucht.
 * - clientCreatedAt: Zeitpunkt der Buchung am Gerät. Wird übernommen, wenn gültig, nicht in der
 *   Zukunft (60 s Toleranz) und höchstens 7 Tage alt; sonst gilt die Serverzeit.
 */
const CLIENT_ID_MIN = 8;
const CLIENT_ID_MAX = 64;
const FUTURE_TOLERANCE_MS = 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeClientId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length >= CLIENT_ID_MIN && id.length <= CLIENT_ID_MAX ? id : null;
}

// Date oder null (= Serverzeit verwenden)
function resolveClientCreatedAt(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  if (t > now + FUTURE_TOLERANCE_MS) return null;
  if (t < now - MAX_AGE_MS) return null;
  // leicht in der Zukunft liegende Gerätezeit auf jetzt kappen
  return t > now ? new Date(now) : d;
}

module.exports = { CLIENT_ID_MIN, CLIENT_ID_MAX, normalizeClientId, resolveClientCreatedAt };
