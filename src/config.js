import 'dotenv/config';

export const config = {
    port: Number(process.env.PORT) || 8080,
    databaseUrl: process.env.DATABASE_URL || '',
    apiKey: process.env.API_KEY || '',
    requireApiKey: process.env.REQUIRE_API_KEY === 'true',
    defaultUserEmail: process.env.DEFAULT_USER_EMAIL || 'owner@local',

    backupEncryptionKey: process.env.BACKUP_ENCRYPTION_KEY || '',
    backupCron: process.env.BACKUP_CRON || '0 23 * * *',
    backupDir: process.env.BACKUP_DIR || './backups',

    web3Provider: process.env.WEB3_PROVIDER || (process.env.PINATA_JWT ? 'pinata' : 'local'),
    pinataJwt: process.env.PINATA_JWT || '',
    pinataGateway: process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud',
};

export const hasDb = () => Boolean(config.databaseUrl);
