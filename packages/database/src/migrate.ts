import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must target a dedicated database before running migrations.');
}

const client = postgres(databaseUrl, { max: 1 });

try {
  await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)) });
  console.log('Database migrations applied.');
} finally {
  await client.end();
}
