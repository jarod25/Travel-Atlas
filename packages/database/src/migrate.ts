import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must target a dedicated database before running migrations.');
}

const client = postgres(databaseUrl, { max: 1 });

try {
  await migrate(drizzle(client), { migrationsFolder: 'packages/database/drizzle' });
  console.log('Database migrations applied.');
} finally {
  await client.end();
}
