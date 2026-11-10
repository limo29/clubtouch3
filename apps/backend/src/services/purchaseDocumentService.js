const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const { parseLocalDate } = require('../utils/businessDay');
const { nextNumber, maxFromNumbers, withNumberRetry } = require('../utils/numberSequence');
const cashCountService = require('./cashCountService');
const closedPeriod = require('../utils/closedPeriod');

// Fachlicher Fehler (Controller antwortet mit statusCode, Vorgabe 400, und dieser Meldung)
function userError(message, statusCode = 400) {
  const err = new Error(message);
  err.userFacing = true;
  err.statusCode = statusCode;
  return err;
}

const DOCUMENT_TYPES = ['RECHNUNG', 'LIEFERSCHEIN'];
const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'ACCOUNT', 'CARD', 'INVOICE'];

/**
 * Betrag aus Formular/JSON: "12,50", "12.50", 12.5 -> Decimal(12.50); leer -> null.
 * Tausenderpunkte ("1.234,56") werden erkannt. Ungültig oder negativ -> 400.
 */
function parseAmount(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  let str = typeof value === 'number' ? String(value) : String(value).trim().replace(/\s|€/g, '');
  if (str.includes(',')) str = str.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(str)) throw userError('Betrag ist ungültig (Beispiel: 12,50)');
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0) throw userError('Betrag darf nicht negativ sein');
  if (n > 99999999) throw userError('Betrag ist zu groß');
  if (/\.\d{3,}$/.test(str)) throw userError('Betrag darf höchstens 2 Nachkommastellen haben');
  return new Prisma.Decimal(str);
}

/** Datum (YYYY-MM-DD lokal oder ISO). leer -> null, ungültig -> 400 mit Feldname. */
function parseDateField(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === 'null') return null;
  const dt = parseLocalDate(value);
  if (!dt) throw userError(`${label} ist ungültig`);
  return dt;
}

/** Zahldatum: leer -> jetzt; ungültig oder in der Zukunft -> 400 */
function parsePaidAt(value) {
  const dt = parseDateField(value, 'Zahldatum');
  if (!dt) return new Date();
  if (dt.getTime() > Date.now() + 60 * 1000) throw userError('Zahldatum darf nicht in der Zukunft liegen');
  return dt;
}

/** Kistenfaktor-Prüfung und Menge in Basiseinheit für eine Eingabezeile */
function itemQuantities(article, item) {
  const toDec = (v, label) => {
    if (v === undefined || v === null || v === '') return new Prisma.Decimal(0);
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) throw userError(`${label} für "${article.name}" ist ungültig`);
    return new Prisma.Decimal(n);
  };
  const kistenQty = toDec(item.kisten, 'Anzahl Kisten');
  const flaschenQty = toDec(item.flaschen, 'Anzahl Einzelstücke');
  const unitsPerKiste = new Prisma.Decimal(article.unitsPerPurchase || 0);
  // Ohne Kistenfaktor darf keine Kiste gebucht werden, sonst landen still 0 Flaschen im Bestand (B8)
  if (kistenQty.gt(0) && unitsPerKiste.lte(0)) {
    throw userError(`Artikel "${article.name}" hat keinen Kistenfaktor (Einheiten pro ${article.purchaseUnit || 'Kiste'}). Bitte im Artikel pflegen.`);
  }
  return { kistenQty, flaschenQty, total: kistenQty.times(unitsPerKiste).plus(flaschenQty) };
}

/** Zahltag, nach dem Kasse/Bank/EÜR rechnen (paidAt, ersatzweise documentDate) */
const effectivePaidAt = (doc) => (doc.paidAt || doc.documentDate) ? new Date(doc.paidAt || doc.documentDate) : null;

/**
 * Bar bezahlte Lieferantenrechnung: Zahldatum nicht vor der letzten Kassenzählung.
 * Nur prüfen, wenn sich am Bar-Zahlzustand etwas ändert (Neu bar bezahlt, anderes Zahldatum).
 */
async function assertCashPaidAt(tx, before, after) {
  if (!(after.type === 'RECHNUNG' && after.paid && after.paymentMethod === 'CASH')) return;
  const when = effectivePaidAt(after);
  if (!when) return;
  const prev = before && before.paid && before.paymentMethod === 'CASH' ? effectivePaidAt(before) : null;
  if (prev && prev.getTime() === when.getTime()) return;
  await cashCountService.assertCashPaymentAfterLastCount(when, tx);
}

/*
 * Abgeschlossene Geschäftsjahre (utils/closedPeriod): maßgeblich sind das Belegdatum (Belegliste,
 * Verbindlichkeiten, Wareneingang) und das Zahldatum (EÜR, Kasse, Bank), jeweils vor und nach der Änderung.
 * Reines Bezahlen/Offen-Setzen schaut nur auf das Zahldatum: Eine Vorjahresrechnung im neuen Jahr zu
 * bezahlen ändert am abgeschlossenen Jahr nichts (Verbindlichkeiten zählen „erst nach dem Stichtag bezahlt“ mit).
 */
const DOC_TYPE_LABEL = { RECHNUNG: 'Lieferantenrechnung', LIEFERSCHEIN: 'Lieferschein' };
const docLabel = (doc) => `${DOC_TYPE_LABEL[doc.type] || 'Beleg'} ${doc.documentNumber} (${doc.supplier})`;
const paidDateOf = (doc) => (doc && doc.type === 'RECHNUNG' && doc.paid ? effectivePaidAt(doc) : null);
// Ausgabe dieses Belegs im Jahr fy (EÜR): Betrag, wenn bezahlt und Zahltag im Jahr, sonst 0
const expenseIn = (doc, fy) => {
  const when = paidDateOf(doc);
  return when && closedPeriod.inYear(when, fy) ? Number(doc.totalAmount || 0) : 0;
};
const { fmtDate, fmtEUR } = closedPeriod;

