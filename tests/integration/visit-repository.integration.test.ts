import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { appendVisitToDay } from '../../packages/database/src/visit-repository';
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

async function makeDays(count = 1) {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic append test' }).returning();
  tripIds.push(trip.id);
  const days = await db
    .insert(tripDays)
    .values(Array.from({ length: count }, (_, position) => ({ tripId: trip.id, position })))
    .returning();
  return { trip, days };
}

describe('appendVisitToDay transaction', () => {
  it('creates the first visit without inventing a preceding leg', async () => {
    const { trip, days } = await makeDays();
    const result = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
    expect(result.visit.position).toBe(0);
    expect(result.visit.placeId).toBeNull();
    expect(result.draftLeg).toBeNull();
    expect(await db.select().from(legs).where(eq(legs.tripId, trip.id))).toHaveLength(0);
  });

  it('appends adjacent visits and stores unknown draft transport and times', async () => {
    const { trip, days } = await makeDays();
    const first = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
    const second = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
    const third = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
    expect([first.visit.position, second.visit.position, third.visit.position]).toEqual([0, 1, 2]);
    expect(second.draftLeg?.fromVisitId).toBe(first.visit.id);
    expect(third.draftLeg?.fromVisitId).toBe(second.visit.id);
    expect(third.draftLeg?.transportMode).toBeNull();
    expect(third.draftLeg?.movementConfidence).toBe('unknown');
    expect(third.draftLeg?.geometryConfidence).toBe('unknown');
    expect(third.draftLeg?.departureLocalDate).toBeNull();
  });

  it('never creates a cross-day leg automatically', async () => {
    const { trip, days } = await makeDays(2);
    await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
    const other = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[1].id });
    expect(other.draftLeg).toBeNull();
    expect(await db.select().from(legs).where(eq(legs.tripId, trip.id))).toHaveLength(0);
  });

  it('rejects another trip day and leaves no visit or leg', async () => {
    const first = await makeDays();
    const second = await makeDays();
    await expect(
      appendVisitToDay(db, { tripId: first.trip.id, tripDayId: second.days[0].id }),
    ).rejects.toThrow('Trip day not found');
    expect(await db.select().from(visits).where(eq(visits.tripId, first.trip.id))).toHaveLength(0);
  });

  it('rolls back the appended visit if inserting the new leg fails', async () => {
    const { trip, days } = await makeDays();
    const first = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
    const [otherDay] = await db
      .insert(tripDays)
      .values({ tripId: trip.id, position: 1 })
      .returning();
    const [otherVisit] = await db
      .insert(visits)
      .values({ tripId: trip.id, tripDayId: otherDay.id, position: 0 })
      .returning();
    await db.insert(legs).values({
      tripId: trip.id,
      fromVisitId: first.visit.id,
      toVisitId: otherVisit.id,
    });

    await expect(
      appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id }),
    ).rejects.toThrow();

    const rows = await db.select().from(visits).where(eq(visits.tripDayId, days[0].id));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.visit.id);
    expect(await db.select().from(legs).where(eq(legs.tripId, trip.id))).toHaveLength(1);
  });

  it('serializes concurrent appends to the same day', async () => {
    const { trip, days } = await makeDays();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id }),
      ),
    );
    const rows = await db.select().from(visits).where(eq(visits.tripDayId, days[0].id));
    expect(rows.map((row) => row.position).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(await db.select().from(legs).where(eq(legs.tripId, trip.id))).toHaveLength(3);
  });
});
