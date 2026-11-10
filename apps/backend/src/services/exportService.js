// services/exportService.js
const { parse } = require('json2csv');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const prisma = require('../utils/prisma');
const accountingService = require('./accountingService');
const customerService = require('./customerService');
const cashCountService = require('./cashCountService');
const cashMovementService = require('./cashMovementService');
const yearEndExtrasService = require('./yearEndExtrasService');
const closedPeriod = require('../utils/closedPeriod');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');

// Logo einmal beim Laden lesen; fehlt die Datei, wird ohne Logo gerendert.
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
let LOGO_BUFFER = null;
try { LOGO_BUFFER = fs.readFileSync(LOGO_PATH); } catch (_) { LOGO_BUFFER = null; }

class ExportService {
  constructor() {
    this.currencyFmt = new Intl.NumberFormat('de-DE', {
      style: 'currency', currency: 'EUR',
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    this.dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /* ========= THEME & UTIL ========= */
  getTheme() {
    return {
      brandName: 'Clubraum',
      // top/bottom lassen Platz für Kopf (Titel, Untertitel, Logo) und Fußzeile
      page: { margin: 50, top: 92, bottom: 62, size: 'A4' },
      font: { regular: 'Helvetica', bold: 'Helvetica-Bold' },
      logo: { height: 28 },
      color: {
        text: '#0f172a', subtext: '#475569',
        primary: '#2563eb', border: '#e2e8f0',
        tableHeaderBg: '#f1f5f9', tableHeaderText: '#334155',
        zebra: '#f8fafc', panelBg: '#f8fafc',
        success: '#16a34a', danger: '#dc2626', warning: '#d97706'
      }
    };
  }
  _fmtEUR = (n) => this.currencyFmt.format(Number(n || 0));
  _fmtDate = (d) => {
    if (!d) return '—';
    const x = d instanceof Date ? d : parseLocalDate(d);
    return x && !Number.isNaN(x.getTime()) ? this.dateFmt.format(x) : '—';
  };
  /** dd.MM.yyyy HH:mm (lokale Zeit, ohne Komma – so liest es auch Excel-DE) */
  _fmtDateTime = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
  };
  /** Zahl mit Komma für CSV (Excel-DE) */
  _csvNum = (n, digits = 2) => (n === null || n === undefined || n === '') ? '' : Number(n).toFixed(digits).replace('.', ',');
  _csvDateTime = (d) => d ? this._fmtDateTime(d) : '';
  _paymentLabel(pm) {
    return ({ CASH: 'Bar', ACCOUNT: 'Kundenkonto', INVOICE: 'Rechnung', TRANSFER: 'Überweisung', CARD: 'Karte' })[pm] || (pm || '—');
  }
  _invoiceStatusLabel(st) {
    return ({ DRAFT: 'Entwurf', SENT: 'Versendet', PAID: 'Bezahlt', CANCELLED: 'Storniert' })[st] || (st || '—');
  }
  /** Einheit passend zur Menge: "1 Flasche", "30 Flaschen", "2 Kisten", "3 Stück" */
  _unitLabel(unit, n) {
    if (!unit) return '';
    if (Math.abs(Number(n)) === 1) return unit;
    const plural = {
      Flasche: 'Flaschen', Kiste: 'Kisten', Dose: 'Dosen', Glas: 'Gläser', Packung: 'Packungen', Kasten: 'Kästen',
      Portion: 'Portionen', Tüte: 'Tüten', Fass: 'Fässer', Karton: 'Kartons', Tray: 'Trays', Stange: 'Stangen', Tafel: 'Tafeln',
      Fl: 'Fl.', 'Fl.': 'Fl.'
    };
    if (plural[unit]) return plural[unit];
    if (/(Stück|Liter|Becher|Beutel|Kanister|Eimer|Sack)$/.test(unit)) return unit;
    if (/e$/.test(unit)) return `${unit}n`;
    return unit;
  }
  /** Menge deutsch ohne unnötige Nachkommastellen ("3", "1,5") */
  _fmtNum(n) {
    const v = Number(n || 0);
    return Number.isInteger(v) ? String(v) : v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  }
  /**
   * Menge mit Einheit, ab einer vollen Kiste mit Aufschlüsselung:
   *   "30 Flaschen (1 Kiste + 10)", "1 Flasche", "-34 Flaschen" (negativ: keine Kisten-Zerlegung)
   */
  _fmtQty(n, unit, pUnit, pQty) {
    const val = Number(n || 0);
    const base = `${this._fmtNum(val)}${unit ? ` ${this._unitLabel(unit, val)}` : ''}`;
    const f = Number(pQty || 0);
    if (!pUnit || !(f > 1) || val < f) return base;
    const crates = Math.floor(val / f);
    const rest = Math.round((val - crates * f) * 100) / 100;
    // geschützte Leerzeichen: die Klammer bricht nur als Ganzes um
    return `${base} (${crates}\u00A0${this._unitLabel(pUnit, crates)}${rest > 0 ? `\u00A0+\u00A0${this._fmtNum(rest)}` : ''})`;
  }
  /** Betrag mit Vorzeichen (+/-), für Differenzen */
  _fmtSigned(n) {
    const v = Math.round(Number(n || 0) * 100) / 100;
    return `${v > 0 ? '+' : ''}${this._fmtEUR(v)}`;
  }

  /* ========= PDF-GRUNDGERÜST =========
   * Kein Instanzzustand: Alles, was eine Seite zum Dekorieren braucht, hängt am
   * Dokument selbst (doc._ct). headerInfo:
   *   { reportName, title, subtitle, watermark, createdBy }
   * Jede per addPage() neu angelegte Seite (auch automatische Umbrüche) bekommt
   * über das 'pageAdded'-Event den Kopf; die erste Seite dekoriert der Aufrufer
   * explizit (Deckblätter bleiben so frei). _finishDoc schreibt die Fußzeilen
   * "Clubraum · Bericht | erstellt am … von … | Seite x von y" auf alle Seiten.
   */
  _createDocWithBuffer(headerInfo = {}) {
    const theme = this.getTheme();
    const doc = new PDFDocument({
      margins: { top: theme.page.top, bottom: theme.page.bottom, left: theme.page.margin, right: theme.page.margin },
      size: theme.page.size,
      bufferPages: true,
      info: {
        Title: headerInfo.title || headerInfo.reportName || theme.brandName,
        Author: headerInfo.createdBy || theme.brandName,
        Creator: 'ClubTouch3'
      }
    });
    doc._ct = { headerInfo: { ...headerInfo }, createdAt: new Date(), theme };
    doc.on('pageAdded', () => this._decoratePage(doc, theme, doc._ct.headerInfo));
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
    return { doc, done, theme };
  }

  _drawLogo(doc, theme, { x, y, height }) {
    if (!LOGO_BUFFER) return 0;
    try {
      doc.image(LOGO_BUFFER, x, y, { height });
      return height; // Logo ist annähernd quadratisch
    } catch (_) { return 0; }
  }

  _decoratePage(doc, theme, headerInfo = {}) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const info = doc._ct.headerInfo || {};
    const { margin } = theme.page;
    const pageWidth = doc.page.width;
    const usable = pageWidth - margin * 2;

    // Font-Zustand sichern: Der Kopf darf einen laufenden Textfluss nicht verändern
    const prev = { font: doc._font && doc._font.name, size: doc._fontSize, fill: doc._fillColor, x: doc.x };
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const logoH = theme.logo.height;
    const logoW = this._drawLogo(doc, theme, { x: pageWidth - margin - logoH, y: 20, height: logoH });
    const textW = usable - (logoW ? logoW + 12 : 0);

    doc.fillColor(theme.color.primary).font(theme.font.bold).fontSize(16)
      .text(info.title || '', margin, 22, { width: textW, align: 'left', lineBreak: false });

    if (info.subtitle) {
      doc.fillColor(theme.color.subtext).font(theme.font.regular).fontSize(9)
        .text(info.subtitle, margin, 44, { width: textW, align: 'left', height: 24, ellipsis: true });
    }

    if (info.watermark) {
      doc.fillColor(theme.color.danger).font(theme.font.bold).fontSize(11)
        .text(String(info.watermark), margin, 60, { width: textW, align: 'right', lineBreak: false });
    }

    doc.save().lineWidth(1).strokeColor(theme.color.border)
      .moveTo(margin, theme.page.top - 16).lineTo(pageWidth - margin, theme.page.top - 16).stroke().restore();

    doc.page.margins.bottom = prevBottom;
    doc.y = theme.page.top;
    doc.x = margin;
    if (prev.font) doc.font(prev.font); else doc.font(theme.font.regular);
    doc.fontSize(prev.size || 10);
    if (prev.fill) doc.fillColor(prev.fill[0], prev.fill[1]); else doc.fillColor(theme.color.text);
  }

  /** Neue Seite; optional mit geändertem Kopf (z.B. nach einem Deckblatt). */
  _addPageDecorated(doc, theme, headerInfo) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    doc.addPage(); // 'pageAdded' dekoriert
  }

