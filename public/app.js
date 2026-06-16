'use strict';

const TAGS = ['', 'Customer', 'Supplier', 'Vendor', 'Friend', 'Family', 'Dealer', 'Distributor', 'OEM'];
const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#4f46e5', '#0d9488', '#be123c'];

// ---------- API ----------
const apiKey = () => localStorage.getItem('apiKey') || '';
async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (apiKey()) headers['x-api-key'] = apiKey();
    const res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
    return res;
}
const json = (path, opts) => api(path, opts).then((r) => r.json());

// ---------- Format helpers ----------
const fmtDate = (ms) => new Date(Number(ms)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (ms) => new Date(Number(ms)).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
const fmtDur = (s) => (s > 0 ? (s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's') : '—');
const dirClass = (d) => (d === 'INCOMING' ? 'dir-in' : d === 'OUTGOING' ? 'dir-out' : 'dir-missed');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initial = (name) => (String(name).match(/[a-z0-9]/i) || ['#'])[0].toUpperCase();
function avatarColor(s) {
    let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const loadingHTML = '<div class="loading"><span class="spinner"></span></div>';
const emptyHTML = (big, sub) => `<div class="empty"><div class="big">${esc(big)}</div>${sub ? esc(sub) : ''}</div>`;

// ---------- Health + account ----------
async function checkHealth() {
    const el = document.getElementById('health');
    try {
        const h = await fetch('/health').then((r) => r.json());
        el.textContent = h.db ? 'connected' : 'no database';
        el.className = 'status ' + (h.db ? 'ok' : 'bad');
    } catch { el.textContent = 'offline'; el.className = 'status bad'; }
}
let meLabel = null, isAdmin = false;
function updateAccount(suffix) {
    const el = document.getElementById('acct'); const k = apiKey();
    if (!k) { el.textContent = 'no key set'; return; }
    const who = meLabel || (k.length > 12 ? k.slice(0, 10) + '…' : k);
    el.textContent = who + (suffix ? ' · ' + suffix : '');
}
async function loadMe() {
    const nav = document.getElementById('navAccounts');
    nav.style.display = 'none'; meLabel = null; isAdmin = false;
    if (!apiKey()) { updateAccount(); return; }
    try {
        const me = await json('/me');
        meLabel = me.label; isAdmin = me.admin;
        if (isAdmin) nav.style.display = '';
        updateAccount();
    } catch { /* ignore */ }
}
async function loadStats() {
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    if (!apiKey()) { ['stTotal', 'stContacts', 'stMissed', 'stCompanies'].forEach((i) => set(i, '—')); return; }
    try {
        const { contacts } = await json('/contacts');
        const total = contacts.reduce((a, c) => a + c.totalCalls, 0);
        const missed = contacts.reduce((a, c) => a + c.missedCount, 0);
        set('stTotal', total.toLocaleString());
        set('stContacts', contacts.length.toLocaleString());
        set('stMissed', missed.toLocaleString());
        const { companies } = await json('/companies');
        set('stCompanies', companies.length.toLocaleString());
    } catch { /* ignore */ }
}

// ---------- Tabs ----------
document.querySelectorAll('.nav-item').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('view-' + t.dataset.view).classList.add('active');
    refreshView(t.dataset.view);
}));
function refreshView(view) {
    if (view === 'calllog') loadCallLog(true);
    else if (view === 'contacts') loadContacts(document.getElementById('search').value);
    else if (view === 'companies') loadCompanies();
    else if (view === 'accounts') loadAccounts();
}
function activeView() {
    const t = document.querySelector('.nav-item.active');
    return t ? t.dataset.view : 'calllog';
}

