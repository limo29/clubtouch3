const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');

// Fachlicher Fehler (Controller antwortet mit 400 und dieser Meldung)
function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
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
   * Generiert eine neue Belegnummer (z.B. RE-2025-0001)
   */
  async generateDocumentNumber(type) {
    const prefix = type === 'RECHNUNG' ? 'EK' : 'LS';
    const year = new Date().getFullYear();
    const yearPrefix = `${prefix}-${year}-`;

    const lastDocument = await prisma.purchaseDocument.findFirst({
      where: {
        documentNumber: {
          startsWith: yearPrefix
        },
        type: type
      },
      orderBy: {
        documentNumber: 'desc'
      }
    });

    let nextNumber = 1;
    if (lastDocument) {
      const parts = lastDocument.documentNumber.split('-');
      nextNumber = parseInt(parts[2]) + 1;
    }

    return `${yearPrefix}${nextNumber.toString().padStart(4, '0')}`;
  }

  /**
   * Erstellt einen neuen Beleg (Lieferschein oder Rechnung)
   * und bucht optional den Wareneingang.
   */
  async createDocument(data, userId, nachweisUrl) {
    const {
      type,
      supplier,
      documentDate,
      description,
      totalAmount,
      paid,
      dueDate,
      paymentMethod,
      reimbursedCustomerId, // nur bei paymentMethod = ACCOUNT (Auslage)
      items, // Erwartet: [{ articleId, kisten, flaschen, ... }]
      lieferscheinIds // Optional: IDs von Lieferscheinen zum Verknüpfen
    } = data;

    return prisma.$transaction(async (tx) => {
      // 1. Dokumenten-Kopf erstellen
      const documentNumber = await this.generateDocumentNumber(type);

      const document = await tx.purchaseDocument.create({
        data: {
          type,
          documentNumber,
          supplier,
          documentDate: new Date(documentDate),
          description,
          nachweisUrl,
          totalAmount: totalAmount ? new Prisma.Decimal(totalAmount) : null,
          paid: paid || false,
          dueDate: dueDate ? new Date(dueDate) : null,
          paymentMethod: paid ? paymentMethod : null,
          paidAt: paid ? new Date() : null,
          userId: userId,
        }
      });

      // 1a. Auslage dem Kundenkonto gutschreiben
      if (paid && paymentMethod === 'ACCOUNT') {
        await this._bookReimbursement(tx, document, reimbursedCustomerId);
      }

      // 1b. Lieferscheine verknüpfen (falls vorhanden)
      if (type === 'RECHNUNG' && lieferscheinIds && Array.isArray(lieferscheinIds) && lieferscheinIds.length > 0) {
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
          if (!item.articleId) continue;

          const article = await tx.article.findUnique({
            where: { id: item.articleId }
          });

          if (!article) {
            throw new Error(`Artikel mit ID ${item.articleId} nicht gefunden.`);
          }

          // Kisten/Flaschen-Logik aus deinem Mockup
          const kistenQty = new Prisma.Decimal(item.kisten || 0);
          const flaschenQty = new Prisma.Decimal(item.flaschen || 0);
          const unitsPerKiste = new Prisma.Decimal(article.unitsPerPurchase || 0);

          // Ohne Kistenfaktor darf keine Kiste gebucht werden, sonst landen still 0 Flaschen im Bestand (B8)
          if (kistenQty.gt(0) && unitsPerKiste.lte(0)) {
            throw new Error(`Artikel "${article.name}" hat keinen Kistenfaktor (Einheiten pro ${article.purchaseUnit || 'Kiste'}). Bitte im Artikel pflegen.`);
          }

          // Gesamtmenge in "Basiseinheit" (z.B. Flasche)
          const totalQuantityToBook = (kistenQty.times(unitsPerKiste)).plus(flaschenQty);

          if (totalQuantityToBook.lte(0)) continue; // Nichts zu buchen

          // 2a. Lagerbestand erhöhen
          await tx.article.update({
            where: { id: item.articleId },
            data: {
              stock: {
                increment: totalQuantityToBook
              }
            }
          });

          // 2b. Bestandsbewegung loggen
          await tx.stockMovement.create({
            data: {
              articleId: item.articleId,
              type: 'DELIVERY', // Wareneingang
              quantity: totalQuantityToBook,
              reason: `Eingang ${documentNumber}`
            }
          });

          // 2c. Beleg-Position speichern
          await tx.purchaseDocumentItem.create({
            data: {
              documentId: document.id,
              articleId: item.articleId,
              description: article.name,
              quantity: totalQuantityToBook,
              unit: article.unit, // z.B. "Flasche"
              purchaseUnit: article.purchaseUnit, // z.B. "Kiste"
              purchaseUnitQuantity: kistenQty,
              baseUnit: article.unit,
              baseUnitQuantity: flaschenQty,
              // Preislogik (für Sofortkauf)
              // Annahme: Frontend schickt 'pricePerKiste' und 'pricePerFlasche'
              // Hier vereinfacht, du kannst das anpassen:
              pricePerUnit: new Prisma.Decimal(0), // TODO: Preislogik
              totalPrice: new Prisma.Decimal(0)    // TODO: Preislogik
            }
          });
        }
      }

      return document;
    }, {
      maxWait: 10000, // 10s
      timeout: 20000, // 20s
    });
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
    // TODO: Prüfen, ob rechnungId wirklich eine RECHNUNG ist
    // TODO: Prüfen, ob Lieferscheine vom selben Lieferanten sind
    // TODO: Prüfen, ob Lieferscheine noch nicht verknüpft sind

    const count = await prisma.purchaseDocument.updateMany({
      where: {
        id: { in: lieferscheinIds },
        type: 'LIEFERSCHEIN',
        rechnungId: null // Nur unverknüpfte
      },
      data: {
        rechnungId: rechnungId
      }
    });

    // Audit-Log
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'LINK_PURCHASE_DOCUMENTS',
        entityType: 'PurchaseDocument',
        entityId: rechnungId,
        changes: {
          linkedIds: lieferscheinIds,
          count: count.count
        }
      }
    });

    return count;
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
   * Markiert eine Rechnung als bezahlt.
   */
  async markAsPaid(documentId, paymentMethod, userId, reimbursedCustomerId = null) {
    return prisma.$transaction(async (tx) => {
      const document = await tx.purchaseDocument.findUnique({ where: { id: documentId } });

      if (!document) {
        throw userError('Beleg nicht gefunden.');
      }
      if (document.type !== 'RECHNUNG') {
        throw userError('Nur Rechnungen können als bezahlt markiert werden.');
      }
      if (hasReimbursement(document)) {
        throw userError('Die Rechnung ist bereits als Auslage gutgeschrieben.');
      }

      let updatedDocument = await tx.purchaseDocument.update({
        where: { id: documentId },
        data: {
          paid: true,
          paidAt: new Date(),
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
            amount: updatedDocument.totalAmount,
            reimbursedCustomerId: updatedDocument.reimbursedCustomerId || undefined
          }
        }
      });

      return updatedDocument;
    });
  }
  async markAsUnpaid(documentId, userId) {
    return prisma.$transaction(async (tx) => {
      const document = await tx.purchaseDocument.findUnique({ where: { id: documentId } });

      if (!document) {
        throw userError('Beleg nicht gefunden.');
      }
      if (document.type !== 'RECHNUNG') {
        throw userError('Nur Rechnungen können bearbeitet werden.');
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
            oldStatus: 'PAID',
            newStatus: 'UNPAID',
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
  async updateDocument(documentId, data, userId, nachweisUrl) {
    const {
      supplier,
      documentDate,
      description,
      totalAmount,
      paid,
      dueDate,
      paymentMethod,
      reimbursedCustomerId, // nur bei paymentMethod = ACCOUNT (Auslage)
      items // Erwartet: [{ articleId, kisten, flaschen }] oder undefined
    } = data;

    return prisma.$transaction(async (tx) => {

      // 1. Hole den alten Beleg INKLUSIVE seiner alten Positionen
      const oldDocument = await tx.purchaseDocument.findUnique({
        where: { id: documentId },
        include: { items: { include: { article: true } } }
      });

      if (!oldDocument) {
        throw new Error('Beleg nicht gefunden.');
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

            const article = await tx.article.findUnique({ where: { id: newItem.articleId } });
            if (!article) throw new Error(`Artikel ${newItem.articleId} nicht gefunden.`);

            const kistenQty = new Prisma.Decimal(newItem.kisten || 0);
            const flaschenQty = new Prisma.Decimal(newItem.flaschen || 0);
            const unitsPerKiste = new Prisma.Decimal(article.unitsPerPurchase || 0);

            const totalNewQuantity = kistenQty.times(unitsPerKiste).plus(flaschenQty);

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

            const article = await tx.article.findUnique({ where: { id: newItem.articleId } });
            const kistenQty = new Prisma.Decimal(newItem.kisten || 0);
            const flaschenQty = new Prisma.Decimal(newItem.flaschen || 0);
            const unitsPerKiste = new Prisma.Decimal(article.unitsPerPurchase || 0);
            const totalNewQuantity = kistenQty.times(unitsPerKiste).plus(flaschenQty);

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
              pricePerUnit: new Prisma.Decimal(0), // TODO: Preislogik
              totalPrice: new Prisma.Decimal(0)
            });
          }
        }
      }

      // 7. Kopfdaten (Header) aktualisieren
      const updateData = {};
      if (supplier !== undefined) updateData.supplier = supplier;
      if (documentDate !== undefined) updateData.documentDate = new Date(documentDate);
      if (description !== undefined) updateData.description = description;

      if (newItemCreations !== undefined) {
        updateData.items = {
          create: newItemCreations
        };
      }

      if (oldDocument.type === 'RECHNUNG') {
        if (totalAmount !== undefined) updateData.totalAmount = new Prisma.Decimal(totalAmount);
        if (paid !== undefined) {
          updateData.paid = paid;
          if (paid) {
            // Wenn bezahlt gesetzt wird, und Methode da ist
            if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
            // Wenn vorher nicht bezahlt war, setze Datum
            if (!oldDocument.paid) updateData.paidAt = new Date();
          } else {
            updateData.paymentMethod = null;
            updateData.paidAt = null;
            updateData.reimbursedCustomerId = null;
          }
        }
        if (dueDate !== undefined) updateData.dueDate = new Date(dueDate);
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
  async deleteDocument(documentId, userId) {
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
        throw new Error('Beleg nicht gefunden.');
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
