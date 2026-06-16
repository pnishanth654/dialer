import { config } from '../config.js';
import { resolveUserId } from '../services/callService.js';

/**
 * Resolves the account for each request from its `x-api-key` header. Each distinct key is
 * an isolated account. When REQUIRE_API_KEY is on, a missing key is rejected so data can
 * never accidentally merge into the shared default account.
 */
export async function auth(req, res, next) {
    const key = req.get('x-api-key');
    if (config.requireApiKey && !(key && key.trim())) {
        return res.status(401).json({ error: 'api key required' });
    }
    try {
        req.userId = await resolveUserId(key);
        req.isAdmin = Boolean(config.adminApiKey) && key === config.adminApiKey;
        next();
    } catch (e) {
        next(e);
    }
}

/** Gate admin-only (account management) routes. */
export function adminOnly(req, res, next) {
    if (!req.isAdmin) return res.status(403).json({ error: 'admin only' });
    next();
}
