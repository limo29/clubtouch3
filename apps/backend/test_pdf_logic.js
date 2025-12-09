const PDFDocument = require('pdfkit');
const fs = require('fs');

class MockExportService {
    constructor() {
        this.currencyFmt = new Intl.NumberFormat('de-DE', {
            style: 'currency', currency: 'EUR',
            minimumFractionDigits: 2, maximumFractionDigits: 2
        });
    }

    getTheme() {
        return {
            brandName: 'Clubraum',
            page: { margin: 50, size: 'A4' },
            font: { regular: 'Helvetica', bold: 'Helvetica-Bold' },
            color: {
                text: '#0f172a', subtext: '#475569',
                primary: '#2563eb', border: '#e2e8f0',
                tableHeaderBg: '#f1f5f9', tableHeaderText: '#334155',
                zebra: '#f8fafc', panelBg: '#f8fafc',
                success: '#16a34a', danger: '#dc2626'
            }
        };
    }

    _createDocWithBuffer() {
        const theme = this.getTheme();
        const doc = new PDFDocument({
            margin: theme.page.margin, size: theme.page.size, bufferPages: true
        });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
        doc.pipe(fs.createWriteStream('debug_output.pdf')); // Also write to file for manual check if needed
        return { doc, done, theme };
    }

    _decoratePage(doc, theme, { title, subtitle }) {
        this._lastHeaderInfo = { title, subtitle };
        const { margin } = theme.page;
        const pageWidth = doc.page.width;

        doc.save().lineWidth(1).strokeColor(theme.color.border)
            .moveTo(margin, margin - 15).lineTo(pageWidth - margin, margin - 15).stroke().restore();

        doc.fillColor(theme.color.primary).font(theme.font.bold).fontSize(18)
            .text(title || '', margin, margin - 40, { width: pageWidth - margin * 2, align: 'left' });

        if (subtitle) {
            doc.fillColor(theme.color.subtext).font(theme.font.regular).fontSize(10)
                .text(subtitle, { width: pageWidth - margin * 2, align: 'left' });
        }

        doc.y = theme.page.margin + 10;
        doc.x = theme.page.margin;
        doc.fillColor(theme.color.text).font(theme.font.regular);
    }

    _addPageDecorated(doc, theme, headerInfo) {
        console.log('Adding new page manually. Current Page Count:', doc.bufferedPageRange().count);
        doc.addPage();
        this._decoratePage(doc, theme, headerInfo);
    }

    _table(doc, theme, { columns, rows, sumRow = null, emptyHint = 'Keine Daten vorhanden', headerInfo }) {
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
                doc.fillColor(theme.color.tableHeaderText).font(this.getTheme().font.bold).fontSize(10)
                    .text(col.header, x + 2, y, { width: widths[idx] - 4, align: col.align || 'left' });
                x += widths[idx];
            });
            doc.moveTo(left, y + headerH + rowPad).lineTo(right, y + headerH + rowPad)
                .lineWidth(0.5).strokeColor(theme.color.border).stroke();
            doc.y = y + headerH + rowPad + 2;
            doc.fillColor(theme.color.text).font(theme.font.regular);
        };

        const ensureRoom = (need) => {
            const bottom = doc.page.height - theme.page.margin;
            // console.log(`Checking room: y=${doc.y}, need=${need}, bottom=${bottom}`);
            if (doc.y + need > bottom) {
                console.log(`Not enough room. y=${doc.y} + ${need} > ${bottom}. Adding page.`);
                this._addPageDecorated(doc, theme, headerInfo || this._lastHeaderInfo || {});
                renderHeader();
            }
        };

        renderHeader();

        if (!rows || rows.length === 0) {
            ensureRoom(22);
            doc.fontSize(10).fillColor(theme.color.subtext).text(emptyHint, left, doc.y + 6);
            doc.moveDown(1); doc.x = theme.page.margin; return;
        }

        rows.forEach((row, i) => {
            // Zeilenhöhe bestimmen
            const heights = columns.map((col, idx) => {
                const txt = col.render ? col.render(row) : (row[col.key] ?? '');
                // Explicitly set font for strict measurement
                doc.font(theme.font.regular).fontSize(10);
                return Math.max(doc.heightOfString(String(txt ?? ''), { width: widths[idx] - 4 }), 10);
            });
            const rowH = Math.max(...heights) + rowPad * 2;

            ensureRoom(rowH + 20);

            // Zebra
            if (i % 2 === 0) doc.save().rect(left, doc.y - 2, usableWidth, rowH + 4).fill(theme.color.zebra).restore();

            // Zellen
            let x = left; const baseY = doc.y + rowPad;
            columns.forEach((col, idx) => {
                const txt = col.render ? col.render(row) : (row[col.key] ?? '');
                const color = typeof col.color === 'function' ? col.color(row) : theme.color.text;
                doc.fillColor(color).font(theme.font.regular).fontSize(10)
                    .text(String(txt ?? ''), x + 2, baseY, { width: widths[idx] - 4, align: col.align || 'left' });
                x += widths[idx];
            });

            doc.moveTo(left, baseY + (rowH - rowPad)).lineTo(right, baseY + (rowH - rowPad))
                .lineWidth(0.3).strokeColor('#eef2f7').stroke();

            doc.y = baseY + (rowH - rowPad) + 2;
        });

        console.log('Finished table. Final y:', doc.y);
    }

    async runTest() {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = { title: 'Test PDF', subtitle: 'Reproduction Check' };
        this._decoratePage(doc, theme, headerInfo);

        console.log('Generating dummy rows...');
        const rows = Array.from({ length: 150 }).map((_, i) => ({
            name: `Article ${i} with a name that might be long enough to cause issues if we are unlucky with wrapping logic or something like that`,
            unit: 'Stk',
            systemQty: 123.45 + i
        }));

        // "Bestand laut System" simulation
        this._table(doc, theme, {
            columns: [
                { header: 'Artikel', width: 320, render: r => r.name },
                { header: 'Einheit', width: 120, render: r => r.unit || '-' },
                { header: 'System', width: 120, align: 'right', render: r => Number(r.systemQty || 0).toFixed(2) }
            ],
            rows: rows,
            headerInfo
        });

        doc.end();
        await done;
        console.log('PDF generated successfully.');
    }
}

new MockExportService().runTest().catch(console.error);
