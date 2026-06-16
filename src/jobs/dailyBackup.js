import cron from 'node-cron';
import { config, hasDb } from '../config.js';
import { getDefaultUserId } from '../services/callService.js';
import { runBackup } from '../services/backupService.js';

/** Schedules the nightly Web3 backup (default 23:00 server time). */
export function scheduleDailyBackup() {
    if (!hasDb()) {
        console.warn('[backup] DATABASE_URL not set — nightly backup disabled');
        return;
    }
    if (!config.backupEncryptionKey) {
        console.warn('[backup] BACKUP_ENCRYPTION_KEY not set — nightly backup disabled');
        return;
    }
    if (!cron.validate(config.backupCron)) {
        console.warn(`[backup] invalid BACKUP_CRON "${config.backupCron}" — nightly backup disabled`);
        return;
    }

    cron.schedule(config.backupCron, async () => {
        try {
            const userId = await getDefaultUserId();
            const rec = await runBackup(userId);
            console.log(`[backup] nightly ok — ${rec.callCount} calls, cid=${rec.cid}`);
        } catch (e) {
            console.error('[backup] nightly failed:', e.message);
        }
    });
    console.log(`[backup] nightly Web3 backup scheduled: ${config.backupCron}`);
}
