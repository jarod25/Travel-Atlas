import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import { tripDays, trips } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 2 });
const db = drizzle(client);
const store = createAtlasStore(url);
const ids: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of ids.reverse()) await db.delete(trips).where(eq(trips.id, id));
  await store.close();
  await client.end();
});

describe('Nested trip boundaries', () => {
  it('derives parent dates recursively without duplicating days and preserves manual correction', async () => {
    const parent = (await store.createTrip('Synthetic parent excursion')) as { id: string } | null;
    if (!parent || !('id' in parent)) throw new Error('Parent creation failed');
    ids.push(parent.id);
    const child = (await store.createTrip('Synthetic weekend', parent.id)) as { id: string } | null;
    if (!child || !('id' in child)) throw new Error('Child creation failed');
    ids.push(child.id);
    const grandchild = (await store.createTrip('Synthetic small excursion', child.id)) as {
      id: string;
    } | null;
    if (!grandchild || !('id' in grandchild)) throw new Error('Grandchild creation failed');
    ids.push(grandchild.id);
    await store.createDay(parent.id, '2026-09-10');
    await store.createDay(grandchild.id, '2026-09-15');
    const list = (await store.listTrips(true)) as Array<{
      id: string;
      parentTripId: string | null;
      computedStartDate: string | null;
      computedEndDate: string | null;
      manualEndDate: string | null;
    }>;
    const parentRow = list.find((row) => row.id === parent.id);
    expect(parentRow).toMatchObject({
      computedStartDate: '2026-09-10',
      computedEndDate: '2026-09-15',
      parentTripId: null,
    });
    expect(list.find((row) => row.id === grandchild.id)?.parentTripId).toBe(child.id);
    const correction = await store.editTrip(parent.id, 1, { manualEndDate: '2026-09-20' });
    expect(correction.status).toBe('updated');
    const after = (await store.listTrips(true)) as typeof list;
    expect(after.find((row) => row.id === parent.id)?.manualEndDate).toBe('2026-09-20');
    expect(after.find((row) => row.id === parent.id)?.computedEndDate).toBe('2026-09-15');
    const combined = (await store.listCombinedDays(parent.id)) as Array<{ tripId: string }>;
    expect(combined).toHaveLength(2);
    expect(new Set(combined.map((day) => day.tripId))).toEqual(new Set([parent.id, grandchild.id]));
    const cycle = await store.editTrip(parent.id, 2, { parentTripId: grandchild.id });
    expect(cycle.status).toBe('invalid');
    const moved = await store.editTrip(child.id, 1, { parentTripId: null });
    expect(moved.status).toBe('updated');
    const listAfter = (await store.listTrips(true)) as typeof list;
    expect(listAfter.find((row) => row.id === parent.id)?.computedEndDate).toBe('2026-09-10');
    expect((await store.listCombinedDays(parent.id)) as Array<unknown>).toHaveLength(1);
    expect(
      await store.createTrip('Invalid synthetic child', '00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
  });
  it('rejects an impossible override and flags a conflict when descendant days change later', async () => {
    const parent = (await store.createTrip('Synthetic period parent')) as { id: string };
    ids.push(parent.id);
    const child = (await store.createTrip('Synthetic period child', parent.id)) as { id: string };
    ids.push(child.id);
    const day = (await store.createDay(child.id, '2026-09-12')) as { id: string };

    const invalid = await store.editTrip(parent.id, 1, {
      manualStartDate: '2026-09-15',
    });
    expect(invalid.status).toBe('invalid');

    const corrected = await store.editTrip(parent.id, 1, {
      manualStartDate: '2026-09-10',
    });
    expect(corrected.status).toBe('updated');

    await db.update(tripDays).set({ localDate: '2026-09-01' }).where(eq(tripDays.id, day.id));
    const tripsAfter = (await store.listTrips(true)) as Array<{
      id: string;
      computedEndDate: string | null;
      manualStartDate: string | null;
    }>;
    expect(tripsAfter.find((trip) => trip.id === parent.id)).toMatchObject({
      computedEndDate: '2026-09-01',
      manualStartDate: '2026-09-10',
    });

    const stillInvalid = await store.editTrip(parent.id, 2, {
      manualStartDate: '2026-09-09',
    });
    expect(stillInvalid.status).toBe('invalid');
    const reset = await store.editTrip(parent.id, 2, { manualStartDate: null });
    expect(reset.status).toBe('updated');
    const afterReset = (await store.listTrips(true)) as typeof tripsAfter;
    expect(afterReset.find((trip) => trip.id === parent.id)?.manualStartDate).toBeNull();
  });
});