  /** Fußzeilen auf alle Seiten schreiben und Dokument beenden. */
  _finishDoc(doc, theme, headerInfo) {
    const info = { ...(doc._ct.headerInfo || {}), ...(headerInfo || {}) };
    const { margin } = theme.page;
    const range = doc.bufferedPageRange();
    const total = range.count;
    const createdLabel = `erstellt am ${this._fmtDateTime(doc._ct.createdAt)}${info.createdBy ? ` von ${info.createdBy}` : ''}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - theme.page.bottom + 22;
      const w = doc.page.width - margin * 2;
      doc.save().lineWidth(0.5).strokeColor(theme.color.border)
        .moveTo(margin, y - 8).lineTo(doc.page.width - margin, y - 8).stroke().restore();
      doc.font(theme.font.regular).fontSize(8).fillColor(theme.color.subtext);
      // Spalten 25 % / 50 % / 25 %, jeweils einzeilig
      doc.text(`${theme.brandName} · ${info.reportName || info.title || ''}`, margin, y, { width: w * 0.25, align: 'left', lineBreak: false, height: 10, ellipsis: true });
      doc.text(createdLabel, margin + w * 0.25, y, { width: w * 0.5, align: 'center', lineBreak: false, height: 10, ellipsis: true });
      doc.text(`Seite ${i - range.start + 1} von ${total}`, margin + w * 0.75, y, { width: w * 0.25, align: 'right', lineBreak: false });
      doc.page.margins.bottom = prevBottom;
    }
    doc.end();
  }

  _bottom(doc, theme) { return doc.page.height - theme.page.bottom; }

  _ensureRoom(doc, theme, need) {
    if (doc.y + need > this._bottom(doc, theme)) {
      doc.addPage();
      return true;
    }
    return false;
  }

  _section(doc, theme, text, headerInfo) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    doc.x = theme.page.margin;
    // Überschrift nie allein am Seitenende
    this._ensureRoom(doc, theme, 100);
    doc.moveDown(0.6);
    doc.font(theme.font.bold).fontSize(14).fillColor(theme.color.text)
      .text(text, theme.page.margin, doc.y, { width: doc.page.width - theme.page.margin * 2 });

    const x = theme.page.margin, y = doc.y + 2;
    const w = doc.page.width - theme.page.margin * 2;
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.5).strokeColor(theme.color.border).stroke();
    doc.moveDown(0.5);
    doc.font(theme.font.regular).fillColor(theme.color.text);
  }

  /** Zwischenüberschrift innerhalb einer Sektion (nie allein am Seitenende). */
  _subheading(doc, theme, text) {
    this._ensureRoom(doc, theme, 90);
    doc.moveDown(0.3);
    doc.font(theme.font.bold).fontSize(11).fillColor(theme.color.text)
      .text(text, theme.page.margin, doc.y, { width: doc.page.width - theme.page.margin * 2 });
    doc.moveDown(0.4);
    doc.font(theme.font.regular).fontSize(10).fillColor(theme.color.text);
  }

  /** Hinweis auf gekürzte Listen: "… und n weitere" */
  _moreNote(doc, theme, shown, total) {
    if (total > shown) this._note(doc, theme, `… und ${total - shown} weitere (nicht einzeln gedruckt; Anzahl und Summen oben sind vollständig).`);
  }

  /**
   * Kompakte zweispaltige Saldenliste (Name links, Betrag rechts je Spalte), spaltenweise
   * von oben nach unten je Seite. rows: [{ label, value, color }]
   */
  _twoColumnList(doc, theme, rows, { fontSize = 8.5, lineH = 11.5 } = {}) {
    const left = theme.page.margin;
    const usable = doc.page.width - left * 2;
    const gap = 18;
    const colW = (usable - gap) / 2;
    const valueW = 62;
    let i = 0;
    while (i < rows.length) {
      this._ensureRoom(doc, theme, lineH * 3);
      const perCol = Math.max(1, Math.floor((this._bottom(doc, theme) - doc.y - 4) / lineH));
      const remaining = rows.length - i;
      const take = Math.min(remaining, perCol * 2);
      const leftCount = Math.min(perCol, Math.ceil(take / 2));
      const y0 = doc.y;
      for (let k = 0; k < take; k++) {
        const r = rows[i + k];
        const col = k < leftCount ? 0 : 1;
        const rowIdx = col === 0 ? k : k - leftCount;
        const x = left + col * (colW + gap);
        const y = y0 + rowIdx * lineH;
        if (rowIdx % 2 === 0) doc.save().rect(x, y - 1.5, colW, lineH).fill(theme.color.zebra).restore();
        doc.font(theme.font.regular).fontSize(fontSize).fillColor(theme.color.text)
          .text(String(r.label ?? ''), x + 2, y, { width: colW - valueW - 6, lineBreak: false, ellipsis: true });
        doc.fillColor(r.color || theme.color.text)
          .text(String(r.value ?? ''), x + colW - valueW - 2, y, { width: valueW, align: 'right', lineBreak: false });
      }
      i += take;
      doc.y = y0 + leftCount * lineH + 4;
      doc.x = left;
      if (i < rows.length) doc.addPage();
    }
    doc.font(theme.font.regular).fontSize(10).fillColor(theme.color.text);
    doc.moveDown(0.4);
  }

  /** Kleiner Hinweistext unter einer Tabelle/Sektion. */
  _note(doc, theme, text) {
    this._ensureRoom(doc, theme, 30);
    doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
      .text(text, theme.page.margin, doc.y, { width: doc.page.width - theme.page.margin * 2 });
    doc.fillColor(theme.color.text).fontSize(10);
    doc.moveDown(0.8);
  }

  /**
   * Label/Wert-Liste mit rechtsbündigen Beträgen.
   * rows: [{ label, value, bold, color, rule, spacer }]
   */
  _kvList(doc, theme, rows, { headerInfo, labelWidth, keepTogether = false } = {}) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const left = theme.page.margin;
    const usable = doc.page.width - left * 2;
    const valueW = 120;
    const labelW = labelWidth || usable - valueW;
    const lineH = 16;
    // Block zusammenhalten (z. B. Herleitung bis zur Differenz), solange er auf eine Seite passt
    if (keepTogether) {
      const need = (rows || []).reduce((a, r) => a + (r.spacer ? 6 : lineH), 0) + 8;
      if (need < this._bottom(doc, theme) - theme.page.top) this._ensureRoom(doc, theme, need);
    }
    (rows || []).forEach(r => {
      if (r.spacer) { doc.y += 6; return; }
      this._ensureRoom(doc, theme, lineH + 4);
      const y = doc.y;
      if (r.rule) {
        doc.moveTo(left, y - 3).lineTo(left + usable, y - 3).lineWidth(0.6).strokeColor(theme.color.border).stroke();
      }
      // einzeilig: zu lange Beschriftungen werden mit … gekürzt statt in die nächste Zeile zu laufen
      doc.font(r.bold ? theme.font.bold : theme.font.regular).fontSize(10).fillColor(theme.color.text)
        .text(String(r.label ?? ''), left, y, { width: labelW - 6, height: lineH - 2, ellipsis: true });
      doc.font(r.bold ? theme.font.bold : theme.font.regular).fontSize(10).fillColor(r.color || theme.color.text)
        .text(String(r.value ?? ''), left + labelW, y, { width: valueW, align: 'right', lineBreak: false });
      doc.y = y + lineH;
    });
    doc.font(theme.font.regular).fillColor(theme.color.text);
    doc.x = left;
    doc.moveDown(0.6);
  }

  /** Unterschriftenzeilen nebeneinander (max. 3 pro Reihe), jeweils mit Ort/Datum-Zeile. */
  _signatureBlock(doc, theme, labels, headerInfo, { dateLine = true } = {}) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const left = theme.page.margin;
    const usable = doc.page.width - left * 2;
    const perRow = Math.min(3, Math.max(1, labels.length));
    const gap = 24;
    const colW = (usable - gap * (perRow - 1)) / perRow;
    const rows = [];
    for (let i = 0; i < labels.length; i += perRow) rows.push(labels.slice(i, i + perRow));

    this._ensureRoom(doc, theme, 40 + rows.length * 90);
    doc.moveDown(1.5);
    doc.font(theme.font.bold).fontSize(11).fillColor(theme.color.text).text('Unterschriften', left, doc.y);
    doc.moveDown(0.5);

    rows.forEach(row => {
      const topY = doc.y + 40;
      row.forEach((label, idx) => {
        const x = left + idx * (colW + gap);
        doc.moveTo(x, topY).lineTo(x + colW, topY).lineWidth(0.7).strokeColor(theme.color.text).stroke();
        doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
          .text(label, x, topY + 4, { width: colW, lineBreak: false });
        if (dateLine) {
          doc.text('Ort, Datum', x, topY + 30, { width: colW, lineBreak: false });
          doc.moveTo(x, topY + 28).lineTo(x + colW, topY + 28).lineWidth(0.4).strokeColor(theme.color.border).stroke();
        }
      });
      doc.y = topY + (dateLine ? 50 : 26);
    });
    doc.x = left;
    doc.fillColor(theme.color.text).font(theme.font.regular).fontSize(10);
  }

  _table(doc, theme, { columns, rows, sumRow = null, emptyHint = 'Keine Daten vorhanden', headerInfo }) {
    if (headerInfo) doc._ct.headerInfo = { ...doc._ct.headerInfo, ...headerInfo };
    const left = theme.page.margin;
    const right = doc.page.width - theme.page.margin;
    const usableWidth = right - left;

    const srcW = columns.map(c => c.width);
    const totalW = srcW.reduce((a, b) => a + b, 0) || 1;
    const scale = usableWidth / totalW;
    const widths = srcW.map(w => Math.floor(w * scale));
    const rowPad = 6;
    const headerH = 18;

    const renderHeader = () => {
      let x = left; const y = doc.y;
      doc.save().rect(left, y - rowPad, usableWidth, headerH + rowPad * 2).fill(theme.color.tableHeaderBg).restore();
      columns.forEach((col, idx) => {
        doc.fillColor(theme.color.tableHeaderText).font(theme.font.bold).fontSize(10)
          .text(col.header, x + 2, y, { width: widths[idx] - 4, align: col.align || 'left' });
        x += widths[idx];
      });
      doc.moveTo(left, y + headerH + rowPad).lineTo(right, y + headerH + rowPad)
        .lineWidth(0.5).strokeColor(theme.color.border).stroke();
      doc.y = y + headerH + rowPad + 2;
      doc.fillColor(theme.color.text).font(theme.font.regular);
    };

    const ensureRoom = (need) => {
      const bottom = this._bottom(doc, theme);
      if (doc.y + need > bottom) {
        if (doc.y < theme.page.top + 50) {
          console.log(`[PDF WARN] Row too tall (${need}) for page. Printing anyway.`);
          return;
        }
        doc.addPage();
        renderHeader();
      }
    };

    // Leere Tabellen: nur Hinweis, keine Kopfzeile
    if (!rows || rows.length === 0) {
      this._ensureRoom(doc, theme, 24);
      doc.fontSize(10).fillColor(theme.color.subtext).text(emptyHint, left, doc.y + 2);
      doc.fillColor(theme.color.text);
      doc.moveDown(1); doc.x = theme.page.margin; return;
    }

    this._ensureRoom(doc, theme, headerH + rowPad * 2 + 40);
    renderHeader();

    // Schriftgröße je Zelle: Passt ein einzelnes Wort nicht in die Spalte, wird bis 8 pt verkleinert,
    // statt das Wort mitten drin umzubrechen ("Lieferante nnamen").
    const cellSize = (txt, w) => {
      const words = String(txt ?? '').split(/\s+/).filter(Boolean);
      let size = 10;
      doc.font(theme.font.regular);
      while (size > 8) {
        doc.fontSize(size);
        if (!words.some(word => doc.widthOfString(word) > w)) break;
        size -= 0.5;
      }
      return size;
    };

    rows.forEach((row, i) => {
      const cells = columns.map((col, idx) => {
        const txt = String((col.render ? col.render(row) : (row[col.key] ?? '')) ?? '');
        const size = cellSize(txt, widths[idx] - 4);
        doc.font(theme.font.regular).fontSize(size);
        return { txt, size, h: Math.max(doc.heightOfString(txt, { width: widths[idx] - 4 }), 10) };
      });
      const rowH = Math.max(...cells.map(c => c.h)) + rowPad * 2;

      // Zeile nie über den Seitenrand teilen: passt sie nicht mehr, neue Seite mit Kopfzeile.
      // Die letzte Zeile nimmt die Summenzeile mit, damit diese nicht allein auf der Folgeseite steht.
      ensureRoom(rowH + (sumRow && i === rows.length - 1 ? 52 : 30));

      if (i % 2 === 0) doc.save().rect(left, doc.y - 2, usableWidth, rowH + 4).fill(theme.color.zebra).restore();

      let x = left; const baseY = doc.y + rowPad;
      columns.forEach((col, idx) => {
        const color = typeof col.color === 'function' ? col.color(row) : theme.color.text;
        doc.fillColor(color).font(theme.font.regular).fontSize(cells[idx].size)
          .text(cells[idx].txt, x + 2, baseY, { width: widths[idx] - 4, align: col.align || 'left' });
        x += widths[idx];
      });

      doc.moveTo(left, baseY + (rowH - rowPad)).lineTo(right, baseY + (rowH - rowPad))
        .lineWidth(0.3).strokeColor('#eef2f7').stroke();

      doc.y = baseY + (rowH - rowPad) + 2;
    });

    if (sumRow) {
      // Höhe der Summenzeile vorab messen, damit sie nie über den Seitenrand umbricht
      doc.font(theme.font.bold).fontSize(10);
      const sumH = Math.max(...sumRow.map((val, idx) => doc.heightOfString(String(val ?? ''), { width: Math.max(10, widths[idx] - 4) })), 12);
      ensureRoom(sumH + 24);
      doc.moveDown(0.2);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.6).strokeColor(theme.color.border).stroke();
      doc.moveDown(0.2);
      let x = left; const baseY = doc.y + rowPad + 2;
      sumRow.forEach((val, idx) => {
        const align = columns[idx]?.align || 'left';
        doc.font(theme.font.bold).fillColor(theme.color.text).fontSize(10)
          .text(String(val ?? ''), x + 2, baseY, { width: widths[idx] - 4, align });
        x += widths[idx];
      });
      doc.font(theme.font.regular);
      doc.y = baseY + Math.max(16, sumH + 4);
    }

    doc.moveDown(1);
    doc.x = theme.page.margin;
    doc.fillColor(theme.color.text);
  }

  /* ========= CSV (Excel-DE: Semikolon, Komma-Dezimal, dd.MM.yyyy HH:mm) ========= */
  async exportTransactionsCSV(filters = {}) {
    const { startDate, endDate, customerId, paymentMethod } = filters;
    const where = { cancelled: false };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = parseLocalDate(startDate);
      if (endDate) where.createdAt.lte = endOfLocalDay(endDate); // Endtag inklusive
    }
    if (customerId) where.customerId = customerId;
    if (paymentMethod) where.paymentMethod = paymentMethod;

    const transactions = await prisma.transaction.findMany({
      where,
      include: { customer: true, user: { select: { name: true } }, items: { include: { article: true } } },
      orderBy: { createdAt: 'asc' }
    });

    const typeLabel = { SALE: 'Verkauf', REFUND: 'Erstattung', EXPIRED: 'Abgelaufen', OWNER_USE: 'Eigenverbrauch' };
    const rows = [];
    transactions.forEach(t => t.items.forEach(item => rows.push({
      Transaktions_ID: t.id,
      Datum: this._csvDateTime(t.createdAt),
      Typ: typeLabel[t.type] || t.type,
      Kunde: t.customer?.name || (t.paymentMethod === 'CASH' ? 'Bar-Zahlung' : '—'),
      Artikel: item.article.name,
      Kategorie: item.article.category,
      Menge: this._csvNum(item.quantity, 0),
      Einheit: item.article.unit,
      Einzelpreis: this._csvNum(item.pricePerUnit),
      Gesamtpreis: this._csvNum(item.totalPrice),
      Zahlungsart: this._paymentLabel(t.paymentMethod),
      Kassierer: t.user.name
    })));

    const fields = ['Transaktions_ID', 'Datum', 'Typ', 'Kunde', 'Artikel', 'Kategorie', 'Menge', 'Einheit', 'Einzelpreis', 'Gesamtpreis', 'Zahlungsart', 'Kassierer'];
    const csv = parse(rows, { fields, delimiter: ';' });
    return { data: csv, filename: `transaktionen_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  async exportInventoryCSV() {
    const articles = await prisma.article.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    const data = articles.map(a => ({
      ID: a.id, Name: a.name, Kategorie: a.category, Preis: this._csvNum(a.price), Bestand: this._csvNum(a.stock, 0),
      Mindestbestand: this._csvNum(a.minStock, 0), Einheit: a.unit, Aktiv: a.active ? 'Ja' : 'Nein',
      'Zählt für Highscore': a.countsForHighscore ? 'Ja' : 'Nein'
    }));
    const fields = ['ID', 'Name', 'Kategorie', 'Preis', 'Bestand', 'Mindestbestand', 'Einheit', 'Aktiv', 'Zählt für Highscore'];
    const csv = parse(data, { fields, delimiter: ';' });
    return { data: csv, filename: `bestand_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  async exportCustomersCSV() {
    const customers = await prisma.customer.findMany({
      include: { _count: { select: { transactions: true } } }, orderBy: { name: 'asc' }
    });

    const data = customers.map(c => ({
      ID: c.id, Name: c.name, Spitzname: c.nickname || '', Guthaben: this._csvNum(c.balance),
      'Anzahl Transaktionen': c._count.transactions, 'Erstellt am': this._csvDateTime(c.createdAt)
    }));
    const fields = ['ID', 'Name', 'Spitzname', 'Guthaben', 'Anzahl Transaktionen', 'Erstellt am'];
    const csv = parse(data, { fields, delimiter: ';' });
    return { data: csv, filename: `kunden_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  /* ========= PDF: Tagesabschluss ========= */
  async exportDailySummaryPDF(date = new Date(), startHour = 6, { createdBy } = {}) {
    const summary = await this.getDailySummaryData(date, startHour);
    const sm = summary.summary || {};
    const hh = String(startHour).padStart(2, '0');
    const timeOf = (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    // Barbestand laut App: dieselbe Herleitung wie die Kassenzählung (since exklusiv, until inklusiv)
    const winStart = new Date(summary.window.start);
    const winEnd = new Date(summary.window.end);
    const cashMv = await cashCountService.getCashMovements(new Date(winStart.getTime() - 1), winEnd);
    const cashChange = Math.round((
      cashMv.cashSales + cashMv.cashRefunds + cashMv.cashTopUps - cashMv.cashExpenses
      + (cashMv.cashInvoices?.total || 0) - (cashMv.bankDeposits?.total || 0) + (cashMv.bankWithdrawals?.total || 0)
      + (cashMv.otherIncome?.total || 0) - (cashMv.otherExpense?.total || 0)
    ) * 100) / 100;
    const cnt = (k) => (cashMv.counts && cashMv.counts[k]) || 0;

    // Stornos: Art des Originals und Mehrfach-Stornos ermitteln (Vorzeichen der Gegenbuchung erklären)
    const cancellations = summary.cancellations || [];
    const origIds = [...new Set(cancellations.map(c => c.originalTransactionId).filter(Boolean))];
    const [origRows, refundCounts] = origIds.length ? await Promise.all([
      prisma.transaction.findMany({ where: { id: { in: origIds } }, select: { id: true, type: true } }),
      prisma.transaction.groupBy({ by: ['originalTransactionId'], where: { type: 'REFUND', originalTransactionId: { in: origIds } }, _count: true })
    ]) : [[], []];
    const origType = new Map(origRows.map(o => [o.id, o.type]));
    const refundsPerOrig = new Map(refundCounts.map(r => [r.originalTransactionId, r._count]));
    const stornoOf = (r) => {
      const t = r.originalTransactionId ? origType.get(r.originalTransactionId) : null;
      const at = r.originalCreatedAt ? this._fmtDateTime(r.originalCreatedAt) : '';
      if (!t) return 'ohne Original';
      if (t === 'REFUND') return `Stornobuchung ${at} (!)`;
      const label = ({ SALE: 'Verkauf', OWNER_USE: 'Eigenverbrauch', EXPIRED: 'Abgelaufen' })[t] || t;
      return `${label} ${at}${(refundsPerOrig.get(r.originalTransactionId) || 0) > 1 ? ' (mehrfach storniert!)' : ''}`;
    };
    const stornoSum = Math.round(cancellations.reduce((a, r) => a + Number(r.amount || 0), 0) * 100) / 100;
    const multiStorno = cancellations.filter(r => (refundsPerOrig.get(r.originalTransactionId) || 0) > 1).length;
    const stornoOfStorno = cancellations.filter(r => origType.get(r.originalTransactionId) === 'REFUND').length;

    return new Promise((resolve, reject) => {
      try {
        const headerInfo = {
          reportName: 'Tagesabschluss',
          title: `Tagesabschluss – ${this.getTheme().brandName}`,
          subtitle: `Geschäftstag ${this._fmtDate(summary.date)} (${hh}:00 Uhr bis ${hh}:00 Uhr des Folgetags)`,
          createdBy
        };
        const { doc, done, theme } = this._createDocWithBuffer(headerInfo);
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung', headerInfo);
        this._kvList(doc, theme, [
          { label: `Bar-Umsatz (${sm.cashTransactions || 0} Verkäufe)`, value: this._fmtEUR(sm.cashRevenue) },
          { label: `Kundenkonto-Umsatz (${sm.accountTransactions || 0} Verkäufe)`, value: this._fmtEUR(sm.accountRevenue) },
          ...(Number(sm.cardTransactions || 0) > 0 ? [{ label: `Karten-Umsatz SumUp (${sm.cardTransactions} Verkäufe)`, value: this._fmtEUR(sm.cardRevenue) }] : []),
          { label: `Gesamtumsatz (${sm.totalTransactions || 0} Verkäufe, ohne stornierte)`, value: this._fmtEUR(sm.totalRevenue), bold: true, color: theme.color.success, rule: true },
          { spacer: true },
          { label: `Stornos des Tages (${cancellations.length} Gegenbuchungen, Liste unten)`, value: this._fmtSigned(stornoSum), color: theme.color.danger },
          { spacer: true },
          { label: 'Aufladungen Kundenkonten bar', value: this._fmtEUR(sm.topUpsCash) },
          { label: 'Aufladungen Kundenkonten per Überweisung', value: this._fmtEUR(sm.topUpsTransfer) },
          { label: 'Aufladungen Kundenkonten per Karte (SumUp)', value: this._fmtEUR(sm.topUpsCard) },
          { label: `Aufladungen gesamt (${sm.topUpsCount || 0})`, value: this._fmtEUR(sm.topUpsTotal), bold: true, rule: true }
        ], { headerInfo });

        // Barbestand: alles, was die Kasse laut App bewegt hat (wie die Soll-Herleitung der Kassenzählung)
        this._section(doc, theme, 'Veränderung Barbestand laut App', headerInfo);
        const cashRows = [
          { label: `+ Bar-Verkäufe (${cnt('sales')}, einschließlich später stornierter)`, value: this._fmtEUR(cashMv.cashSales) },
          { label: `+ Bar-Stornos (${cnt('refunds')}, Geld zurückgegeben)`, value: this._fmtEUR(cashMv.cashRefunds) },
          { label: `+ Bar-Aufladungen Kundenkonten (${cnt('topUps')})`, value: this._fmtEUR(cashMv.cashTopUps) }
        ];
        if (cnt('cashInvoices')) cashRows.push({ label: `+ Bar bezahlte Kundenrechnungen (${cnt('cashInvoices')})`, value: this._fmtEUR(cashMv.cashInvoices.total) });
        if (cnt('expenses')) cashRows.push({ label: `- Bar bezahlte Lieferantenrechnungen (${cnt('expenses')})`, value: this._fmtEUR(-cashMv.cashExpenses) });
        if (cnt('bankDeposits')) cashRows.push({ label: `- Einzahlungen auf Bank (${cnt('bankDeposits')})`, value: this._fmtEUR(-cashMv.bankDeposits.total) });
        if (cnt('bankWithdrawals')) cashRows.push({ label: `+ Abhebungen von Bank (${cnt('bankWithdrawals')})`, value: this._fmtEUR(cashMv.bankWithdrawals.total) });
        if (cnt('otherIncome')) cashRows.push({ label: `+ Sonstige Bareinnahmen (${cnt('otherIncome')})`, value: this._fmtEUR(cashMv.otherIncome.total) });
        if (cnt('otherExpense')) cashRows.push({ label: `- Sonstige Barausgaben (${cnt('otherExpense')})`, value: this._fmtEUR(-cashMv.otherExpense.total) });
        cashRows.push({ label: '= Veränderung Barbestand laut App', value: this._fmtSigned(cashChange), bold: true, rule: true });
        this._kvList(doc, theme, cashRows, { headerInfo, keepTogether: true });
        this._note(doc, theme, 'Ohne Kassenzählung: Ob das Geld tatsächlich in der Kasse ist, zeigt erst die nächste Kassenzählung (Soll/Ist).');

        this._section(doc, theme, 'Aufladungen (Kundenkonten)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Uhrzeit', width: 70, render: r => timeOf(r.createdAt) },
            { header: 'Kunde', width: 220, render: r => r.customer },
            { header: 'Art', width: 100, render: r => r.method === 'CASH' ? 'Bar' : r.method === 'CARD' ? 'Karte' : 'Überweisung' },
            { header: 'Referenz', width: 110, render: r => String(r.reference || '').startsWith('STORNO:') ? 'Storno einer Aufladung' : (r.reference || '') },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.amount), color: r => Number(r.amount) < 0 ? theme.color.danger : theme.color.success }
          ],
          rows: summary.topUps || [],
          sumRow: ['Summe', '', '', '', this._fmtEUR(sm.topUpsTotal)],
          emptyHint: 'Keine Aufladungen an diesem Geschäftstag.',
          headerInfo
        });

        this._section(doc, theme, 'Stornos', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Uhrzeit', width: 55, render: r => timeOf(r.createdAt) },
            { header: 'Storno von', width: 140, render: r => stornoOf(r) },
            { header: 'Kunde', width: 120, render: r => r.customer || 'Bar-Zahlung' },
            { header: 'Zahlung', width: 80, render: r => this._paymentLabel(r.paymentMethod) },
            { header: 'Kassierer/in', width: 90, render: r => r.cashier },
            { header: 'Gegenbuchung', width: 95, align: 'right', render: r => this._fmtSigned(r.amount), color: r => Number(r.amount) > 0 ? theme.color.warning : theme.color.danger }
          ],
          rows: cancellations,
          sumRow: ['Summe', '', '', '', '', this._fmtSigned(stornoSum)],
          emptyHint: 'Keine Stornos an diesem Geschäftstag.',
          headerInfo
        });
        if (cancellations.length) {
          const hints = ['Gegenbuchung: minus = Betrag an den Gast zurück (bar oder Gutschrift aufs Kundenkonto); 0,00 € bei Eigenverbrauch/Abgelaufen (nur Bestand).'];
          if (stornoOfStorno) hints.push(`${stornoOfStorno} Storno einer Stornobuchung (!): bucht den Betrag erneut ab, daher plus.`);
          if (multiStorno) hints.push(`${multiStorno} Gegenbuchungen gehören zu mehrfach stornierten Verkäufen: bitte prüfen.`);
          this._note(doc, theme, hints.join(' '));
        }

        this._section(doc, theme, 'Top 10 Artikel', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: '#', width: 40, align: 'right', render: r => String(r.__idx + 1) },
            { header: 'Artikel', width: 300, render: r => r.name },
            { header: 'Menge', width: 80, align: 'right', render: r => String(r.quantity_sold) },
            { header: 'Umsatz', width: 120, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: (summary.topArticles || []).map((r, i) => ({ ...r, __idx: i })),
          emptyHint: 'Keine Verkäufe erfasst.',
          headerInfo
        });

