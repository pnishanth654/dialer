import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
    const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
    await db().query(sql);
    console.log('[migrate] schema applied');
}

// Allow `npm run migrate` (robust on Windows: compare normalized file URLs)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    migrate()
        .then(() => process.exit(0))
        .catch((e) => {
            console.error('[migrate] failed:', e.message);
            process.exit(1);
        });
}