// ---------- Call Log (paged + filtered) ----------
const CL_PAGE = 100;
let clOffset = 0, clLoading = false, clDone = false;
let clRange = 'ALL', clDir = 'ALL', clQ = '';
function clSince() {
    const day = 86400000, now = Date.now();
    if (clRange === '7D') return now - 7 * day;
    if (clRange === '30D') return now - 30 * day;
    if (clRange === '1Y') return now - 365 * day;
    return 0;
}
function dirInfo(d) {
    if (d === 'INCOMING') return ['↙', 'Incoming'];
    if (d === 'OUTGOING') return ['↗', 'Outgoing'];
    if (d === 'REJECTED') return ['⊘', 'Rejected'];
    return ['↙', 'Missed'];
}
function callRow(c) {
    const name = c.contactName || c.number;
    const missed = c.direction === 'MISSED' || c.direction === 'REJECTED';
    const cls = dirClass(c.direction);
    const [glyph, label] = dirInfo(c.direction);
    const sub = c.company ? esc(c.company) + ' · ' + esc(c.number) : esc(c.number);
    return `<div class="row" data-n="${esc(c.normalizedNumber)}">
        <div class="callicon ${cls}">${glyph}</div>
        <div class="row-main">
            <div class="row-title ${missed ? 'missed' : ''}">${esc(name)}</div>
            <div class="row-sub">${fmtDate(c.startTime)} · ${fmtTime(c.startTime)} · ${sub}</div>
        </div>
        <div class="row-end">
            <div class="dir-label ${cls}">${label}</div>
            <div class="row-dur">${fmtDur(c.durationSec)}</div>
        </div>
    </div>`;
}
async function loadCallLog(reset = true) {
    const list = document.getElementById('callLogList');
    const more = document.getElementById('callLogMore');
    if (!apiKey()) { list.innerHTML = emptyHTML('Enter your account key', 'Use the key box at the top right, then Set.'); more.innerHTML = ''; updateAccount(); return; }
    if (reset) { clOffset = 0; clDone = false; list.innerHTML = loadingHTML; }
    if (clLoading || clDone) return;
    clLoading = true;
    if (!reset) more.innerHTML = loadingHTML;
    try {
        const since = clSince();
        const qs = `limit=${CL_PAGE}&offset=${clOffset}&dir=${clDir}` + (since ? `&since=${since}` : '') + (clQ ? `&q=${encodeURIComponent(clQ)}` : '');
        const { calls } = await json(`/calllog?${qs}`);
        if (reset) list.innerHTML = '';
        if (reset && calls.length === 0) { list.innerHTML = emptyHTML('No calls match', 'Try a different filter or sync from the phone.'); }
        else {
            list.insertAdjacentHTML('beforeend', calls.map(callRow).join(''));
            list.querySelectorAll('.row[data-n]').forEach((el) => { el.onclick = () => openContact(el.dataset.n); });
        }
        clOffset += calls.length;
        clDone = calls.length < CL_PAGE;
        updateAccount(`${clOffset} shown`);
        more.innerHTML = clDone
            ? (clOffset > 0 ? `<div class="loading">— end · ${clOffset} calls —</div>` : '')
            : `<div style="text-align:center;margin:16px 0"><button class="btn" id="moreBtn">Load 100 more</button></div>`;
        const b = document.getElementById('moreBtn'); if (b) b.onclick = () => loadCallLog(false);
    } catch (e) {
        (reset ? list : more).innerHTML = emptyHTML('Could not load', e.message);
    } finally { clLoading = false; }
}

