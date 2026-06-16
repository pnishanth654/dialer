import { query } from '../db/pool.js';
import { encrypt, decrypt, sha256 } from './crypto.js';
import { web3Provider } from './web3/index.js';
import { allCalls, insertCalls } from './callService.js';

const BACKUP_VERSION = 1;

/**
 * Serialize all of a user's calls, encrypt them, push the ciphertext to Web3 storage,
 * and record the resulting CID. The plaintext never leaves this process.
 */
export async function runBackup(userId) {
    const calls = await allCalls(userId);
    const payload = Buffer.from(
        JSON.stringify({ version: BACKUP_VERSION, exportedAt: Date.now(), userId, calls }),
        'utf8'
    );

    const checksum = sha256(payload);
    const ciphertext = encrypt(payload);
    const provider = web3Provider();
    const filename = `business-dialer-${userId}-${Date.now()}.enc`;
    const { cid, size } = await provider.put(ciphertext, filename);

    const r = await query(
        `INSERT INTO web3_backups (user_id, provider, cid, gateway_url, call_count, byte_size, sha256, encrypted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         RETURNING id, provider, cid, gateway_url AS "gatewayUrl", call_count AS "callCount",
                   byte_size AS "byteSize", created_at AS "createdAt"`,
        [userId, provider.name, cid, provider.gatewayUrl(cid), calls.length, size, checksum]
    );
    return r.rows[0];
}

export async function listBackups(userId) {
    const r = await query(
        `SELECT id, provider, cid, gateway_url AS "gatewayUrl", call_count AS "callCount",
                byte_size AS "byteSize", sha256, created_at AS "createdAt"
         FROM web3_backups WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
    );
    return r.rows;
}

/** Fetch a backup by CID from Web3 storage, decrypt, verify, and re-import (dedup-safe). */
export async function restoreBackup(userId, cid) {
    const provider = web3Provider();
    const ciphertext = await provider.get(cid);
    const payload = decrypt(ciphertext);
    const data = JSON.parse(payload.toString('utf8'));
    const result = await insertCalls(userId, data.calls || []);
    return { cid, checksum: sha256(payload), ...result };
}