// „Eingetragen von“: freier Name, gekürzt; leer = null
function cleanEnteredBy(value) {
  const name = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  return name || null;
}

/**
 * Auslage: Ein Kunde hat eine Lieferantenrechnung aus eigener Tasche bezahlt (paymentMethod = ACCOUNT).
 * Der volle Rechnungsbetrag wird seinem Kundenkonto als AccountTopUp mit method = REIMBURSEMENT
 * gutgeschrieben (purchaseDocumentId verknüpft, reimbursedCustomerId am Beleg). Das ist kein Geldeingang:
 * Kassen-, Bank- und Aufladungssummen filtern auf CASH/TRANSFER und sehen die Gutschrift nicht; die
 * EÜR-Ausgabe (bezahlte RECHNUNG) bleibt unverändert. Offen setzen oder Löschen bucht „Storno Auslage“
 * (negativer REIMBURSEMENT-TopUp). Solange die Gutschrift besteht, sind Betrag, Kunde und Zahlungsart gesperrt.
 */
const hasReimbursement = (doc) => !!(doc && doc.paid && doc.paymentMethod === 'ACCOUNT' && doc.reimbursedCustomerId);

class PurchaseDocumentService {

  /**
   * Bucht die Auslage-Gutschrift für eine bezahlte Lieferantenrechnung (innerhalb von tx).
   */
  async _bookReimbursement(tx, doc, customerId) {
    if (doc.type !== 'RECHNUNG') throw userError('Nur Lieferantenrechnungen können als Auslage gutgeschrieben werden.');
    if (!customerId) throw userError('Bitte den Kunden wählen, der die Rechnung ausgelegt hat.');
    const amount = Number(doc.totalAmount || 0);
    if (!(amount > 0)) throw userError('Für eine Auslage muss der Rechnungsbetrag größer als 0 sein.');
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw userError('Kunde für die Auslage nicht gefunden.');

    await tx.accountTopUp.create({
      data: {
        customerId,
        amount: new Prisma.Decimal(amount),
        method: 'REIMBURSEMENT',
        reference: `Auslage ${doc.documentNumber} · ${doc.supplier}`,
        purchaseDocumentId: doc.id,
      }
    });
    await tx.customer.update({ where: { id: customerId }, data: { balance: { increment: amount } } });
    return tx.purchaseDocument.update({ where: { id: doc.id }, data: { reimbursedCustomerId: customerId } });
  }

  /**
   * Bucht die Gutschrift zurück („Storno Auslage“), falls eine besteht (innerhalb von tx).
   */
  async _reverseReimbursement(tx, doc) {
    if (!hasReimbursement(doc)) return;
    const amount = Number(doc.totalAmount || 0);
    await tx.accountTopUp.create({
      data: {
        customerId: doc.reimbursedCustomerId,
        amount: new Prisma.Decimal(-amount),
        method: 'REIMBURSEMENT',
        reference: `Storno Auslage ${doc.documentNumber} · ${doc.supplier}`,
        purchaseDocumentId: doc.id,
      }
    });
    await tx.customer.update({ where: { id: doc.reimbursedCustomerId }, data: { balance: { decrement: amount } } });
  }

  /**
   * Neue Belegnummer innerhalb der Transaktion (EK-2026-0001 bzw. LS-2026-0001, Jahr = Erfassungsjahr).
   * Der Zähler `purchase.lastNumber.<EK|LS>.<Jahr>` merkt sich die höchste je vergebene Nummer,
   * gelöschte Belege geben ihre Nummer also nicht wieder frei.
   */
  async generateDocumentNumber(tx, type) {
    const prefix = type === 'RECHNUNG' ? 'EK' : 'LS';
    const year = new Date().getFullYear();
    const yearPrefix = `${prefix}-${year}-`;
    const existing = await tx.purchaseDocument.findMany({
      where: { documentNumber: { startsWith: yearPrefix } },
      select: { documentNumber: true }
    });
    const n = await nextNumber(tx, `purchase.lastNumber.${prefix}.${year}`,
      maxFromNumbers(existing.map((r) => r.documentNumber), yearPrefix),
      `Höchste vergebene Belegnummer ${prefix} ${year}`);
    return `${yearPrefix}${String(n).padStart(4, '0')}`;
  }

