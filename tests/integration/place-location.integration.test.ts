import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { legs, places, routeProposals, tripDays, trips, visits } from '../../packages/database/src/schema';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 1 });
const db = drizzle(client);
const ids: string[] = [];
const tripIds: string[] = [];
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) {
    await db.delete(routeProposals).where(eq(routeProposals.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  for (const id of ids) await db.delete(places).where(eq(places.id, id));
  await client.end();
});
describe('Place coordinate certainty', () => {
  it('preserves a valid (0,0) point distinct from NULL', async () => {
    const [known] = await db
      .insert(places)
      .values({
        name: 'Synthetic origin',
        location: [0, 0],
        locationConfidence: 'estimated',
      })
      .returning();
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
    await expect(
      db
        .update(places)
        .set({ location: [190, 0], locationConfidence: 'estimated' })
        .where(eq(places.id, place.id)),
    ).rejects.toBeDefined();
    await expect(
      db.update(places).set({ locationConfidence: 'confirmed' }).where(eq(places.id, place.id)),
    ).rejects.toBeDefined();
  });
  it('invalidates pending proposals from a moved shared Place, without altering history', async () => {
    const [origin] = await db
      .insert(places)
      .values({
        name: 'Synthetic shared origin',
        location: [1, 2],
        locationConfidence: 'estimated',
      })
      .returning();
    const [destination] = await db
      .insert(places)
      .values({ name: 'Synthetic destination' })
      .returning();
    ids.push(origin.id, destination.id);
    const [trip] = await db
      .insert(trips)
      .values({ title: 'Synthetic proposal dependency' })
      .returning();
    tripIds.push(trip.id);
    const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
    const [from] = await db
      .insert(visits)
      .values({ tripId: trip.id, tripDayId: day.id, position: 0, placeId: origin.id })
      .returning();
    const [to] = await db
      .insert(visits)
      .values({ tripId: trip.id, tripDayId: day.id, position: 1, placeId: destination.id })
      .returning();
    const [leg] = await db
      .insert(legs)
      .values({
        tripId: trip.id,
        fromVisitId: from.id,
        toVisitId: to.id,
        transportMode: 'train',
        transportConfidence: 'confirmed',
      })
      .returning();
    const [pending] = await db
      .insert(routeProposals)
      .values({
        tripId: trip.id,
        legId: leg.id,
        fromVisitId: from.id,
        toVisitId: to.id,
        transportMode: 'train',
      })
      .returning();
    const store = createAtlasStore(url!);
    try {
      // Certainty-only changes do not alter the inputs used for routing.
      await store.updatePlace(origin.id, [1, 2], 'confirmed');
      let [proposal] = await db
        .select()
        .from(routeProposals)
        .where(eq(routeProposals.id, pending.id));
      expect(proposal.status).toBe('pending');
      await store.updatePlace(origin.id, [3, 4], 'estimated');
      [proposal] = await db
        .select()
        .from(routeProposals)
        .where(eq(routeProposals.id, pending.id));
      expect(proposal.status).toBe('invalidated');
      expect(proposal.reviewedAt).toBeInstanceOf(Date);
      const [savedLeg] = await db.select().from(legs).where(eq(legs.id, leg.id));
      expect(savedLeg.isCurrent).toBe(true);
      expect(savedLeg.transportMode).toBe('train');
      expect(savedLeg.transportConfidence).toBe('confirmed');
    } finally {
      await store.close();
    }
  });
});
