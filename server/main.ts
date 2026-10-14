import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config';
import { openDb, migrate } from './db/index';
import { LocalDiskStorage } from './storage';
import { Services } from './services';
import { createApp } from './app';
import { MiniSources } from './minisources';

const cfg = loadConfig();
const db = await openDb({ databaseUrl: cfg.databaseUrl, dataDir: cfg.databaseUrl ? null : cfg.dataDir });
const applied = await migrate(db);
if (applied.length) console.log('Applied migrations:', applied.join(', '));
const svc = new Services(db, new LocalDiskStorage(path.join(cfg.dataDir, 'uploads')), { maxUploadBytes: cfg.maxUploadBytes, miniLibrary: MiniSources.fromEnv() });
const dist = path.resolve('dist');
const { server } = createApp(svc, { staticDir: fs.existsSync(dist) ? dist : null, secureCookies: cfg.secureCookies });
server.listen(cfg.port, () => console.log('OPEN TABLETOP server on http://localhost:' + cfg.port + (cfg.databaseUrl ? ' (PostgreSQL)' : ' (embedded PGlite at ' + cfg.dataDir + ')')));
const shutdown = async () => { server.close(); await db.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