        this._section(doc, theme, 'Umsatzverteilung nach Stunden', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Stunde', width: 120, render: r => `${String(r.hour).padStart(2, '0')}:00 – ${String(r.hour).padStart(2, '0')}:59` },
            { header: 'Verkäufe', width: 140, align: 'right', render: r => String(r.transactions) },
            { header: 'Umsatz', width: 200, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: summary.hourlyDistribution || [],
          emptyHint: 'Keine Daten vorhanden.',
          headerInfo
        });

        this._section(doc, theme, 'Transaktionen des Tages', headerInfo);
        const txType = (t) => t.type === 'REFUND' ? 'Storno' : (t.cancelled ? 'Verkauf (storniert)' : 'Verkauf');
        this._table(doc, theme, {
          columns: [
            { header: 'Uhrzeit', width: 60, render: r => timeOf(r.createdAt) },
            { header: 'Vorgang', width: 110, render: r => txType(r) },
            { header: 'Kunde', width: 150, render: r => r.customer || 'Bar-Zahlung' },
            { header: 'Zahlung', width: 90, render: r => this._paymentLabel(r.paymentMethod) },
            { header: 'Kassierer/in', width: 120, render: r => r.cashier },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.amount),
              color: r => r.type === 'REFUND' || r.cancelled ? theme.color.danger : theme.color.text }
          ],
          rows: summary.transactions || [],
          emptyHint: 'Keine Transaktionen an diesem Geschäftstag.',
          headerInfo
        });

        this._signatureBlock(doc, theme, ['Kassierer/in (Unterschrift)', 'Datum'], headerInfo, { dateLine: false });

        this._finishDoc(doc, theme, headerInfo);
        done.then(pdf => resolve({ data: pdf, filename: `tagesabschluss_${summary.date}.pdf`, mimeType: 'application/pdf' }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= PDF: Monatsbericht ========= */
  async exportMonthlySummaryPDF(year, month, { createdBy } = {}) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    // Nur echte Verkäufe: REFUND (negativ), EXPIRED/OWNER_USE (0 €) gehören nicht in den Umsatz
    const [transactions, cashAgg, accountAgg, categoryStats, topArticles, topUps, expenseAgg, cardAgg] = await Promise.all([
      prisma.transaction.aggregate({
        where: { type: 'SALE', createdAt: { gte: startDate, lte: endDate }, cancelled: false },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.transaction.aggregate({
        where: { type: 'SALE', paymentMethod: 'CASH', createdAt: { gte: startDate, lte: endDate }, cancelled: false },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.transaction.aggregate({
        where: { type: 'SALE', paymentMethod: 'ACCOUNT', createdAt: { gte: startDate, lte: endDate }, cancelled: false },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.$queryRaw`
        SELECT a.category, SUM(ti.quantity) as items_sold, SUM(ti."totalPrice") as revenue
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= (${startDate}::timestamptz AT TIME ZONE 'UTC') AND t."createdAt" <= (${endDate}::timestamptz AT TIME ZONE 'UTC')
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.category
        ORDER BY revenue DESC
      `,
      prisma.$queryRaw`
        SELECT a.name, a.unit, SUM(ti.quantity) as items_sold, SUM(ti."totalPrice") as revenue
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= (${startDate}::timestamptz AT TIME ZONE 'UTC') AND t."createdAt" <= (${endDate}::timestamptz AT TIME ZONE 'UTC')
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.id, a.name, a.unit
        ORDER BY revenue DESC
        LIMIT 10
      `,
      prisma.accountTopUp.groupBy({
        by: ['method'],
        where: { createdAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true }, _count: true
      }),
      // Nach Zahldatum wie in der EÜR (accountingService.getProfitLoss): paidAt, Altbelege ohne paidAt nach documentDate
      prisma.purchaseDocument.aggregate({
        where: {
          type: 'RECHNUNG', paid: true,
          OR: [{ paidAt: { gte: startDate, lte: endDate } }, { paidAt: null, documentDate: { gte: startDate, lte: endDate } }]
        },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.transaction.aggregate({
        where: { type: 'SALE', paymentMethod: 'CARD', createdAt: { gte: startDate, lte: endDate }, cancelled: false },
        _sum: { totalAmount: true }, _count: true
      })
    ]);

    const topUpCash = Number(topUps.find(t => t.method === 'CASH')?._sum.amount || 0);
    const topUpTransfer = Number(topUps.find(t => t.method === 'TRANSFER')?._sum.amount || 0);
    const topUpCard = Number(topUps.find(t => t.method === 'CARD')?._sum.amount || 0);

    return new Promise((resolve, reject) => {
      try {
        const headerInfo = {
          reportName: 'Monatsbericht',
          title: `Monatsbericht – ${this.getTheme().brandName}`,
          subtitle: `${this.getMonthName(month)} ${year} (${this._fmtDate(startDate)} – ${this._fmtDate(endDate)})`,
          createdBy
        };
        const { doc, done, theme } = this._createDocWithBuffer(headerInfo);
        this._decoratePage(doc, theme, headerInfo);

        const total = Number(transactions._sum.totalAmount || 0);
        const count = transactions._count || 0;
        this._section(doc, theme, 'Zusammenfassung', headerInfo);
        this._kvList(doc, theme, [
          { label: `Bar-Umsatz (${cashAgg._count || 0} Verkäufe)`, value: this._fmtEUR(cashAgg._sum.totalAmount) },
          { label: `Kundenkonto-Umsatz (${accountAgg._count || 0} Verkäufe)`, value: this._fmtEUR(accountAgg._sum.totalAmount) },
          ...((cardAgg._count || 0) > 0 ? [{ label: `Karten-Umsatz SumUp (${cardAgg._count} Verkäufe)`, value: this._fmtEUR(cardAgg._sum.totalAmount) }] : []),
          { label: `Gesamtumsatz (${count} Verkäufe)`, value: this._fmtEUR(total), bold: true, color: theme.color.success, rule: true },
          { label: 'Durchschnitt pro Verkauf', value: this._fmtEUR(count ? total / count : 0) },
          { spacer: true },
          { label: `Bezahlte Lieferantenrechnungen (${expenseAgg._count || 0} Belege)`, value: this._fmtEUR(expenseAgg._sum.totalAmount), color: theme.color.danger },
          { spacer: true },
          { label: 'Aufladungen Kundenkonten bar', value: this._fmtEUR(topUpCash) },
          { label: 'Aufladungen Kundenkonten per Überweisung', value: this._fmtEUR(topUpTransfer) },
          ...(topUpCard ? [{ label: 'Aufladungen Kundenkonten per Karte (SumUp)', value: this._fmtEUR(topUpCard) }] : []),
          { label: 'Aufladungen gesamt (kein Umsatz, Verbindlichkeit)', value: this._fmtEUR(topUpCash + topUpTransfer + topUpCard), bold: true }
        ], { headerInfo });

        this._section(doc, theme, 'Umsatz nach Kategorien', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Kategorie', width: 320, render: r => r.category },
            { header: 'Artikel', width: 120, align: 'right', render: r => String(Number(r.items_sold || 0)) },
            { header: 'Umsatz', width: 160, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: categoryStats || [],
          sumRow: ['Summe', String((categoryStats || []).reduce((a, r) => a + Number(r.items_sold || 0), 0)), this._fmtEUR((categoryStats || []).reduce((a, r) => a + Number(r.revenue || 0), 0))],
          emptyHint: 'Keine Verkäufe in diesem Monat.',
          headerInfo
        });

        this._section(doc, theme, 'Top 10 Artikel', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: '#', width: 40, align: 'right', render: r => String(r.__idx + 1) },
            { header: 'Artikel', width: 300, render: r => r.name },
            { header: 'Menge', width: 100, align: 'right', render: r => this._fmtQty(r.items_sold, r.unit) },
            { header: 'Umsatz', width: 120, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: (topArticles || []).map((r, i) => ({ ...r, __idx: i })),
          emptyHint: 'Keine Verkäufe in diesem Monat.',
          headerInfo
        });

        this._finishDoc(doc, theme, headerInfo);
        done.then(pdf => resolve({
          data: pdf, filename: `monatsbericht_${year}_${String(month).padStart(2, '0')}.pdf`, mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= PDF: Kontoauszug ========= */
  /**
   * Kontoauszug eines Kunden (Aufladungen, Einkäufe, Stornos) mit laufendem Saldo.
   * Datenbasis ist customerService.getAccountStatement, damit UI und PDF dieselben Zahlen zeigen.
   */
  async exportCustomerStatementPDF(customerId, start, end, { createdBy } = {}) {
    const statement = await customerService.getAccountStatement(customerId, start, end);
    const { customer, movements = [], summary = {} } = statement;

    const typeLabel = (m) => {
      if (m.type === 'TOPUP') return 'Aufladung';
      if (m.type === 'CANCELLED') return 'Storno';
      return 'Einkauf';
    };
    const displayName = customer.nickname ? `${customer.name} (${customer.nickname})` : customer.name;
    const slug = String(customer.name || 'kunde').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '');

    return new Promise((resolve, reject) => {
      try {
        const headerInfo = {
          reportName: 'Kontoauszug',
          title: `Kontoauszug – ${this.getTheme().brandName}`,
          subtitle: `${displayName} · Zeitraum ${this._fmtDate(start)} – ${this._fmtDate(end)}`,
          createdBy
        };
        const { doc, done, theme } = this._createDocWithBuffer(headerInfo);
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung', headerInfo);
        this._kvList(doc, theme, [
          { label: 'Aufladungen im Zeitraum', value: this._fmtEUR(summary.totalTopUps), color: theme.color.success },
          { label: `Einkäufe im Zeitraum (${summary.transactionCount || 0} Buchungen)`, value: this._fmtEUR(summary.totalSpent), color: theme.color.danger },
          ...(statement.openingBalance !== undefined ? [
            { label: 'Kontostand zu Beginn des Zeitraums', value: this._fmtEUR(statement.openingBalance) },
            { label: 'Kontostand am Ende des Zeitraums', value: this._fmtEUR(statement.closingBalance) }
          ] : []),
          { label: 'Aktueller Kontostand', value: this._fmtEUR(customer.currentBalance), bold: true, rule: true,
            color: Number(customer.currentBalance) < 0 ? theme.color.danger : theme.color.text }
        ], { headerInfo });

        this._section(doc, theme, 'Kontobewegungen', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 110, render: r => this._fmtDateTime(r.date) },
            { header: 'Vorgang', width: 80, render: r => typeLabel(r) },
            { header: 'Beschreibung', width: 220, render: r => r.description || '' },
            {
              header: 'Betrag', width: 90, align: 'right',
              render: r => this._fmtEUR(r.amount),
              color: r => (Number(r.amount) < 0 ? theme.color.danger : (Number(r.amount) > 0 ? theme.color.success : theme.color.subtext))
            },
            {
              header: 'Saldo', width: 90, align: 'right',
              render: r => this._fmtEUR(r.balance),
              color: r => (Number(r.balance) < 0 ? theme.color.danger : theme.color.text)
            }
          ],
          rows: movements,
          sumRow: ['', '', 'Summe Zeitraum', this._fmtEUR(Number(summary.totalTopUps || 0) - Number(summary.totalSpent || 0)), this._fmtEUR(statement.closingBalance ?? customer.currentBalance)],
          emptyHint: 'Keine Kontobewegungen im gewählten Zeitraum.',
          headerInfo
        });

        this._finishDoc(doc, theme, headerInfo);
        const fmtFile = (d) => {
          const x = new Date(d); const p = (n) => String(n).padStart(2, '0');
          return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
        };
        done.then(pdf => resolve({
          data: pdf,
          filename: `kontoauszug_${slug}_${fmtFile(start)}_${fmtFile(end)}.pdf`,
          mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= PDF: EÜR (Datenbasis ausschließlich accountingService.getProfitLoss) ========= */
  async exportEURPDF(startDate, endDate, { createdBy } = {}) {
    const eur = await accountingService.getProfitLoss(startDate, endDate);
    // Gästeguthaben zum Stichtag (Zeitraumende), nicht der heutige Stand
    const guest = await yearEndExtrasService.getGuestBalances(parseLocalDate(startDate), endOfLocalDay(endDate));
    const d = eur.details;
    const byType = d.incomeByType || {};
    const byExpType = d.expensesByType || {};
    const sum = (arr, sel) => (arr || []).reduce((a, r) => a + Number(sel(r) || 0), 0);

    return new Promise((resolve, reject) => {
      try {
        const headerInfo = {
          reportName: 'EÜR',
          title: `Einnahmen-Überschuss-Rechnung – ${this.getTheme().brandName}`,
          subtitle: `Zeitraum ${eur.period.label}`,
          createdBy
        };
        const { doc, done, theme } = this._createDocWithBuffer(headerInfo);
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Einnahmen-Überschuss-Rechnung', headerInfo);
        const eurKvRows = [
          { label: `Barverkäufe (${d.transactionCounts?.cash || 0} Verkäufe)`, value: this._fmtEUR(byType.cash) },
          { label: `Verkäufe über Kundenkonto (${d.transactionCounts?.account || 0} Verkäufe)`, value: this._fmtEUR(byType.account) },
          ...(Number(byType.card || 0) > 0 ? [{ label: `Kartenzahlungen SumUp (${d.transactionCounts?.card || 0} Verkäufe)`, value: this._fmtEUR(byType.card) }] : []),
          { label: `Bezahlte Kundenrechnungen (${(d.paidInvoices || []).length})`, value: this._fmtEUR(byType.invoices) }
        ];
        if ((byType.otherCash || 0) > 0 || (d.otherIncome && d.otherIncome.count > 0)) {
          eurKvRows.push({ label: `Sonstige Bareinnahmen (${d.otherIncome ? d.otherIncome.count : 0})`, value: this._fmtEUR(byType.otherCash || 0), color: theme.color.success });
        }
        eurKvRows.push({ label: 'Summe Betriebseinnahmen', value: this._fmtEUR(eur.summary.totalIncome), bold: true, color: theme.color.success });
        eurKvRows.push({ spacer: true });
        eurKvRows.push({ label: `Bezahlte Lieferantenrechnungen (${(d.expenseDocs || []).length} Belege)`, value: this._fmtEUR(byExpType.purchaseDocuments != null ? byExpType.purchaseDocuments : eur.summary.totalExpenses) });
        if ((byExpType.otherCash || 0) > 0 || (d.otherExpense && d.otherExpense.count > 0)) {
          eurKvRows.push({ label: `Sonstige Barausgaben (${d.otherExpense ? d.otherExpense.count : 0})`, value: this._fmtEUR(byExpType.otherCash || 0), color: theme.color.danger });
        }
        eurKvRows.push({ label: 'Summe Betriebsausgaben', value: this._fmtEUR(eur.summary.totalExpenses), bold: true, color: theme.color.danger });
        eurKvRows.push({ spacer: true });
        eurKvRows.push({ label: eur.summary.profit < 0 ? 'Fehlbetrag' : 'Überschuss', value: this._fmtEUR(eur.summary.profit), bold: true, rule: true,
          color: eur.summary.profit < 0 ? theme.color.danger : theme.color.success });
        this._kvList(doc, theme, eurKvRows, { headerInfo });

        this._section(doc, theme, 'Nachrichtlich (kein Ertrag, keine Ausgabe)', headerInfo);
        this._kvList(doc, theme, [
          { label: `Eigenverbrauch / Sachentnahme (${eur.nonRevenue.ownerUse.quantity} Stück, Warenwert)`, value: this._fmtEUR(eur.nonRevenue.ownerUse.value) },
          { label: `Abgelaufen / Schwund (${eur.nonRevenue.expired.quantity} Stück, Warenwert)`, value: this._fmtEUR(eur.nonRevenue.expired.value) },
          { spacer: true },
          // Bank-Kassenbewegungen: ergebnisneutral (nur Liquidität, keine EÜR-Relevanz)
          { label: `Kassenbewegungen (Bank-Einzahlungen/-Abhebungen):`, value: '', bold: true },
          { label: `  Einzahlungen auf Bank (${eur.liquidity.cashMovements?.bankDeposits?.count || 0})`, value: this._fmtEUR(eur.liquidity.cashMovements?.bankDeposits?.total || 0) },
          { label: `  Abhebungen von Bank (${eur.liquidity.cashMovements?.bankWithdrawals?.count || 0})`, value: this._fmtEUR(eur.liquidity.cashMovements?.bankWithdrawals?.total || 0) },
          { spacer: true },
          { label: 'Aufladungen Kundenkonten bar', value: this._fmtEUR(eur.liquidity.topUps.cash) },
          { label: 'Aufladungen Kundenkonten per Überweisung', value: this._fmtEUR(eur.liquidity.topUps.transfer) },
          { label: 'Aufladungen Kundenkonten per Karte (SumUp)', value: this._fmtEUR(eur.liquidity.topUps.card || 0) },
          { label: 'Aufladungen gesamt (Zufluss, aber Verbindlichkeit gegenüber Gästen)', value: this._fmtEUR(eur.liquidity.topUps.total), bold: true },
          {
            label: guest.asOfIsNow
              ? `Gästeguthaben Stand heute ${this._fmtDateTime(guest.asOf)} (Stichtag liegt in der Zukunft)`
              : `Gästeguthaben zum Stichtag ${this._fmtDate(guest.stichtag)} (Summe aller Kundenkonten)`,
            value: this._fmtEUR(guest.totals.net)
          },
          { spacer: true },
          { label: `Offene Lieferantenrechnungen zum Stichtag (${eur.liabilities.unpaidPurchaseDocuments.count})`, value: this._fmtEUR(eur.liabilities.unpaidPurchaseDocuments.total), color: theme.color.danger },
          { label: `Offene Kundenrechnungen zum Stichtag (${eur.receivables.unpaidInvoices.count})`, value: this._fmtEUR(eur.receivables.unpaidInvoices.total) }
        ], { headerInfo });

        this._section(doc, theme, 'Einnahmen nach Kategorie', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Kategorie', width: 300, render: r => r.category },
            { header: 'Menge', width: 100, align: 'right', render: r => String(Number(r.quantity || 0)) },
            { header: 'Betrag', width: 120, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: d.incomeByCategory || [],
          sumRow: ['Summe', String(sum(d.incomeByCategory, r => r.quantity)), this._fmtEUR(sum(d.incomeByCategory, r => r.amount))],
          emptyHint: 'Keine Verkäufe im Zeitraum.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgaben nach Lieferant', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Lieferant', width: 320, render: r => r.supplier },
            { header: 'Belege', width: 80, align: 'right', render: r => String(r.count) },
            { header: 'Betrag', width: 120, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.danger }
          ],
          rows: d.expensesBySupplier || [],
          sumRow: ['Summe', String(sum(d.expensesBySupplier, r => r.count)), this._fmtEUR(sum(d.expensesBySupplier, r => r.amount))],
          emptyHint: 'Keine Ausgaben erfasst.',
          headerInfo
        });

        this._section(doc, theme, 'Verkaufte Artikel', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 240, render: r => r.article },
            { header: 'Kategorie', width: 160, render: r => r.category || '-' },
            { header: 'Menge', width: 80, align: 'right', render: r => Number(r.quantity || 0).toFixed(0) },
            { header: 'Betrag', width: 100, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: d.incomeByArticle || [],
          sumRow: ['Summe', '', Number(sum(d.incomeByArticle, r => r.quantity)).toFixed(0), this._fmtEUR(sum(d.incomeByArticle, r => r.amount))],
          emptyHint: 'Keine Verkäufe im Zeitraum.',
          headerInfo
        });

        this._section(doc, theme, 'Eigenverbrauch und Schwund (nachrichtlich)', headerInfo);
        const nonRevRows = [
          ...(eur.nonRevenue.ownerUse.items || []).map(r => ({ ...r, kind: 'Eigenverbrauch' })),
          ...(eur.nonRevenue.expired.items || []).map(r => ({ ...r, kind: 'Abgelaufen' }))
        ];
        this._table(doc, theme, {
          columns: [
            { header: 'Art', width: 120, render: r => r.kind },
            { header: 'Artikel', width: 240, render: r => r.article },
            { header: 'Menge', width: 100, align: 'right', render: r => this._fmtQty(r.quantity, r.unit) },
            { header: 'Warenwert', width: 100, align: 'right', render: r => this._fmtEUR(r.value) }
          ],
          rows: nonRevRows,
          sumRow: ['Summe', '', String(sum(nonRevRows, r => r.quantity)), this._fmtEUR(sum(nonRevRows, r => r.value))],
          emptyHint: 'Kein Eigenverbrauch, keine abgelaufenen Artikel.',
          headerInfo
        });

        this._section(doc, theme, 'Bezahlte Kundenrechnungen', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Rechnung', width: 100, render: r => r.invoiceNumber || '-' },
            { header: 'Empfänger', width: 170, render: r => r.customerName || '-' },
            { header: 'Beschreibung', width: 150, render: r => r.description || '-' },
            { header: 'Bezahlt am', width: 80, render: r => this._fmtDate(r.paidAt) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.success }
          ],
          rows: d.paidInvoices || [],
          sumRow: ['Summe', '', '', '', this._fmtEUR(sum(d.paidInvoices, r => r.totalAmount))],
          emptyHint: 'Keine bezahlten Kundenrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgabenbelege (bezahlte Lieferantenrechnungen)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 75, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 160, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 110, render: r => r.documentNumber || '-' },
            { header: 'Zahlung', width: 75, render: r => this._paymentLabel(r.paymentMethod) },
            { header: 'Nachweis', width: 60, align: 'center', render: r => r.nachweisUrl ? 'Ja' : 'Nein' },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: d.expenseDocs || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(sum(d.expenseDocs, r => r.totalAmount))],
          emptyHint: 'Keine Ausgabenbelege.',
          headerInfo
        });

        this._section(doc, theme, 'Offene Lieferantenrechnungen zum Stichtag (Verbindlichkeiten)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Belegdatum', width: 80, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 180, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 120, render: r => r.documentNumber || '-' },
            { header: 'Fällig', width: 80, render: r => this._fmtDate(r.dueDate) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: eur.liabilities.unpaidPurchaseDocuments.items || [],
          sumRow: ['Summe', '', '', '', this._fmtEUR(eur.liabilities.unpaidPurchaseDocuments.total)],
          emptyHint: 'Keine offenen Lieferantenrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Offene Kundenrechnungen zum Stichtag (Forderungen)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Rechnung', width: 100, render: r => r.invoiceNumber || '-' },
            { header: 'Empfänger', width: 160, render: r => r.customerName || '-' },
            { header: 'Erstellt', width: 80, render: r => this._fmtDate(r.createdAt) },
            { header: 'Fällig', width: 80, render: r => this._fmtDate(r.dueDate) },
            { header: 'Status', width: 70, render: r => this._invoiceStatusLabel(r.status) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount) }
          ],
          rows: eur.receivables.unpaidInvoices.items || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(eur.receivables.unpaidInvoices.total)],
          emptyHint: 'Keine offenen Kundenrechnungen.',
          headerInfo
        });

        this._finishDoc(doc, theme, headerInfo);
        done.then(pdf => resolve({ data: pdf, filename: `eur_${startDate}_${endDate}.pdf`, mimeType: 'application/pdf' }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= PDF: Kassenzählung (Zählbeleg) ========= */
  async exportCashCountPDF(cashCountId, { createdBy } = {}) {
    const cc = await cashCountService.getById(cashCountId);
    if (!cc) throw new Error('Kassenzählung nicht gefunden');
    const b = (cc.breakdownJson && typeof cc.breakdownJson === 'object') ? cc.breakdownJson : {};
    const denoms = cashCountService.denominations;
    const denomRows = denoms.map(d => {
      const count = Number((cc.denominations || {})[String(d)] || 0);
      return { value: d, count, amount: Math.round(d * 100) * count / 100 };
    });
    const diff = Number(cc.difference || 0);
    const diffColor = (theme) => Math.abs(diff) < 0.005 ? theme.color.success : (diff < 0 ? theme.color.danger : theme.color.warning);
    const fmtDenom = (v) => v >= 1 ? `${v} €` : `${Math.round(v * 100)} Cent`;
    const n = (k) => (b.counts && b.counts[k]) || 0;
    const isOpening = !!(cc.isOpening || b.isOpening);

    return new Promise((resolve, reject) => {
      try {
        const headerInfo = {
          reportName: 'Kassenzählung',
          title: `Kassenzählung – ${this.getTheme().brandName}`,
          subtitle: `Gezählt am ${this._fmtDateTime(cc.countedAt)}${cc.user ? ` von ${cc.user.name}` : ''}`,
          createdBy
        };
        const { doc, done, theme } = this._createDocWithBuffer(headerInfo);
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Ergebnis', headerInfo);
        if (isOpening) {
          this._kvList(doc, theme, [
            { label: 'Anfangsbestand beim Start mit ClubTouch3 (gezählt)', value: this._fmtEUR(cc.countedTotal), bold: true, rule: true }
          ], { headerInfo });
          this._note(doc, theme, 'Anfangsbestand beim Start – kein Soll-Vergleich. Die App übernimmt den gezählten Betrag als Ausgangswert; '
            + 'Soll und Differenz gibt es erst ab der nächsten Zählung.'
            + (Math.abs(Number(b.computedExpected || 0)) >= 0.005
              ? ` Nachrichtlich: Vor dem Anfangsbestand waren bereits Barbuchungen über ${this._fmtEUR(b.computedExpected)} in der App erfasst; sie sind im Anfangsbestand enthalten.`
              : ''));
        } else {
          this._kvList(doc, theme, [
            { label: 'Soll laut System', value: this._fmtEUR(cc.expectedTotal) },
            { label: 'Ist gezählt', value: this._fmtEUR(cc.countedTotal), bold: true },
            { label: 'Differenz (Ist - Soll)', value: `${diff > 0 ? '+' : ''}${this._fmtEUR(diff)}`, bold: true, rule: true, color: diffColor(theme) }
          ], { headerInfo });
        }
        if (cc.note) this._note(doc, theme, `Notiz: ${cc.note}`);

        this._section(doc, theme, 'Stückelung', headerInfo);
        const pieces = denomRows.reduce((a, r) => a + r.count, 0);
        if (pieces === 0 && Number(cc.countedTotal || 0) > 0) {
          // nur ein Betrag erfasst (Anfangsbestand ohne Stückelung)
          this._kvList(doc, theme, [
            { label: 'Betrag ohne Stückelung erfasst', value: this._fmtEUR(cc.countedTotal), bold: true }
          ], { headerInfo });
        } else {
          this._table(doc, theme, {
            columns: [
              { header: 'Nennwert', width: 160, render: r => fmtDenom(r.value) },
              { header: 'Anzahl', width: 120, align: 'right', render: r => String(r.count) },
              { header: 'Betrag', width: 160, align: 'right', render: r => this._fmtEUR(r.amount) }
            ],
            rows: denomRows,
            sumRow: ['Summe gezählt', String(pieces), this._fmtEUR(cc.countedTotal)],
            headerInfo
          });
        }

        if (isOpening) {
          this._signatureBlock(doc, theme, ['Gezählt von', 'Geprüft von'], headerInfo);
          this._finishDoc(doc, theme, headerInfo);
          const st = new Date(cc.countedAt);
          const p2 = (x) => String(x).padStart(2, '0');
          done.then(pdf => resolve({
            data: pdf,
            filename: `kassenzaehlung_${st.getFullYear()}-${p2(st.getMonth() + 1)}-${p2(st.getDate())}_${p2(st.getHours())}${p2(st.getMinutes())}_anfangsbestand.pdf`,
            mimeType: 'application/pdf'
          }));
          return;
        }

        // Überschrift und Herleitung (13 Zeilen) gemeinsam auf eine Seite
        this._ensureRoom(doc, theme, 270);
        this._section(doc, theme, 'Soll-Herleitung seit der letzten Zählung', headerInfo);
        const sinceLabel = b.hasBaseline && cc.previousCount
          ? `Vorzählung vom ${this._fmtDateTime(cc.previousCount.countedAt)}`
          : 'Keine Vorzählung vorhanden (Startsaldo 0,00 €, alle Barbewegungen seit Beginn)';
        this._kvList(doc, theme, [
          { label: sinceLabel, value: this._fmtEUR(b.baseline || 0) },
          { label: `+ Bar-Verkäufe (${n('sales')})`, value: this._fmtEUR(b.cashSales || 0), color: theme.color.success },
          { label: `+ Bar-Erstattungen / Stornos (${n('refunds')})`, value: this._fmtEUR(b.cashRefunds || 0), color: theme.color.danger },
          { label: `+ Bar-Aufladungen Kundenkonten (${n('topUps')})`, value: this._fmtEUR(b.cashTopUps || 0), color: theme.color.success },
          { label: `- Bar bezahlte Lieferantenrechnungen (${n('expenses')})`, value: this._fmtEUR(b.cashExpenses || 0), color: theme.color.danger },
          { label: `+ Bar bezahlte Kundenrechnungen (${n('cashInvoices')})`, value: this._fmtEUR(b.cashInvoices?.total ?? 0), color: theme.color.success },
          { label: `- Einzahlungen auf Bank (${n('bankDeposits')})`, value: this._fmtEUR(b.bankDeposits?.total ?? 0), color: theme.color.danger },
          { label: `+ Abhebungen von Bank (${n('bankWithdrawals')})`, value: this._fmtEUR(b.bankWithdrawals?.total ?? 0), color: theme.color.success },
          { label: `+ Sonstige Bareinnahmen (${n('otherIncome')})`, value: this._fmtEUR(b.otherIncome?.total ?? 0), color: theme.color.success },
          { label: `- Sonstige Barausgaben (${n('otherExpense')})`, value: this._fmtEUR(b.otherExpense?.total ?? 0), color: theme.color.danger },
          { label: '= Soll laut System', value: this._fmtEUR(cc.expectedTotal), bold: true, rule: true },
          { label: 'Ist gezählt', value: this._fmtEUR(cc.countedTotal), bold: true },
          { label: 'Differenz', value: `${diff > 0 ? '+' : ''}${this._fmtEUR(diff)}`, bold: true, color: diffColor(theme) }
        ], { headerInfo, keepTogether: true });

        if (Array.isArray(b.expenseDocs) && b.expenseDocs.length) {
          this._section(doc, theme, 'Bar bezahlte Lieferantenrechnungen im Zählzeitraum', headerInfo);
          this._table(doc, theme, {
            columns: [
              { header: 'Bezahlt am', width: 110, render: r => this._fmtDateTime(r.paidAt) },
              { header: 'Lieferant', width: 200, render: r => r.supplier || '-' },
              { header: 'Belegnr.', width: 130, render: r => r.documentNumber || '-' },
              { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.danger }
            ],
            rows: b.expenseDocs,
            sumRow: ['Summe', '', '', this._fmtEUR(b.cashExpenses || 0)],
            headerInfo
          });
        }

        if (Array.isArray(b.movements) && b.movements.length) {
          this._section(doc, theme, 'Kassenbewegungen seit der letzten Zählung', headerInfo);
          const mvRows = b.movements;
          const mvNet = mvRows.reduce((a, r) => a + Number(r.signedAmount || 0), 0);
          const round2local = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
          this._table(doc, theme, {
            columns: [
              { header: 'Datum/Uhrzeit', width: 100, render: r => this._fmtDateTime(r.occurredAt) },
              { header: 'Typ', width: 130, render: r => cashMovementService.label(r.type) },
              { header: 'Konto / Notiz', width: 160, render: r => [r.bankAccount, r.note].filter(Boolean).join(' – ') || '—' },
              { header: 'Erfasst von', width: 90, render: r => r.user || '—' },
              {
                header: 'Betrag', width: 75, align: 'right',
                render: r => `${Number(r.signedAmount) > 0 ? '+' : ''}${this._fmtEUR(r.signedAmount)}`,
                color: (r) => Number(r.signedAmount) >= 0 ? theme.color.success : theme.color.danger
              }
            ],
            rows: mvRows,
            sumRow: ['Netto', '', '', '', `${round2local(mvNet) > 0 ? '+' : ''}${this._fmtEUR(round2local(mvNet))}`],
            headerInfo
          });
        }

        this._signatureBlock(doc, theme, ['Gezählt von', 'Geprüft von'], headerInfo);

        this._finishDoc(doc, theme, headerInfo);
        const stamp = new Date(cc.countedAt);
        const p = (x) => String(x).padStart(2, '0');
        done.then(pdf => resolve({
          data: pdf,
          filename: `kassenzaehlung_${stamp.getFullYear()}-${p(stamp.getMonth() + 1)}-${p(stamp.getDate())}_${p(stamp.getHours())}${p(stamp.getMinutes())}.pdf`,
          mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= PDF: Jahresabschluss (ausschließlich aus dem Snapshot) ========= */
  /**
   * Geschlossenes Geschäftsjahr: alle Zahlen kommen aus YearEndReport.detailsJson.
   * Offenes Geschäftsjahr: Live-Entwurf in derselben Form, mit "ENTWURF" im Kopf.
   * Snapshots vor version 4 haben keine Kassenzählungsliste, Stornos, Guthaben-Abstimmung und
   * Geldbestand-Überleitung: diese Abschnitte sagen dann "bei diesem Abschluss noch nicht erfasst".
   */
  async exportYearEndReportPDF(fiscalYearId, { createdBy } = {}) {
    const { fiscalYear, snapshot: s } = await accountingService.getYearEndSnapshot(fiscalYearId);
    const draft = !!s.draft;
    const v4 = Number(s.version || 0) >= 4;
    const notCaptured = 'Bei diesem Abschluss noch nicht erfasst (Abschluss vor Einführung dieses Abschnitts).';
    const LIST_LIMIT = 40;

    const sum = (arr, sel) => Math.round((arr || []).reduce((acc, r) => acc + Number(sel(r) || 0), 0) * 100) / 100;
    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    const periodLabel = `${this._fmtDate(fiscalYear.startDate)} – ${this._fmtDate(fiscalYear.endDate)}`;
    const dataStateLabel = draft
      ? `Datenstand: Live-Vorschau vom ${this._fmtDateTime(s.generatedAt || new Date())}`
      : `Datenstand: Abschluss vom ${this._fmtDateTime(s.closedAt)}`;

    const income = s.summary || {};
    const byType = s.incomeByType || {};
    const byExpType = s.expensesByType || {};
    // Kassenbewegungen: kann bei Altabschlüssen (v2) fehlen → robust behandeln
    const cm = s.cashMovements || null;
    const banks = Array.isArray(s.bankAccounts) ? s.bankAccounts : [];
    const banksTotal = sum(banks, b => b.balance);
    const cash = s.cashCount || null;
    const cashTotal = cash ? Number(cash.countedTotal || 0) : 0;
    const unpaidInvSum = sum(s.unpaidInvoices, r => r.totalAmount);
    const unpaidPurchSum = sum(s.unpaidPurchaseDocs, r => r.totalAmount);
    const diffRows = (s.inventory && Array.isArray(s.inventory.diff)) ? s.inventory.diff : [];
    const expenseCount = (s.expenseDocs || []).length;

    // Gästeguthaben: v4 zum Stichtag (bzw. Stand heute), ältere Abschlüsse: Stand beim Abschluss
    const gb = v4 && s.guestBalances ? s.guestBalances : null;
    const balances = Array.isArray(s.customerBalances) ? s.customerBalances : [];
    const guestCredit = gb ? Number(gb.totals.credit) : sum(balances.filter(b => Number(b.balance) > 0), b => b.balance);
    const guestDebit = gb ? Number(gb.totals.debit) : sum(balances.filter(b => Number(b.balance) < 0), b => b.balance);
    const guestBalance = Number(s.liquidity?.guestBalanceEnd ?? r2(guestCredit + guestDebit));
    const guestAsOf = gb
      ? (gb.asOfIsNow ? `Stand heute ${this._fmtDateTime(gb.asOf)}` : `zum Stichtag ${this._fmtDate(gb.stichtag)}`)
      : (draft ? 'Stand heute' : `Stand beim Abschluss ${this._fmtDate(s.closedAt)}`);
    const corr = v4 ? (s.corrections || null) : null;
    const counts = v4 ? (s.cashCounts || null) : null;

    // Nachträgliche Änderungen nach dem Abschluss (nur geschlossene Jahre, LIVE erzeugt): protokollierte
    // CLOSED_PERIOD_CHANGE-Einträge und Vergleich Snapshot-EÜR gegen die aktuelle EÜR des Zeitraums.
    // Der Vergleich zeigt auch Abweichungen ohne Protokoll (Altfälle vor Einführung der Sperre).
    let post = null;
    if (!draft) {
      const [entries, live] = await Promise.all([
        closedPeriod.listForYear(fiscalYear.id),
        accountingService.getProfitLoss(fiscalYear.startDate, fiscalYear.endDate)
      ]);
      const cmpRows = [['Betriebseinnahmen', 'totalIncome'], ['Betriebsausgaben', 'totalExpenses'], ['Überschuss / Fehlbetrag', 'profit']]
        .map(([label, k]) => {
          const closedVal = r2(income[k]);
          const liveVal = r2(live.summary[k]);
          return { label, closed: closedVal, live: liveVal, diff: r2(liveVal - closedVal) };
        });
      const profitDiff = cmpRows[2].diff;
      const loggedEffect = r2(sum(entries, e => (e.changes && e.changes.effect) || 0));
      post = {
        entries, cmpRows, profitDiff, loggedEffect,
        unexplained: r2(profitDiff - loggedEffect),
        anyDiff: cmpRows.some(r => Math.abs(r.diff) >= 0.005),
        generatedAt: new Date()
      };
    }

    return new Promise((resolve, reject) => {
      try {
        const headerInfo = {
          reportName: 'Jahresabschluss',
          title: `Jahresabschluss – ${this.getTheme().brandName}`,
          subtitle: `Geschäftsjahr ${fiscalYear.name} (${periodLabel}) · ${dataStateLabel}`,
          watermark: draft ? 'ENTWURF' : null,
          createdBy
        };
        const { doc, done, theme } = this._createDocWithBuffer(headerInfo);
        const pageW = doc.page.width - theme.page.margin * 2;
        const diffColor = (d) => Math.abs(Number(d || 0)) < 0.005 ? theme.color.success : (Number(d) < 0 ? theme.color.danger : theme.color.warning);

        // ---------- DECKBLATT ----------
        this._drawLogo(doc, theme, { x: doc.page.width - theme.page.margin - 70, y: 60, height: 70 });
        doc.fillColor(theme.color.primary).font(theme.font.bold).fontSize(26)
          .text(`Jahresabschluss – ${theme.brandName}`, theme.page.margin, 150, { width: pageW, align: 'left' });
        doc.moveDown(0.4);
        doc.font(theme.font.regular).fontSize(12).fillColor(theme.color.subtext)
          .text(`Geschäftsjahr: ${fiscalYear.name} (${periodLabel})`, { width: pageW })
          .text(draft
            ? `Status: ENTWURF, noch nicht abgeschlossen · Live-Vorschau vom ${this._fmtDateTime(s.generatedAt || new Date())}`
            : `Status: abgeschlossen am ${this._fmtDateTime(s.closedAt)} · Zahlen eingefroren`, { width: pageW });
        if (draft) {
          doc.moveDown(0.3);
          doc.font(theme.font.bold).fontSize(28).fillColor(theme.color.danger).opacity(0.25)
            .text('ENTWURF', theme.page.margin, doc.y, { width: pageW, align: 'right' }).opacity(1);
        }

        const panelX = theme.page.margin;
        const panelY = Math.max(280, doc.y + 24);
        const kpiRows = v4 ? 4 : 3;
        const lineH = 40;
        const panelH = 70 + kpiRows * lineH;
        doc.save();
        doc.roundedRect(panelX, panelY, pageW, panelH, 8).fill(theme.color.panelBg);
        doc.restore();
        doc.save().lineWidth(1).strokeColor(theme.color.border).roundedRect(panelX, panelY, pageW, panelH, 8).stroke().restore();
        doc.font(theme.font.bold).fontSize(14).fillColor(theme.color.text)
          .text('Zusammenfassung zum Stichtag', panelX + 16, panelY + 12);

        const colW = pageW / 2 - 24;
        const KPI = (label, value, x, y, color, valueFont) => {
          doc.font(theme.font.regular).fontSize(10).fillColor(theme.color.subtext).text(label, x, y, { width: colW, lineBreak: false, ellipsis: true });
          doc.font(valueFont || theme.font.bold).fontSize(12).fillColor(color || theme.color.text).text(value, x, y + 13, { width: colW, lineBreak: false, ellipsis: true });
        };
        const col1x = panelX + 16, col2x = panelX + pageW / 2 + 8, kpiY = panelY + 42;
        KPI('Betriebseinnahmen', this._fmtEUR(income.totalIncome), col1x, kpiY, theme.color.success);
        KPI('Betriebsausgaben', this._fmtEUR(income.totalExpenses), col1x, kpiY + lineH, theme.color.danger);
        KPI(Number(income.profit) < 0 ? 'Fehlbetrag' : 'Überschuss', this._fmtEUR(income.profit), col1x, kpiY + lineH * 2,
          Number(income.profit) < 0 ? theme.color.danger : theme.color.success);
        if (cash && cash.isOpening) {
          KPI(`Kassenbestand (Anfangsbestand ${this._fmtDate(cash.countedAt)})`, this._fmtEUR(cashTotal), col2x, kpiY);
        } else if (cash) {
          KPI(cash.manual ? 'Kassenbestand (manuell erfasst)' : `Kassenbestand (gezählt ${this._fmtDate(cash.countedAt)})`, this._fmtEUR(cashTotal), col2x, kpiY);
        } else {
          KPI('Kassenbestand', 'noch nicht gezählt', col2x, kpiY, theme.color.danger);
        }
        if (banks.length) KPI('Bankkonten gesamt', this._fmtEUR(banksTotal), col2x, kpiY + lineH);
        else if (draft) KPI('Bankkonten gesamt', 'wird beim Abschluss erfasst', col2x, kpiY + lineH, theme.color.subtext, theme.font.regular);
        else KPI('Bankkonten gesamt', 'keine erfasst', col2x, kpiY + lineH, theme.color.subtext, theme.font.regular);
        KPI(`Gästeguthaben netto (${gb ? (gb.asOfIsNow ? 'Stand heute' : 'Stichtag') : (draft ? 'Stand heute' : 'beim Abschluss')})`, this._fmtEUR(guestBalance), col2x, kpiY + lineH * 2, theme.color.danger);
        if (v4) {
          const cs = corr?.cancelledSales || { count: 0, total: 0 };
          KPI(`Stornierte Verkäufe (${cs.count})`, this._fmtEUR(cs.total), col1x, kpiY + lineH * 3, cs.count ? theme.color.warning : theme.color.text);
          const nCounts = counts ? counts.items.filter(c => !c.isOpening).length : 0;
          KPI(`Kassendifferenzen (${nCounts} ${nCounts === 1 ? 'Zählung' : 'Zählungen'} im Jahr)`, this._fmtSigned(counts?.totalDifference || 0), col2x, kpiY + lineH * 3, diffColor(counts?.totalDifference || 0));
        }

        if (s.legacy) {
          doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
            .text('Hinweis: Dieser Abschluss wurde vor Einführung des vollständigen Abschluss-Snapshots erstellt. '
              + 'Detail-Listen (Belege, Artikel, Gästeguthaben) liegen dafür nicht vor.',
              panelX, panelY + panelH + 16, { width: pageW });
        } else if (!v4) {
          doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
            .text('Hinweis: Dieser Abschluss wurde vor Einführung von Kassenzählungsliste, Stornoübersicht, Guthaben-Abstimmung und Geldbestand-Überleitung erstellt; '
              + 'diese Abschnitte fehlen hier. Gästeguthaben: Stand beim Abschluss.',
              panelX, panelY + panelH + 16, { width: pageW });
        }

        // Hinweis auf nachträgliche Änderungen (live, siehe Nachtrag am Ende)
        if (post) {
          const hintY = (s.legacy || !v4) ? doc.y + 10 : panelY + panelH + 16;
          const n = post.entries.length;
          const clean = n === 0 && !post.anyDiff;
          doc.font(theme.font.bold).fontSize(11).fillColor(clean ? theme.color.success : theme.color.warning)
            .text(clean
              ? 'Nachträgliche Änderungen nach dem Abschluss: keine'
              : `Nachträgliche Änderungen nach dem Abschluss: ${n === 0 ? 'keine protokolliert' : `${n} protokolliert`}`
                + (post.anyDiff ? ` · Abweichung Überschuss aktuell gegenüber Abschluss: ${this._fmtSigned(post.profitDiff)}` : ''),
            panelX, hintY, { width: pageW });
          doc.font(theme.font.regular).fontSize(9).fillColor(theme.color.subtext)
            .text(clean
              ? `Geprüft beim Erstellen dieses PDFs am ${this._fmtDateTime(post.generatedAt)}: keine protokollierte Änderung, aktuelle EÜR gleich dem Abschluss.`
              : 'Die Zahlen dieses Berichts sind der Stand beim Abschluss. Einzelheiten im Nachtrag „Nachträgliche Änderungen nach dem Abschluss“ am Ende.',
            panelX, doc.y + 2, { width: pageW });
          doc.fillColor(theme.color.text);
        }

        // ---------- SEITE 2: EÜR ----------
        this._addPageDecorated(doc, theme, headerInfo);
        this._section(doc, theme, 'Einnahmen-Überschuss-Rechnung', headerInfo);
        const eurRows = [];
        if (s.incomeByType) {
          eurRows.push({ label: 'Barverkäufe', value: this._fmtEUR(byType.cash) });
          eurRows.push({ label: 'Verkäufe über Kundenkonto', value: this._fmtEUR(byType.account) });
          if (Number(byType.card || 0) > 0) eurRows.push({ label: 'Kartenzahlungen SumUp', value: this._fmtEUR(byType.card) });
          eurRows.push({ label: 'Bezahlte Kundenrechnungen', value: this._fmtEUR(byType.invoices) });
          if (cm && cm.otherIncome && (Number(cm.otherIncome.total || 0) > 0 || Number(cm.otherIncome.count || 0) > 0)) {
            eurRows.push({ label: `Sonstige Bareinnahmen (${cm.otherIncome.count || 0})`, value: this._fmtEUR(cm.otherIncome.total || 0), color: theme.color.success });
          }
        }
        eurRows.push({ label: 'Summe Betriebseinnahmen', value: this._fmtEUR(income.totalIncome), bold: true, color: theme.color.success });
        eurRows.push({ spacer: true });
        // Lieferantenrechnungen zeigt den Belegbetrag (ohne sonstige Barausgaben)
        const expDocsAmount = byExpType.purchaseDocuments != null ? byExpType.purchaseDocuments : income.totalExpenses;
        eurRows.push({ label: `Bezahlte Lieferantenrechnungen${expenseCount ? ` (${expenseCount} Belege)` : ''}`, value: this._fmtEUR(expDocsAmount) });
        if (cm && cm.otherExpense && (Number(cm.otherExpense.total || 0) > 0 || Number(cm.otherExpense.count || 0) > 0)) {
          eurRows.push({ label: `Sonstige Barausgaben (${cm.otherExpense.count || 0})`, value: this._fmtEUR(cm.otherExpense.total || 0), color: theme.color.danger });
        }
        eurRows.push({ label: 'Summe Betriebsausgaben', value: this._fmtEUR(income.totalExpenses), bold: true, color: theme.color.danger });
        eurRows.push({ spacer: true });
        eurRows.push({
          label: Number(income.profit) < 0 ? 'Fehlbetrag' : 'Überschuss', value: this._fmtEUR(income.profit),
          bold: true, color: Number(income.profit) < 0 ? theme.color.danger : theme.color.success, rule: true
        });
        this._kvList(doc, theme, eurRows, { headerInfo, keepTogether: true });

        if (s.nonRevenue || (s.liquidity && s.liquidity.topUps)) {
          this._section(doc, theme, 'Nachrichtlich (kein Ertrag, keine Ausgabe)', headerInfo);
          const nr = s.nonRevenue || {};
          const tu = (s.liquidity && s.liquidity.topUps) || null;
          const infoRows = [];
          if (nr.ownerUse) infoRows.push({ label: `Eigenverbrauch / Sachentnahme (${this._fmtNum(nr.ownerUse.quantity)} Stück, Warenwert)`, value: this._fmtEUR(nr.ownerUse.value) });
          if (nr.expired) infoRows.push({ label: `Abgelaufen / Schwund (${this._fmtNum(nr.expired.quantity)} Stück, Warenwert)`, value: this._fmtEUR(nr.expired.value) });
          if (tu) {
            // Karte als eigene Zeile, damit "gesamt" aus den Zeilen nachrechenbar ist
            const card = tu.card != null ? Number(tu.card) : r2(Number(tu.total || 0) - Number(tu.cash || 0) - Number(tu.transfer || 0));
            infoRows.push({ label: 'Aufladungen Kundenkonten bar', value: this._fmtEUR(tu.cash) });
            infoRows.push({ label: 'Aufladungen Kundenkonten per Überweisung', value: this._fmtEUR(tu.transfer) });
            infoRows.push({ label: 'Aufladungen Kundenkonten per Karte (SumUp)', value: this._fmtEUR(card) });
            infoRows.push({ label: 'Aufladungen gesamt (Zufluss, aber Verbindlichkeit gegenüber Gästen)', value: this._fmtEUR(tu.total), bold: true, rule: true });
          }
          this._kvList(doc, theme, infoRows, { headerInfo, keepTogether: true });
        }

        // ---------- KASSE & BANK ----------
        this._section(doc, theme, 'Kasse und Bank', headerInfo);
        const cashRows = [];
        if (cash && !cash.manual && cash.isOpening) {
          cashRows.push({ label: `Kassenzählung vom ${this._fmtDateTime(cash.countedAt)}${cash.countedBy ? ` (gezählt von ${cash.countedBy})` : ''}`, value: '' });
          cashRows.push({ label: 'Anfangsbestand beim Start (kein Soll-Vergleich)', value: this._fmtEUR(cash.countedTotal), bold: true });
          if (cash.note) cashRows.push({ label: `Notiz: ${cash.note}`, value: '' });
        } else if (cash && !cash.manual) {
          cashRows.push({ label: `Kassenzählung vom ${this._fmtDateTime(cash.countedAt)}${cash.countedBy ? ` (gezählt von ${cash.countedBy})` : ''}`, value: '' });
          cashRows.push({ label: 'Soll laut System', value: this._fmtEUR(cash.expectedTotal) });
          cashRows.push({ label: 'Ist gezählt', value: this._fmtEUR(cash.countedTotal), bold: true });
          const d = Number(cash.difference || 0);
          cashRows.push({ label: 'Differenz (Ist - Soll)', value: this._fmtSigned(d), bold: true, color: diffColor(d) });
          if (cash.note) cashRows.push({ label: `Notiz: ${cash.note}`, value: '' });
        } else if (cash && cash.manual) {
          cashRows.push({ label: 'Barkasse (manuell erfasst, Abschluss vor Einführung der Kassenzählung)', value: this._fmtEUR(cashTotal), bold: true });
        } else {
          cashRows.push({ label: 'Kassenbestand: noch keine Kassenzählung im Geschäftsjahr (Pflicht vor dem Abschluss)', value: '—', bold: true, color: theme.color.danger });
        }
        // Liquiditätsbewegungen Kasse ↔ Bank (ergebnisneutral)
        if (cm) {
          cashRows.push({ spacer: true });
          cashRows.push({ label: `Einzahlungen auf Bank im Geschäftsjahr (${cm.bankDeposits?.count || 0}) [nur Liquidität, kein Ertrag]`, value: this._fmtEUR(cm.bankDeposits?.total || 0) });
          cashRows.push({ label: `Abhebungen von Bank im Geschäftsjahr (${cm.bankWithdrawals?.count || 0}) [nur Liquidität, keine Ausgabe]`, value: this._fmtEUR(cm.bankWithdrawals?.total || 0) });
        }
        cashRows.push({ spacer: true });
        if (banks.length === 0) {
          cashRows.push(draft
            ? { label: 'Bankkonten: Kontostände werden beim Abschluss erfasst', value: '—' }
            : { label: 'Bankkonten: keine erfasst', value: this._fmtEUR(0) });
        }
        banks.forEach(b => cashRows.push({ label: `Bankkonto ${b.name || ''}${b.iban ? ` (${b.iban})` : ''}`, value: this._fmtEUR(b.balance) }));
        if (banks.length === 0 && draft) {
          cashRows.push({ label: 'Liquide Mittel gesamt (Kasse + Bank): nach Erfassung der Kontostände', value: '—', bold: true, rule: true });
        } else {
          cashRows.push({ label: 'Liquide Mittel gesamt (Kasse + Bank)', value: this._fmtEUR(cashTotal + banksTotal), bold: true, rule: true });
        }
        this._kvList(doc, theme, cashRows, { headerInfo, keepTogether: true });

        // ---------- ALLE KASSENZÄHLUNGEN DES JAHRES (v4) ----------
        this._section(doc, theme, 'Kassenzählungen im Geschäftsjahr', headerInfo);
        if (counts) {
          const cItems = counts.items || [];
          this._table(doc, theme, {
            columns: [
              { header: 'Datum/Uhrzeit', width: 92, render: r => this._fmtDateTime(r.countedAt) },
              { header: 'Gezählt von', width: 85, render: r => r.countedBy || '—' },
              { header: 'Soll', width: 70, align: 'right', render: r => r.isOpening ? 'Anfangsbestand' : this._fmtEUR(r.expectedTotal) },
              { header: 'Ist', width: 70, align: 'right', render: r => this._fmtEUR(r.countedTotal) },
              { header: 'Differenz', width: 65, align: 'right', render: r => r.isOpening ? '—' : this._fmtSigned(r.difference), color: r => r.isOpening ? theme.color.subtext : diffColor(r.difference) },
              { header: 'Notiz', width: 118, render: r => r.note || '' }
            ],
            rows: cItems,
            sumRow: ['Summe', '', '', '', this._fmtSigned(counts.totalDifference), ''],
            emptyHint: 'Keine Kassenzählung im Geschäftsjahr.',
            headerInfo
          });
          const hints = [`Zählfenster ${this._fmtDate(counts.window?.start)} bis ${this._fmtDate(counts.window?.end)} (einschließlich des Tags nach dem Stichtag).`];
          if (cItems.some(c => c.isOpening)) hints.push('Anfangsbestand: beim Start mit ClubTouch3 gezählt, Soll = Ist, kein Soll-Vergleich.');
          hints.push('Jede Zählung rechnet ab der vorherigen Zählung; eine Differenz wird dadurch nicht in die nächste Zählung übertragen.');
          this._note(doc, theme, hints.join(' '));
        } else {
          this._note(doc, theme, `${notCaptured} Oben steht nur die für den Abschluss verwendete Zählung.`);
        }

        // ---------- BANK-ABSTIMMUNG ----------
        // Snapshot v3; Altabschlüsse haben das Feld nicht → Abschnitt entfällt
        const br = s.bankReconciliation || null;
        if (br) {
          this._section(doc, theme, 'Bank-Abstimmung', headerInfo);
          const inf = br.inflows || {}, outf = br.outflows || {};
          const cnt = (x) => Number((x && x.count) || 0);
          const tot = (x) => Number((x && x.total) || 0);
          const openingLabel = br.openingSource === 'VORJAHRESABSCHLUSS'
            ? `Bankstand laut Abschluss "${br.openingFiscalYear?.name || 'Vorjahr'}" (${this._fmtDate(br.openingFiscalYear?.endDate)})`
            : br.openingSource === 'ANFANGSSTAND'
              ? `Anfangsstand vom ${this._fmtDate(br.openingBalance?.date)}`
              : 'Kein Anfangsstand erfasst (Start bei 0,00 €)';
          const brRows = [
            { label: openingLabel, value: this._fmtEUR(br.opening), bold: true },
            { label: `+ Einzahlungen aus der Kasse (${cnt(inf.bankDeposits)})`, value: this._fmtEUR(tot(inf.bankDeposits)), color: theme.color.success },
            { label: `+ Aufladungen Kundenkonten per Überweisung (${cnt(inf.topUpsTransfer)})`, value: this._fmtEUR(tot(inf.topUpsTransfer)), color: theme.color.success },
            { label: `+ Bezahlte Kundenrechnungen per Überweisung (${cnt(inf.invoicesPaid)})`, value: this._fmtEUR(tot(inf.invoicesPaid)), color: theme.color.success },
            ...(cnt(inf.cardPayments) ? [{ label: `+ Kartenzahlungen SumUp (${cnt(inf.cardPayments)})`, value: this._fmtEUR(tot(inf.cardPayments)), color: theme.color.success }] : []),
            ...(tot(outf.cardFees) ? [{ label: `- SumUp-Gebühren ${String(outf.cardFees.percent).replace('.', ',')} % (geschätzt)`, value: this._fmtEUR(-tot(outf.cardFees)), color: theme.color.danger }] : []),
            { label: `- Per Überweisung bezahlte Lieferantenrechnungen (${cnt(outf.purchasesTransfer)})`, value: this._fmtEUR(-tot(outf.purchasesTransfer)), color: theme.color.danger },
            { label: `- Abhebungen für die Kasse (${cnt(outf.bankWithdrawals)})`, value: this._fmtEUR(-tot(outf.bankWithdrawals)), color: theme.color.danger },
            { label: 'Bank-Soll laut App', value: this._fmtEUR(br.expected), bold: true, rule: true }
          ];
          if (br.invoicesPaidCash && Number(br.invoicesPaidCash.count || 0) > 0) {
            brRows.push({ label: `Nachrichtlich: bar bezahlte Kundenrechnungen laufen über die Kasse (${br.invoicesPaidCash.count})`, value: this._fmtEUR(br.invoicesPaidCash.total || 0) });
          }
          if (banks.length > 0) {
            const actual = br.actual != null ? Number(br.actual) : banksTotal;
            const bd = br.difference != null ? Number(br.difference) : (actual - Number(br.expected || 0));
            brRows.push({ label: `Eingetragene Kontostände (${banks.length} ${banks.length === 1 ? 'Konto' : 'Konten'})`, value: this._fmtEUR(actual), bold: true });
            brRows.push({ label: 'Differenz (Ist - Soll)', value: this._fmtSigned(bd), bold: true, color: Math.abs(bd) < 0.005 ? theme.color.success : theme.color.warning });
          } else {
            brRows.push({ label: draft ? 'Ist-Kontostände: werden beim Abschluss erfasst' : 'Ist-Kontostände: keine erfasst', value: '—' });
          }
          // Herleitung bis Ist/Differenz zusammenhalten
          this._kvList(doc, theme, brRows, { headerInfo, keepTogether: true });
          this._note(doc, theme, br.notCovered || 'Nicht enthalten: Bankgebühren, Zinsen, Mitgliedsbeiträge, Spenden und alles, was nicht über die App gebucht wurde.');

          const brItems = Array.isArray(br.movements) ? br.movements : [];
          const brNet = sum(brItems, r => r.amount);
          this._subheading(doc, theme, `Bankbewegungen über die App (${brItems.length})`);
          this._table(doc, theme, {
            columns: [
              { header: 'Datum', width: 90, render: r => this._fmtDate(r.date) },
              { header: 'Vorgang', width: 250, render: r => r.label || '—' },
              { header: 'Referenz', width: 140, render: r => r.reference || '—' },
              {
                header: 'Betrag ±', width: 90, align: 'right',
                render: r => `${Number(r.amount || 0) >= 0 ? '+' : ''}${this._fmtEUR(r.amount || 0)}`,
                color: r => Number(r.amount || 0) < 0 ? theme.color.danger : theme.color.success
              }
            ],
            rows: brItems,
            sumRow: ['', '', 'Netto', `${brNet >= 0 ? '+' : ''}${this._fmtEUR(brNet)}`],
            emptyHint: 'Keine Bankbewegungen über die App im Geschäftsjahr.',
            headerInfo
          });
        }

        // ---------- KASSENBEWEGUNGEN ----------
        this._section(doc, theme, 'Kassenbewegungen im Geschäftsjahr', headerInfo);
        const cmItems = (cm && Array.isArray(cm.items)) ? cm.items : [];
        const cmNetTotal = sum(cmItems, r => r.signedAmount);
        this._table(doc, theme, {
          columns: [
            { header: 'Datum/Uhrzeit', width: 110, render: r => this._fmtDateTime(r.occurredAt) },
            { header: 'Typ', width: 110, render: r => cashMovementService.label(r.type) },
            { header: 'Konto / Notiz', width: 160, render: r => (r.bankAccount ? `${r.bankAccount}${r.note ? ' – ' + r.note : ''}` : (r.note || '—')) },
            { header: 'Erfasst von', width: 100, render: r => r.user || '—' },
            {
              header: 'Betrag ±', width: 90, align: 'right',
              render: r => `${Number(r.signedAmount || 0) >= 0 ? '+' : ''}${this._fmtEUR(r.signedAmount || 0)}`,
              color: r => Number(r.signedAmount || 0) < 0 ? theme.color.danger : theme.color.success
            }
          ],
          rows: cmItems,
          sumRow: ['', '', '', 'Netto', `${cmNetTotal >= 0 ? '+' : ''}${this._fmtEUR(cmNetTotal)}`],
          emptyHint: 'Keine Kassenbewegungen im Geschäftsjahr.',
          headerInfo
        });
        if (cmItems.length) this._note(doc, theme, 'Nur nicht stornierte Kassenbewegungen; stornierte stehen unter „Stornos und Korrekturen“.');

        // ---------- GELDBESTAND ANFANG → ENDE (v4) ----------
        this._section(doc, theme, 'Geldbestand zu Beginn und am Ende (Plausibilität)', headerInfo);
        const lb = v4 ? (s.liquidityBridge || null) : null;
        if (lb && lb.available) {
          const prevName = lb.previousFiscalYear?.name || 'Vorjahr';
          const lbRows = [
            { label: `Kasse zu Beginn (laut Abschluss „${prevName}“)`, value: this._fmtEUR(lb.cashStart) },
            { label: `Bank zu Beginn (laut Abschluss „${prevName}“)`, value: this._fmtEUR(lb.bankStart) },
            { label: '= Geldbestand zu Beginn', value: this._fmtEUR(lb.startTotal), bold: true, rule: true },
            { label: `+ ${Number(lb.profit) < 0 ? 'Fehlbetrag' : 'Überschuss'} laut EÜR`, value: this._fmtSigned(lb.profit) },
            { label: '+ Veränderung Gästeguthaben (ohne Übernahme von Startguthaben)', value: this._fmtSigned(lb.guestChange) }
          ];
          if (Number(lb.cardFees || 0) > 0) lbRows.push({ label: '- SumUp-Gebühren (geschätzt, nicht in der EÜR)', value: this._fmtEUR(-lb.cardFees) });
          lbRows.push({ label: '= rechnerischer Geldbestand am Ende', value: this._fmtEUR(lb.expectedEnd), bold: true, rule: true });
          lbRows.push({ spacer: true });
          lbRows.push(lb.cashEnd != null
            ? { label: `Kasse gezählt (Zählung vom ${this._fmtDateTime(lb.cashCountedAt)})`, value: this._fmtEUR(lb.cashEnd) }
            : { label: 'Kasse: noch nicht gezählt', value: '—', color: theme.color.danger });
          lbRows.push(lb.bankEnd != null
            ? { label: 'Bank laut eingetragenen Kontoständen', value: this._fmtEUR(lb.bankEnd) }
            : { label: lb.bankPending ? 'Bank: Kontostände werden beim Abschluss erfasst' : 'Bank: keine Kontostände erfasst', value: '—' });
          if (lb.actualEnd != null) {
            const rest = r2(Number(lb.difference) - Number(lb.cashCountDifferences || 0) - Number(lb.bankDifference || 0));
            lbRows.push({ label: '= tatsächlicher Geldbestand am Ende', value: this._fmtEUR(lb.actualEnd), bold: true, rule: true });
            lbRows.push({ label: 'Differenz (tatsächlich - rechnerisch)', value: this._fmtSigned(lb.difference), bold: true, color: diffColor(lb.difference) });
            lbRows.push({ label: '  davon Kassendifferenzen der Zählungen im Jahr', value: this._fmtSigned(lb.cashCountDifferences || 0) });
            if (lb.bankDifference != null) lbRows.push({ label: '  davon Bank-Differenz laut Bank-Abstimmung', value: this._fmtSigned(lb.bankDifference) });
            lbRows.push({ label: '  verbleibender Rest (zeitliche Abgrenzung)', value: this._fmtSigned(rest), color: Math.abs(rest) < 0.005 ? theme.color.success : theme.color.warning });
          }
          this._kvList(doc, theme, lbRows, { headerInfo, keepTogether: true });
          this._note(doc, theme, 'Lesart: Der Überschuss erklärt die Veränderung des Geldbestands, korrigiert um Vorgänge ohne Geldfluss: Verkäufe über Kundenkonto sind Einnahme, aber kein Geld; '
            + 'Aufladungen sind Geld, aber kein Ertrag (Veränderung Gästeguthaben); die Übernahme von Startguthaben ist nicht enthalten. '
            + 'Ein Rest entsteht durch zeitliche Abgrenzung, z. B. wenn die Kasse erst nach dem Stichtag gezählt wurde (Verkäufe nach Mitternacht).');
        } else if (lb && !lb.available) {
          this._note(doc, theme, `Nicht herleitbar. ${(lb.reasons || []).join(' ')}`);
          this._note(doc, theme, lb.explanation || '');
        } else {
          this._note(doc, theme, notCaptured);
        }

        // ---------- STORNOS UND KORREKTUREN (v4) ----------
        this._section(doc, theme, 'Stornos und Korrekturen', headerInfo);
        if (corr) {
          const cs = corr.cancelledSales || { count: 0, total: 0, byPayment: {}, items: [] };
          const oc = corr.otherCancellations || { count: 0, total: 0, items: [] };
          const ct = corr.cancelledTopUps || { count: 0, total: 0, items: [] };
          const cc = corr.cancelledCashMovements || { count: 0, total: 0, items: [] };
          const sc = corr.stockCorrections || { count: 0, items: [] };
          const bp = cs.byPayment || {};
          const sumRows = [
            { label: `Stornierte Verkäufe (${cs.count})`, value: this._fmtEUR(cs.total), bold: true },
            ...Object.keys(bp).map(k => ({ label: `  davon ${this._paymentLabel(k)} (${bp[k].count})`, value: this._fmtEUR(bp[k].total) })),
            ...(oc.count ? [{ label: `Sonstige Stornobuchungen (${oc.count}, Liste unten)`, value: this._fmtEUR(oc.total) }] : []),
            { label: `Stornierte Aufladungen (${ct.count})`, value: this._fmtEUR(ct.total), bold: true },
            { label: `Stornierte Kassenbewegungen (${cc.count})`, value: this._fmtEUR(cc.total), bold: true },
            { label: 'Manuelle Bestandskorrekturen', value: `${sc.count} ${sc.count === 1 ? 'Buchung' : 'Buchungen'}`, bold: true }
          ];
          this._kvList(doc, theme, sumRows, { headerInfo, keepTogether: true });
          if (cs.multipleCount) {
            this._note(doc, theme, `Achtung: ${cs.multipleCount} Stornobuchungen betreffen mehrfach stornierte Verkäufe (doppelte Gegenbuchung). Bitte prüfen.`);
          }

          this._subheading(doc, theme, `Stornierte Verkäufe (${cs.count})`);
          const csItems = (cs.items || []).slice(0, LIST_LIMIT);
          this._table(doc, theme, {
            columns: [
              { header: 'Verkauf am', width: 88, render: r => this._fmtDateTime(r.originalAt) },
              { header: 'Storno am', width: 88, render: r => this._fmtDateTime(r.cancelledAt) },
              { header: 'Kunde', width: 112, render: r => (r.customer || 'Bar') + (r.multiple ? ' (mehrfach storniert!)' : '') },
              { header: 'Zahlung', width: 70, render: r => this._paymentLabel(r.paymentMethod) },
              { header: 'Storniert von', width: 75, render: r => r.cancelledBy || '—' },
              { header: 'Betrag', width: 67, align: 'right', render: r => this._fmtEUR(r.amount) }
            ],
            rows: csItems,
            sumRow: ['Summe', '', '', '', '', this._fmtEUR(cs.total)],
            emptyHint: 'Keine stornierten Verkäufe im Geschäftsjahr.',
            headerInfo
          });
          this._moreNote(doc, theme, csItems.length, cs.count);

          if (oc.count) {
            this._subheading(doc, theme, `Sonstige Stornobuchungen (${oc.count})`);
            const ocItems = (oc.items || []).slice(0, LIST_LIMIT);
            this._table(doc, theme, {
              columns: [
                { header: 'Storno am', width: 90, render: r => this._fmtDateTime(r.cancelledAt) },
                { header: 'Storno von', width: 150, render: r => `${r.originalLabel}${r.originalAt ? ` ${this._fmtDateTime(r.originalAt)}` : ''}` },
                { header: 'Kunde', width: 110, render: r => r.customer || 'Bar' },
                { header: 'Storniert von', width: 80, render: r => r.cancelledBy || '—' },
                { header: 'Betrag', width: 70, align: 'right', render: r => this._fmtEUR(r.amount) }
              ],
              rows: ocItems,
              sumRow: ['Summe', '', '', '', this._fmtEUR(oc.total)],
              headerInfo
            });
            this._moreNote(doc, theme, ocItems.length, oc.count);
            this._note(doc, theme, 'Eigenverbrauch/Abgelaufen haben 0,00 € (nur Bestand). Ein negativer Betrag bei „Stornobuchung“ heißt: eine Stornobuchung wurde ihrerseits storniert und hat den Betrag erneut belastet.');
          }

          this._subheading(doc, theme, `Stornierte Aufladungen (${ct.count})`);
          const ctItems = (ct.items || []).slice(0, LIST_LIMIT);
          this._table(doc, theme, {
            columns: [
              { header: 'Aufgeladen am', width: 100, render: r => this._fmtDateTime(r.originalAt) },
              { header: 'Storno am', width: 100, render: r => this._fmtDateTime(r.cancelledAt) },
              { header: 'Kunde', width: 160, render: r => r.customer || '—' },
              { header: 'Art', width: 70, render: r => ({ CASH: 'Bar', TRANSFER: 'Überweisung', CARD: 'Karte' })[r.method] || r.method },
              { header: 'Betrag', width: 70, align: 'right', render: r => this._fmtEUR(r.amount) }
            ],
            rows: ctItems,
            sumRow: ['Summe', '', '', '', this._fmtEUR(ct.total)],
            emptyHint: 'Keine stornierten Aufladungen im Geschäftsjahr.',
            headerInfo
          });
          this._moreNote(doc, theme, ctItems.length, ct.count);

          this._subheading(doc, theme, `Stornierte Kassenbewegungen (${cc.count})`);
          const ccItems = (cc.items || []).slice(0, LIST_LIMIT);
          this._table(doc, theme, {
            columns: [
              { header: 'Datum', width: 88, render: r => this._fmtDateTime(r.occurredAt) },
              { header: 'Storniert am', width: 88, render: r => this._fmtDateTime(r.cancelledAt) },
              { header: 'Typ', width: 90, render: r => cashMovementService.label(r.type) },
              { header: 'Notiz', width: 100, render: r => r.note || '—' },
              { header: 'Erfasst / storniert von', width: 75, render: r => `${r.createdBy || '—'} / ${r.cancelledBy || '—'}` },
              { header: 'Betrag', width: 65, align: 'right', render: r => this._fmtEUR(r.amount) }
            ],
            rows: ccItems,
            sumRow: ['Summe', '', '', '', '', this._fmtEUR(cc.total)],
            emptyHint: 'Keine stornierten Kassenbewegungen im Geschäftsjahr.',
            headerInfo
          });
          this._moreNote(doc, theme, ccItems.length, cc.count);

          this._subheading(doc, theme, `Manuelle Bestandskorrekturen (${sc.count})`);
          const scItems = (sc.items || []).slice(0, LIST_LIMIT);
          this._table(doc, theme, {
            columns: [
              { header: 'Datum', width: 88, render: r => this._fmtDateTime(r.createdAt) },
              { header: 'Art', width: 70, render: r => r.type === 'INVENTORY' ? 'Inventur' : 'Korrektur' },
              { header: 'Artikel', width: 140, render: r => r.article },
              { header: 'Menge', width: 80, align: 'right', render: r => `${Number(r.quantity) > 0 ? '+' : ''}${this._fmtQty(r.quantity, r.unit)}` },
              { header: 'Grund', width: 120, render: r => r.reason || '—' }
            ],
            rows: scItems,
            emptyHint: 'Keine manuellen Bestandskorrekturen im Geschäftsjahr.',
            headerInfo
          });
          this._moreNote(doc, theme, scItems.length, sc.count);
          this._note(doc, theme, 'Ohne automatische Bestandsbuchungen aus Stornos und Beleg-/Rechnungskorrekturen. Zeitraum: Buchungszeitpunkt im Geschäftsjahr.');
        } else {
          this._note(doc, theme, notCaptured);
        }

        // ---------- GÄSTEGUTHABEN ----------
        this._section(doc, theme, `Gästeguthaben ${guestAsOf}`, headerInfo);
        if (gb && gb.asOfIsNow) {
          this._note(doc, theme, `Der Stichtag ${this._fmtDate(gb.stichtag)} liegt in der Zukunft; die Guthaben zeigen den Stand heute (${this._fmtDateTime(gb.asOf)}).`);
        }
        if (gb) {
          const rc = gb.reconciliation || {};
          const tu = rc.topUps || {};
          const t = (m) => tu[m] || { total: 0, count: 0 };
          const startLabel = this._fmtDate(new Date(parseLocalDate(fiscalYear.startDate).getTime() - 1));
          this._subheading(doc, theme, 'Guthaben-Abstimmung');
          const gRows = [
            { label: `Guthaben zu Beginn (laut Buchungen bis ${startLabel})`, value: this._fmtEUR(rc.opening), bold: true },
            { label: `+ Aufladungen bar (${t('CASH').count})`, value: this._fmtEUR(t('CASH').total) },
            { label: `+ Aufladungen per Überweisung (${t('TRANSFER').count})`, value: this._fmtEUR(t('TRANSFER').total) },
            { label: `+ Aufladungen per Karte (${t('CARD').count})`, value: this._fmtEUR(t('CARD').total) },
            { label: `+ Auslagen-Gutschriften (${t('REIMBURSEMENT').count}, abzüglich Storno Auslage)`, value: this._fmtEUR(t('REIMBURSEMENT').total) },
            { label: `+ Übernahme Startguthaben Clubtouch 2.0 (${t('MIGRATION').count})`, value: this._fmtEUR(t('MIGRATION').total) },
            { label: `- Stornierte Aufladungen (${rc.topUpStornos?.count || 0})`, value: this._fmtEUR(rc.topUpStornos?.total || 0) },
            { label: `- Verkäufe über Kundenkonto (${rc.accountSales?.count || 0}, wie EÜR)`, value: this._fmtEUR(-(rc.accountSales?.total || 0)) },
            { label: `- Später stornierte Kundenkonto-Verkäufe (${rc.accountSalesCancelled?.count || 0})`, value: this._fmtEUR(-(rc.accountSalesCancelled?.total || 0)) },
            { label: `+ Stornos: Gutschrift aufs Kundenkonto (${rc.accountRefunds?.count || 0})`, value: this._fmtEUR(rc.accountRefunds?.total || 0) },
            ...(Number(rc.otherAccountTx?.total || 0) !== 0 ? [{ label: `+/- Sonstige Kundenkonto-Buchungen (${rc.otherAccountTx.count})`, value: this._fmtEUR(rc.otherAccountTx.total) }] : []),
            { label: '= Guthaben laut Buchungen', value: this._fmtEUR(rc.expectedEnd), bold: true, rule: true },
            { label: 'Summe der Einzelkonten (Liste unten, netto)', value: this._fmtEUR(rc.accountsSum), bold: true },
            {
              label: Math.abs(Number(rc.deviation || 0)) < 0.005 ? 'Abweichung (stimmt überein)' : 'ABWEICHUNG Einzelkonten - Buchungen',
              value: this._fmtSigned(rc.deviation), bold: true,
              color: Math.abs(Number(rc.deviation || 0)) < 0.005 ? theme.color.success : theme.color.danger
            }
          ];
          this._kvList(doc, theme, gRows, { headerInfo, keepTogether: true });
          if (Math.abs(Number(rc.deviation || 0)) >= 0.005) {
            this._note(doc, theme, 'Die Kontostände passen nicht zu den gebuchten Aufladungen und Verkäufen: Ein Guthaben wurde außerhalb der Buchungen verändert '
              + 'oder eine Buchung fehlt. Betroffene Konten:');
            const devs = (rc.deviations || []).slice(0, LIST_LIMIT);
            this._table(doc, theme, {
              columns: [
                { header: 'Kunde', width: 220, render: r => r.nickname ? `${r.name} (${r.nickname})` : r.name },
                { header: 'Kontostand', width: 90, align: 'right', render: r => this._fmtEUR(r.balance) },
                { header: 'laut Buchungen', width: 90, align: 'right', render: r => this._fmtEUR(r.ledger) },
                { header: 'Abweichung', width: 90, align: 'right', render: r => this._fmtSigned(r.difference), color: () => theme.color.danger }
              ],
              rows: devs,
              headerInfo
            });
            this._moreNote(doc, theme, devs.length, rc.deviationsCount || devs.length);
          }
        } else {
          this._note(doc, theme, `Guthaben-Abstimmung: ${notCaptured}`);
        }

        this._subheading(doc, theme, `Einzelkonten mit Saldo (${balances.length})`);
        if (balances.length) {
          this._twoColumnList(doc, theme, balances.map(b => ({
            label: b.nickname ? `${b.name} (${b.nickname})` : b.name,
            value: this._fmtEUR(b.balance),
            color: Number(b.balance) < 0 ? theme.color.danger : theme.color.text
          })));
        } else {
          this._note(doc, theme, s.legacy ? 'Keine Einzelliste im Abschluss vorhanden (Altbestand).' : 'Keine Kundenkonten mit Saldo.');
        }
        const nCredit = balances.filter(b => Number(b.balance) > 0).length;
        const nDebit = balances.filter(b => Number(b.balance) < 0).length;
        // Ohne Einzelliste (Altbestand) gibt es keine Aufteilung, nur den damals gespeicherten Nettobetrag
        this._kvList(doc, theme, [
          ...(balances.length || gb ? [
            { label: `Guthaben der Gäste (Verbindlichkeit, ${nCredit} Konten)`, value: this._fmtEUR(guestCredit) },
            { label: `Minus-Salden (Forderung an Gäste, ${nDebit} Konten)`, value: this._fmtEUR(guestDebit), color: guestDebit < 0 ? theme.color.danger : theme.color.text }
          ] : []),
          { label: 'Gästeguthaben netto', value: this._fmtEUR(guestBalance), bold: true, rule: true }
        ], { headerInfo, keepTogether: true });

        // ---------- VERBINDLICHKEITEN & FORDERUNGEN ----------
        this._section(doc, theme, 'Offene Lieferantenrechnungen (Verbindlichkeiten)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Belegdatum', width: 80, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 180, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 120, render: r => r.documentNumber || '-' },
            { header: 'Fällig', width: 80, render: r => this._fmtDate(r.dueDate) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: s.unpaidPurchaseDocs || [],
          sumRow: ['Summe', '', '', '', this._fmtEUR(unpaidPurchSum)],
          emptyHint: 'Keine offenen Lieferantenrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Offene Kundenrechnungen (Forderungen)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Rechnung', width: 100, render: r => r.invoiceNumber || '-' },
            { header: 'Empfänger', width: 160, render: r => r.customerName || '-' },
            { header: 'Erstellt', width: 80, render: r => this._fmtDate(r.createdAt) },
            { header: 'Fällig', width: 80, render: r => this._fmtDate(r.dueDate) },
            { header: 'Status', width: 70, render: r => this._invoiceStatusLabel(r.status) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount) }
          ],
          rows: s.unpaidInvoices || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(unpaidInvSum)],
          emptyHint: 'Keine offenen Kundenrechnungen.',
          headerInfo
        });

        // ---------- WARENBESTAND ----------
        // Deaktivierte Artikel nur mit Bestand; negativer Bestand zählt mit 0 € (sonst drückt er die Summe ins Minus)
        const isNeg = (r) => Number(r.systemStock) < 0 || Number(r.physicalStock) < 0;
        const invRows = diffRows.filter(r => !(r.active === false && Number(r.systemStock || 0) === 0 && Number(r.physicalStock || 0) === 0));
        const hiddenInactive = diffRows.length - invRows.length;
        const physVal = (r) => r2(Math.max(0, Number(r.physicalStock || 0)) * Number(r.price || 0));
        const negCount = invRows.filter(isNeg).length;
        this._section(doc, theme, 'Warenbestand zum Stichtag (laut App / gezählt / Differenz)', headerInfo);
        this._table(doc, theme, {
          columns: [
            {
              header: 'Artikel', width: 150,
              render: r => `${r.name}${r.active === false ? ' (inaktiv)' : ''}${isNeg(r) ? ' (!)' : ''}`,
              color: r => isNeg(r) ? theme.color.warning : theme.color.text
            },
            { header: 'Laut App', width: 105, align: 'right', render: r => this._fmtQty(r.systemStock, r.unit, r.purchaseUnit, r.unitsPerPurchase) },
            { header: 'Gezählt', width: 105, align: 'right', render: r => this._fmtQty(r.physicalStock, r.unit, r.purchaseUnit, r.unitsPerPurchase) },
            { header: 'Differenz', width: 80, align: 'right', render: r => `${Number(r.diff) > 0 ? '+' : ''}${this._fmtQty(r.diff, r.unit)}`, color: r => r.diff < 0 ? theme.color.danger : (r.diff > 0 ? theme.color.success : theme.color.text) },
            { header: 'Wert gezählt', width: 75, align: 'right', render: r => this._fmtEUR(physVal(r)) },
            { header: 'Diff. Wert', width: 75, align: 'right', render: r => this._fmtSigned(r.diffValue), color: r => r.diffValue < 0 ? theme.color.danger : (r.diffValue > 0 ? theme.color.success : theme.color.text) }
          ],
          rows: invRows,
          sumRow: ['Summe', '', '', '', this._fmtEUR(sum(invRows, physVal)), this._fmtSigned(sum(invRows, r => r.diffValue))],
          emptyHint: 'Keine Bestandsdaten.',
          headerInfo
        });
        const invHints = [];
        if (negCount) invHints.push(`(!) Bestand negativ: Wareneingang nicht gebucht? ${negCount} ${negCount === 1 ? 'Artikel hat' : 'Artikel haben'} einen negativen Bestand und ${negCount === 1 ? 'ist' : 'sind'} mit 0,00 € bewertet. Ein negativer Bestand heißt fast immer, dass ein Wareneingang (Lieferschein/Rechnung) nicht gebucht wurde.`);
        if (hiddenInactive) invHints.push(`${hiddenInactive} deaktivierte Artikel ohne Bestand sind nicht aufgeführt.`);
        if (invHints.length) this._note(doc, theme, invHints.join(' '));
        // Lesehilfe für die Kassenprüfung: was Plus und Minus bedeuten
        this._note(doc, theme, 'Differenz = gezählt minus laut App. Plus: mehr da als gebucht (z. B. geschenkte Ware oder Einkauf ohne Lieferschein/Rechnung). '
          + 'Minus: fehlt gegenüber den Buchungen (z. B. getrunken, verschenkt oder weggeschüttet ohne Buchung „Auf den Wirt“/„Abgelaufen“, nicht gebuchter Verkauf). '
          + 'Bewertet zum Verkaufspreis.');
        if (draft) {
          this._note(doc, theme, 'Im Entwurf entspricht der gezählte Bestand dem Bestand laut App; die Inventur wird erst beim Abschluss erfasst.');
        }

        // ---------- SCHWUND & EIGENVERBRAUCH ----------
        this._section(doc, theme, 'Abgelaufen / Schwund', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 300, render: r => r.article },
            { header: 'Menge', width: 100, align: 'right', render: r => this._fmtQty(r.quantity, r.unit) },
            { header: 'Warenwert', width: 100, align: 'right', render: r => this._fmtEUR(r.value) }
          ],
          rows: s.expiredArticles || [],
          sumRow: ['Summe', this._fmtNum(sum(s.expiredArticles, r => r.quantity)), this._fmtEUR(sum(s.expiredArticles, r => r.value))],
          emptyHint: 'Keine abgelaufenen Artikel.',
          headerInfo
        });

        this._section(doc, theme, 'Eigenverbrauch (Sachentnahme, "Auf den Wirt")', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 300, render: r => r.article },
            { header: 'Menge', width: 100, align: 'right', render: r => this._fmtQty(r.quantity, r.unit) },
            { header: 'Warenwert', width: 100, align: 'right', render: r => this._fmtEUR(r.value) }
          ],
          rows: s.ownerUseArticles || [],
          sumRow: ['Summe', this._fmtNum(sum(s.ownerUseArticles, r => r.quantity)), this._fmtEUR(sum(s.ownerUseArticles, r => r.value))],
          emptyHint: 'Kein Eigenverbrauch.',
          headerInfo
        });

        // ---------- DETAILLISTEN ----------
        this._section(doc, theme, 'Einnahmen nach Artikel', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 240, render: r => r.article },
            { header: 'Kategorie', width: 160, render: r => r.category || '-' },
            { header: 'Menge', width: 80, align: 'right', render: r => this._fmtNum(r.quantity) },
            { header: 'Betrag', width: 100, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: s.soldArticles || [],
          sumRow: ['Summe', '', this._fmtNum(sum(s.soldArticles, r => r.quantity)), this._fmtEUR(sum(s.soldArticles, r => r.amount))],
          emptyHint: 'Keine Verkäufe.',
          headerInfo
        });

        this._section(doc, theme, 'Bezahlte Kundenrechnungen', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Rechnung', width: 100, render: r => r.invoiceNumber || '-' },
            { header: 'Empfänger', width: 170, render: r => r.customerName || '-' },
            { header: 'Beschreibung', width: 150, render: r => r.description || '-' },
            { header: 'Bezahlt am', width: 80, render: r => this._fmtDate(r.paidAt) },
            { header: 'Betrag', width: 90, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.success }
          ],
          rows: s.paidInvoices || [],
          sumRow: ['Summe', '', '', '', this._fmtEUR(sum(s.paidInvoices, r => r.totalAmount))],
          emptyHint: 'Keine bezahlten Kundenrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgabenbelege (bezahlte Lieferantenrechnungen)', headerInfo);
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 75, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 160, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 110, render: r => r.documentNumber || '-' },
            { header: 'Zahlung', width: 75, render: r => this._paymentLabel(r.paymentMethod) },
            { header: 'Nachweis', width: 60, align: 'center', render: r => r.nachweisUrl ? 'Ja' : 'Nein' },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: s.expenseDocs || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(sum(s.expenseDocs, r => r.totalAmount))],
          emptyHint: 'Keine Ausgabenbelege.',
          headerInfo
        });

        // ---------- UNTERSCHRIFTEN ----------
        this._signatureBlock(doc, theme, ['Kassenwart/in', 'Kassenprüfer/in 1', 'Kassenprüfer/in 2'], headerInfo);

        // ---------- NACHTRAG: NACHTRÄGLICHE ÄNDERUNGEN (live) ----------
        if (post) {
          const annexHeader = {
            ...headerInfo,
            subtitle: `Geschäftsjahr ${fiscalYear.name} (${periodLabel}) · Nachtrag, Datenstand live vom ${this._fmtDateTime(post.generatedAt)}`
          };
          this._addPageDecorated(doc, theme, annexHeader);
          this._section(doc, theme, 'Nachträgliche Änderungen nach dem Abschluss', annexHeader);
          this._note(doc, theme, `Dieser Nachtrag wird bei jedem Abruf des Berichts live erzeugt (${this._fmtDateTime(post.generatedAt)}). `
            + `Alle Zahlen davor sind eingefroren (Abschluss vom ${this._fmtDateTime(s.closedAt)}). Änderungen an Buchungen dieses Geschäftsjahres nach dem Abschluss `
            + 'sind nur nach ausdrücklicher Bestätigung möglich und werden hier mit Zeitpunkt, Benutzer und Auswirkung aufgeführt.');

          this._subheading(doc, theme, 'Vergleich laut Abschluss / aktueller Datenstand');
          this._table(doc, theme, {
            columns: [
              { header: 'Position', width: 190, render: r => r.label },
              { header: 'Laut Abschluss', width: 110, align: 'right', render: r => this._fmtEUR(r.closed) },
              { header: 'Aktueller Datenstand', width: 120, align: 'right', render: r => this._fmtEUR(r.live) },
              { header: 'Abweichung', width: 100, align: 'right', render: r => this._fmtSigned(r.diff), color: r => diffColor(r.diff) }
            ],
            rows: post.cmpRows,
            headerInfo: annexHeader
          });
          this._kvList(doc, theme, [
            { label: 'Abweichung Überschuss (aktuell - Abschluss)', value: this._fmtSigned(post.profitDiff), bold: true, color: diffColor(post.profitDiff) },
            { label: `davon durch protokollierte Änderungen (${post.entries.length})`, value: this._fmtSigned(post.loggedEffect) },
            { label: 'davon ohne protokollierte Änderung', value: this._fmtSigned(post.unexplained), bold: true, color: diffColor(post.unexplained), rule: true }
          ], { headerInfo: annexHeader, keepTogether: true });
          if (Math.abs(post.unexplained) >= 0.005) {
            this._note(doc, theme, 'Abweichung ohne protokollierte Änderung: Sie ist vor Einführung der Sperre für abgeschlossene Jahre oder außerhalb der App '
              + '(z. B. direkt in der Datenbank) entstanden. Bitte anhand der Buchungen dieses Zeitraums klären.');
          }

          this._subheading(doc, theme, `Protokollierte Änderungen (${post.entries.length})`);
          this._table(doc, theme, {
            columns: [
              { header: 'Zeitpunkt', width: 88, render: r => this._fmtDateTime(r.createdAt) },
              { header: 'Benutzer', width: 80, render: r => (r.user && r.user.name) || '—' },
              // Standardschrift kennt keinen Pfeil (→), daher ersetzen
              { header: 'Änderung', width: 270, render: r => `${(r.changes && r.changes.operation) ? `${r.changes.operation}: ` : ''}${(r.changes && r.changes.description) || ''}`.replace(/→/g, '->') },
              {
                header: 'Auswirkung Überschuss', width: 82, align: 'right',
                render: r => (r.changes && r.changes.effect != null) ? this._fmtSigned(r.changes.effect) : 'ergebnisneutral',
                color: r => (r.changes && r.changes.effect != null) ? diffColor(r.changes.effect) : theme.color.subtext
              }
            ],
            rows: post.entries,
            sumRow: post.entries.length ? ['Summe', '', '', this._fmtSigned(post.loggedEffect)] : null,
            emptyHint: 'Keine protokollierten Änderungen nach dem Abschluss.',
            headerInfo: annexHeader
          });
          this._note(doc, theme, '„Ergebnisneutral“: Die Änderung betrifft Gästeguthaben, Bank-Kontostände, Entwürfe oder Eigenverbrauch/Schwund, nicht Einnahmen oder Ausgaben. '
            + 'Offline gebuchte Verkäufe/Aufladungen, die erst nach dem Abschluss übertragen wurden, erscheinen als „Offline-Nachbuchung“.');
        }

        this._finishDoc(doc, theme, headerInfo);
        done.then(pdf => resolve({
          data: pdf,
          filename: `jahresabschluss_${String(fiscalYear.name).replace(/\s+/g, '_')}${draft ? '_ENTWURF' : ''}.pdf`,
          mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= HELPERS ========= */
  async getDailySummaryData(date, startHour) {
    const transactionService = require('./transactionService');
    return transactionService.getDailySummary(date, startHour);
  }

  getMonthName(month) {
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    return months[month - 1];
  }
}

module.exports = new ExportService();
