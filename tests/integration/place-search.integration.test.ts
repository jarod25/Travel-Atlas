import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import { places } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 2 });
const db = drizzle(client);
const store = createAtlasStore(url);
const created: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of created) await db.delete(places).where(eq(places.id, id));
  await store.close();
  await client.end();
});

describe('Normalized local Place search', () => {
  it('finds accent and punctuation variants and common typos without merging Places', async () => {
    const source = (await store.createPlace('Synthetic Belfort-Montbéliard TGV')) as {
      id: string;
    };
    const unrelated = (await store.createPlace('Synthetic Helsinki Airport')) as { id: string };
    created.push(source.id, unrelated.id);

    for (const query of [
      'synthetic belfort montbeliard tgv',
      'SYNTHETIC BELFORT-MONTBELIARD TGV',
      'synthetic belfort montbelaird tgv',
    ]) {
      const results = (await store.listPlaces(query)) as Array<{ id: string }>;
      expect(results.map((place) => place.id)).toContain(source.id);
    }
    const retained = await db.select().from(places).where(eq(places.id, source.id));
    expect(retained).toHaveLength(1);
  });

  it('preserves Japanese characters during normalization', async () => {
    const source = (await store.createPlace('京都駅')) as { id: string };
    created.push(source.id);
    const results = (await store.listPlaces('京都')) as Array<{ id: string }>;
    expect(results.map((place) => place.id)).toContain(source.id);
  });
});