  /**
   * Erstellt einen neuen Beleg (Lieferschein oder Rechnung)
   * und bucht optional den Wareneingang.
   */
  async createDocument(data, userId, nachweisUrl, { confirmClosed = false } = {}) {
    const {
      type,
      supplier,
      documentDate,
      description,
      enteredBy,
      totalAmount,
      paid,
      paidAt,
      dueDate,
      paymentMethod,
      reimbursedCustomerId, // nur bei paymentMethod = ACCOUNT (Auslage)
      items, // Erwartet: [{ articleId, kisten, flaschen, ... }]
      lieferscheinIds // Optional: IDs von Lieferscheinen zum Verknüpfen
    } = data;

    // Kopf prüfen (vor der Transaktion, damit Fehler sauber als 400 ankommen)
    if (!DOCUMENT_TYPES.includes(type)) throw userError('Belegart fehlt oder ist ungültig (Lieferantenrechnung oder Lieferschein)');
    const cleanSupplier = typeof supplier === 'string' ? supplier.trim() : '';
    if (!cleanSupplier) throw userError('Lieferant fehlt');
    if (cleanSupplier.length > 200) throw userError('Lieferant darf höchstens 200 Zeichen lang sein');
    const docDate = parseDateField(documentDate, 'Belegdatum');
    if (!docDate) throw userError('Belegdatum fehlt');
    if (items !== undefined && items !== null && !Array.isArray(items)) throw userError("Ungültiges 'items' Format.");
    const isRechnung = type === 'RECHNUNG';
    const amount = isRechnung ? parseAmount(totalAmount) : null;
    const due = isRechnung ? parseDateField(dueDate, 'Fälligkeitsdatum') : null;
    const isPaid = isRechnung && !!paid;
    if (isPaid && !PAYMENT_METHODS.includes(paymentMethod)) throw userError('Zahlungsart fehlt oder ist ungültig');
    const paidDate = isPaid ? parsePaidAt(paidAt) : null;

    return withNumberRetry(() => prisma.$transaction(async (tx) => {
      // Abgeschlossenes Geschäftsjahr: Belegdatum oder Zahldatum darin → 409 ohne Bestätigung
      const closedYears = await closedPeriod.guard([docDate, paidDate], confirmClosed, tx);

      // 1. Dokumenten-Kopf erstellen
      const documentNumber = await this.generateDocumentNumber(tx, type);

      if (isPaid) {
        await assertCashPaidAt(tx, null, { type, paid: true, paymentMethod, paidAt: paidDate, documentDate: docDate });
      }

      const document = await tx.purchaseDocument.create({
        data: {
          type,
          documentNumber,
          supplier: cleanSupplier,
          documentDate: docDate,
          description,
          enteredBy: cleanEnteredBy(enteredBy),
          nachweisUrl,
          totalAmount: amount ?? null,
          paid: isPaid,
          dueDate: due ?? null,
          paymentMethod: isPaid ? paymentMethod : null,
          paidAt: paidDate,
          userId: userId,
        }
      });

      // 1a. Auslage dem Kundenkonto gutschreiben
      if (isPaid && paymentMethod === 'ACCOUNT') {
        await this._bookReimbursement(tx, document, reimbursedCustomerId);
      }

      // 1b. Lieferscheine verknüpfen (falls vorhanden)
      if (isRechnung && lieferscheinIds && Array.isArray(lieferscheinIds) && lieferscheinIds.length > 0) {
        await tx.purchaseDocument.updateMany({
          where: {
            id: { in: lieferscheinIds },
            type: 'LIEFERSCHEIN',
            rechnungId: null // Nur unverknüpfte
          },
          data: {
            rechnungId: document.id
          }
        });
      }

      // 2. Positionen verarbeiten & Lagerbestand buchen (falls vorhanden)
      if (items && items.length > 0) {
        for (const item of items) {
          if (!item || !item.articleId) continue;

          const article = await tx.article.findUnique({
            where: { id: String(item.articleId) }
          });

          if (!article) {
            throw userError(`Artikel mit ID ${item.articleId} nicht gefunden.`, 404);
          }

          // Kisten/Einzelstücke -> Gesamtmenge in Basiseinheit (z.B. Flasche); Kistenfaktor-Prüfung
          const { kistenQty, flaschenQty, total: totalQuantityToBook } = itemQuantities(article, item);

          if (totalQuantityToBook.lte(0)) continue; // Nichts zu buchen

          // 2a. Lagerbestand erhöhen
          await tx.article.update({
            where: { id: article.id },
            data: {
              stock: {
                increment: totalQuantityToBook
              }
            }
          });

          // 2b. Bestandsbewegung loggen
          await tx.stockMovement.create({
            data: {
              articleId: article.id,
              type: 'DELIVERY', // Wareneingang
              quantity: totalQuantityToBook,
              reason: `Eingang ${documentNumber}`
            }
          });

          // 2c. Beleg-Position speichern (Einkaufspreise je Position werden nicht erfasst, der Betrag steht im Kopf)
          await tx.purchaseDocumentItem.create({
            data: {
              documentId: document.id,
              articleId: article.id,
              description: article.name,
              quantity: totalQuantityToBook,
              unit: article.unit, // z.B. "Flasche"
              purchaseUnit: article.purchaseUnit, // z.B. "Kiste"
              purchaseUnitQuantity: kistenQty,
              baseUnit: article.unit,
              baseUnitQuantity: flaschenQty,
              pricePerUnit: new Prisma.Decimal(0),
              totalPrice: new Prisma.Decimal(0)
            }
          });
        }
      }

      if (closedYears.length) {
        const amountTxt = isRechnung && amount != null ? `, ${fmtEUR(amount)}` : '';
        await closedPeriod.logChange(tx, closedYears, {
          kind: 'expense', userId, entityType: 'PurchaseDocument', entityId: document.id,
          operation: 'Beleg nachträglich angelegt',
          description: `${docLabel(document)} nachträglich angelegt, Belegdatum ${fmtDate(docDate)}${amountTxt}`
            + (isPaid ? `, bezahlt am ${fmtDate(paidDate)}` : ''),
          amountBefore: isRechnung ? 0 : null,
          amountAfter: isRechnung ? (fy) => expenseIn(document, fy) : null,
        });
      }

      return document;
    }, {
      maxWait: 10000, // 10s
      timeout: 20000, // 20s
    }));
  }

