import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { places } from '../../packages/database/src/schema';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 1 });
const db = drizzle(client);
const ids: string[] = [];
beforeAll(async () => { await migrate(db, { migrationsFolder: 'packages/database/drizzle' }); });
afterAll(async () => {
  for (const id of ids) await db.delete(places).where(eq(places.id, id));
  await client.end();
});
describe('Place coordinate certainty', () => {
  it('preserves a valid (0,0) point distinct from NULL', async () => {
    const [known] = await db.insert(places).values({
      name: 'Synthetic origin', location: [0, 0], locationConfidence: 'estimated',
    }).returning();
    ids.push(known.id);
    expect(known.location).toEqual([0, 0]);
    const [unknown] = await db.insert(places).values({ name: 'Synthetic missing' }).returning();
    ids.push(unknown.id);
    expect(unknown.location).toBeNull();
    expect(unknown.locationConfidence).toBe('unknown');
  });
  it('rejects out-of-bounds coordinates and inconsistent null certainty', async () => {
    const [place] = await db.insert(places).values({ name: 'Synthetic bounds' }).returning();
    ids.push(place.id);
    await expect(db.update(places).set({ location: [190, 0], locationConfidence: 'estimated' })
      .where(eq(places.id, place.id))).rejects.toBeDefined();
    await expect(db.update(places).set({ locationConfidence: 'confirmed' })
      .where(eq(places.id, place.id))).rejects.toBeDefined();
  });
});
