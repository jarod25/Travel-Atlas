import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import { tripDays, trips } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 1 });
const db = drizzle(client);
const store = createAtlasStore(url);
const tripIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) await db.delete(trips).where(eq(trips.id, id));
  await store.close();
  await client.end();
});

describe('Day calendar revision', () => {
  it('keeps unknown date until user supplies one and protects against stale writes', async () => {
    const [trip] = await db.insert(trips).values({ title: 'Synthetic day edit' }).returning();
    tripIds.push(trip.id);
    const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
    expect(day.localDate).toBeNull();
    expect(day.revision).toBe(1);
    const updated = await store.editDay(trip.id, day.id, 1, '2026-09-12');
    expect(updated.status).toBe('updated');
    if (updated.status !== 'updated') throw new Error('Unexpected day update');
    expect(updated.day.localDate).toBe('2026-09-12');
    expect(updated.day.revision).toBe(2);
    expect(await store.editDay(trip.id, day.id, 1, null)).toEqual({
      status: 'conflict',
      currentRevision: 2,
    });
    const cleared = await store.editDay(trip.id, day.id, 2, null);
    expect(cleared.status).toBe('updated');
    if (cleared.status === 'updated') expect(cleared.day.localDate).toBeNull();
  });

  it('does not edit a day belonging to another trip', async () => {
    const [first] = await db.insert(trips).values({ title: 'Synthetic A' }).returning();
    const [second] = await db.insert(trips).values({ title: 'Synthetic B' }).returning();
    tripIds.push(first.id, second.id);
    const [day] = await db.insert(tripDays).values({ tripId: second.id, position: 0 }).returning();
    expect(await store.editDay(first.id, day.id, 1, '2026-09-12')).toEqual({ status: 'not_found' });
  });
});
