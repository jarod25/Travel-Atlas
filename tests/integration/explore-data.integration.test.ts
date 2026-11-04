import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import {
  legs,
  places,
  routeVersions,
  tripDays,
  trips,
  visits,
} from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 1 });
const db = drizzle(client);
const store = createAtlasStore(url);
const tripIds: string[] = [];
const placeIds: string[] = [];
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) {
    await db.update(legs).set({ selectedRouteVersionId: null }).where(eq(legs.tripId, id));
    await db.delete(routeVersions).where(eq(routeVersions.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  for (const id of placeIds) await db.delete(places).where(eq(places.id, id));
  await store.close();
  await client.end();
});

describe('Explore GeoJSON metadata', () => {
  it('includes stored local dates, confidence, and transport without fabricating coordinates', async () => {
    const [trip] = await db.insert(trips).values({ title: 'Synthetic mapped trip' }).returning();
    tripIds.push(trip.id);
    const [day] = await db
      .insert(tripDays)
      .values({
        tripId: trip.id,
        position: 0,
        localDate: '2026-09-12',
      })
      .returning();
    const [point] = await db
      .insert(places)
      .values({
        name: 'Synthetic point',
        location: [0, 0],
        locationConfidence: 'confirmed',
      })
      .returning();
    const [unknown] = await db.insert(places).values({ name: 'Unknown location' }).returning();
    placeIds.push(point.id, unknown.id);
    const [first, second] = await db
      .insert(visits)
      .values([
        { tripId: trip.id, tripDayId: day.id, position: 0, placeId: point.id },
        { tripId: trip.id, tripDayId: day.id, position: 1, placeId: unknown.id },
      ])
      .returning();
    const [leg] = await db
      .insert(legs)
      .values({
        tripId: trip.id,
        fromVisitId: first.id,
        toVisitId: second.id,
        transportMode: 'train',
        movementConfidence: 'confirmed',
      })
      .returning();
    const [version] = await db
      .insert(routeVersions)
      .values({
        tripId: trip.id,
        legId: leg.id,
        versionNumber: 1,
        confidence: 'estimated',
        geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[0,0],[0,1]]}'),4326)`,
      })
      .returning();
    await db.update(legs).set({ selectedRouteVersionId: version.id }).where(eq(legs.id, leg.id));
    const data = await store.getExplore();
    const collection = data as {
      type: string;
      features: Array<{
        geometry: { type: string; coordinates: unknown };
        properties: Record<string, string | null>;
      }>;
    };
    expect(collection.type).toBe('FeatureCollection');
    const features = collection.features.filter((feature) => feature.properties.tripId === trip.id);
    expect(features).toHaveLength(2);
    const pointFeature = features.find((feature) => feature.properties.kind === 'visit');
    expect(pointFeature?.geometry.coordinates).toEqual([0, 0]);
    expect(pointFeature?.properties.locationConfidence).toBe('confirmed');
    expect(pointFeature?.properties.localDate).toBe('2026-09-12');
    expect(pointFeature?.properties.dayId).toBe(day.id);
    const route = features.find((feature) => feature.properties.kind === 'route');
    expect(route?.geometry.type).toBe('LineString');
    expect(route?.properties.transportMode).toBe('train');
    expect(route?.properties.confidence).toBe('estimated');
    expect(route?.properties.localDate).toBe('2026-09-12');
    expect(route?.properties.dayId).toBe(day.id);

    // A stale current flag must never expose an archived Visit's route in Explore.
    await db.update(visits).set({ isArchived: true }).where(eq(visits.id, second.id));
    const afterArchive = (await store.getExplore()) as typeof collection;
    const visible = afterArchive.features.filter(
      (feature) => feature.properties.tripId === trip.id,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].properties.kind).toBe('visit');
    await db.update(visits).set({ isArchived: false }).where(eq(visits.id, second.id));
  });
});
