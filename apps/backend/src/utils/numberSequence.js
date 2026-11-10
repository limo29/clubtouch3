// Fortlaufende Nummernkreise (Kundenrechnungen, Einkaufsbelege).
//
// Die höchste je vergebene Nummer steht als Zähler im SystemSetting (z.B. `invoice.lastNumber.2026`).
// Dadurch wird eine Nummer auch nach dem endgültigen Löschen des letzten Belegs nie wieder vergeben.
// Beim ersten Aufruf je Jahr wird der Zähler aus dem Bestand initialisiert (höchste vorhandene Nummer).
//
// Das UPDATE ... RETURNING sperrt die Zählerzeile bis zum Ende der Transaktion; parallele Vergaben
// warten also aufeinander und bekommen verschiedene Nummern. Trotzdem gilt: Aufrufer fangen P2002
// auf der Nummernspalte ab und wiederholen die ganze Transaktion (withNumberRetry).

/**
 * Nächste Nummer eines Kreises innerhalb der Transaktion `tx`.
 * @param {object} tx         Prisma-Transaktionsclient
 * @param {string} key        SystemSetting-Schlüssel des Zählers
 * @param {number} existingMax höchste aktuell vorhandene Nummer im Bestand (für Initialisierung/Abgleich)
 * @param {string} description Beschreibung für den Zähler
 * @returns {Promise<number>}
 */
async function nextNumber(tx, key, existingMax, description) {
  const base = Math.max(0, Number(existingMax) || 0);
  await tx.$executeRaw`
    INSERT INTO "SystemSetting" ("key", "value", "description", "updatedAt")
    VALUES (${key}, ${String(base)}, ${description || null}, now())
    ON CONFLICT ("key") DO NOTHING`;
  const rows = await tx.$queryRaw`
    UPDATE "SystemSetting"
    SET "value" = (GREATEST(
          CASE WHEN "value" ~ '^[0-9]+$' THEN "value"::int ELSE 0 END,
          ${base}::int) + 1)::text,
        "updatedAt" = now()
    WHERE "key" = ${key}
    RETURNING "value"`;
  return Number(rows[0].value);
}

/** Höchste laufende Nummer aus einer Liste von Belegnummern (`<prefix><n>`). */
function maxFromNumbers(numbers, prefix) {
  let max = 0;
  for (const nr of numbers) {
    const s = String(nr || '');
    if (!s.startsWith(prefix)) continue;
    const n = parseInt(s.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

const isUniqueViolation = (err) => !!err && err.code === 'P2002';

/** Führt `fn` aus und wiederholt bei Eindeutigkeitsverletzung (P2002) bis zu `attempts`-mal. */
async function withNumberRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  const err = new Error('Belegnummer konnte nicht vergeben werden, bitte erneut versuchen');
  err.statusCode = 409;
  err.userFacing = true;
  err.cause = lastErr;
  throw err;
}

module.exports = { nextNumber, maxFromNumbers, withNumberRetry };
