import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { reassignVisitPlace } from '../../packages/database/src/visit-repository';
import {
  legs,
  places,
  routeProposals,
  tripDays,
  trips,
  visits,
} from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 5 });
const db = drizzle(client);
const tripIds: string[] = [];
const placeIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) {
    await db.delete(routeProposals).where(eq(routeProposals.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  for (const id of placeIds) await db.delete(places).where(eq(places.id, id));
  await client.end();
});

describe('Existing Visit Place correction', () => {
  it('preserves Leg identity and facts while invalidating pending route calculations', async () => {
    const [firstPlace] = await db.insert(places).values({ name: 'Synthetic old Place' }).returning();
    const [newPlace] = await db.insert(places).values({ name: 'Synthetic corrected Place' }).returning();
    placeIds.push(firstPlace.id, newPlace.id);
    const [trip] = await db.insert(trips).values({ title: 'Synthetic correction' }).returning();
    tripIds.push(trip.id);
    const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
    const [first] = await db
      .insert(visits)
      .values({ tripId: trip.id, tripDayId: day.id, placeId: firstPlace.id, position: 0 })
      .returning();
    const [second] = await db
      .insert(visits)
      .values({ tripId: trip.id, tripDayId: day.id, position: 1 })
      .returning();
    const [leg] = await db
      .insert(legs)
      .values({
        tripId: trip.id,
        fromVisitId: first.id,
        toVisitId: second.id,
        transportMode: 'train',
        transportConfidence: 'confirmed',
      })
      .returning();
    const [proposal] = await db
      .insert(routeProposals)
      .values({
        tripId: trip.id,
        legId: leg.id,
        fromVisitId: first.id,
        toVisitId: second.id,
        transportMode: 'train',
      })
      .returning();

    const edited = await reassignVisitPlace(db, {
      tripId: trip.id,
      tripDayId: day.id,
      visitId: first.id,
      expectedRevision: 1,
      placeId: newPlace.id,
    });
    expect(edited.status).toBe('updated');
    if (edited.status !== 'updated') throw new Error('Expected Visit update');
    expect(edited.visit.id).toBe(first.id);
    expect(edited.visit.revision).toBe(2);
    expect(edited.visit.placeId).toBe(newPlace.id);
    const [savedLeg] = await db.select().from(legs).where(eq(legs.id, leg.id));
    expect(savedLeg.isCurrent).toBe(true);
    expect(savedLeg.transportMode).toBe('train');
    expect(savedLeg.transportConfidence).toBe('confirmed');
    const [savedProposal] = await db.select().from(routeProposals).where(eq(routeProposals.id, proposal.id));
    expect(savedProposal.status).toBe('invalidated');
    expect(savedProposal.reviewedAt).toBeInstanceOf(Date);

    const conflict = await reassignVisitPlace(db, {
      tripId: trip.id,
      tripDayId: day.id,
      visitId: first.id,
      expectedRevision: 1,
      placeId: firstPlace.id,
    });
    expect(conflict).toEqual({ status: 'conflict', currentRevision: 2 });
    const [stillEdited] = await db.select().from(visits).where(eq(visits.id, first.id));
    expect(stillEdited.placeId).toBe(newPlace.id);

    const noChange = await reassignVisitPlace(db, {
      tripId: trip.id,
      tripDayId: day.id,
      visitId: first.id,
      expectedRevision: 2,
      placeId: newPlace.id,
    });
    expect(noChange.status).toBe('updated');
    if (noChange.status === 'updated') expect(noChange.visit.revision).toBe(2);

    await db.update(tripDays).set({ isArchived: true }).where(eq(tripDays.id, day.id));
    const archived = await reassignVisitPlace(db, {
      tripId: trip.id,
      tripDayId: day.id,
      visitId: first.id,
      expectedRevision: 2,
      placeId: firstPlace.id,
    });
    expect(archived.status).toBe('archived');
  });
});