// ---------- Contacts ----------
function contactRow(c) {
    const name = c.contactName || c.number;
    const tag = c.tag ? `<span class="chip" style="padding:1px 9px;font-size:11px">${esc(c.tag)}</span>` : '';
    const sub = c.company ? esc(c.company) + ' · ' + esc(c.number) : esc(c.number);
    return `<div class="row" data-n="${esc(c.normalizedNumber)}">
        <div class="avatar" style="background:${avatarColor(name)}">${esc(initial(name))}</div>
        <div class="row-main">
            <div class="row-title">${esc(name)} ${tag}</div>
            <div class="row-sub">${sub}</div>
        </div>
        <div class="row-end">
            <div class="row-dur">${fmtDate(c.lastCallTime)}</div>
            <div class="muted" style="font-size:12px">${c.totalCalls} calls</div>
        </div>
    </div>`;
}
async function loadContacts(q = '') {
    const list = document.getElementById('contactList');
    if (!apiKey()) { list.innerHTML = emptyHTML('Enter your account key', 'Use the key box at the top right, then Set.'); return; }
    list.innerHTML = loadingHTML;
    try {
        const { contacts } = await json('/contacts?q=' + encodeURIComponent(q));
        list.innerHTML = contacts.length ? contacts.map(contactRow).join('') : emptyHTML('No contacts found', '');
        list.querySelectorAll('.row[data-n]').forEach((el) => { el.onclick = () => openContact(el.dataset.n); });
    } catch (e) { list.innerHTML = emptyHTML('Could not load', e.message); }
}

// ---------- Contact detail drawer ----------
async function openContact(n) {
    drawer(loadingHTML);
    const [{ calls }, { meta }] = await Promise.all([json('/contacts/' + n + '/timeline'), json('/contacts/' + n + '/meta')]);
    const m = meta || {}; const head = calls[0] || {};
    const name = m.displayName || head.contactName || n;
    const first = calls.length ? calls[calls.length - 1] : null;
    const count = (d) => calls.filter((c) => (d === 'MISSED' ? (c.direction === 'MISSED' || c.direction === 'REJECTED') : c.direction === d)).length;
    const tagOptions = TAGS.map((t) => `<option value="${t}" ${m.tag === t ? 'selected' : ''}>${t || '— none —'}</option>`).join('');
    drawer(`
        <div class="d-head">
            <div class="avatar" style="background:${avatarColor(name)};width:52px;height:52px;font-size:20px">${esc(initial(name))}</div>
            <div><div class="d-name">${esc(name)}</div><div class="d-sub">${esc(m.company || head.company || '')} ${head.number ? '· ' + esc(head.number) : ''}</div></div>
        </div>
        <div class="pill-row">
            <div class="pill"><b>${calls.length}</b><span>Total</span></div>
            <div class="pill"><b class="dir-in">${count('INCOMING')}</b><span>In</span></div>
            <div class="pill"><b class="dir-out">${count('OUTGOING')}</b><span>Out</span></div>
            <div class="pill"><b class="dir-missed">${count('MISSED')}</b><span>Missed</span></div>
        </div>
        <details class="form"><summary>Edit tag / company</summary>
            <label>Display name</label><input id="m-name" value="${esc(m.displayName || '')}">
            <label>Company</label><input id="m-company" value="${esc(m.company || '')}">
            <label>Department</label><input id="m-dept" value="${esc(m.department || '')}">
            <label>Tag</label><select id="m-tag">${tagOptions}</select>
            <label>Notes</label><textarea id="m-notes" rows="2">${esc(m.notes || '')}</textarea>
            <button class="btn btn-primary" id="m-save" style="margin-top:12px">Save</button>
        </details>
        <h3 style="margin:18px 0 4px">Timeline</h3>
        ${calls.map((c) => {
        const [g] = dirInfo(c.direction);
        return `<div class="tl-row"><span><span class="${dirClass(c.direction)}">${g}</span> ${fmtDate(c.startTime)} ${fmtTime(c.startTime)}</span>
            <span class="${dirClass(c.direction)}">${c.direction} · ${fmtDur(c.durationSec)}</span></div>`;
    }).join('')}
        ${first ? `<div class="loading">— First call: ${fmtDate(first.startTime)} —</div>` : ''}
    `);
    document.getElementById('m-save').addEventListener('click', async () => {
        await json('/contacts/' + n + '/meta', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: val('m-name'), company: val('m-company'), department: val('m-dept'), tag: val('m-tag'), notes: val('m-notes') }),
        });
        closeDrawer(); refreshView(activeView()); loadStats();
    });
}

