import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

export function createPostgresPool(databaseUrl = process.env.DATABASE_URL): pg.Pool {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function migrateDatabase(pool: pg.Pool): Promise<string[]> {
  const directory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const exists = await pool.query<{ exists: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations'
    ) AS exists`);
    if (exists.rows[0]?.exists) {
      const prior = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (prior.rowCount) continue;
    }
    await pool.query(await readFile(join(directory, file), 'utf8'));
    applied.push(version);
  }
  return applied;
}
