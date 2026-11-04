import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { updateLegWithRevision } from '../../packages/database/src/leg-repository';
import {
  legs,
  routeProposals,
  routeVersions,
  tripDays,
  trips,
  visits,
} from '../../packages/database/src/schema';

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
    await db.update(legs).set({ selectedRouteVersionId: null }).where(eq(legs.tripId, id));
    await db.delete(routeVersions).where(eq(routeVersions.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await client.end();
});
async function fixture() {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic revision test' }).returning();
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
    .values({
      tripId: trip.id,
      fromVisitId: points[0].id,
      toVisitId: points[1].id,
      transportMode: 'train',
    })
    .returning();
  return { trip, leg, points };
}
describe('Leg revision transactions', () => {
  it('accepts a complete edit of a fresh Unknown draft with nullable times', async () => {
    const { leg } = await fixture();
    await db.update(legs).set({ transportMode: null }).where(eq(legs.id, leg.id));
    const updated = await updateLegWithRevision(db, leg.id, leg.revision, {
      transportMode: 'train',
      transportConfidence: 'confirmed',
      departureLocalDate: null,
      departureLocalTime: null,
      departureTimeConfidence: 'unknown',
      arrivalLocalDate: null,
      arrivalLocalTime: null,
      arrivalTimeConfidence: 'unknown',
    });
    expect(updated.status).toBe('updated');
    if (updated.status === 'updated') {
      expect(updated.leg.transportMode).toBe('train');
      expect(updated.leg.transportConfidence).toBe('confirmed');
    }
  });
  it('increments revisions and rejects stale concurrent changes', async () => {
    const { leg } = await fixture();
    expect(leg.revision).toBe(1);
    const first = await updateLegWithRevision(db, leg.id, 1, {
      transportConfidence: 'confirmed',
    });
    expect(first.status).toBe('updated');
    const stale = await updateLegWithRevision(db, leg.id, 1, { transportMode: 'bus' });
    expect(stale).toEqual({ status: 'conflict', currentRevision: 2 });
    const [saved] = await db.select().from(legs).where(eq(legs.id, leg.id));
    expect(saved.revision).toBe(2);
    expect(saved.transportMode).toBe('train');
  });

  it('invalidates pending proposals on transport change but retains accepted history', async () => {
    const { trip, leg, points } = await fixture();
    const [version] = await db
      .insert(routeVersions)
      .values({
        tripId: trip.id,
        legId: leg.id,
        versionNumber: 1,
        confidence: 'estimated',
      })
      .returning();
    await db
      .update(legs)
      .set({ selectedRouteVersionId: version.id, geometryConfidence: 'estimated' })
      .where(eq(legs.id, leg.id));
    const [candidate] = await db
      .insert(routeProposals)
      .values({
        tripId: trip.id,
        legId: leg.id,
        fromVisitId: points[0].id,
        toVisitId: points[1].id,
        transportMode: 'train',
      })
      .returning();
    const result = await updateLegWithRevision(db, leg.id, 1, { transportMode: 'bus' });
    expect(result.status).toBe('updated');
    const [saved] = await db.select().from(legs).where(eq(legs.id, leg.id));
    expect(saved.transportMode).toBe('bus');
    expect(saved.geometryConfidence).toBe('unknown');
    expect(saved.selectedRouteVersionId).toBeNull();
    const [invalid] = await db
      .select()
      .from(routeProposals)
      .where(eq(routeProposals.id, candidate.id));
    expect(invalid.status).toBe('invalidated');
    expect(invalid.reviewedAt).not.toBeNull();
    expect(
      await db.select().from(routeVersions).where(eq(routeVersions.legId, leg.id)),
    ).toHaveLength(1);
  });

  it('rejects changes to archived Trips and historical Legs without rewriting evidence', async () => {
    const { trip, leg } = await fixture();
    await db.update(trips).set({ isArchived: true }).where(eq(trips.id, trip.id));
    const archivedEdit = await updateLegWithRevision(db, leg.id, 1, { transportMode: 'bus' });
    expect(archivedEdit).toEqual({ status: 'not_found' });

    await db.update(trips).set({ isArchived: false }).where(eq(trips.id, trip.id));
    await db.update(legs).set({ isCurrent: false }).where(eq(legs.id, leg.id));
    const historicalEdit = await updateLegWithRevision(db, leg.id, 1, { transportMode: 'bus' });
    expect(historicalEdit).toEqual({ status: 'not_found' });

    const [unchanged] = await db.select().from(legs).where(eq(legs.id, leg.id));
    expect(unchanged.transportMode).toBe('train');
    expect(unchanged.revision).toBe(1);
    expect(unchanged.isCurrent).toBe(false);
  });
});
