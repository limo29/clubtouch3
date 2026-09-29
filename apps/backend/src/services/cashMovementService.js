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
  isBankType(type) { return BANK_TYPES.includes(type); }
  signedAmount(mv) { return round2(this.cashSign(mv.type) * dec(mv.amount)); }

  /** Bewegung anlegen. Validierung der Pflichtfelder passiert zusätzlich hier (nicht nur im Router). */
  async create({ type, amount, occurredAt, note, bankAccount, userId }) {
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
  async cancel(id, userId) {
    const existing = await prisma.cashMovement.findUnique({ where: { id } });
    if (!existing) throw new Error('Kassenbewegung nicht gefunden');
    if (existing.cancelled) throw new Error('Kassenbewegung ist bereits storniert');

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.cashMovement.update({
        where: { id },
        data: { cancelled: true, cancelledAt: new Date(), cancelledBy: userId },
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
   * window: Prisma-Filter für occurredAt, z.B. { gt: since, lte: until } oder { gte, lte }.
   * @returns {{ bankDeposits, bankWithdrawals, otherIncome, otherExpense, items }}
   *   jeweils { total, count, items[] }; items = alle Bewegungen (aufsteigend nach Datum)
   */
  async summarize(window) {
    const rows = await prisma.cashMovement.findMany({
      where: { cancelled: false, occurredAt: window },
      orderBy: { occurredAt: 'asc' },
      include: { user: { select: { id: true, name: true } } }
    });
    const items = rows.map(toPlain);
    const bucket = (type) => {
      const list = items.filter(m => m.type === type);
      return {
        total: round2(list.reduce((a, m) => a + dec(m.amount), 0)),
        count: list.length,
        items: list.map(m => ({
          id: m.id, occurredAt: m.occurredAt, amount: m.amount, note: m.note,
          bankAccount: m.bankAccount, user: m.user ? m.user.name : null
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
        bankAccount: m.bankAccount, user: m.user ? m.user.name : null
      }))
    };
  }
}

module.exports = new CashMovementService();
