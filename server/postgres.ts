import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

export function createPostgresPool(databaseUrl = process.env.DATABASE_URL): pg.Pool {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  // PostgreSQL restarts terminate idle sockets. Without an error listener node-postgres
  // treats that expected pool event as uncaught and terminates the API process.
  pool.on('error', () => {
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'postgres_idle_client_disconnected' })}\n`);
  });
  return pool;
}

export async function migrateDatabase(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const directory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
  const applied: string[] = [];
  try {
    await client.query(`SELECT pg_advisory_lock(hashtextextended('zecathon-schema-migrations', 0))`);
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const exists = await client.query<{ exists: boolean }>(`SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations'
      ) AS exists`);
      if (exists.rows[0]?.exists) {
        const prior = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
        if (prior.rowCount) continue;
      }
      await client.query(await readFile(join(directory, file), 'utf8'));
      applied.push(version);
    }
    return applied;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtextextended('zecathon-schema-migrations', 0))`).catch(() => undefined);
    client.release();
  }
}
