// src/services/receiptService.js
// Kassenprüfer-Belegprüfung: Eingangsbelege eines Zeitraums mit Nachweis-ZIP-Export.
'use strict';

const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { ZipArchive } = require('archiver');
const prisma = require('../utils/prisma');
const fileUploadService = require('./fileUploadService');
const exportService = require('./exportService');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');

// -----------------------------------------------------------------------
// Hilfsfunktionen
// -----------------------------------------------------------------------

/** Dateiendung → MIME-Typ (nur Typen, die fileUploadService erlaubt) */
function _extToMime(ext) {
  switch (ext.toLowerCase()) {
    case '.pdf':  return 'application/pdf';
    case '.png':  return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default:      return null;
  }
}

/**
 * Lieferantenname → Datei-Slug (max. 40 Zeichen).
 * Umlaute ersetzen, Nicht-Alnum → '-', mehrfache '-' zusammenziehen, trimmen.
 */
function _supplierSlug(name) {
  if (!name) return 'unbekannt';
  let s = String(name)
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 40) || 'unbekannt';
}

/**
 * Betrag (number) → Komma-Dezimal-String (z.B. "66,00")
 * LIEFERSCHEIN: "LS"
 */
function _amountSlug(doc) {
  if (doc.type === 'LIEFERSCHEIN' || doc.totalAmount === null || doc.totalAmount === undefined) {
    return 'LS';
  }
  return Number(doc.totalAmount).toFixed(2).replace('.', ',');
}

/**
 * Zahlungsart → deutscher Text
 */
function _paymentLabel(pm) {
  return ({ CASH: 'Bar', ACCOUNT: 'Kundenkonto', INVOICE: 'Rechnung', TRANSFER: 'Überweisung' })[pm] || (pm || '');
}

// -----------------------------------------------------------------------
// ReceiptService
// -----------------------------------------------------------------------

class ReceiptService {

  /**
   * Listet alle PurchaseDocuments im Zeitraum [start, end] auf,
   * sortiert nach documentDate asc, dann documentNumber asc.
   * Prüft jeweils, ob die Nachweis-Datei auf dem Dateisystem vorhanden ist.
   *
   * @param {Date} start
   * @param {Date} end
   * @returns {Promise<{period, documents, summary}>}
   */
  async listReceipts(start, end) {
    const docs = await prisma.purchaseDocument.findMany({
      where: {
        documentDate: { gte: start, lte: end }
      },
      orderBy: [
        { documentDate: 'asc' },
        { documentNumber: 'asc' }
      ]
    });

    const documents = await Promise.all(docs.map(async (d) => {
      const url = d.nachweisUrl || null;
      let hasNachweis = false;
      let nachweisMissingFile = false;
      let nachweisMime = null;

      if (url) {
        const fsPath = fileUploadService._fromAnyUrlToFsPath(url);
        try {
          await fsPromises.access(fsPath, fs.constants.F_OK);
          hasNachweis = true;
          nachweisMime = _extToMime(path.extname(url));
        } catch {
          hasNachweis = false;
          nachweisMissingFile = true;
          nachweisMime = _extToMime(path.extname(url));
        }
      }

      return {
        id:             d.id,
        documentNumber: d.documentNumber,
        type:           d.type,
        supplier:       d.supplier,
        documentDate:   d.documentDate,
        totalAmount:    d.type === 'LIEFERSCHEIN' ? null : (d.totalAmount !== null ? Number(d.totalAmount) : null),
        paid:           d.paid,
        paidAt:         d.paidAt,
        paymentMethod:  d.paymentMethod,
        nachweisUrl:    url,
        nachweisMime,
        hasNachweis,
        nachweisMissingFile,
        rechnungId:     d.rechnungId,
        description:    d.description
      };
    }));

    // Zusammenfassung
    const count         = documents.length;
    const withNachweis  = documents.filter(d => d.hasNachweis).length;
    const withoutNachweis = count - withNachweis;

    const rechnungen  = documents.filter(d => d.type === 'RECHNUNG');
    const totalAmount = rechnungen.reduce((s, d) => s + (d.totalAmount || 0), 0);
    const totalPaid   = rechnungen.filter(d => d.paid).reduce((s, d) => s + (d.totalAmount || 0), 0);
    const totalUnpaid = totalAmount - totalPaid;

    return {
      period: { startDate: start, endDate: end },
      documents,
      summary: {
        count,
        withNachweis,
        withoutNachweis,
        totalAmount,
        totalPaid,
        totalUnpaid
      }
    };
  }

