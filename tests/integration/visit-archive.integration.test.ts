import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  appendVisitToDay,
  archiveVisitFromDay,
  reorderVisitsInDay,
} from '../../packages/database/src/visit-repository';
import { legs, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL must point to a disposable integration-test database.');
}
const client = postgres(url, { max: 5 });
const db = drizzle(client);
const tripIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) {
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await client.end();
});

async function fixture() {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic visit archive' }).returning();
  tripIds.push(trip.id);
  const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
  const results = [];
  for (let index = 0; index < 3; index += 1) {
    results.push(await appendVisitToDay(db, { tripId: trip.id, tripDayId: day.id }));
  }
  return { trip, day, ids: results.map((r) => r.visit.id) };
}

describe('Atomic visit archival', () => {
  it('archives a Visit and its current legs while preserving history', async () => {
    const { trip, day, ids } = await fixture();
    const result = await archiveVisitFromDay(db, {
      tripId: trip.id,
      tripDayId: day.id,
      visitId: ids[1],
    });
    expect(result).toEqual({
      archivedVisitId: ids[1],
      archivedLegCount: 2,
      newLegCount: 1,
    });
    const all = await db.select().from(legs).where(eq(legs.tripId, trip.id));
    expect(all.filter((leg) => !leg.isCurrent)).toHaveLength(2);
    const activeLegs = all.filter((leg) => leg.isCurrent);
    expect(activeLegs).toHaveLength(1);
    expect(activeLegs[0].fromVisitId).toBe(ids[0]);
    expect(activeLegs[0].toVisitId).toBe(ids[2]);
    expect(activeLegs[0].transportMode).toBeNull();
    const rows = await db.select().from(visits).where(eq(visits.tripDayId, day.id));
    expect(rows.find((visit) => visit.id === ids[1])?.isArchived).toBe(true);
    const active = rows
      .filter((visit) => !visit.isArchived)
      .sort((a, b) => a.position - b.position);
    expect(active.map((visit) => [visit.id, visit.position])).toEqual([
      [ids[0], 0],
      [ids[2], 1],
    ]);
  });

  it('keeps unrelated known Legs current when archiving an edge Visit', async () => {
    const { trip, day, ids } = await fixture();
    const known = (await db.select().from(legs).where(eq(legs.tripId, trip.id))).find(
      (leg) => leg.fromVisitId === ids[1] && leg.toVisitId === ids[2],
    );
    if (!known) throw new Error('Expected known Leg');
    await db
      .update(legs)
      .set({
        transportMode: 'train',
        transportConfidence: 'confirmed',
        movementConfidence: 'confirmed',
      })
      .where(eq(legs.id, known.id));
    expect(
      await archiveVisitFromDay(db, {
        tripId: trip.id,
        tripDayId: day.id,
        visitId: ids[0],
      }),
    ).toEqual({
      archivedVisitId: ids[0],
      archivedLegCount: 1,
      newLegCount: 0,
    });
    const after = await db.select().from(legs).where(eq(legs.tripId, trip.id));
    const retained = after.find((leg) => leg.id === known.id);
    expect(retained?.isCurrent).toBe(true);
    expect(retained?.transportMode).toBe('train');
    expect(retained?.movementConfidence).toBe('confirmed');
    expect(after.filter((leg) => !leg.isCurrent)).toHaveLength(1);
  });

  it('allows append and reorder without touching archived visits', async () => {
    const { trip, day, ids } = await fixture();
    await archiveVisitFromDay(db, { tripId: trip.id, tripDayId: day.id, visitId: ids[1] });
    const added = await appendVisitToDay(db, { tripId: trip.id, tripDayId: day.id });
    expect(added.visit.position).toBe(2);
    const result = await reorderVisitsInDay(db, {
      tripId: trip.id,
      tripDayId: day.id,
      orderedVisitIds: [added.visit.id, ids[0], ids[2]],
    });
    expect(result.changed).toBe(true);
    const active = (await db.select().from(visits).where(eq(visits.tripDayId, day.id)))
      .filter((visit) => !visit.isArchived)
      .sort((a, b) => a.position - b.position);
    expect(active.map((visit) => visit.id)).toEqual([added.visit.id, ids[0], ids[2]]);
    const [archived] = await db.select().from(visits).where(eq(visits.id, ids[1]));
    expect(archived.isArchived).toBe(true);
  });

  it('rejects archiving another-day visit and leaves the timeline unchanged', async () => {
    const { trip, day, ids } = await fixture();
    const [otherDay] = await db
      .insert(tripDays)
      .values({ tripId: trip.id, position: 1 })
      .returning();
    const other = await appendVisitToDay(db, { tripId: trip.id, tripDayId: otherDay.id });
    await expect(
      archiveVisitFromDay(db, {
        tripId: trip.id,
        tripDayId: day.id,
        visitId: other.visit.id,
      }),
    ).rejects.toThrow('Visit not found');
    const active = await db
      .select()
      .from(visits)
      .where(eq(visits.tripDayId, day.id))
      .orderBy(asc(visits.position));
    expect(active.map((visit) => visit.id)).toEqual(ids);
  });

  it('rejects removing a Visit involved in current explicit cross-day link', async () => {
    const { trip, day, ids } = await fixture();
    const [otherDay] = await db
      .insert(tripDays)
      .values({ tripId: trip.id, position: 1 })
      .returning();
    const [outside] = await db
      .insert(visits)
      .values({
        tripId: trip.id,
        tripDayId: otherDay.id,
        position: 0,
      })
      .returning();
    await db.insert(legs).values({ tripId: trip.id, fromVisitId: ids[2], toVisitId: outside.id });
    await expect(
      archiveVisitFromDay(db, {
        tripId: trip.id,
        tripDayId: day.id,
        visitId: ids[1],
      }),
    ).rejects.toThrow('current cross-day connection');
    const [unchanged] = await db.select().from(visits).where(eq(visits.id, ids[1]));
    expect(unchanged.isArchived).toBe(false);
  });
});
