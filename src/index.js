import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, hasDb } from './config.js';
import { api } from './routes/api.js';
import { scheduleDailyBackup } from './jobs/dailyBackup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '20mb' }));

// Web dashboard (Phase 3) served from /public
app.use(express.static(join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        db: hasDb(),
        web3Provider: config.web3Provider,
        encryptionConfigured: Boolean(config.backupEncryptionKey),
    });
});

app.use('/api', api);

// Central error handler — surfaces a clean JSON error + status.
app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: err.message || 'internal error' });
});

app.listen(config.port, () => {
    console.log(`[server] Business Dialer API on http://localhost:${config.port}`);
    console.log(`[server] db=${hasDb()} web3=${config.web3Provider}`);
    scheduleDailyBackup();
});
