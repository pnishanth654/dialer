import { insertCalls, normalize } from './callService.js';

/** Minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines in fields). */
export function parseCsv(text) {
    const rows = [];
    let field = '', row = [], inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') pushField();
        else if (ch === '\n') pushRow();
        else if (ch === '\r') { /* skip */ }
        else field += ch;
    }
    if (field.length || row.length) pushRow();
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const pick = (header, names) =>
    header.findIndex((h) => names.includes(h.trim().toLowerCase()));

function toDirection(raw) {
    const v = String(raw).trim().toLowerCase();
    if (/^\d+$/.test(v)) {
        // Android CallLog.Calls.TYPE codes
        return { 1: 'INCOMING', 2: 'OUTGOING', 3: 'MISSED', 4: 'MISSED', 5: 'REJECTED', 6: 'REJECTED' }[v] || 'OUTGOING';
    }
    if (v.includes('miss')) return 'MISSED';
    if (v.includes('reject') || v.includes('declin') || v.includes('block')) return 'REJECTED';
    if (v.includes('in')) return 'INCOMING';
    return 'OUTGOING';
}

function toEpochMs(raw) {
    const v = String(raw).trim();
    if (/^\d+$/.test(v)) {
        const n = Number(v);
        return v.length <= 10 ? n * 1000 : n; // seconds vs millis
    }
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function toSeconds(raw) {
    const v = String(raw).trim();
    if (/^\d+$/.test(v)) return Number(v);
    const m = v.match(/^(\d+):(\d{1,2})$/); // mm:ss
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    return 0;
}

/** Map arbitrary call-log CSV rows to our call shape using fuzzy header matching. */
export function mapCsvToCalls(rows) {
    if (rows.length < 2) return [];
    const header = rows[0];
    const iNum = pick(header, ['number', 'phone', 'phone number', 'phonenumber', 'msisdn']);
    const iName = pick(header, ['name', 'contact', 'contact name', 'cachedname']);
    const iDate = pick(header, ['date', 'time', 'datetime', 'timestamp', 'date/time', 'call date']);
    const iType = pick(header, ['type', 'direction', 'call type', 'calltype']);
    const iDur = pick(header, ['duration', 'duration (sec)', 'seconds', 'length']);

    const out = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const number = iNum >= 0 ? row[iNum]?.trim() : '';
        if (!number) continue;
        out.push({
            number,
            normalizedNumber: normalize(number),
            contactName: iName >= 0 ? (row[iName]?.trim() || null) : null,
            direction: iType >= 0 ? toDirection(row[iType]) : 'OUTGOING',
            startTime: iDate >= 0 ? toEpochMs(row[iDate]) : Date.now(),
            durationSec: iDur >= 0 ? toSeconds(row[iDur]) : 0,
        });
    }
    return out;
}

export async function importCsv(userId, text) {
    const calls = mapCsvToCalls(parseCsv(text));
    return insertCalls(userId, calls);
}

export async function importCalls(userId, calls) {
    return insertCalls(userId, calls || []);
}
