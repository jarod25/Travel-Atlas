import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  connectAdjacentDays,
  disconnectAdjacentDays,
} from '../../packages/database/src/day-connection';
import { appendVisitToDay } from '../../packages/database/src/visit-repository';
import { legs, routeProposals, tripDays, trips, visits } from '../../packages/database/src/schema';

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
    await db.delete(routeProposals).where(eq(routeProposals.tripId, id));
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

  it('requires an explicit disconnect before appending after a connected day boundary', async () => {
    const f = await fixture();
    expect(
      (
        await connectAdjacentDays(db, {
          tripId: f.trip.id,
          fromDayId: f.days[0].id,
          toDayId: f.days[1].id,
        })
      ).status,
    ).toBe('connected');
    await expect(
      appendVisitToDay(db, { tripId: f.trip.id, tripDayId: f.days[0].id }),
    ).rejects.toThrow('Disconnect the current cross-day Leg');
    expect(await db.select().from(visits).where(eq(visits.tripDayId, f.days[0].id))).toHaveLength(
      1,
    );
  });

  it('disconnects only the exact current boundary while keeping known history', async () => {
    const f = await fixture();
    const connected = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
    });
    if (connected.status !== 'connected') throw new Error('Expected connected days');
    await db
      .update(legs)
      .set({
        transportMode: 'train',
        movementConfidence: 'confirmed',
        transportConfidence: 'confirmed',
      })
      .where(eq(legs.id, connected.leg.id));
    const [proposal] = await db
      .insert(routeProposals)
      .values({
        tripId: f.trip.id,
        legId: connected.leg.id,
        fromVisitId: connected.leg.fromVisitId,
        toVisitId: connected.leg.toVisitId,
        transportMode: 'train',
      })
      .returning();
    const input = {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
      legId: connected.leg.id,
    };
    expect(await disconnectAdjacentDays(db, { ...input, revision: 3 })).toEqual({
      status: 'conflict',
      currentRevision: 1,
    });
    const disconnected = await disconnectAdjacentDays(db, { ...input, revision: 1 });
    expect(disconnected.status).toBe('disconnected');
    const [historic] = await db.select().from(legs).where(eq(legs.id, connected.leg.id));
    expect(historic.isCurrent).toBe(false);
    expect(historic.transportMode).toBe('train');
    expect(historic.movementConfidence).toBe('confirmed');
    expect(historic.transportConfidence).toBe('confirmed');
    const [stale] = await db
      .select()
      .from(routeProposals)
      .where(eq(routeProposals.id, proposal.id));
    expect(stale.status).toBe('invalidated');
    expect((await disconnectAdjacentDays(db, { ...input, revision: 1 })).status).toBe('invalid');
    const reconnected = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
    });
    expect(reconnected.status).toBe('connected');
    if (reconnected.status !== 'connected') throw new Error('Expected reconnected days');
    expect(reconnected.created).toBe(false);
    expect(reconnected.leg.id).toBe(connected.leg.id);
    expect(reconnected.leg.movementConfidence).toBe('confirmed');
    expect(reconnected.leg.transportMode).toBe('train');
    expect(reconnected.leg.transportConfidence).toBe('confirmed');
    expect(reconnected.leg.revision).toBe(3);
    expect(await db.select().from(legs).where(eq(legs.tripId, f.trip.id))).toHaveLength(1);
  });

  it('keeps ambiguous cross-day leg history without choosing a transport', async () => {
    const f = await fixture();
    const first = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
    });
    if (first.status !== 'connected') throw new Error('Expected initial Leg');
    const disconnected = await disconnectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
      legId: first.leg.id,
      revision: first.leg.revision,
    });
    expect(disconnected.status).toBe('disconnected');
    await db.insert(legs).values({
      tripId: f.trip.id,
      fromVisitId: f.points[0].id,
      toVisitId: f.points[1].id,
      isCurrent: false,
      transportMode: 'bus',
    });
    const reconnected = await connectAdjacentDays(db, {
      tripId: f.trip.id,
      fromDayId: f.days[0].id,
      toDayId: f.days[1].id,
    });
    expect(reconnected.status).toBe('connected');
    if (reconnected.status !== 'connected') throw new Error('Expected reconnect');
    expect(reconnected.created).toBe(true);
    expect(reconnected.leg.transportMode).toBeNull();
    expect(reconnected.leg.movementConfidence).toBe('unknown');
    const all = await db.select().from(legs).where(eq(legs.tripId, f.trip.id));
    expect(all.filter((leg) => leg.isCurrent)).toHaveLength(1);
    expect(all.filter((leg) => !leg.isCurrent)).toHaveLength(2);
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
