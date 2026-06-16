import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { exportRows } from './callService.js';

const HEADERS = ['Date', 'Time', 'Contact', 'Company', 'Number', 'Direction', 'Duration (sec)', 'SIM'];

function fmtDate(d) {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d) {
    return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function rowValues(r) {
    return [
        fmtDate(r.startTime), fmtTime(r.startTime), r.contactName || '', r.company || '',
        r.number, r.direction, r.durationSec, r.simSlot ?? '',
    ];
}

export async function exportCsv(userId) {
    const rows = await exportRows(userId);
    const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [HEADERS.join(',')];
    for (const r of rows) lines.push(rowValues(r).map(esc).join(','));
    return {
        filename: 'call-history.csv',
        contentType: 'text/csv; charset=utf-8',
        buffer: Buffer.from(lines.join('\n'), 'utf8'),
    };
}

export async function exportXlsx(userId) {
    const rows = await exportRows(userId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Call History');
    ws.columns = HEADERS.map((h) => ({ header: h, width: h.length + 6 }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(rowValues(r));
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
        filename: 'call-history.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
    };
}

export async function exportPdf(userId) {
    const rows = await exportRows(userId);
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', resolve));

    doc.fontSize(16).text('Business Dialer — Call History', { align: 'center' });
    doc.fontSize(9).fillColor('#666')
        .text(`${rows.length} calls · generated ${fmtDate(Date.now())}`, { align: 'center' });
    doc.moveDown().fillColor('#000');

    rows.forEach((r) => {
        const name = r.contactName || r.number;
        const co = r.company ? ` · ${r.company}` : '';
        const dur = r.durationSec > 0 ? ` · ${r.durationSec}s` : '';
        doc.fontSize(9).text(
            `${fmtDate(r.startTime)} ${fmtTime(r.startTime)}  —  ${name}${co}  [${r.direction}${dur}]`
        );
    });

    doc.end();
    await done;
    return {
        filename: 'call-history.pdf',
        contentType: 'application/pdf',
        buffer: Buffer.concat(chunks),
    };
}

export async function buildExport(userId, format) {
    switch (format) {
        case 'csv': return exportCsv(userId);
        case 'xlsx': return exportXlsx(userId);
        case 'pdf': return exportPdf(userId);
        default: {
            const e = new Error(`unknown export format: ${format}`);
            e.status = 400;
            throw e;
        }
    }
}
