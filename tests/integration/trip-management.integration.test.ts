import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { updateTripWithRevision } from '../../packages/database/src/trip-repository';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import { places, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 2 });
const db = drizzle(client);
const store = createAtlasStore(url);
const tripIds: string[] = [];
const placeIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) await db.delete(trips).where(eq(trips.id, id));
  for (const id of placeIds) await db.delete(places).where(eq(places.id, id));
  await store.close();
  await client.end();
});

describe('Revisioned Trip management', () => {
  it('renames without losing history, detects stale edits and supports restoration', async () => {
    const [trip] = await db.insert(trips).values({ title: 'Synthetic old title' }).returning();
    tripIds.push(trip.id);
    const result = await updateTripWithRevision(db, trip.id, 1, { title: 'Synthetic new title' });
    expect(result.status).toBe('updated');
    if (result.status !== 'updated') throw new Error('Unexpected update result');
    expect(result.trip.revision).toBe(2);
    const stale = await updateTripWithRevision(db, trip.id, 1, { isArchived: true });
    expect(stale).toEqual({ status: 'conflict', currentRevision: 2 });
    const archived = await updateTripWithRevision(db, trip.id, 2, { isArchived: true });
    expect(archived.status).toBe('updated');
    const visible = await store.listTrips();
    expect(JSON.stringify(visible)).not.toContain(trip.id);
    const withArchived = await store.listTrips(true);
    expect(JSON.stringify(withArchived)).toContain(trip.id);
    const restored = await updateTripWithRevision(db, trip.id, 3, { isArchived: false });
    expect(restored.status).toBe('updated');
    expect(JSON.stringify(await store.listTrips())).toContain(trip.id);
  });

  it('hides archived geographic features without erasing their Visits', async () => {
    const [trip] = await db.insert(trips).values({ title: 'Synthetic archived feature' }).returning();
    tripIds.push(trip.id);
    const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
    const [place] = await db.insert(places).values({
      name: 'Synthetic point', location: [0, 0], locationConfidence: 'estimated',
    }).returning();
    placeIds.push(place.id);
    await db.insert(visits).values({ tripId: trip.id, tripDayId: day.id, position: 0, placeId: place.id });
    expect(JSON.stringify(await store.getExplore())).toContain(trip.id);
    await updateTripWithRevision(db, trip.id, 1, { isArchived: true });
    expect(JSON.stringify(await store.getExplore())).not.toContain(trip.id);
    const retained = await db.select().from(visits).where(eq(visits.tripId, trip.id));
    expect(retained).toHaveLength(1);
  });
});