// ---------- Companies ----------
async function loadCompanies() {
    const list = document.getElementById('companyList');
    if (!apiKey()) { list.innerHTML = emptyHTML('Enter your account key', ''); return; }
    list.innerHTML = loadingHTML;
    try {
        const { companies } = await json('/companies');
        list.innerHTML = companies.length ? companies.map((c) => `
            <div class="company-card" data-c="${esc(c.company)}">
                <div class="cc-name"><div class="avatar" style="background:${avatarColor(c.company)};width:34px;height:34px;font-size:14px">${esc(initial(c.company))}</div>${esc(c.company)}</div>
                <div class="cc-meta">${c.contactCount} contacts · ${c.totalCalls} calls<br>last ${fmtDate(c.lastCallTime)}</div>
            </div>`).join('') : emptyHTML('No companies yet', 'Tag a contact with a company, or company shows up from synced contacts.');
        list.querySelectorAll('.company-card[data-c]').forEach((el) => { el.onclick = () => openCompany(el.dataset.c); });
    } catch (e) { list.innerHTML = emptyHTML('Could not load', e.message); }
}
async function openCompany(name) {
    drawer(loadingHTML);
    const data = await json('/companies/' + encodeURIComponent(name) + '/timeline');
    drawer(`
        <div class="d-head">
            <div class="avatar" style="background:${avatarColor(name)};width:52px;height:52px;font-size:20px">${esc(initial(name))}</div>
            <div><div class="d-name">${esc(name)}</div><div class="d-sub">${data.contacts.length} contacts · ${data.calls.length} calls</div></div>
        </div>
        <h3 style="margin:16px 0 4px">People</h3>
        ${data.contacts.map((p) => `<div class="tl-row"><span>${esc(p.contactName || p.normalizedNumber)}</span><span class="muted">${p.totalCalls} calls</span></div>`).join('')}
        <h3 style="margin:18px 0 4px">Combined timeline</h3>
        ${data.calls.slice(0, 200).map((c) => `<div class="tl-row"><span><span class="${dirClass(c.direction)}">${dirInfo(c.direction)[0]}</span> ${fmtDate(c.startTime)} — ${esc(c.contactName || c.number)}</span><span class="${dirClass(c.direction)}">${fmtDur(c.durationSec)}</span></div>`).join('')}
    `);
}

