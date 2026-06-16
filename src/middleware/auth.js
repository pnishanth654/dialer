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
        next();
    } catch (e) {
        next(e);
    }
}
