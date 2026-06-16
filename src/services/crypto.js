import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';

function key() {
    const hex = config.backupEncryptionKey;
    if (!hex) {
        const e = new Error('BACKUP_ENCRYPTION_KEY is not set — run `npm run genkey` and add it to .env');
        e.status = 500;
        throw e;
    }
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    return buf;
}

/** Returns iv(12) || authTag(16) || ciphertext as a single Buffer. */
export function encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key(), iv);
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decrypt(blob) {
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const data = blob.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const generateKey = () => crypto.randomBytes(32).toString('hex');