  /**
   * Listet alle Belege auf, mit Filterung und Gruppierung
   */
  async listDocuments(filters) {
    const { startDate, endDate, supplier, paid, search } = filters;
    const where = {
      // Wir wollen nur "Top-Level" Belege:
      // - Alle Lieferscheine, die *keiner* Rechnung zugeordnet sind
      // - Alle Rechnungen
      OR: [
        {
          type: 'LIEFERSCHEIN',
          rechnungId: null
        },
        {
          type: 'RECHNUNG'
        }
      ]
    };

    if (startDate || endDate) {
      where.documentDate = {};
      if (startDate) where.documentDate.gte = new Date(startDate);
      if (endDate) where.documentDate.lte = new Date(endDate);
    }

    // Lieferant (exakter Name, wie in /suppliers geliefert)
    if (supplier) where.supplier = supplier;
    // Zahlstatus (nur für Rechnungen sinnvoll; Lieferscheine haben paid=false)
    if (paid === 'true') where.paid = true;
    if (paid === 'false') where.AND = [{ paid: false }, { type: 'RECHNUNG' }];
    // Freitextsuche über Belegnummer, Lieferant, Beschreibung
    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.AND = [
        ...(where.AND || []),
        { OR: [
          { documentNumber: { contains: q, mode: 'insensitive' } },
          { supplier: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ] },
      ];
    }

    return prisma.purchaseDocument.findMany({
      where,
      include: {
        // Lade die zugehörigen Lieferscheine für Rechnungen (inkl. gebuchter Positionen,
        // damit das UI zeigen kann, welcher Wareneingang bereits über den Lieferschein lief)
        lieferscheine: {
          orderBy: { documentDate: 'asc' },
          include: { items: { select: { quantity: true, unit: true, description: true } } }
        },
        reimbursedCustomer: { select: { id: true, name: true, nickname: true } },
        // Zähle die Positionen (für Sofortkäufe)
        _count: {
          select: { items: true }
        }
      },
      orderBy: {
        documentDate: 'desc'
      }
    });
  }

  /**
   * Verknüpft Lieferscheine mit einer Rechnung
   */
  async linkLieferscheineToRechnung(rechnungId, lieferscheinIds, userId) {
    return prisma.$transaction(async (tx) => {
      // Ziel muss eine vorhandene Lieferantenrechnung sein
      const rechnung = await tx.purchaseDocument.findUnique({ where: { id: String(rechnungId) }, select: { id: true, type: true, supplier: true } });
      if (!rechnung) throw userError('Rechnung nicht gefunden.', 404);
      if (rechnung.type !== 'RECHNUNG') throw userError('Lieferscheine können nur einer Lieferantenrechnung zugeordnet werden.');

      const ids = [...new Set(lieferscheinIds.map(String))];
      const docs = ids.length
        ? await tx.purchaseDocument.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, supplier: true, documentNumber: true } })
        : [];
      if (docs.length !== ids.length) throw userError('Mindestens ein Lieferschein wurde nicht gefunden.', 404);
      const notLs = docs.find((x) => x.type !== 'LIEFERSCHEIN');
      if (notLs) throw userError(`${notLs.documentNumber} ist kein Lieferschein.`);
      // Gleicher Lieferant: das Frontend bietet ohnehin nur offene Lieferscheine dieses Lieferanten an
      const foreign = docs.find((x) => x.supplier !== rechnung.supplier);
      if (foreign) throw userError(`Lieferschein ${foreign.documentNumber} ist von „${foreign.supplier}“, die Rechnung von „${rechnung.supplier}“.`);

      // Bereits einer (anderen) Rechnung zugeordnete Lieferscheine bleiben unverändert (count zeigt das)
      const count = await tx.purchaseDocument.updateMany({
        where: {
          id: { in: ids },
          type: 'LIEFERSCHEIN',
          rechnungId: null // Nur unverknüpfte
        },
        data: {
          rechnungId: rechnung.id
        }
      });

      // Audit-Log
      await tx.auditLog.create({
        data: {
          userId: userId,
          action: 'LINK_PURCHASE_DOCUMENTS',
          entityType: 'PurchaseDocument',
          entityId: rechnung.id,
          changes: {
            linkedIds: ids,
            count: count.count
          }
        }
      });

