import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for integration tests (use a dedicated test database).');
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

afterAll(async () => {
  await client.end();
});

describe('Drizzle / PostGIS geometry round trips', () => {
  it('preserves synthetic lines and NULL while rejecting points', async () => {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
    await db.execute(sql`
      CREATE TEMP TABLE atlas_test_geom (
        id text PRIMARY KEY,
        geom geometry(Geometry, 4326),
        CONSTRAINT only_lines CHECK (
          geom IS NULL OR GeometryType(geom) IN ('LINESTRING', 'MULTILINESTRING')
        )
      )
    `);
    await db.execute(sql`CREATE INDEX atlas_test_geom_gix ON atlas_test_geom USING GIST (geom)`);

    const line = { type: 'LineString', coordinates: [[0, 0], [0, 1]] };
    const multi = { type: 'MultiLineString', coordinates: [[[0, 0], [0, 1]], [[1, 1], [2, 2]]] };

    await db.execute(sql`
      INSERT INTO atlas_test_geom (id, geom)
      VALUES ('line', ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(line)}), 4326))
    `);
    await db.execute(sql`
      INSERT INTO atlas_test_geom (id, geom)
      VALUES ('multi', ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(multi)}), 4326))
    `);
    await db.execute(sql`INSERT INTO atlas_test_geom (id, geom) VALUES ('unknown', NULL)`);

    const rows = await db.execute(sql`
      SELECT id, ST_AsGeoJSON(geom) AS geojson, ST_SRID(geom) AS srid,
             GeometryType(geom) AS geometry_type, ST_Length(geom::geography) AS meters
      FROM atlas_test_geom ORDER BY id
    `);

    const lineResult = rows.find((row) => row.id === 'line');
    const multiResult = rows.find((row) => row.id === 'multi');
    const unknownResult = rows.find((row) => row.id === 'unknown');

    expect(rows).toHaveLength(3);
    expect(lineResult?.srid).toBe(4326);
    expect(lineResult?.geometry_type).toBe('LINESTRING');
    expect(JSON.parse(String(lineResult?.geojson))).toEqual(line);
    expect(Number(lineResult?.meters)).toBeGreaterThan(0);
    expect(multiResult?.srid).toBe(4326);
    expect(multiResult?.geometry_type).toBe('MULTILINESTRING');
    expect(JSON.parse(String(multiResult?.geojson))).toEqual(multi);
    expect(Number(multiResult?.meters)).toBeGreaterThan(0);
    expect(unknownResult?.geojson).toBeNull();

    try {
      await db.execute(sql`
        INSERT INTO atlas_test_geom (id, geom)
        VALUES ('point', ST_GeomFromGeoJSON('{"type":"Point","coordinates":[0,0]}'))
      `);
      throw new Error('Expected a CHECK constraint violation');
    } catch (error) {
      const pgError = error as { code?: string; cause?: { code?: string } };
      expect(pgError.cause?.code ?? pgError.code).toBe('23514');
    }
  });
});
