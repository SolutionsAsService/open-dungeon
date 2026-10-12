import path from 'node:path';

export interface Config { port: number; databaseUrl: string | null; dataDir: string; maxUploadBytes: number; secureCookies: boolean }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT || 8787),
    databaseUrl: env.DATABASE_URL ? env.DATABASE_URL : null,
    dataDir: path.resolve(env.DATA_DIR || '.data'),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024),
    secureCookies: env.COOKIE_SECURE === '1',
  };
}
