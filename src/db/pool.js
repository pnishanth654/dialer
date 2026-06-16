import pg from 'pg';
import { config, hasDb } from '../config.js';

let pool = null;

if (hasDb()) {
    pool = new pg.Pool({
        connectionString: config.databaseUrl,
        // Neon / Supabase require TLS; allow self-signed chains from poolers.
        ssl: config.databaseUrl.includes('sslmode=disable')
            ? false
            : { rejectUnauthorized: false },
        max: 5,
    });
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
}

/** Throws a clear error if a DB route is hit without DATABASE_URL configured. */
export function db() {
    if (!pool) {
        const e = new Error('DATABASE_URL is not configured — set it in server/.env');
        e.status = 503;
        throw e;
    }
    return pool;
}

export const query = (text, params) => db().query(text, params);
export { pool };