  /**
   * Erstellt ein ZIP-Archiv mit allen vorhandenen Nachweisen + Belegliste.csv + Belegliste.pdf.
   *
   * @param {Date}   start
   * @param {Date}   end
   * @param {{name: string, createdBy: string}} opts
   * @returns {Promise<{stream: Archiver, filename: string}>}
   */
  async buildReceiptZip(start, end, { name = 'Zeitraum', createdBy = '' } = {}) {
    const list = await this.listReceipts(start, end);

    // Dateinamen im ZIP erzeugen (Kollisionen auflösen)
    const usedNames = new Map(); // Basis-Name → Zähler
    const fileNames = {}; // doc.id → Dateiname im ZIP (oder FEHLT-Marker)

    for (const doc of list.documents) {
      if (!doc.nachweisUrl) {
        fileNames[doc.id] = null; // kein Upload
        continue;
      }

      const ext = path.extname(doc.nachweisUrl) || '.bin';
      const base = `${doc.documentNumber}_${_supplierSlug(doc.supplier)}_${_amountSlug(doc)}`;
      let candidate = `${base}${ext}`;

      if (usedNames.has(candidate)) {
        const n2 = usedNames.get(candidate) + 1;
        usedNames.set(candidate, n2);
        candidate = `${base}_${n2}${ext}`;
      } else {
        usedNames.set(candidate, 1);
      }

      fileNames[doc.id] = doc.hasNachweis ? candidate : (doc.nachweisMissingFile ? `__FEHLT__${candidate}` : null);
    }

    // CSV-Puffer aufbauen
    const csvBuffer = this._buildCsvBuffer(list.documents, fileNames);

    // PDF-Puffer aufbauen
    const pdfBuffer = await this.buildReceiptListPDF(list, {
      title: `Belegliste – ${name}`,
      subtitle: this._periodLabel(start, end, name),
      createdBy,
      fileNames
    });

    // ZIP-Dateiname
    const fmtYMD = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    const nameSlug = _supplierSlug(name).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'Zeitraum';
    const filename = `nachweise_${nameSlug}_${fmtYMD(start)}_${fmtYMD(end)}.zip`;

    // Archiver erstellen (archiver v8: ZipArchive)
    const archive = new ZipArchive({ zlib: { level: 6 } });

    // Dateien hinzufügen
    for (const doc of list.documents) {
      const zipName = fileNames[doc.id];
      if (!zipName || zipName.startsWith('__FEHLT__')) continue;
      if (!doc.hasNachweis) continue;
      const fsPath = fileUploadService._fromAnyUrlToFsPath(doc.nachweisUrl);
      archive.file(fsPath, { name: zipName });
    }

    // CSV und PDF anhängen
    archive.append(csvBuffer, { name: 'Belegliste.csv' });
    archive.append(pdfBuffer, { name: 'Belegliste.pdf' });

    archive.finalize();

    return { stream: archive, filename };
  }

