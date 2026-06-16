// Lists tables + row counts so we can confirm the schema applied. Run after migrate.
import { db } from './pool.js';

const tables = await db().query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1"
);
console.log('Tables:', tables.rows.map((r) => r.table_name).join(', ') || '(none)');

for (const t of ['users', 'calls', 'contacts', 'web3_backups']) {
    try {
        const c = await db().query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        console.log(`  ${t}: ${c.rows[0].n} rows`);
    } catch (e) {
        console.log(`  ${t}: MISSING (${e.message})`);
    }
}
process.exit(0);
