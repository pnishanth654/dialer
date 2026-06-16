import { config } from '../../config.js';

/**
 * IPFS storage via Pinata (free tier). Uploads opaque encrypted blobs and fetches them
 * back by CID through the configured gateway. The network is public, so callers must
 * encrypt before put() — see services/crypto.js.
 */
export const pinataProvider = {
    name: 'ipfs-pinata',

    gatewayUrl(cid) {
        return `${config.pinataGateway}/ipfs/${cid}`;
    },

    async put(buffer, filename) {
        if (!config.pinataJwt) throw new Error('PINATA_JWT is not set');
        const form = new FormData();
        form.append('file', new Blob([buffer]), filename);
        form.append('pinataMetadata', JSON.stringify({ name: filename }));

        const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.pinataJwt}` },
            body: form,
        });
        if (!res.ok) throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`);
        const json = await res.json();
        return { cid: json.IpfsHash, size: json.PinSize ?? buffer.length };
    },

    async get(cid) {
        const res = await fetch(this.gatewayUrl(cid));
        if (!res.ok) throw new Error(`Pinata fetch failed: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    },
};
