import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '../../config.js';
import { sha256 } from '../crypto.js';

/**
 * Offline stand-in for IPFS: writes encrypted blobs to disk and uses their content hash
 * as a deterministic pseudo-CID. Lets the full backup/restore pipeline run with zero
 * signup. Swap in the Pinata provider by setting PINATA_JWT.
 */
export const localProvider = {
    name: 'local',

    gatewayUrl(cid) {
        return `file://${resolve(config.backupDir, `${cid}.bin`)}`;
    },

    async put(buffer) {
        await mkdir(config.backupDir, { recursive: true });
        const cid = `local-${sha256(buffer).slice(0, 46)}`;
        await writeFile(join(config.backupDir, `${cid}.bin`), buffer);
        return { cid, size: buffer.length };
    },

    async get(cid) {
        return readFile(join(config.backupDir, `${cid}.bin`));
    },
};
