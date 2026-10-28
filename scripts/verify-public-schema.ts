import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { createPostgresPool } from '../server/postgres.ts';

// Public releases never apply migrations. PostgreSQL enforces read-only mode on
// the entire compatibility check, including failure paths.
const pool = createPostgresPool();
let client: PoolClient | undefined;
try {
  client = await pool.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10s'");
  const required = (await readdir(fileURLToPath(new URL('../server/migrations/', import.meta.url))))
    .filter(file => /^\d+.*\.sql$/.test(file)).sort().map(file => file.replace(/\.sql$/, ''));
  const { rows } = await client.query<{ version: string }>('SELECT version FROM public.schema_migrations');
  const applied = new Set(rows.map(row => row.version));
  const missing = required.filter(version => !applied.has(version));
  if (missing.length) throw new Error(`Production schema requires separate migration review: ${missing.join(', ')}`);
  await client.query('COMMIT');
  process.stdout.write(`${JSON.stringify({ event: 'public_schema_compatible', requiredMigrations: required.length, mode: 'read-only' })}\n`);
} catch (error) {
  await client?.query('ROLLBACK').catch(() => undefined);
  // Never log PostgreSQL connection errors, which may contain connection details.
  process.stderr.write(`${error instanceof Error && error.message.startsWith('Production schema requires') ? error.message : 'Public schema verification failed; database access and schema must be reviewed.'}\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
