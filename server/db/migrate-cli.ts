import { loadConfig } from '../config';
import { openDb, migrate } from './index';

const cfg = loadConfig();
const db = await openDb({ databaseUrl: cfg.databaseUrl, dataDir: cfg.dataDir });
const applied = await migrate(db);
console.log(applied.length ? 'Applied: ' + applied.join(', ') : 'Database is up to date');
await db.close();
