import { createPostgresPool, migrateDatabase } from '../server/postgres.ts';

const pool = createPostgresPool();
try {
  const applied = await migrateDatabase(pool);
  process.stdout.write(`${JSON.stringify({ appliedMigrations: applied }, null, 2)}\n`);
} finally { await pool.end(); }
