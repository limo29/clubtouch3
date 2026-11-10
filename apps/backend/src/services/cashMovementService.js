// services/cashMovementService.js
//
// Kassenbewegungen ohne Verkauf. Sie sind der fehlende Baustein in der
// Soll-Herleitung der Kassenzählung: Bargeld, das zur Bank gebracht wird,
// Wechselgeld, das abgehoben wird, und Kleinbeträge ohne Beleg.
//
//   DEPOSIT_TO_BANK       Kasse -   ergebnisneutral (nur Liquidität)
//   WITHDRAWAL_FROM_BANK  Kasse +   ergebnisneutral (nur Liquidität)
//   OTHER_INCOME          Kasse +   Betriebseinnahme  (EÜR)
//   OTHER_EXPENSE         Kasse -   Betriebsausgabe   (EÜR)
//
// amount ist immer positiv; die Richtung steckt im Typ. Storno statt Löschen.

const prisma = require('../utils/prisma');
const closedPeriod = require('../utils/closedPeriod');

const TYPES = ['DEPOSIT_TO_BANK', 'WITHDRAWAL_FROM_BANK', 'OTHER_INCOME', 'OTHER_EXPENSE'];
const NOTE_REQUIRED = ['OTHER_INCOME', 'OTHER_EXPENSE'];
const BANK_TYPES = ['DEPOSIT_TO_BANK', 'WITHDRAWAL_FROM_BANK'];

const TYPE_LABELS = {
  DEPOSIT_TO_BANK: 'Einzahlung auf Bank',
  WITHDRAWAL_FROM_BANK: 'Abhebung von Bank',
  OTHER_INCOME: 'Sonstige Bareinnahme',
  OTHER_EXPENSE: 'Sonstige Barausgabe'
};

// Vorzeichen für die Kasse: +1 erhöht den Barbestand, -1 mindert ihn
const CASH_SIGN = {
  DEPOSIT_TO_BANK: -1,
  WITHDRAWAL_FROM_BANK: 1,
  OTHER_INCOME: 1,
  OTHER_EXPENSE: -1
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dec = (n) => Number(n || 0);

/**
 * Betrag für das Protokoll abgeschlossener Jahre: sonstige Bareinnahme/-ausgabe zählt in der EÜR
 * (Ausgabe negativ), Bank-Ein-/Auszahlungen sind ergebnisneutral, dort zählt die Auswirkung auf die Kasse.
 */
function eurEffect(type, before, after) {
  if (type === 'OTHER_INCOME') return { amountBefore: before, amountAfter: after };
  if (type === 'OTHER_EXPENSE') return { kind: 'expense', amountBefore: before, amountAfter: after };
  return { amountBefore: null, amountAfter: null, effect: null, details: { kasseVorher: CASH_SIGN[type] * before, kasseNachher: CASH_SIGN[type] * after } };
}

function toPlain(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.amount !== undefined && out.amount !== null) out.amount = Number(out.amount);
  out.signedAmount = round2((CASH_SIGN[out.type] || 0) * dec(out.amount));
  out.typeLabel = TYPE_LABELS[out.type] || out.type;
  return out;
}

class CashMovementService {
  get types() { return TYPES; }
  get labels() { return TYPE_LABELS; }
  label(type) { return TYPE_LABELS[type] || type || '—'; }
  cashSign(type) { return CASH_SIGN[type] || 0; }
  signedAmount(mv) { return round2(this.cashSign(mv.type) * dec(mv.amount)); }

