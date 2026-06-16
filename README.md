# Business Dialer — Cloud + Web3 Storage Server

Node.js backend that receives call history from the phone app, stores it permanently in a
free **PostgreSQL** database, and keeps **encrypted Web3 (IPFS) backups** so your lifetime
history survives even if the database is lost.

## Storage model

| Layer | Tech | Cost | Purpose |
|-------|------|------|---------|
| On phone | SQLite (Room) | free | instant, offline-first capture |
| Cloud archive | **PostgreSQL (Neon / Supabase free tier)** | free | searchable permanent archive, restore to new phones |
| Decentralized backup | **IPFS via Pinata** (encrypted) | free tier | censorship-resistant, provider-independent permanence |

Backups are **AES-256-GCM encrypted before they ever leave the server** — IPFS is a public
network, so only ciphertext is pinned. The DB stores just the CID + metadata.

## Setup

```bash
cd server
npm install              # local install only (no -g)
cp .env.example .env
npm run genkey           # prints a 64-hex key -> paste into BACKUP_ENCRYPTION_KEY in .env
```

**Free Postgres (pick one):**
- **Neon** — https://neon.tech → create project → copy the connection string into `DATABASE_URL`.
- **Supabase** — https://supabase.com → Project Settings → Database → connection string.

**Web3 (optional — works offline without it):**
- Sign up at https://pinata.cloud (free), create a JWT, set `PINATA_JWT`.
- If `PINATA_JWT` is blank, the server uses a local-filesystem stand-in (`BACKUP_DIR`) so
  the full backup/restore flow still runs.

```bash
npm run migrate          # create tables (needs DATABASE_URL)
npm run dev              # start with auto-reload  (or: npm start)
npm run selftest         # offline check of encryption + Web3 pipeline (no DB needed)
```

## API

All `/api/*` routes require header `x-api-key: <API_KEY>` unless `API_KEY` is blank (dev).

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | status (db, web3 provider, encryption) |
| POST | `/api/sync/calls` | push a batch of calls (dedup-safe) |
| GET  | `/api/calls?since=<ms>` | pull calls (restore a new phone) |
| GET  | `/api/contacts` | aggregated recents (totals, first/last call) |
| GET  | `/api/search?q=` | search by name / company / number |
| GET  | `/api/contacts/:normalized/timeline` | full timeline for one number |
| GET  | `/api/contacts/:normalized/meta` | get tag / company / notes for a number |
| PUT  | `/api/contacts/:normalized/meta` | set tag / company / department / notes |
| GET  | `/api/companies` | companies with contact + call counts |
| GET  | `/api/companies/:name/timeline` | combined timeline + roster for a company |
| POST | `/api/import` | import calls — raw CSV (`text/csv`) or JSON `{calls:[…]}` |
| GET  | `/api/export.csv` \| `.xlsx` \| `.pdf` | download full lifetime history |
| POST | `/api/backup/web3` | encrypt + pin a backup now, returns CID |
| GET  | `/api/backup/web3` | list past backups |
| POST | `/api/restore/web3/:cid` | fetch from IPFS, decrypt, re-import |

## Web dashboard

Open **`http://localhost:8080/`** (served from `public/`). Tabs:
- **Contacts** — search by name / company / number; open a contact for its full timeline,
  stats, and an inline editor for tag / company / department / notes.
- **Companies** — every company with a combined timeline across all its contacts.
- **Import / Export** — upload a Samsung/Redmi/Google call-log CSV (duplicates skipped),
  download CSV / Excel / PDF, or trigger a Web3 backup.

If `API_KEY` is set, paste it into the field in the dashboard header (stored in your
browser's localStorage and sent as `x-api-key`).

### Phone → server sync payload
```json
POST /api/sync/calls
{ "calls": [
  { "number": "9840012345", "normalizedNumber": "9840012345",
    "contactName": "Kumar", "company": "ABC Engineering",
    "direction": "OUTGOING", "startTime": 1749623700000,
    "durationSec": 443, "simSlot": 0,
    "clientUuid": "…", "deviceId": "…" }
] }
```

A nightly job (`BACKUP_CRON`, default 23:00) runs the Web3 backup automatically.

## Notes / upgrade paths
- **Arweave** (pay-once *permanent* storage) is the natural upgrade from IPFS pinning for
  true "forever" backups — add an `arweave.js` provider behind the same interface.
- **Filecoin** deals (via Storacha/web3.storage) give long-term IPFS persistence.
- Multi-user + Google login: the schema already has a `users` table; swap the single-owner
  `auth` middleware for real auth in Phase 3.
