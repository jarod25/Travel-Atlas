import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { places, tripDays, trips } from '../../packages/database/src/schema';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must point to a disposable integration-test database.');
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);
const createdTripIds: string[] = [];
const createdPlaceIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});

afterAll(async () => {
  if (createdTripIds.length > 0) {
    await db.delete(trips).where(inArray(trips.id, createdTripIds));
  }
  if (createdPlaceIds.length > 0) {
    await db.delete(places).where(inArray(places.id, createdPlaceIds));
  }
  await client.end();
});

function pgCode(error: unknown): string | undefined {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}

describe('Initial Drizzle/PostGIS schema', () => {
  it('applies migrations idempotently', async () => {
    await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
    const rows = await db.execute(sql`
      SELECT extname FROM pg_extension WHERE extname = 'postgis'
    `);
    expect(rows[0]?.extname).toBe('postgis');
  });

  it('persists trips and ordered days with a nullable local date', async () => {
    const [trip] = await db.insert(trips).values({ title: 'Synthetic trip' }).returning();
    createdTripIds.push(trip.id);

    const [day] = await db
      .insert(tripDays)
      .values({ tripId: trip.id, localDate: null, position: 0 })
      .returning();

    expect(day.tripId).toBe(trip.id);
    expect(day.localDate).toBeNull();

    const rows = await db.select().from(tripDays).where(eq(tripDays.tripId, trip.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(0);

    try {
      await db.insert(tripDays).values({ tripId: trip.id, position: 0 });
      throw new Error('Expected a duplicate day position to be rejected');
    } catch (error) {
      expect(pgCode(error)).toBe('23505');
    }

    try {
      await db.insert(tripDays).values({ tripId: trip.id, position: -1 });
      throw new Error('Expected invalid position to be rejected');
    } catch (error) {
      expect(pgCode(error)).toBe('23514');
    }
  });

  it('enforces the parent trip foreign key', async () => {
    try {
      await db.insert(tripDays).values({
        tripId: '00000000-0000-4000-8000-000000000001',
        position: 0,
      });
      throw new Error('Expected missing trip to be rejected');
    } catch (error) {
      expect(pgCode(error)).toBe('23503');
    }
  });

  it('round-trips a point and preserves unknown coordinates as NULL', async () => {
    const rows = await db
      .insert(places)
      .values([
        { name: 'Synthetic origin', location: [0, 0] },
        { name: null, location: null },
      ])
      .returning();
    createdPlaceIds.push(...rows.map((row) => row.id));

    const known = rows.find((row) => row.name === 'Synthetic origin');
    const unknown = rows.find((row) => row.name === null);
    expect(known?.location).toEqual([0, 0]);
    expect(unknown?.location).toBeNull();

    const spatial = await db.execute(sql`
      SELECT ST_SRID(location) AS srid, ST_AsGeoJSON(location) AS geojson
      FROM places WHERE id = ${known?.id}
    `);
    expect(spatial[0]?.srid).toBe(4326);
    expect(JSON.parse(String(spatial[0]?.geojson))).toEqual({
      type: 'Point',
      coordinates: [0, 0],
    });

    const indexes = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'places' AND indexname = 'places_location_gist_idx'
    `);
    expect(indexes).toHaveLength(1);
  });

  it('documents that coordinate bounds require application validation', async () => {
    // PostGIS geometry(Point, 4326) validates geometry type/SRID, not the coordinate range.
    // Future application validation must guard geographic bounds before persistence.
    const rows = await db.execute(sql`
      SELECT ST_SRID(ST_SetSRID(ST_MakePoint(0, 0), 4326)) AS srid
    `);
    expect(rows[0]?.srid).toBe(4326);
  });
});
