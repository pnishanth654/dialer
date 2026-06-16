// Offline self-test: validates encryption + Web3 storage pipeline without a database.
// Run with: npm run selftest
import assert from 'node:assert';
import { rm } from 'node:fs/promises';

process.env.BACKUP_ENCRYPTION_KEY ||=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.BACKUP_DIR ||= './backups-selftest';
process.env.WEB3_PROVIDER ||= 'local';

const { encrypt, decrypt, sha256 } = await import('./services/crypto.js');
const { localProvider } = await import('./services/web3/local.js');
const { normalize } = await import('./services/callService.js');

let passed = 0;
const ok = (label) => { console.log(`  ✓ ${label}`); passed++; };

// 1. Number normalization matches the Android client.
assert.equal(normalize('+91 98400 12345'), '9840012345');
assert.equal(normalize('(098400) 67890'), '9840067890');
assert.equal(normalize('100'), '100');
ok('phone number normalization');

// 2. AES-256-GCM round trip.
const secret = Buffer.from('the first call was 15-Feb-2022 ☎', 'utf8');
assert.deepEqual(decrypt(encrypt(secret)), secret);
ok('encrypt → decrypt round trip');

// 3. Tampering is detected (auth tag).
const blob = encrypt(secret);
blob[blob.length - 1] ^= 0xff;
assert.throws(() => decrypt(blob));
ok('tamper detection');

// 4. Local Web3 provider stores and retrieves by CID.
const data = Buffer.from('encrypted-bytes-here');
const { cid, size } = await localProvider.put(data, 'test.enc');
assert.equal(size, data.length);
assert.deepEqual(await localProvider.get(cid), data);
ok(`local provider put/get (cid=${cid.slice(0, 16)}…)`);

// 5. Full backup payload pipeline: serialize → encrypt → store → fetch → decrypt → parse.
const calls = [
    { number: '9840012345', direction: 'OUTGOING', startTime: 1644936600000, durationSec: 300 },
    { number: '9840012345', direction: 'MISSED', startTime: 1654936600000, durationSec: 0 },
];
const payload = Buffer.from(JSON.stringify({ version: 1, calls }), 'utf8');
const checksum = sha256(payload);
const put = await localProvider.put(encrypt(payload), 'backup.enc');
const restored = JSON.parse(decrypt(await localProvider.get(put.cid)).toString('utf8'));
assert.equal(sha256(Buffer.from(JSON.stringify(restored), 'utf8')), checksum);
assert.equal(restored.calls.length, 2);
ok('full backup → restore payload pipeline');

await rm(process.env.BACKUP_DIR, { recursive: true, force: true });
console.log(`\nAll ${passed} checks passed.`);
