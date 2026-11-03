import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  legs,
  routeProposals,
  routeVersions,
  tripDays,
  trips,
  visits,
} from '../../packages/database/src/schema';

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
    await db.delete(routeProposals).where(eq(routeProposals.tripId, id));
    await db.update(legs).set({ selectedRouteVersionId: null }).where(eq(legs.tripId, id));
    await db.delete(routeVersions).where(eq(routeVersions.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await client.end();
});

function code(error: unknown) {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}
async function reject(action: () => Promise<unknown>, expected: string) {
  try {
    await action();
    throw new Error('Expected constraint violation');
  } catch (error) {
    expect(code(error)).toBe(expected);
  }
}
async function fixture() {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic proposal' }).returning();
  tripIds.push(trip.id);
  const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
  const points = await db
    .insert(visits)
    .values([
      { tripId: trip.id, tripDayId: day.id, position: 0 },
      { tripId: trip.id, tripDayId: day.id, position: 1 },
      { tripId: trip.id, tripDayId: day.id, position: 2 },
    ])
    .returning();
  const [first] = await db
    .insert(legs)
    .values({
      tripId: trip.id,
      fromVisitId: points[0].id,
      toVisitId: points[1].id,
    })
    .returning();
  const [second] = await db
    .insert(legs)
    .values({
      tripId: trip.id,
      fromVisitId: points[1].id,
      toVisitId: points[2].id,
    })
    .returning();
  return { trip, points, first, second };
}

describe('Persistent route proposals and guarded route selection', () => {
  it('stores pending parameters and geometry without selecting or confirming travel', async () => {
    const { trip, points, first } = await fixture();
    const line = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0, 1],
      ],
    };
    const [proposal] = await db
      .insert(routeProposals)
      .values({
        tripId: trip.id,
        legId: first.id,
        fromVisitId: points[0].id,
        toVisitId: points[1].id,
        transportMode: 'train',
        provider: 'synthetic',
        parameters: { profile: 'train', attempts: 1 },
        geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(line)}),4326)`,
      })
      .returning();
    expect(proposal.status).toBe('pending');
    expect(proposal.parameters).toEqual({ profile: 'train', attempts: 1 });
    expect(proposal.reviewedAt).toBeNull();
    const [leg] = await db.select().from(legs).where(eq(legs.id, first.id));
    expect(leg.selectedRouteVersionId).toBeNull();
    expect(leg.geometryConfidence).toBe('unknown');
    const rows = await db.execute(sql`SELECT ST_AsGeoJSON(geometry) AS route
      FROM route_proposals WHERE id = ${proposal.id}`);
    expect(JSON.parse(String(rows[0].route))).toEqual(line);
  });

  it('selects only a version belonging to the same Leg', async () => {
    const { trip, first, second } = await fixture();
    const [version] = await db
      .insert(routeVersions)
      .values({
        tripId: trip.id,
        legId: first.id,
        versionNumber: 1,
        confidence: 'estimated',
        origin: 'calculated',
      })
      .returning();
    await reject(
      () =>
        db.update(legs).set({ selectedRouteVersionId: version.id }).where(eq(legs.id, second.id)),
      '23503',
    );
    await db.update(legs).set({ selectedRouteVersionId: version.id }).where(eq(legs.id, first.id));
    const [selected] = await db.select().from(legs).where(eq(legs.id, first.id));
    expect(selected.selectedRouteVersionId).toBe(version.id);
    expect(selected.geometryConfidence).toBe('unknown');
  });

  it('requires reviewed timestamp when proposal status changes', async () => {
    const { trip, points, first } = await fixture();
    const [proposal] = await db
      .insert(routeProposals)
      .values({
        tripId: trip.id,
        legId: first.id,
        fromVisitId: points[0].id,
        toVisitId: points[1].id,
      })
      .returning();
    await reject(
      () =>
        db
          .update(routeProposals)
          .set({ status: 'accepted' })
          .where(eq(routeProposals.id, proposal.id)),
      '23514',
    );
    const [reviewed] = await db
      .update(routeProposals)
      .set({ status: 'invalidated', reviewedAt: new Date() })
      .where(eq(routeProposals.id, proposal.id))
      .returning();
    expect(reviewed.status).toBe('invalidated');
    expect(reviewed.reviewedAt).not.toBeNull();
  });

  it('rejects same-trip Leg violations', async () => {
    const a = await fixture();
    const b = await fixture();
    await reject(
      () =>
        db.insert(routeProposals).values({
          tripId: a.trip.id,
          legId: b.first.id,
          fromVisitId: a.points[0].id,
          toVisitId: a.points[1].id,
        }),
      '23503',
    );
  });
});
