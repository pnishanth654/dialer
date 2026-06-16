import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth.js';
import {
    insertCalls, summaries, timeline, allCalls,
    companies, companyTimeline, getMeta, setMeta, callLog,
    getMe, listAccounts, createAccount, setAccountLabel, deleteAccount,
} from '../services/callService.js';
import { runBackup, listBackups, restoreBackup } from '../services/backupService.js';
import { buildExport } from '../services/exportService.js';
import { importCsv, importCalls } from '../services/importService.js';

export const api = Router();
api.use(auth);
// Accept raw CSV bodies for the import endpoint.
api.use((req, res, next) => {
    if (req.is('text/csv') || req.is('text/plain')) {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (c) => { data += c; });
        req.on('end', () => { req.rawBody = data; next(); });
    } else next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Sync ---

// Push a batch of calls from the phone. Dedup-safe.
api.post('/sync/calls', wrap(async (req, res) => {
    const result = await insertCalls(req.userId, req.body?.calls || []);
    res.json(result);
}));

// Pull all calls (e.g. restoring a freshly installed phone). ?since=<epochMs>
api.get('/calls', wrap(async (req, res) => {
    const since = Number(req.query.since) || 0;
    res.json({ calls: await allCalls(req.userId, since) });
}));

// Chronological call log for the dashboard. ?limit= &offset= &since= &dir= &q=
api.get('/calllog', wrap(async (req, res) => {
    res.json({
        calls: await callLog(req.userId, {
            limit: req.query.limit,
            offset: req.query.offset,
            since: req.query.since,
            dir: req.query.dir,
            q: req.query.q,
        }),
    });
}));

// --- Search / history (also powers the web dashboard in Phase 3) ---

api.get('/contacts', wrap(async (req, res) => {
    res.json({ contacts: await summaries(req.userId, req.query.q) });
}));

api.get('/search', wrap(async (req, res) => {
    res.json({ contacts: await summaries(req.userId, req.query.q || '') });
}));

api.get('/contacts/:normalized/timeline', wrap(async (req, res) => {
    res.json({ calls: await timeline(req.userId, req.params.normalized) });
}));

// --- Contact metadata (tags, company grouping) ---

api.get('/contacts/:normalized/meta', wrap(async (req, res) => {
    res.json({ meta: await getMeta(req.userId, req.params.normalized) });
}));

api.put('/contacts/:normalized/meta', wrap(async (req, res) => {
    res.json({ meta: await setMeta(req.userId, req.params.normalized, req.body || {}) });
}));

api.get('/companies', wrap(async (req, res) => {
    res.json({ companies: await companies(req.userId) });
}));

api.get('/companies/:name/timeline', wrap(async (req, res) => {
    res.json(await companyTimeline(req.userId, req.params.name));
}));

// --- Import / export ---

// Accepts either raw CSV (Content-Type text/csv) or JSON { calls: [...] }.
api.post('/import', wrap(async (req, res) => {
    if (req.rawBody) return res.json(await importCsv(req.userId, req.rawBody));
    if (req.body?.csv) return res.json(await importCsv(req.userId, req.body.csv));
    res.json(await importCalls(req.userId, req.body?.calls || []));
}));

api.get('/export.:format', wrap(async (req, res) => {
    const { filename, contentType, buffer } = await buildExport(req.userId, req.params.format);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
}));

// --- Account (who am I) + admin account management ---

api.get('/me', wrap(async (req, res) => {
    res.json({ ...(await getMe(req.userId)), admin: req.isAdmin });
}));

api.get('/admin/accounts', adminOnly, wrap(async (req, res) => {
    res.json({ accounts: await listAccounts() });
}));

api.post('/admin/accounts', adminOnly, wrap(async (req, res) => {
    res.json({ account: await createAccount(req.body?.label, req.body?.key) });
}));

api.put('/admin/accounts/:id', adminOnly, wrap(async (req, res) => {
    res.json({ account: await setAccountLabel(req.params.id, req.body?.label) });
}));

api.delete('/admin/accounts/:id', adminOnly, wrap(async (req, res) => {
    res.json(await deleteAccount(req.params.id));
}));

// --- Web3 backup ---

api.post('/backup/web3', wrap(async (req, res) => {
    res.json(await runBackup(req.userId));
}));

api.get('/backup/web3', wrap(async (req, res) => {
    res.json({ backups: await listBackups(req.userId) });
}));

api.post('/restore/web3/:cid', wrap(async (req, res) => {
    res.json(await restoreBackup(req.userId, req.params.cid));
}));