// ---------- Accounts (admin) ----------
function accountRow(a) {
    const who = a.label || '(unnamed)';
    return `<div class="row" style="cursor:default">
        <div class="avatar" style="background:${avatarColor(a.label || a.key)}">${esc(initial(who))}</div>
        <div class="row-main">
            <input class="acct-label" data-id="${a.id}" value="${esc(a.label || '')}" placeholder="username" />
            <div class="mono">${esc(a.key)}</div>
        </div>
        <div class="row-end">
            <div style="display:flex;gap:6px;justify-content:flex-end">
                <button class="chip" data-copy="${esc(a.key)}">Copy key</button>
                <button class="chip" data-del="${a.id}" data-name="${esc(a.label || a.key)}" style="color:var(--red);border-color:var(--red)">Delete</button>
            </div>
            <div class="muted" style="font-size:12px;margin-top:6px">${a.calls} calls</div>
        </div>
    </div>`;
}
async function loadAccounts() {
    const list = document.getElementById('accountList');
    list.innerHTML = loadingHTML;
    try {
        const { accounts } = await json('/admin/accounts');
        list.innerHTML = accounts.length ? accounts.map(accountRow).join('') : emptyHTML('No accounts yet', 'Create one above.');
        list.querySelectorAll('.acct-label').forEach((inp) => inp.addEventListener('change', async () => {
            try { await json('/admin/accounts/' + inp.dataset.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: inp.value.trim() }) }); loadMe(); }
            catch (e) { alert('Rename failed: ' + e.message); }
        }));
        list.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
            navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = 'Copied!'; setTimeout(() => { b.textContent = t; }, 1200);
        }));
        list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
            if (!confirm(`Delete account "${b.dataset.name}" and ALL its calls? This cannot be undone.`)) return;
            try { await json('/admin/accounts/' + b.dataset.del, { method: 'DELETE' }); loadAccounts(); loadStats(); }
            catch (e) { alert('Delete failed: ' + e.message); }
        }));
    } catch (e) { list.innerHTML = emptyHTML('Could not load', e.message); }
}
document.getElementById('createAcct').addEventListener('click', async () => {
    const label = document.getElementById('newLabel').value.trim();
    const s = document.getElementById('acctStatus'); s.textContent = 'Creating…';
    try {
        const { account } = await json('/admin/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) });
        s.textContent = `Created "${account.label || '(unnamed)'}" — key: ${account.key}  (copy & give to them)`;
        document.getElementById('newLabel').value = ''; loadAccounts();
    } catch (e) { s.textContent = 'Failed: ' + e.message; }
});
document.getElementById('addExisting').addEventListener('click', async () => {
    const key = document.getElementById('addKey').value.trim();
    const label = document.getElementById('addKeyLabel').value.trim();
    if (!key) { alert('Enter a key'); return; }
    try {
        await json('/admin/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, label }) });
        document.getElementById('addKey').value = ''; document.getElementById('addKeyLabel').value = '';
        loadAccounts();
    } catch (e) { alert('Failed: ' + e.message); }
});

// ---------- Drawer ----------
function drawer(html) { document.getElementById('drawerBody').innerHTML = html; document.getElementById('drawer').classList.add('open'); }
function closeDrawer() { document.getElementById('drawer').classList.remove('open'); }
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
document.getElementById('drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') closeDrawer(); });

// ---------- Export / Import / Backup ----------
document.querySelectorAll('[data-export]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const old = a.textContent; a.textContent = '…';
    try {
        const res = await api('/export.' + a.dataset.export);
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement('a'); link.href = url; link.download = 'call-history.' + a.dataset.export; link.click();
        URL.revokeObjectURL(url);
    } catch (err) { alert('Export failed: ' + err.message); }
    finally { a.textContent = old; }
}));
document.getElementById('importBtn').addEventListener('click', async () => {
    const file = document.getElementById('importFile').files[0];
    const status = document.getElementById('importStatus');
    if (!file) { status.textContent = 'Choose a CSV file first.'; return; }
    status.textContent = 'Importing…';
    try {
        const r = await json('/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text() });
        status.textContent = `Imported ${r.inserted} new, skipped ${r.skipped} duplicates.`;
        loadStats(); refreshView(activeView());
    } catch (e) { status.textContent = 'Import failed: ' + e.message; }
});

// ---------- Filters ----------
function wireChips(groupId, onPick) {
    document.querySelectorAll('#' + groupId + ' .chip').forEach((btn) => btn.addEventListener('click', () => {
        document.querySelectorAll('#' + groupId + ' .chip').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active'); onPick(btn.dataset); loadCallLog(true);
    }));
}
wireChips('clRange', (d) => { clRange = d.range; });
wireChips('clDir', (d) => { clDir = d.dir; });
let clT;
document.getElementById('clSearch').addEventListener('input', (e) => { clearTimeout(clT); clT = setTimeout(() => { clQ = e.target.value.trim(); loadCallLog(true); }, 250); });
let sT;
document.getElementById('search').addEventListener('input', (e) => { clearTimeout(sT); sT = setTimeout(() => loadContacts(e.target.value), 250); });

// ---------- Key ----------
const val = (id) => document.getElementById(id).value.trim();
document.getElementById('apiKey').value = apiKey();
document.getElementById('saveKey').addEventListener('click', () => {
    localStorage.setItem('apiKey', document.getElementById('apiKey').value.trim());
    checkHealth(); loadMe(); loadStats(); refreshView(activeView());
});

// ---------- Init ----------
checkHealth();
loadMe();
loadStats();
loadCallLog(true);
