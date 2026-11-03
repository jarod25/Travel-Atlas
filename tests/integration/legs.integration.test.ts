import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { legs, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL must point to a disposable integration-test database.');
}
const client = postgres(url, { max: 1 });
const db = drizzle(client);
const tripIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});

afterAll(async () => {
  for (const id of tripIds) {
    // Legs deliberately have no cascading FK: remove them before fixture trips.
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await client.end();
});

function errorCode(error: unknown): string | undefined {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}

async function fixture(title: string, count = 3) {
  const [trip] = await db.insert(trips).values({ title }).returning();
  tripIds.push(trip.id);
  const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
  const points = await db.insert(visits).values(
    Array.from({ length: count }, (_, position) => ({
      tripId: trip.id, tripDayId: day.id, position,
    })),
  ).returning();
  return { trip, day, points };
}

async function rejectCode(action: () => Promise<unknown>, expected: string) {
  try {
    await action();
    throw new Error('Expected database constraint rejection');
  } catch (error) {
    expect(errorCode(error)).toBe(expected);
  }
}

describe('Persisted Legs', () => {
  it('creates a draft with unknown dimensions and no invented timestamps', async () => {
    const { trip, points } = await fixture('Leg defaults');
    const [leg] = await db.insert(legs).values({
      tripId: trip.id,
      fromVisitId: points[0].id,
      toVisitId: points[1].id,
    }).returning();
    expect(leg.isCurrent).toBe(true);
    expect(leg.transportMode).toBeNull();
    expect([leg.movementConfidence, leg.transportConfidence, leg.geometryConfidence]).toEqual([
      'unknown', 'unknown', 'unknown',
    ]);
    expect(leg.departureLocalDate).toBeNull();
    expect(leg.departureLocalTime).toBeNull();
    expect(leg.departureTimeZone).toBeNull();
    expect(leg.arrivalLocalDate).toBeNull();
  });

  it('disallows cross-trip endpoints, including a mismatched trip id', async () => {
    const one = await fixture('Leg source');
    const two = await fixture('Leg destination');
    await rejectCode(() => db.insert(legs).values({
      tripId: one.trip.id, fromVisitId: one.points[0].id, toVisitId: two.points[0].id,
    }), '23503');
    await rejectCode(() => db.insert(legs).values({
      tripId: two.trip.id, fromVisitId: one.points[0].id, toVisitId: one.points[1].id,
    }), '23503');
  });

  it('rejects self-referencing legs and duplicate current incoming/outgoing links', async () => {
    const { trip, points } = await fixture('Leg cardinality');
    await rejectCode(() => db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[0].id,
    }), '23514');
    const [existing] = await db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[1].id,
    }).returning();
    await rejectCode(() => db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[2].id,
    }), '23505');
    await rejectCode(() => db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[2].id, toVisitId: points[1].id,
    }), '23505');
    await db.update(legs).set({ isCurrent: false }).where(eq(legs.id, existing.id));
    const [next] = await db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[1].id,
    }).returning();
    expect(next.isCurrent).toBe(true);
  });

  it('stores local time with unknown time zone without inventing a UTC instant', async () => {
    const { trip, points } = await fixture('Leg local time');
    const [leg] = await db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[1].id,
      transportMode: 'train', movementConfidence: 'confirmed',
      transportConfidence: 'confirmed', geometryConfidence: 'unknown',
      departureLocalDate: '2026-09-12', departureLocalTime: '14:30:00',
      departureTimeConfidence: 'estimated',
    }).returning();
    expect(leg.departureLocalDate).toBe('2026-09-12');
    expect(leg.departureLocalTime).toBe('14:30:00');
    expect(leg.departureTimeZone).toBeNull();
    expect(leg.departureTimeConfidence).toBe('estimated');
    expect(leg.geometryConfidence).toBe('unknown');
  });

  it('rejects an isolated clock time without a calendar date', async () => {
    const { trip, points } = await fixture('Leg invalid time');
    await rejectCode(() => db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[1].id,
      arrivalLocalTime: '17:00:00',
    }), '23514');
  });

  it('permits a cross-day link only as an explicit record (no automatic trigger)', async () => {
    const { trip, points } = await fixture('Explicit cross-day');
    const [other] = await db.insert(tripDays).values({ tripId: trip.id, position: 1 }).returning();
    const [later] = await db.insert(visits).values({
      tripId: trip.id, tripDayId: other.id, position: 0,
    }).returning();
    const [leg] = await db.insert(legs).values({
      tripId: trip.id, fromVisitId: points[0].id, toVisitId: later.id,
    }).returning();
    expect(leg.toVisitId).toBe(later.id);
  });
});
