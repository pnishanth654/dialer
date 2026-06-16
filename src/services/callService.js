import { query } from '../db/pool.js';
import { config } from '../config.js';

/** Mirror of the Android PhoneNumbers.normalize: digits only, last 10. */
export function normalize(raw) {
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}

let cachedDefaultUserId = null;
const keyCache = new Map(); // apiKey -> userId

export async function getDefaultUserId() {
    if (cachedDefaultUserId) return cachedDefaultUserId;
    const r = await query(
        `INSERT INTO users (email) VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [config.defaultUserEmail]
    );
    cachedDefaultUserId = r.rows[0].id;
    return cachedDefaultUserId;
}

/**
 * Resolves the account for a request. With an api key, each distinct key is its own
 * isolated account (created on first use). Without a key, falls back to the default user
 * (only reachable when REQUIRE_API_KEY is off — i.e. local dev).
 */
export async function resolveUserId(apiKey) {
    const key = (apiKey || '').trim();
    if (!key) return getDefaultUserId();
    if (keyCache.has(key)) return keyCache.get(key);
    const r = await query(
        `INSERT INTO users (api_key) VALUES ($1)
         ON CONFLICT (api_key) DO UPDATE SET api_key = EXCLUDED.api_key
         RETURNING id`,
        [key]
    );
    const id = r.rows[0].id;
    keyCache.set(key, id);
    return id;
}

/**
 * Upsert a batch of calls. Dedup is enforced by the calls_dedup unique index, so syncing
 * the same calls repeatedly is safe. Returns { received, inserted, skipped }.
 */
export async function insertCalls(userId, calls) {
    if (!Array.isArray(calls) || calls.length === 0) {
        return { received: 0, inserted: 0, skipped: 0 };
    }

    const cols = [
        'user_id', 'device_id', 'client_uuid', 'number', 'normalized_number',
        'contact_name', 'company', 'direction', 'start_time', 'duration_sec', 'sim_slot',
    ];

    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < calls.length; i += CHUNK) {
        const slice = calls.slice(i, i + CHUNK);
        const values = [];
        const rows = slice.map((c, idx) => {
            const base = idx * cols.length;
            const startMs = Number(c.startTime);
            values.push(
                userId,
                c.deviceId ?? null,
                c.clientUuid ?? null,
                c.number,
                c.normalizedNumber || normalize(c.number),
                c.contactName ?? null,
                c.company ?? null,
                c.direction,
                new Date(startMs).toISOString(),
                Number(c.durationSec) || 0,
                c.simSlot ?? null
            );
            const ph = cols.map((_, k) => `$${base + k + 1}`).join(', ');
            return `(${ph})`;
        });

        const res = await query(
            `INSERT INTO calls (${cols.join(', ')}) VALUES ${rows.join(', ')}
             ON CONFLICT DO NOTHING`,
            values
        );
        inserted += res.rowCount;
    }

    return { received: calls.length, inserted, skipped: calls.length - inserted };
}

// Summaries blend the call log with per-number overrides from the `contacts` table
// (saved display name / company) and surface the contact tag.
const SUMMARY_SELECT = `
    SELECT calls.normalized_number AS "normalizedNumber",
           MAX(calls.number) AS number,
           MAX(COALESCE(c.display_name, calls.contact_name)) AS "contactName",
           MAX(COALESCE(c.company, calls.company)) AS company,
           MAX(c.tag) AS tag,
           COUNT(*)::int AS "totalCalls",
           (EXTRACT(EPOCH FROM MIN(calls.start_time)) * 1000)::bigint AS "firstCallTime",
           (EXTRACT(EPOCH FROM MAX(calls.start_time)) * 1000)::bigint AS "lastCallTime",
           SUM(CASE WHEN direction = 'INCOMING' THEN 1 ELSE 0 END)::int AS "incomingCount",
           SUM(CASE WHEN direction = 'OUTGOING' THEN 1 ELSE 0 END)::int AS "outgoingCount",
           SUM(CASE WHEN direction IN ('MISSED','REJECTED') THEN 1 ELSE 0 END)::int AS "missedCount"
    FROM calls
    LEFT JOIN contacts c
      ON c.user_id = calls.user_id AND c.normalized_number = calls.normalized_number
    WHERE calls.user_id = $1`;

export async function summaries(userId, search) {
    if (search && search.trim()) {
        const like = `%${search.trim()}%`;
        const r = await query(
            `${SUMMARY_SELECT}
               AND (COALESCE(c.display_name, calls.contact_name) ILIKE $2
                    OR COALESCE(c.company, calls.company) ILIKE $2
                    OR calls.number ILIKE $2
                    OR calls.normalized_number ILIKE $2
                    OR c.tag ILIKE $2)
             GROUP BY calls.normalized_number
             ORDER BY MAX(calls.start_time) DESC`,
            [userId, like]
        );
        return r.rows;
    }
    const r = await query(
        `${SUMMARY_SELECT} GROUP BY calls.normalized_number ORDER BY MAX(calls.start_time) DESC`,
        [userId]
    );
    return r.rows;
}

// Effective company per call = contact override, else the company captured with the call.
const EFFECTIVE_CALLS = `
    SELECT calls.*, COALESCE(c.company, calls.company) AS eff_company,
           COALESCE(c.display_name, calls.contact_name) AS eff_name
    FROM calls
    LEFT JOIN contacts c
      ON c.user_id = calls.user_id AND c.normalized_number = calls.normalized_number
    WHERE calls.user_id = $1`;

/** Companies grouped from calls + overrides, with contact and call counts. */
export async function companies(userId) {
    const r = await query(
        `SELECT eff_company AS company,
                COUNT(DISTINCT normalized_number)::int AS "contactCount",
                COUNT(*)::int AS "totalCalls",
                (EXTRACT(EPOCH FROM MAX(start_time)) * 1000)::bigint AS "lastCallTime"
         FROM (${EFFECTIVE_CALLS}) t
         WHERE eff_company IS NOT NULL AND eff_company <> ''
         GROUP BY eff_company
         ORDER BY MAX(start_time) DESC`,
        [userId]
    );
    return r.rows;
}

/** Combined timeline for every contact at a company + the roster of those contacts. */
export async function companyTimeline(userId, company) {
    const calls = await query(
        `SELECT number, eff_name AS "contactName", normalized_number AS "normalizedNumber",
                direction, (EXTRACT(EPOCH FROM start_time) * 1000)::bigint AS "startTime",
                duration_sec AS "durationSec"
         FROM (${EFFECTIVE_CALLS}) t
         WHERE eff_company = $2
         ORDER BY start_time DESC`,
        [userId, company]
    );
    const roster = await query(
        `SELECT normalized_number AS "normalizedNumber",
                MAX(eff_name) AS "contactName",
                COUNT(*)::int AS "totalCalls"
         FROM (${EFFECTIVE_CALLS}) t
         WHERE eff_company = $2
         GROUP BY normalized_number
         ORDER BY MAX(start_time) DESC`,
        [userId, company]
    );
    return { company, contacts: roster.rows, calls: calls.rows };
}

export async function getMeta(userId, normalized) {
    const r = await query(
        `SELECT normalized_number AS "normalizedNumber", display_name AS "displayName",
                company, department, designation, tag, notes
         FROM contacts WHERE user_id = $1 AND normalized_number = $2`,
        [userId, normalized]
    );
    return r.rows[0] || null;
}

export async function setMeta(userId, normalized, m) {
    const r = await query(
        `INSERT INTO contacts (user_id, normalized_number, display_name, company, department, designation, tag, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (user_id, normalized_number) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            company      = EXCLUDED.company,
            department   = EXCLUDED.department,
            designation  = EXCLUDED.designation,
            tag          = EXCLUDED.tag,
            notes        = EXCLUDED.notes,
            updated_at   = now()
         RETURNING normalized_number AS "normalizedNumber", display_name AS "displayName",
                   company, department, designation, tag, notes`,
        [userId, normalized, m.displayName ?? null, m.company ?? null, m.department ?? null,
         m.designation ?? null, m.tag ?? null, m.notes ?? null]
    );
    return r.rows[0];
}

/**
 * Chronological call log (newest first) with optional filters so large histories stay
 * manageable. opts: { limit, offset, since(ms), dir(ALL|INCOMING|OUTGOING|MISSEDREJ), q }.
 */
export async function callLog(userId, opts = {}) {
    const limit = Math.min(Number(opts.limit) || 100, 2000);
    const offset = Number(opts.offset) || 0;
    const params = [userId];
    const where = [];

    if (opts.since) {
        params.push(Number(opts.since));
        where.push(`start_time >= to_timestamp($${params.length} / 1000.0)`);
    }
    if (opts.dir && opts.dir !== 'ALL') {
        if (opts.dir === 'MISSEDREJ') {
            where.push(`direction IN ('MISSED','REJECTED')`);
        } else {
            params.push(opts.dir);
            where.push(`direction = $${params.length}`);
        }
    }
    if (opts.q && String(opts.q).trim()) {
        params.push(`%${String(opts.q).trim()}%`);
        const i = params.length;
        where.push(`(eff_name ILIKE $${i} OR eff_company ILIKE $${i} OR number ILIKE $${i})`);
    }
    params.push(limit); const li = params.length;
    params.push(offset); const oi = params.length;
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const r = await query(
        `SELECT eff_name AS "contactName", eff_company AS company, number,
                normalized_number AS "normalizedNumber", direction,
                (EXTRACT(EPOCH FROM start_time) * 1000)::bigint AS "startTime",
                duration_sec AS "durationSec", sim_slot AS "simSlot"
         FROM (${EFFECTIVE_CALLS}) t
         ${clause}
         ORDER BY start_time DESC
         LIMIT $${li} OFFSET $${oi}`,
        params
    );
    return r.rows;
}

/** Flat rows for CSV/Excel/PDF export, newest first. */
export async function exportRows(userId) {
    const r = await query(
        `SELECT eff_name AS "contactName", eff_company AS company, number, direction,
                start_time AS "startTime", duration_sec AS "durationSec", sim_slot AS "simSlot"
         FROM (${EFFECTIVE_CALLS}) t
         ORDER BY start_time DESC`,
        [userId]
    );
    return r.rows;
}

export async function timeline(userId, normalized) {
    const r = await query(
        `SELECT number, contact_name AS "contactName", company, direction,
                (EXTRACT(EPOCH FROM start_time) * 1000)::bigint AS "startTime",
                duration_sec AS "durationSec", sim_slot AS "simSlot"
         FROM calls
         WHERE user_id = $1 AND normalized_number = $2
         ORDER BY start_time DESC`,
        [userId, normalized]
    );
    return r.rows;
}

/** Full pull for restoring a new phone, or for backup serialization. */
export async function allCalls(userId, sinceMs = 0) {
    const r = await query(
        `SELECT number, normalized_number AS "normalizedNumber", contact_name AS "contactName",
                company, direction,
                (EXTRACT(EPOCH FROM start_time) * 1000)::bigint AS "startTime",
                duration_sec AS "durationSec", sim_slot AS "simSlot",
                client_uuid AS "clientUuid", device_id AS "deviceId"
         FROM calls
         WHERE user_id = $1 AND start_time >= to_timestamp($2 / 1000.0)
         ORDER BY start_time ASC`,
        [userId, sinceMs]
    );
    return r.rows;
}