      return count;
    });
  }

  /**
   * Holt einen einzelnen Beleg
   */
  async getDocumentById(id) {
    return prisma.purchaseDocument.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            article: true
          }
        },
        lieferscheine: {
          orderBy: { documentDate: 'asc' },
          include: { items: { select: { quantity: true, unit: true, description: true } } }
        },
        rechnung: { select: { id: true, documentNumber: true, documentDate: true, paid: true } },
        reimbursedCustomer: { select: { id: true, name: true, nickname: true } }
      }
    });
  }
  /**
     * Holt eine Liste aller einzigartigen Lieferantennamen
     */
  async getUniqueSuppliers() {
    const suppliers = await prisma.purchaseDocument.groupBy({
      by: ['supplier'],
      _count: {
        supplier: true,
      },
      orderBy: {
        _count: {
          supplier: 'desc',
        },
      },
    });

    // groupBy gibt { supplier: 'Name', _count: { supplier: 5 } }
    // Wir wollen nur den Namen
    return suppliers.map(s => s.supplier);
  }

  /**
   * Namen, die schon Belege eingetragen haben (häufigste zuerst) – Auswahl für „Eingetragen von“.
   */
  async getEnteredByNames() {
    const rows = await prisma.purchaseDocument.groupBy({
      by: ['enteredBy'],
      where: { enteredBy: { not: null } },
      _count: { enteredBy: true },
      orderBy: { _count: { enteredBy: 'desc' } },
      take: 50,
    });
    return rows.map((r) => r.enteredBy);
  }
  /**
   * Markiert eine Rechnung als bezahlt. paidAt optional (Vorgabe jetzt, nicht in der Zukunft);
   * das Zahldatum bestimmt EÜR, Kassen-Soll und Bank-Abstimmung.
   */
  async markAsPaid(documentId, paymentMethod, userId, reimbursedCustomerId = null, paidAt = undefined, { confirmClosed = false } = {}) {
    if (!PAYMENT_METHODS.includes(paymentMethod)) throw userError('Zahlungsart fehlt oder ist ungültig');
    const paidDate = parsePaidAt(paidAt);
    return prisma.$transaction(async (tx) => {
      const document = await tx.purchaseDocument.findUnique({ where: { id: documentId } });

      if (!document) {
        throw userError('Beleg nicht gefunden.', 404);
      }
      if (document.type !== 'RECHNUNG') {
        throw userError('Nur Rechnungen können als bezahlt markiert werden.');
      }
      if (hasReimbursement(document)) {
        throw userError('Die Rechnung ist bereits als Auslage gutgeschrieben.');
      }
      // Zahldatum alt (falls schon bezahlt) und neu gegen abgeschlossene Jahre
      const closedYears = await closedPeriod.guard([paidDateOf(document), paidDate], confirmClosed, tx);
      await assertCashPaidAt(tx, document, { ...document, paid: true, paymentMethod, paidAt: paidDate });

      let updatedDocument = await tx.purchaseDocument.update({
        where: { id: documentId },
        data: {
          paid: true,
          paidAt: paidDate,
          paymentMethod: paymentMethod
        }
      });
      if (paymentMethod === 'ACCOUNT') {
        updatedDocument = await this._bookReimbursement(tx, updatedDocument, reimbursedCustomerId);
      }

      // Audit-Log
      await tx.auditLog.create({
        data: {
          userId: userId,
          action: 'MARK_AS_PAID',
          entityType: 'PurchaseDocument',
          entityId: documentId,
          changes: {
            paymentMethod: paymentMethod,
            paidAt: paidDate,
            previousPaidAt: document.paid ? document.paidAt : undefined,
            amount: updatedDocument.totalAmount,
            reimbursedCustomerId: updatedDocument.reimbursedCustomerId || undefined
          }
        }
      });

      if (closedYears.length) {
        const prev = paidDateOf(document);
        await closedPeriod.logChange(tx, closedYears, {
          kind: 'expense', userId, entityType: 'PurchaseDocument', entityId: documentId,
          operation: prev ? 'Zahldatum geändert' : 'Als bezahlt markiert',
          description: prev
            ? `${docLabel(document)}: Zahldatum von ${fmtDate(prev)} auf ${fmtDate(paidDate)} geändert, ${fmtEUR(document.totalAmount)}`
            : `${docLabel(document)} als bezahlt markiert (${fmtDate(paidDate)}), ${fmtEUR(document.totalAmount)}`,
          amountBefore: (fy) => expenseIn(document, fy),
          amountAfter: (fy) => expenseIn(updatedDocument, fy),
        });
      }

      return updatedDocument;
    });
  }
  async markAsUnpaid(documentId, userId, { confirmClosed = false } = {}) {
    return prisma.$transaction(async (tx) => {
      const document = await tx.purchaseDocument.findUnique({ where: { id: documentId } });

      if (!document) {
        throw userError('Beleg nicht gefunden.', 404);
      }
      if (document.type !== 'RECHNUNG') {
        throw userError('Nur Rechnungen können bearbeitet werden.');
      }
      const closedYears = await closedPeriod.guard([paidDateOf(document)], confirmClosed, tx);
      if (closedYears.length) {
        await closedPeriod.logChange(tx, closedYears, {
          kind: 'expense', userId, entityType: 'PurchaseDocument', entityId: documentId,
          operation: 'Zahlung zurückgenommen',
          description: `${docLabel(document)} auf offen gesetzt (war bezahlt am ${fmtDate(paidDateOf(document))}), ${fmtEUR(document.totalAmount)}`,
          amountBefore: (fy) => expenseIn(document, fy),
          amountAfter: 0,
        });
      }

      await this._reverseReimbursement(tx, document);

      const updatedDocument = await tx.purchaseDocument.update({
        where: { id: documentId },
        data: {
          paid: false,
          paidAt: null,
          paymentMethod: null,
          reimbursedCustomerId: null
        }
      });

      // Audit-Log
      await tx.auditLog.create({
        data: {
          userId: userId,
          action: 'MARK_AS_UNPAID',
          entityType: 'PurchaseDocument',
          entityId: documentId,
          changes: {
            oldStatus: document.paid ? 'PAID' : 'UNPAID',
            newStatus: 'UNPAID',
            previousPaidAt: document.paidAt || undefined,
            previousPaymentMethod: document.paymentMethod || undefined,
            reimbursementReversed: hasReimbursement(document) || undefined
          }
        }
      });

      return updatedDocument;
    });
  }
  /**
   * Holt alle Lieferscheine eines Lieferanten, die noch KEINER Rechnung zugeordnet sind.
   */
  async getUnassignedLieferscheine(supplier) {
    return prisma.purchaseDocument.findMany({
      where: {
        type: 'LIEFERSCHEIN',
        supplier: supplier,
        rechnungId: null // Der Schlüssel: Nur die, die noch frei sind
      },
      include: { items: { select: { quantity: true, unit: true, description: true } } },
      orderBy: {
        documentDate: 'desc'
      }
    });
  }

  /**
   * Entknüpft Lieferscheine von einer Rechnung (setzt rechnungId auf null)
   */
  async unlinkLieferscheine(lieferscheinIds, userId) {
    const count = await prisma.purchaseDocument.updateMany({
      where: {
        id: { in: lieferscheinIds },
        type: 'LIEFERSCHEIN'
      },
      data: {
        rechnungId: null
      }
    });

    // Audit-Log
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'UNLINK_PURCHASE_DOCUMENTS',
        entityType: 'PurchaseDocument',
        entityId: 'batch_unlink',
        changes: {
          unlinkedIds: lieferscheinIds,
          count: count.count
        }
      }
    });
    return count;
  }

  /**
   * Aktualisiert einen kompletten Beleg (Kopfdaten & Positionen)
   * und korrigiert den Lagerbestand.
   */
  async updateDocument(documentId, data, userId, nachweisUrl, { confirmClosed = false } = {}) {
    const {
      supplier,
      documentDate,
      description,
      enteredBy,
      totalAmount: totalAmountRaw,
      paid,
      paidAt,
      dueDate,
      paymentMethod,
      reimbursedCustomerId, // nur bei paymentMethod = ACCOUNT (Auslage)
      items // Erwartet: [{ articleId, kisten, flaschen }] oder undefined
    } = data;

    // Eingaben prüfen (400 statt 500 bei Unsinn)
    if (supplier !== undefined && !(typeof supplier === 'string' && supplier.trim())) throw userError('Lieferant fehlt');
    if (typeof supplier === 'string' && supplier.trim().length > 200) throw userError('Lieferant darf höchstens 200 Zeichen lang sein');
    const docDate = parseDateField(documentDate, 'Belegdatum');
    if (documentDate !== undefined && !docDate) throw userError('Belegdatum fehlt');
    const totalAmount = parseAmount(totalAmountRaw);
    const due = parseDateField(dueDate, 'Fälligkeitsdatum');
    if (paid && paymentMethod !== undefined && !PAYMENT_METHODS.includes(paymentMethod)) throw userError('Zahlungsart ist ungültig');
    const paidDate = paidAt !== undefined && paidAt !== '' && paidAt !== null ? parsePaidAt(paidAt) : undefined;
    if (items !== undefined && items !== null && !Array.isArray(items)) throw userError("Ungültiges 'items' Format.");

    return prisma.$transaction(async (tx) => {

      // 1. Hole den alten Beleg INKLUSIVE seiner alten Positionen
      const oldDocument = await tx.purchaseDocument.findUnique({
        where: { id: documentId },
        include: { items: { include: { article: true } } }
      });

      if (!oldDocument) {
        throw userError('Beleg nicht gefunden.', 404);
      }

      // Auslage: solange gutgeschrieben, sind Betrag, Kunde und Zahlungsart gesperrt (nur „offen“ setzen hebt sie auf)
      const credited = hasReimbursement(oldDocument);
      const unpaying = paid === false;
      if (credited && !unpaying) {
        const amountChanged = totalAmount !== undefined && totalAmount !== null
          && Number(totalAmount) !== Number(oldDocument.totalAmount);
        const methodChanged = paymentMethod !== undefined && paymentMethod !== 'ACCOUNT';
        const customerChanged = reimbursedCustomerId !== undefined && reimbursedCustomerId !== oldDocument.reimbursedCustomerId;
        if (amountChanged || methodChanged || customerChanged) {
          throw userError('Betrag, Kunde und Zahlungsart sind gesperrt, solange die Auslage dem Kundenkonto gutgeschrieben ist. Erst auf „offen“ setzen (bucht die Gutschrift zurück).');
        }
      }
      if (credited && unpaying) {
        await this._reverseReimbursement(tx, oldDocument);
      }

      // --- ITEMS & LAGERBESTAND LOGIK (Nur wenn 'items' übergeben wurde) ---
      let newItemCreations = undefined;

      if (items !== undefined) {
        // 2. Lagerbestand-KORREKTUR (Alte Buchungen stornieren)
        // Wir erstellen eine Map, um die Stornos zu sammeln
        const stockCorrections = new Map();
        for (const oldItem of oldDocument.items) {
          if (oldItem.articleId) {
            // 'quantity' ist die Gesamtmenge (z.B. 15 Flaschen)
            const oldQuantity = new Prisma.Decimal(oldItem.quantity);
            // Wir addieren den *negativen* Wert, um den Bestand zu senken
            const currentCorrection = stockCorrections.get(oldItem.articleId) || new Prisma.Decimal(0);
            stockCorrections.set(oldItem.articleId, currentCorrection.minus(oldQuantity));
          }
        }

        // 3. Lagerbestand-KORREKTUR (Neue Buchungen anwenden)
        if (items && items.length > 0) {
          for (const newItem of items) {
            if (!newItem.articleId) continue;

            const article = await tx.article.findUnique({ where: { id: String(newItem.articleId) } });
            if (!article) throw userError(`Artikel ${newItem.articleId} nicht gefunden.`, 404);

            // gleiche Kistenfaktor-Prüfung wie beim Anlegen
            const { total: totalNewQuantity } = itemQuantities(article, newItem);

            // Wir addieren den *positiven* Wert, um den Bestand zu erhöhen
            const currentCorrection = stockCorrections.get(newItem.articleId) || new Prisma.Decimal(0);
            stockCorrections.set(newItem.articleId, currentCorrection.plus(totalNewQuantity));
          }
        }

        // 4. Lagerbestand-Delta-Buchungen durchführen
        for (const [articleId, delta] of stockCorrections.entries()) {
          if (delta.equals(0)) continue; // Keine Änderung

          // 4a. Lagerbestand im Artikel aktualisieren
          await tx.article.update({
            where: { id: articleId },
            data: {
              stock: {
                increment: delta // 'delta' kann positiv oder negativ sein
              }
            }
          });

          // 4b. StockMovement loggen
          await tx.stockMovement.create({
            data: {
              articleId: articleId,
              type: 'CORRECTION', // Wir verwenden 'CORRECTION' für Änderungen
              quantity: delta,
              reason: `Korrektur Beleg ${oldDocument.documentNumber}`
            }
          });
        }

        // 5. Alte Positionen LÖSCHEN
        await tx.purchaseDocumentItem.deleteMany({
          where: { documentId: documentId }
        });

        // 6. Neue Positionen vorbereiten (werden beim Update via 'create' hinzugefügt)
        newItemCreations = [];
        if (items && items.length > 0) {
          for (const newItem of items) {
            if (!newItem.articleId) continue;

            const article = await tx.article.findUnique({ where: { id: String(newItem.articleId) } });
            const { kistenQty, flaschenQty, total: totalNewQuantity } = itemQuantities(article, newItem);

            if (totalNewQuantity.lte(0)) continue;

            newItemCreations.push({
              articleId: newItem.articleId,
              description: article.name,
              quantity: totalNewQuantity,
              unit: article.unit,
              purchaseUnit: article.purchaseUnit,
              purchaseUnitQuantity: kistenQty,
              baseUnit: article.unit,
              baseUnitQuantity: flaschenQty,
              pricePerUnit: new Prisma.Decimal(0), // Einkaufspreise je Position werden nicht erfasst
              totalPrice: new Prisma.Decimal(0)
            });
          }
        }
      }

      // 7. Kopfdaten (Header) aktualisieren
      const updateData = {};
      if (supplier !== undefined) updateData.supplier = supplier.trim();
      if (docDate) updateData.documentDate = docDate;
      if (description !== undefined) updateData.description = description;
      if (enteredBy !== undefined) updateData.enteredBy = cleanEnteredBy(enteredBy);

      if (newItemCreations !== undefined) {
        updateData.items = {
          create: newItemCreations
        };
      }

      if (oldDocument.type === 'RECHNUNG') {
        if (totalAmount !== undefined) updateData.totalAmount = totalAmount;
        if (paid !== undefined) {
          updateData.paid = paid;
          if (paid) {
            // Wenn bezahlt gesetzt wird, und Methode da ist
            if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
            // Zahldatum: übergeben -> übernehmen; sonst beim Wechsel auf bezahlt jetzt
            if (paidDate) updateData.paidAt = paidDate;
            else if (!oldDocument.paid) updateData.paidAt = new Date();
          } else {
            updateData.paymentMethod = null;
            updateData.paidAt = null;
            updateData.reimbursedCustomerId = null;
          }
        } else if (paidDate && oldDocument.paid) {
          updateData.paidAt = paidDate;
        }
        // leeres Fälligkeitsdatum ("") = kein Datum
        if (due !== undefined) updateData.dueDate = due;

        // Bar bezahlt: Zahldatum nicht vor der letzten Kassenzählung (nur wenn sich daran etwas ändert)
        await assertCashPaidAt(tx, oldDocument, { ...oldDocument, ...updateData });
      }

      if (nachweisUrl !== undefined) {
        updateData.nachweisUrl = nachweisUrl;
      }

      let updatedDocument = await tx.purchaseDocument.update({
        where: { id: documentId },
        data: updateData
      });

      // Neu als Auslage bezahlt → gutschreiben (mit dem jetzt gespeicherten Betrag)
      // (Altbelege, die schon vor der Auslage-Funktion mit ACCOUNT bezahlt waren, bleiben ohne Kunde unberührt)
      const legacyAccount = oldDocument.paid && oldDocument.paymentMethod === 'ACCOUNT' && !oldDocument.reimbursedCustomerId;
      if (updatedDocument.type === 'RECHNUNG' && updatedDocument.paid && updatedDocument.paymentMethod === 'ACCOUNT'
        && !updatedDocument.reimbursedCustomerId && (reimbursedCustomerId || !legacyAccount)) {
        updatedDocument = await this._bookReimbursement(tx, updatedDocument, reimbursedCustomerId);
      }

      // Abgeschlossenes Geschäftsjahr (Prüfung nach dem Rechnen, die Transaktion rollt bei 409 alles zurück):
      // Zahldatum alt/neu immer; Belegdatum alt/neu nur, wenn sich am Beleg selbst etwas ändert
      const changes = [];
      const sameTime = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
      if (updatedDocument.supplier !== oldDocument.supplier) changes.push(`Lieferant von „${oldDocument.supplier}“ auf „${updatedDocument.supplier}“`);
      if (!sameTime(updatedDocument.documentDate, oldDocument.documentDate)) changes.push(`Belegdatum von ${fmtDate(oldDocument.documentDate)} auf ${fmtDate(updatedDocument.documentDate)}`);
      if (Number(updatedDocument.totalAmount || 0) !== Number(oldDocument.totalAmount || 0)) changes.push(`Betrag von ${fmtEUR(oldDocument.totalAmount)} auf ${fmtEUR(updatedDocument.totalAmount)}`);
      if ((updatedDocument.description || '') !== (oldDocument.description || '')) changes.push('Beschreibung geändert');
      if ((updatedDocument.enteredBy || '') !== (oldDocument.enteredBy || '')) changes.push('„Eingetragen von“ geändert');
      if (!sameTime(updatedDocument.dueDate, oldDocument.dueDate)) changes.push('Fälligkeit geändert');
      if (nachweisUrl !== undefined) changes.push('Nachweis ersetzt');
      if (newItemCreations !== undefined) {
        const qtyMap = (list) => {
          const m = new Map();
          for (const it of list) if (it.articleId) m.set(String(it.articleId), (m.get(String(it.articleId)) || 0) + Number(it.quantity));
          return [...m.entries()].sort().map(([k, v]) => `${k}:${v}`).join('|');
        };
        if (qtyMap(oldDocument.items) !== qtyMap(newItemCreations)) changes.push('Positionen/Wareneingang geändert');
      }
      const oldPaid = paidDateOf(oldDocument);
      const newPaid = paidDateOf(updatedDocument);
      const paymentChanged = !sameTime(oldPaid, newPaid) || (oldPaid && updatedDocument.paymentMethod !== oldDocument.paymentMethod);
      if (paymentChanged) {
        if (oldPaid && !newPaid) changes.push(`auf offen gesetzt (war bezahlt am ${fmtDate(oldPaid)})`);
        else if (!oldPaid && newPaid) changes.push(`als bezahlt markiert (${fmtDate(newPaid)})`);
        else changes.push(`Zahldatum von ${fmtDate(oldPaid)} auf ${fmtDate(newPaid)}`);
      }
      const contentChanged = changes.length > (paymentChanged ? 1 : 0);
      // Ohne tatsächliche Änderung (Speichern ohne Änderung) keine Rückfrage
      const closedYears = await closedPeriod.guard([
        ...(paymentChanged || contentChanged ? [oldPaid, newPaid] : []),
        ...(contentChanged ? [oldDocument.documentDate, updatedDocument.documentDate] : [])
      ], confirmClosed, tx);
      if (closedYears.length) {
        await closedPeriod.logChange(tx, closedYears, {
          kind: 'expense', userId, entityType: 'PurchaseDocument', entityId: documentId,
          operation: 'Beleg geändert',
          description: `${docLabel(oldDocument)} geändert: ${changes.join(', ')}`,
          amountBefore: oldDocument.type === 'RECHNUNG' ? (fy) => expenseIn(oldDocument, fy) : null,
          amountAfter: oldDocument.type === 'RECHNUNG' ? (fy) => expenseIn(updatedDocument, fy) : null,
        });
      }

      // Audit-Log
      await tx.auditLog.create({
        data: {
          userId: userId,
          action: 'UPDATE_DOCUMENT',
          entityType: 'PurchaseDocument',
          entityId: documentId,
          changes: { updatedFields: Object.keys(data), nachweisUpdate: nachweisUrl !== undefined }
        }
      });

      return updatedDocument;
    });
  }
  /**
   * Löscht einen Beleg und storniert alle zugehörigen Wareneingänge.
   */
  async deleteDocument(documentId, userId, { confirmClosed = false } = {}) {
    return prisma.$transaction(async (tx) => {

      // 1. Hole den Beleg und seine Positionen
      const document = await tx.purchaseDocument.findUnique({
        where: { id: documentId },
        include: {
          items: true,
          // Wir brauchen auch die Lieferscheine, um sie zu loggen
          lieferscheine: { select: { id: true } }
        }
      });

      if (!document) {
        throw userError('Beleg nicht gefunden.', 404);
      }

      const closedYears = await closedPeriod.guard([document.documentDate, paidDateOf(document)], confirmClosed, tx);
      if (closedYears.length) {
        const isRe = document.type === 'RECHNUNG';
        await closedPeriod.logChange(tx, closedYears, {
          kind: 'expense', userId, entityType: 'PurchaseDocument', entityId: documentId,
          operation: 'Beleg gelöscht',
          description: `${docLabel(document)} gelöscht, Belegdatum ${fmtDate(document.documentDate)}`
            + (isRe ? `, ${fmtEUR(document.totalAmount)}${paidDateOf(document) ? `, bezahlt am ${fmtDate(paidDateOf(document))}` : ', offen'}` : ''),
          amountBefore: isRe ? (fy) => expenseIn(document, fy) : null,
          amountAfter: isRe ? 0 : null,
        });
      }

      // 1b. Auslage-Gutschrift zurückbuchen (die TopUps bleiben, purchaseDocumentId wird null, reference behält die Nummer)
      await this._reverseReimbursement(tx, document);

      // 2. Lagerbestand-KORREKTUR (Storno)
      //    Dies gilt für Lieferscheine und Sofortkauf-Rechnungen
      if (document.items.length > 0) {
        for (const item of document.items) {
          if (item.articleId) {
            // 2a. Bestand verringern (Storno)
            await tx.article.update({
              where: { id: item.articleId },
              data: {
                stock: {
                  decrement: item.quantity // item.quantity ist die gebuchte Menge (z.B. 15 Flaschen)
                }
              }
            });

            // 2b. Storno-Bewegung loggen
            await tx.stockMovement.create({
              data: {
                articleId: item.articleId,
                type: 'CORRECTION',
                quantity: item.quantity.negated(), // Negativ = Abgang
                reason: `Storno/Löschung Beleg ${document.documentNumber}`
              }
            });
          }
        }
      }

      // 3. Verknüpfte Lieferscheine (falls dies eine Rechnung ist)
      //    Das Schema (onDelete: SetNull) entknüpft diese automatisch.
      //    Wir müssen hier nichts manuell tun.

      // 4. Positionen (Items) löschen
      //    Das Schema (onDelete: Cascade) löscht diese automatisch.

      // 5. Beleg löschen
      await tx.purchaseDocument.delete({
        where: { id: documentId }
      });

      // 6. Audit-Log
      await tx.auditLog.create({
        data: {
          userId: userId,
          action: 'DELETE_DOCUMENT',
          entityType: 'PurchaseDocument',
          entityId: documentId,
          changes: {
            documentNumber: document.documentNumber,
            supplier: document.supplier,
            unlinkedLieferscheine: document.lieferscheine.map(ls => ls.id)
          }
        }
      });

      return document; // Rückgabe zur Bestätigung
    });
  }



}

module.exports = new PurchaseDocumentService();
