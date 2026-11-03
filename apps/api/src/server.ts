import { createAtlasStore } from '@travel-atlas/database';
import { buildApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run Travel Atlas API');
}
const store = createAtlasStore(databaseUrl);
const app = buildApp(store);
const port = Number(process.env.API_PORT ?? '3001');
const host = process.env.API_HOST ?? '127.0.0.1';

app.addHook('onClose', async () => {
  await store.close();
});
try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
