import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { updateLegWithRevision } from '../../packages/database/src/leg-repository';
import { legs, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 3 });
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

describe('Leg time precision independent of certainty', () => {
  it('keeps approximate confirmed times and validates midnight-spanning ranges', async () => {
    const [trip] = await db.insert(trips).values({ title: 'Synthetic Leg time range' }).returning();
    tripIds.push(trip.id);
    const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
    const points = await db
      .insert(visits)
      .values([
        { tripId: trip.id, tripDayId: day.id, position: 0 },
        { tripId: trip.id, tripDayId: day.id, position: 1 },
      ])
      .returning();
    const [leg] = await db
      .insert(legs)
      .values({ tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[1].id })
      .returning();

    const approximate = await updateLegWithRevision(db, leg.id, 1, {
      departureLocalDate: '2026-09-12',
      departureLocalTime: '14:00:00',
      departureTimePrecision: 'approximate',
      departureTimeConfidence: 'confirmed',
    });
    expect(approximate.status).toBe('updated');
    if (approximate.status !== 'updated') throw new Error('Expected edited Leg');
    expect(approximate.leg.departureTimePrecision).toBe('approximate');
    expect(approximate.leg.departureTimeConfidence).toBe('confirmed');

    const ranged = await updateLegWithRevision(db, leg.id, 2, {
      departureLocalDate: '2026-09-12',
      departureLocalTime: '23:55:00',
      departureTimePrecision: 'range',
      departureRangeEndLocalDate: '2026-09-13',
      departureRangeEndLocalTime: '00:20:00',
    });
    expect(ranged.status).toBe('updated');
    if (ranged.status !== 'updated') throw new Error('Expected recorded time range');
    expect(ranged.leg.departureRangeEndLocalDate).toBe('2026-09-13');
    expect(ranged.leg.departureTimeConfidence).toBe('confirmed');

    const invalid = await updateLegWithRevision(db, leg.id, 3, {
      departureRangeEndLocalDate: '2026-09-12',
      departureRangeEndLocalTime: '23:00:00',
    });
    expect(invalid).toEqual({ status: 'invalid_times' });

    const reset = await updateLegWithRevision(db, leg.id, 3, {
      departureTimePrecision: 'unspecified',
      departureRangeEndLocalDate: null,
      departureRangeEndLocalTime: null,
    });
    expect(reset.status).toBe('updated');
    if (reset.status !== 'updated') throw new Error('Expected reset');
    expect(reset.leg.departureTimePrecision).toBe('unspecified');
    expect(reset.leg.departureRangeEndLocalDate).toBeNull();
  });
});
