import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { places, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL must point to a disposable integration-test database.');
}
const client = postgres(url, { max: 1 });
const db = drizzle(client);
const tripIds: string[] = [];
const placeIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});

afterAll(async () => {
  for (const id of tripIds) {
    await db.delete(trips).where(eq(trips.id, id));
  }
  for (const id of placeIds) {
    await db.delete(places).where(eq(places.id, id));
  }
  await client.end();
});

function pgCode(error: unknown): string | undefined {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}

async function newTrip(title: string) {
  const [trip] = await db.insert(trips).values({ title }).returning();
  tripIds.push(trip.id);
  return trip;
}

describe('Persisted ordered visits', () => {
  it('reuses one place across multiple visits, including on another day', async () => {
    const trip = await newTrip('Synthetic repeated place');
    const [dayOne, dayTwo] = await db
      .insert(tripDays)
      .values([
        { tripId: trip.id, position: 0, localDate: '2026-09-12' },
        { tripId: trip.id, position: 1, localDate: null },
      ])
      .returning();
    const [place] = await db.insert(places).values({ name: 'Synthetic station' }).returning();
    placeIds.push(place.id);

    const inserted = await db
      .insert(visits)
      .values([
        { tripId: trip.id, tripDayId: dayOne.id, placeId: place.id, position: 0 },
        { tripId: trip.id, tripDayId: dayOne.id, placeId: null, position: 1 },
        { tripId: trip.id, tripDayId: dayTwo.id, placeId: place.id, position: 0 },
      ])
      .returning();

    expect(inserted).toHaveLength(3);
    const rows = await db.select().from(visits).where(eq(visits.tripId, trip.id));
    expect(rows.filter((v) => v.placeId === place.id)).toHaveLength(2);
    expect(rows.find((v) => v.placeId === null)?.position).toBe(1);
    expect(dayTwo.localDate).toBeNull();
  });

  it('rejects a visit whose trip and day belong to different trips', async () => {
    const first = await newTrip('Synthetic trip A');
    const second = await newTrip('Synthetic trip B');
    const [day] = await db
      .insert(tripDays)
      .values({ tripId: first.id, position: 0 })
      .returning();

    try {
      await db.insert(visits).values({ tripId: second.id, tripDayId: day.id, position: 0 });
      throw new Error('Expected mismatched trip/day to be rejected');
    } catch (error) {
      expect(pgCode(error)).toBe('23503');
    }
  });

  it('rejects duplicate and negative positions within a day', async () => {
    const trip = await newTrip('Synthetic positions');
    const [day] = await db
      .insert(tripDays)
      .values({ tripId: trip.id, position: 0 })
      .returning();

    await db.insert(visits).values({ tripId: trip.id, tripDayId: day.id, position: 0 });

    for (const invalidPosition of [0, -1]) {
      try {
        await db
          .insert(visits)
          .values({ tripId: trip.id, tripDayId: day.id, position: invalidPosition });
        throw new Error('Expected invalid position to be rejected');
      } catch (error) {
        expect(pgCode(error)).toBe(invalidPosition === 0 ? '23505' : '23514');
      }
    }
  });

  it('cascades visits on day deletion, without deleting the reusable place', async () => {
    const trip = await newTrip('Synthetic cascade');
    const [day] = await db
      .insert(tripDays)
      .values({ tripId: trip.id, position: 0 })
      .returning();
    const [place] = await db.insert(places).values({ name: 'Reusable place' }).returning();
    placeIds.push(place.id);
    const [visit] = await db
      .insert(visits)
      .values({ tripId: trip.id, tripDayId: day.id, placeId: place.id, position: 0 })
      .returning();

    await db.delete(tripDays).where(eq(tripDays.id, day.id));
    expect(await db.select().from(visits).where(eq(visits.id, visit.id))).toHaveLength(0);
    expect(await db.select().from(places).where(eq(places.id, place.id))).toHaveLength(1);
  });

  it('supports independent ordering within different days', async () => {
    const indexes = await db.execute(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'visits' AND constraint_name = 'visits_day_position_unique'
    `);
    expect(indexes).toHaveLength(1);
  });
});