  /**
   * Erstellt die Belegliste.csv als Buffer (UTF-8 mit BOM, Semikolon, Komma-Dezimal).
   */
  _buildCsvBuffer(documents, fileNames) {
    const fmtDate = (d) => {
      if (!d) return '';
      const x = new Date(d);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}`;
    };
    const fmtEur = (n) => (n === null || n === undefined) ? '' : Number(n).toFixed(2).replace('.', ',');
    const typeLabel = (t) => t === 'RECHNUNG' ? 'Rechnung' : 'Lieferschein';
    const paidLabel = (doc) => {
      if (doc.type === 'LIEFERSCHEIN') return '';
      return doc.paid ? 'Ja' : 'Nein';
    };
    const fileNameLabel = (doc) => {
      const fn = fileNames[doc.id];
      if (!fn) return 'FEHLT'; // kein Upload
      if (fn.startsWith('__FEHLT__')) return 'FEHLT (Datei nicht gefunden)';
      return fn;
    };

    const header = 'Belegnummer;Typ;Datum;Lieferant;Betrag;Bezahlt;Zahlungsart;Nachweis-Datei';
    const rows = documents.map(doc =>
      [
        doc.documentNumber,
        typeLabel(doc.type),
        fmtDate(doc.documentDate),
        doc.supplier || '',
        fmtEur(doc.totalAmount),
        paidLabel(doc),
        doc.paymentMethod ? _paymentLabel(doc.paymentMethod) : '',
        fileNameLabel(doc)
      ].join(';')
    );

    const csv = [header, ...rows].join('\r\n');
    // UTF-8 BOM + Content
    return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(csv, 'utf8')]);
  }

  /**
   * Erstellt die Belegliste als PDF-Buffer, analog zu exportCashCountPDF.
   */
  async buildReceiptListPDF(list, { title, subtitle, createdBy, fileNames = {} } = {}) {
    const theme = exportService.getTheme();
    const fmtDate = exportService._fmtDate.bind(exportService);
    const fmtEUR  = exportService._fmtEUR.bind(exportService);

    const headerInfo = {
      reportName: 'Belegliste',
      title: title || 'Belegliste – Clubraum',
      subtitle: subtitle || '',
      createdBy
    };

    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme: th } = exportService._createDocWithBuffer(headerInfo);
        exportService._decoratePage(doc, th, headerInfo);

        const sm = list.summary;

        // --- Zusammenfassung ---
        exportService._section(doc, th, 'Zusammenfassung', headerInfo);
        exportService._kvList(doc, th, [
          { label: 'Anzahl Belege gesamt', value: String(sm.count) },
          { label: '  davon Rechnungen',   value: String(list.documents.filter(d => d.type === 'RECHNUNG').length) },
          { label: '  davon Lieferscheine',value: String(list.documents.filter(d => d.type === 'LIEFERSCHEIN').length) },
          { spacer: true },
          { label: 'Mit Nachweis',          value: String(sm.withNachweis) },
          {
            label: 'Ohne Nachweis',
            value: String(sm.withoutNachweis),
            color: sm.withoutNachweis > 0 ? th.color.danger : th.color.text
          },
          { spacer: true },
          { label: 'Summe Rechnungen',      value: fmtEUR(sm.totalAmount), bold: true, rule: true },
          { label: '  davon bezahlt',        value: fmtEUR(sm.totalPaid),   color: th.color.success },
          { label: '  davon offen',          value: fmtEUR(sm.totalUnpaid), color: sm.withoutNachweis > 0 || sm.totalUnpaid > 0 ? th.color.danger : th.color.text }
        ], { headerInfo });

        // --- Belege-Tabelle ---
        exportService._section(doc, th, 'Belege', headerInfo);

        const fileNameLabel = (docRow) => {
          const fn = fileNames[docRow.id];
          if (!fn) return 'FEHLT';
          if (fn.startsWith('__FEHLT__')) return 'FEHLT (Datei nicht gefunden)';
          return fn;
        };
        const fileNameColor = (docRow) => {
          const fn = fileNames[docRow.id];
          if (!fn || fn.startsWith('__FEHLT__')) return th.color.danger;
          return th.color.text;
        };

        // Summe der Spaltenbreiten = 495 pt (A4 abzüglich Ränder), damit nichts skaliert
        // und "Lieferschein", "28.09.2026", "EK-2026-0001" jeweils in eine Zeile passen.
        const shortPayment = (pm) => ({ CASH: 'Bar', ACCOUNT: 'Konto', INVOICE: 'Rechn.', TRANSFER: 'Überw.' })[pm] || '';
        const paidLabel = (r) => {
          if (r.type === 'LIEFERSCHEIN') return '–';
          if (!r.paid) return 'Nein';
          const pm = shortPayment(r.paymentMethod);
          return pm ? `Ja (${pm})` : 'Ja';
        };
        exportService._table(doc, th, {
          columns: [
            { header: 'Belegnr.',  width: 70,  render: r => r.documentNumber },
            { header: 'Typ',       width: 59,  render: r => r.type === 'RECHNUNG' ? 'Rechnung' : 'Lieferschein' },
            { header: 'Datum',     width: 55,  render: r => fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 85,  render: r => r.supplier || '' },
            { header: 'Bezahlt',   width: 64,  render: r => paidLabel(r), color: r => (r.type === 'RECHNUNG' && !r.paid) ? th.color.warning : th.color.text },
            { header: 'Betrag',    width: 55,  align: 'right', render: r => r.totalAmount !== null ? fmtEUR(r.totalAmount) : '–' },
            {
              header: 'Nachweis',
              width: 107,
              render: r => fileNameLabel(r),
              color: r => fileNameColor(r)
            }
          ],
          rows: list.documents,
          sumRow: [
            'Summe', '', '', '', '',
            fmtEUR(list.documents.filter(d => d.type === 'RECHNUNG').reduce((s, d) => s + (d.totalAmount || 0), 0)),
            ''
          ],
          emptyHint: 'Keine Belege im Zeitraum vorhanden.',
          headerInfo
        });

        // Hinweis unter der Tabelle
        exportService._note(doc, th,
          `${sm.withNachweis} von ${sm.count} Belegen mit Nachweis.`
        );

        // Unterschriftenblock
        exportService._signatureBlock(doc, th,
          ['Kassenprüfer/in 1', 'Kassenprüfer/in 2'],
          headerInfo
        );

        exportService._finishDoc(doc, th, headerInfo);
        done.then(buf => resolve(buf)).catch(reject);
      } catch (e) { reject(e); }
    });
  }

  // Hilfe: Zeitraum-Label für Subtitle
  _periodLabel(start, end, name = '') {
    const fmtDate = exportService._fmtDate.bind(exportService);
    const period = `${fmtDate(start)} – ${fmtDate(end)}`;
    return name ? `${period} · ${name}` : period;
  }
}

module.exports = new ReceiptService();
