import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import { trips, tripDays } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 2 });
const db = drizzle(client);
const store = createAtlasStore(url);
const ids: string[] = [];

beforeAll(async () => { await migrate(db, { migrationsFolder: 'packages/database/drizzle' }); });
afterAll(async () => {
  for (const id of ids.reverse()) await db.delete(trips).where(eq(trips.id, id));
  await store.close();
  await client.end();
});

describe('Nested trip boundaries', () => {
  it('derives parent dates recursively without duplicating days and preserves manual correction', async () => {
    const parent = await store.createTrip('Synthetic parent excursion') as { id: string } | null;
    if (!parent || !('id' in parent)) throw new Error('Parent creation failed');
    ids.push(parent.id);
    const child = await store.createTrip('Synthetic weekend', parent.id) as { id: string } | null;
    if (!child || !('id' in child)) throw new Error('Child creation failed');
    ids.push(child.id);
    const grandchild = await store.createTrip('Synthetic small excursion', child.id) as { id: string } | null;
    if (!grandchild || !('id' in grandchild)) throw new Error('Grandchild creation failed');
    ids.push(grandchild.id);
    await store.createDay(parent.id, '2026-09-10');
    await store.createDay(grandchild.id, '2026-09-15');
    const list = await store.listTrips(true) as Array<{ id: string; parentTripId: string | null; computedStartDate: string | null; computedEndDate: string | null; manualEndDate: string | null }>;
    const parentRow = list.find(row => row.id === parent.id);
    expect(parentRow).toMatchObject({ computedStartDate: '2026-09-10', computedEndDate: '2026-09-15', parentTripId: null });
    expect(list.find(row => row.id === grandchild.id)?.parentTripId).toBe(child.id);
    const correction = await store.editTrip(parent.id, 1, { manualEndDate: '2026-09-20' });
    expect(correction.status).toBe('updated');
    const after = await store.listTrips(true) as typeof list;
    expect(after.find(row => row.id === parent.id)?.manualEndDate).toBe('2026-09-20');
    expect(after.find(row => row.id === parent.id)?.computedEndDate).toBe('2026-09-15');
    expect(await store.createTrip('Invalid synthetic child', '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