  /** Bewegung anlegen. Validierung der Pflichtfelder passiert zusätzlich hier (nicht nur im Router). */
  async create({ type, amount, occurredAt, note, bankAccount, userId, confirmClosed = false }) {
    if (!userId) throw new Error('Benutzer fehlt');
    if (!TYPES.includes(type)) throw new Error('Ungültiger Bewegungstyp');
    const amt = round2(amount);
    if (!(amt > 0)) throw new Error('Betrag muss größer als 0 sein');

    const cleanNote = note ? String(note).trim() : '';
    if (NOTE_REQUIRED.includes(type) && cleanNote.length < 3) {
      throw new Error('Notiz ist bei sonstigen Bareinnahmen/-ausgaben Pflicht (mindestens 3 Zeichen)');
    }
    const cleanBank = bankAccount ? String(bankAccount).trim() : '';

    let when = occurredAt ? new Date(occurredAt) : new Date();
    if (Number.isNaN(when.getTime())) throw new Error('Ungültiges Datum');
    if (when.getTime() > Date.now() + 60 * 1000) throw new Error('Datum darf nicht in der Zukunft liegen');

    const created = await prisma.$transaction(async (tx) => {
      // Rückdatiert in ein abgeschlossenes Geschäftsjahr → 409 ohne Bestätigung
      const closedYears = await closedPeriod.guard([when], confirmClosed, tx);
      const row = await tx.cashMovement.create({
        data: {
          type,
          amount: amt,
          occurredAt: when,
          note: cleanNote || null,
          bankAccount: BANK_TYPES.includes(type) && cleanBank ? cleanBank : null,
          userId
        },
        include: { user: { select: { id: true, name: true } } }
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CASH_MOVEMENT',
          entityType: 'CashMovement',
          entityId: row.id,
          changes: { type, amount: amt, occurredAt: when, note: row.note, bankAccount: row.bankAccount }
        }
      });
      if (closedYears.length) {
        await closedPeriod.logChange(tx, closedYears, {
          userId, entityType: 'CashMovement', entityId: row.id,
          operation: 'Kassenbewegung nachgetragen',
          description: `Kassenbewegung „${TYPE_LABELS[type]}“ vom ${closedPeriod.fmtDate(when)} nachgetragen, ${closedPeriod.fmtEUR(amt)}${row.note ? ` (${row.note})` : ''}`,
          ...eurEffect(type, 0, amt),
        });
      }
      return row;
    });
    return toPlain(created);
  }

  /** Liste, neueste zuerst. from/to optional (Date), limit max 500. Stornierte werden mitgeliefert (cancelled=true). */
  async list({ from = null, to = null, limit = 50, includeCancelled = true } = {}) {
    const where = {};
    if (from || to) {
      where.occurredAt = {};
      if (from) where.occurredAt.gte = from;
      if (to) where.occurredAt.lte = to;
    }
    if (!includeCancelled) where.cancelled = false;
    const rows = await prisma.cashMovement.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Math.max(Number(limit) || 50, 1), 500),
      include: { user: { select: { id: true, name: true } } }
    });
    return rows.map(toPlain);
  }

  async getById(id) {
    return toPlain(await prisma.cashMovement.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true } } }
    }));
  }

  /** Storno: Zeile bleibt erhalten, zählt aber nirgends mehr. */
  async cancel(id, userId, { confirmClosed = false } = {}) {
    const existing = await prisma.cashMovement.findUnique({ where: { id } });
    if (!existing) throw new Error('Kassenbewegung nicht gefunden');
    if (existing.cancelled) throw new Error('Kassenbewegung ist bereits storniert');

    const updated = await prisma.$transaction(async (tx) => {
      const closedYears = await closedPeriod.guard([existing.occurredAt], confirmClosed, tx);
      if (closedYears.length) {
        const amt = Number(existing.amount);
        await closedPeriod.logChange(tx, closedYears, {
          userId, entityType: 'CashMovement', entityId: id,
          operation: 'Kassenbewegung storniert',
          description: `Kassenbewegung „${TYPE_LABELS[existing.type]}“ vom ${closedPeriod.fmtDate(existing.occurredAt)} storniert, ${closedPeriod.fmtEUR(amt)}${existing.note ? ` (${existing.note})` : ''}`,
          ...eurEffect(existing.type, amt, 0),
        });
      }
      // Bedingt auf cancelled = false: Zwei parallele Stornos schreiben nur einmal
      const claimed = await tx.cashMovement.updateMany({
        where: { id, cancelled: false },
        data: { cancelled: true, cancelledAt: new Date(), cancelledBy: userId }
      });
      if (claimed.count === 0) throw new Error('Kassenbewegung ist bereits storniert');
      const row = await tx.cashMovement.findUnique({
        where: { id },
        include: { user: { select: { id: true, name: true } } }
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CANCEL_CASH_MOVEMENT',
          entityType: 'CashMovement',
          entityId: id,
          changes: { type: row.type, amount: Number(row.amount), occurredAt: row.occurredAt }
        }
      });
      return row;
    });
    return toPlain(updated);
  }

  /** Zuletzt verwendete Kontonamen (für das Autocomplete im Frontend). */
  async recentBankAccounts(limit = 10) {
    const rows = await prisma.cashMovement.findMany({
      where: { bankAccount: { not: null } },
      orderBy: { occurredAt: 'desc' },
      select: { bankAccount: true },
      take: 200
    });
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const name = (r.bankAccount || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name); out.push(name);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Nicht stornierte Bewegungen im Fenster, nach Typ aufsummiert.
   * window: Prisma-Filter für occurredAt, z.B. { gte, lte } (EÜR, Bank-Abstimmung: fachliches Datum).
   * cashCount: { since, until } für das Kassen-Soll. Eine Bewegung zählt zu der Zählung, bei der
   *   sowohl ihr Datum (occurredAt) als auch ihre Erfassung (createdAt) erreicht ist, also nach
   *   max(occurredAt, createdAt) in (since, until]. Rückdatierte Bewegungen (Datum vor der letzten
   *   Zählung, aber erst danach erfasst) landen so in der nächsten Zählung statt in keiner.
   *   Doppelt kann nichts zählen: Was eine frühere Zählung gesehen hat, war vor ihr erfasst und datiert.
   * @returns {{ bankDeposits, bankWithdrawals, otherIncome, otherExpense, items }}
   *   jeweils { total, count, items[] }; items = alle Bewegungen (aufsteigend nach Datum)
   */
  async summarize(window, { cashCount = null } = {}) {
    let where = { cancelled: false, occurredAt: window };
    if (cashCount) {
      const { since, until } = cashCount;
      where = {
        cancelled: false,
        occurredAt: { lte: until },
        createdAt: { lte: until },
        ...(since ? { OR: [{ occurredAt: { gt: since } }, { createdAt: { gt: since } }] } : {})
      };
    }
    const rows = await prisma.cashMovement.findMany({
      where,
      orderBy: { occurredAt: 'asc' },
      include: { user: { select: { id: true, name: true } } }
    });
    const since = cashCount && cashCount.since ? new Date(cashCount.since).getTime() : null;
    // nachgetragen: fachlich vor der letzten Zählung datiert, aber erst danach erfasst
    const late = (m) => since !== null && new Date(m.occurredAt).getTime() <= since;
    const items = rows.map(toPlain);
    const bucket = (type) => {
      const list = items.filter(m => m.type === type);
      return {
        total: round2(list.reduce((a, m) => a + dec(m.amount), 0)),
        count: list.length,
        items: list.map(m => ({
          id: m.id, occurredAt: m.occurredAt, amount: m.amount, note: m.note,
          bankAccount: m.bankAccount, user: m.user ? m.user.name : null,
          ...(late(m) ? { lateEntry: true, createdAt: m.createdAt } : {})
        }))
      };
    };
    return {
      bankDeposits: bucket('DEPOSIT_TO_BANK'),
      bankWithdrawals: bucket('WITHDRAWAL_FROM_BANK'),
      otherIncome: bucket('OTHER_INCOME'),
      otherExpense: bucket('OTHER_EXPENSE'),
      items: items.map(m => ({
        id: m.id, type: m.type, typeLabel: m.typeLabel, occurredAt: m.occurredAt,
        amount: m.amount, signedAmount: m.signedAmount, note: m.note,
        bankAccount: m.bankAccount, user: m.user ? m.user.name : null,
        ...(late(m) ? { lateEntry: true, createdAt: m.createdAt } : {})
      }))
    };
  }
}

module.exports = new CashMovementService();
