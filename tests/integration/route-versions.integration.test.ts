import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { legs, routeVersions, routeWaypoints, tripDays, trips, visits } from '../../packages/database/src/schema';

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
    await db.execute(sql`DELETE FROM route_waypoints WHERE route_version_id IN (
      SELECT id FROM route_versions WHERE trip_id = ${id}
    )`);
    await db.delete(routeVersions).where(eq(routeVersions.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await client.end();
});

function pgCode(error: unknown) {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}
async function rejection(action: () => Promise<unknown>, code: string) {
  try {
    await action();
    throw new Error('Expected database rejection');
  } catch (error) {
    expect(pgCode(error)).toBe(code);
  }
}
async function fixture() {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic routes' }).returning();
  tripIds.push(trip.id);
  const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
  const points = await db.insert(visits).values([
    { tripId: trip.id, tripDayId: day.id, position: 0 },
    { tripId: trip.id, tripDayId: day.id, position: 1 },
  ]).returning();
  const [leg] = await db.insert(legs).values({
    tripId: trip.id, fromVisitId: points[0].id, toVisitId: points[1].id,
  }).returning();
  return { trip, leg };
}

describe('Versioned PostGIS route geometry', () => {
  it('round-trips LineString, MultiLineString and NULL with SRID 4326', async () => {
    const { trip, leg } = await fixture();
    const line = { type: 'LineString', coordinates: [[0, 0], [0, 1]] };
    const multi = { type: 'MultiLineString', coordinates: [[[0, 0], [0, 1]], [[1, 1], [2, 2]]] };
    for (const [index, geojson] of [line, multi].entries()) {
      await db.insert(routeVersions).values({
        tripId: trip.id, legId: leg.id, versionNumber: index + 1,
        geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}),4326)`,
        origin: 'calculated', confidence: 'estimated',
      });
    }
    await db.insert(routeVersions).values({
      tripId: trip.id, legId: leg.id, versionNumber: 3, geometry: null,
    });
    const rows = await db.execute(sql`
      SELECT version_number, ST_AsGeoJSON(geometry) AS geojson,
        ST_SRID(geometry) AS srid, GeometryType(geometry) AS type,
        ST_Length(geometry::geography) AS meters
      FROM route_versions WHERE leg_id = ${leg.id} ORDER BY version_number
    `);
    expect(rows).toHaveLength(3);
    expect(rows[0].srid).toBe(4326);
    expect(JSON.parse(String(rows[0].geojson))).toEqual(line);
    expect(Number(rows[0].meters)).toBeGreaterThan(0);
    expect(rows[1].type).toBe('MULTILINESTRING');
    expect(JSON.parse(String(rows[1].geojson))).toEqual(multi);
    expect(rows[2].geojson).toBeNull();
    expect(rows[2].meters).toBeNull();
  });

  it('rejects invalid geometry, duplicate numbering and negative distances', async () => {
    const { trip, leg } = await fixture();
    await rejection(() => db.insert(routeVersions).values({
      tripId: trip.id, legId: leg.id, versionNumber: 1,
      geometry: sql`ST_SetSRID(ST_MakePoint(0,0),4326)`,
    }), '23514');
    await db.insert(routeVersions).values({ tripId: trip.id, legId: leg.id, versionNumber: 1 });
    await rejection(() => db.insert(routeVersions).values({
      tripId: trip.id, legId: leg.id, versionNumber: 1,
    }), '23505');
    await rejection(() => db.insert(routeVersions).values({
      tripId: trip.id, legId: leg.id, versionNumber: 2, distanceMeters: -1,
    }), '23514');
  });

  it('enforces same-trip Leg ownership and unique waypoint positions', async () => {
    const first = await fixture();
    const second = await fixture();
    await rejection(() => db.insert(routeVersions).values({
      tripId: first.trip.id, legId: second.leg.id, versionNumber: 1,
    }), '23503');
    const [version] = await db.insert(routeVersions).values({
      tripId: first.trip.id, legId: first.leg.id, versionNumber: 1,
      confidence: 'unknown',
    }).returning();
    const [waypoint] = await db.insert(routeWaypoints).values({
      routeVersionId: version.id, position: 0, location: [0, 0],
    }).returning();
    expect(waypoint.location).toEqual([0, 0]);
    await rejection(() => db.insert(routeWaypoints).values({
      routeVersionId: version.id, position: 0, location: [1, 1],
    }), '23505');
  });

  it('creates a GiST index for route geometry', async () => {
    const indexes = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'route_versions'
        AND indexname = 'route_versions_geometry_gist_idx'
    `);
    expect(indexes).toHaveLength(1);
  });
});
