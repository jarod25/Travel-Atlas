import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { connectAdjacentDays } from '../../packages/database/src/day-connection';
import { legs, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 4 });
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
async function fixture(dayCount = 2) {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic adjacent days' }).returning();
  tripIds.push(trip.id);
  const days = await db
    .insert(tripDays)
    .values(Array.from({ length: dayCount }, (_, position) => ({ tripId: trip.id, position })))
    .returning();
  const points = await db
    .insert(visits)
    .values(
      days.map((day) => ({
        tripId: trip.id,
        tripDayId: day.id,
        position: 0,
      })),
    )
    .returning();
  return { trip, days, points };
}

describe('Explicit Connect Days', () => {
  it('only creates one unknown draft Leg after explicit action, idempotently', async () => {
    const f = await fixture();
    expect(await db.select().from(legs).where(eq(legs.tripId, f.trip.id))).toHaveLength(0);
    const first = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
    });
    expect(first.status).toBe('connected');
    if (first.status !== 'connected') throw new Error('Unexpected connection result');
    expect(first.created).toBe(true);
    expect(first.leg.fromVisitId).toBe(f.points[0].id);
    expect(first.leg.toVisitId).toBe(f.points[1].id);
    expect(first.leg.transportMode).toBeNull();
    expect(first.leg.movementConfidence).toBe('unknown');
    expect(first.leg.geometryConfidence).toBe('unknown');
    const repeated = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
    });
    expect(repeated.status).toBe('connected');
    if (repeated.status === 'connected') expect(repeated.created).toBe(false);
    expect(await db.select().from(legs).where(eq(legs.tripId, f.trip.id))).toHaveLength(1);
  });

  it('rejects backwards and skipped days, and links to another Trip', async () => {
    const f = await fixture(3);
    const other = await fixture();
    const reversed = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[1].id,
      toDayId: f.days[0].id,
    });
    expect(reversed.status).toBe('invalid');
    const skipped = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[2].id,
    });
    expect(skipped.status).toBe('invalid');
    expect(
      await connectAdjacentDays(db, {
        tripId: f.trip.id,
        fromDayId: f.days[0].id,
        toDayId: other.days[1].id,
      }),
    ).toEqual({ status: 'not_found' });
  });

  it('rejects empty days without manufacturing Visits or routes', async () => {
    const f = await fixture();
    await db.delete(visits).where(eq(visits.id, f.points[1].id));
    const result = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
    });
    expect(result.status).toBe('invalid');
    expect(await db.select().from(legs).where(eq(legs.tripId, f.trip.id))).toHaveLength(0);
  });
});
