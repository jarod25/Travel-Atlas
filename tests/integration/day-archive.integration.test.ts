import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { setDayArchivedWithRevision } from '../../packages/database/src/day-archive';
import { appendVisitToDay, archiveVisitFromDay, reorderVisitsInDay } from '../../packages/database/src/visit-repository';
import { connectAdjacentDays } from '../../packages/database/src/day-connection';
import { legs, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
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
  const [trip] = await db.insert(trips).values({ title: 'Synthetic day archive' }).returning();
  tripIds.push(trip.id);
  const days = await db.insert(tripDays).values([
    { tripId: trip.id, position: 0 },
    { tripId: trip.id, position: 1 },
  ]).returning();
  const first = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
  const second = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[0].id });
  const third = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[1].id });
  const fourth = await appendVisitToDay(db, { tripId: trip.id, tripDayId: days[1].id });
  const connection = await connectAdjacentDays(db, {
    tripId: trip.id, fromDayId: days[0].id, toDayId: days[1].id,
  });
  expect(connection.status).toBe('connected');
  return { trip, days, ids: [first.visit.id, second.visit.id, third.visit.id, fourth.visit.id] };
}

describe('Day archive with retained Leg history', () => {
  it('archives only touching links, preserves visits and never invents inter-day travel on restore', async () => {
    const f = await fixture();
    const before = await db.select().from(legs).where(eq(legs.tripId, f.trip.id));
    expect(before.filter((leg) => leg.isCurrent)).toHaveLength(3);
    const archived = await setDayArchivedWithRevision(db, {
      tripId: f.trip.id, dayId: f.days[0].id, revision: 1, isArchived: true,
    });
    expect(archived.status).toBe('updated');
    if (archived.status !== 'updated') throw new Error('Expected updated day');
    expect(archived.day.isArchived).toBe(true);
    expect(archived.day.revision).toBe(2);

    const during = await db.select().from(legs).where(eq(legs.tripId, f.trip.id));
    expect(during.filter((leg) => !leg.isCurrent)).toHaveLength(2);
    expect(during.filter((leg) => leg.isCurrent)).toHaveLength(1);
    const allVisits = await db.select().from(visits).where(eq(visits.tripId, f.trip.id));
    expect(allVisits).toHaveLength(4);
    expect(allVisits.every((visit) => !visit.isArchived)).toBe(true);

    const restored = await setDayArchivedWithRevision(db, {
      tripId: f.trip.id, dayId: f.days[0].id, revision: 2, isArchived: false,
    });
    expect(restored.status).toBe('updated');
    if (restored.status !== 'updated') throw new Error('Expected restored day');
    expect(restored.day.isArchived).toBe(false);
    expect(restored.day.revision).toBe(3);

    const after = await db.select().from(legs).where(eq(legs.tripId, f.trip.id));
    expect(after.filter((leg) => !leg.isCurrent)).toHaveLength(2);
    const active = after.filter((leg) => leg.isCurrent);
    expect(active).toHaveLength(2);
    expect(active.some((leg) =>
      leg.fromVisitId === f.ids[0] && leg.toVisitId === f.ids[1] &&
      leg.transportMode === null && leg.movementConfidence === 'unknown')).toBe(true);
    expect(active.some((leg) =>
      leg.fromVisitId === f.ids[1] && leg.toVisitId === f.ids[2])).toBe(false);
    expect(active.some((leg) =>
      leg.fromVisitId === f.ids[2] && leg.toVisitId === f.ids[3])).toBe(true);
  });

  it('rejects stale revisions and unauthorized trip/day pair without mutation', async () => {
    const f = await fixture();
    const [otherTrip] = await db.insert(trips).values({ title: 'Synthetic other trip' }).returning();
    tripIds.push(otherTrip.id);
    expect(await setDayArchivedWithRevision(db, {
      tripId: otherTrip.id, dayId: f.days[0].id, revision: 1, isArchived: true,
    })).toEqual({ status: 'not_found' });
    await setDayArchivedWithRevision(db, {
      tripId: f.trip.id, dayId: f.days[0].id, revision: 1, isArchived: true,
    });
    expect(await setDayArchivedWithRevision(db, {
      tripId: f.trip.id, dayId: f.days[0].id, revision: 1, isArchived: false,
    })).toEqual({ status: 'conflict', currentRevision: 2 });
    const same = await setDayArchivedWithRevision(db, {
      tripId: f.trip.id, dayId: f.days[0].id, revision: 2, isArchived: true,
    });
    expect(same.status).toBe('updated');
    if (same.status === 'updated') expect(same.day.revision).toBe(2);
    const [day] = await db.select().from(tripDays).where(eq(tripDays.id, f.days[0].id));
    expect(day.isArchived).toBe(true);
    expect(day.revision).toBe(2);
  });

  it('prevents mutations inside an archived day but allows its later restoration', async () => {
    const f = await fixture();
    await setDayArchivedWithRevision(db, {
      tripId: f.trip.id, dayId: f.days[0].id, revision: 1, isArchived: true,
    });
    await expect(appendVisitToDay(db, {
      tripId: f.trip.id, tripDayId: f.days[0].id,
    })).rejects.toThrow('Trip day is archived');
    await expect(reorderVisitsInDay(db, {
      tripId: f.trip.id, tripDayId: f.days[0].id,
      orderedVisitIds: [f.ids[1], f.ids[0]],
    })).rejects.toThrow('Trip day is archived');
    await expect(archiveVisitFromDay(db, {
      tripId: f.trip.id, tripDayId: f.days[0].id, visitId: f.ids[0],
    })).rejects.toThrow('Trip day is archived');
    expect(await db.select().from(visits).where(eq(visits.tripId, f.trip.id)))
      .toHaveLength(4);
    const restored = await setDayArchivedWithRevision(db, {
      tripId: f.trip.id, dayId: f.days[0].id, revision: 2, isArchived: false,
    });
    expect(restored.status).toBe('updated');
    const afterAppend = await appendVisitToDay(db, {
      tripId: f.trip.id, tripDayId: f.days[0].id,
    });
    expect(afterAppend.visit.position).toBe(2);
  });
});
