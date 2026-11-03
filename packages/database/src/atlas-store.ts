import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appendVisitToDay, archiveVisitFromDay, reorderVisitsInDay } from './visit-repository';
import { legs, places, tripDays, trips, visits } from './schema';
import { updateLegWithRevision } from './leg-repository';
import type { LegChanges, LegUpdateResult } from './leg-repository';

export interface AtlasStore {
  listTrips(): Promise<unknown>;
  createTrip(title: string): Promise<unknown>;
  getTrip(tripId: string): Promise<unknown | null>;
  listDays(tripId: string): Promise<unknown[] | null>;
  createDay(tripId: string, localDate: string | null): Promise<unknown | null>;
  getTimeline(tripId: string, dayId: string): Promise<unknown | null>;
  listPlaces(search: string): Promise<unknown[]>;
  createPlace(name: string): Promise<unknown>;
  addVisit(tripId: string, dayId: string, placeId: string | null): Promise<unknown>;
  reorderVisits(tripId: string, dayId: string, visitIds: string[]): Promise<unknown>;
  archiveVisit(tripId: string, dayId: string, visitId: string): Promise<unknown>;
  getExplore(): Promise<unknown>;
  updateLeg(id: string, revision: number, changes: LegChanges): Promise<LegUpdateResult>;
  close(): Promise<void>;
}

/** All geographic data stays behind the REST API; no routes are interpolated. */
export function createAtlasStore(databaseUrl: string): AtlasStore {
  const client = postgres(databaseUrl);
  const db = drizzle(client);

  return {
    listTrips: () => db.select().from(trips).orderBy(asc(trips.title)),
    createTrip: async (title) => {
      const [trip] = await db.insert(trips).values({ title }).returning();
      return trip;
    },
    getTrip: async (id) => {
      const [trip] = await db.select().from(trips).where(eq(trips.id, id));
      return trip ?? null;
    },
    listDays: async (id) => {
      const [trip] = await db.select({ id: trips.id }).from(trips).where(eq(trips.id, id));
      if (!trip) return null;
      return db
        .select()
        .from(tripDays)
        .where(eq(tripDays.tripId, id))
        .orderBy(asc(tripDays.position));
    },
    createDay: async (id, localDate) =>
      db.transaction(async (tx) => {
        const [trip] = await tx
          .select({ id: trips.id })
          .from(trips)
          .where(eq(trips.id, id))
          .for('update');
        if (!trip) return null;
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tripDays)
          .where(eq(tripDays.tripId, id));
        const [day] = await tx
          .insert(tripDays)
          .values({ tripId: id, localDate, position: count })
          .returning();
        return day;
      }),
    getTimeline: async (tripId, dayId) => {
      const [day] = await db
        .select()
        .from(tripDays)
        .where(and(eq(tripDays.tripId, tripId), eq(tripDays.id, dayId)));
      if (!day) return null;
      const ordered = await db
        .select({
          id: visits.id,
          position: visits.position,
          placeId: visits.placeId,
          placeName: places.name,
          placeLocation: places.location,
        })
        .from(visits)
        .leftJoin(places, eq(visits.placeId, places.id))
        .where(and(eq(visits.tripDayId, dayId), eq(visits.isArchived, false)))
        .orderBy(asc(visits.position));
      const edges = await db
        .select({
          id: legs.id,
          fromVisitId: legs.fromVisitId,
          toVisitId: legs.toVisitId,
          transportMode: legs.transportMode,
          revision: legs.revision,
          movementConfidence: legs.movementConfidence,
          transportConfidence: legs.transportConfidence,
          geometryConfidence: legs.geometryConfidence,
        })
        .from(legs)
        .where(and(eq(legs.tripId, tripId), eq(legs.isCurrent, true)));
      const memberIds = new Set(ordered.map((visit) => visit.id));
      return {
        day,
        visits: ordered,
        legs: edges.filter(
          (edge) => memberIds.has(edge.fromVisitId) && memberIds.has(edge.toVisitId),
        ),
      };
    },
    listPlaces: async (search) =>
      db
        .select({ id: places.id, name: places.name, location: places.location })
        .from(places)
        .where(sql`${places.name} ILIKE ${'%' + search + '%'}`)
        .orderBy(asc(places.name))
        .limit(30),
    createPlace: async (name) => {
      const [place] = await db.insert(places).values({ name }).returning();
      return place;
    },
    addVisit: async (tripId, dayId, placeId) => {
      return appendVisitToDay(db, { tripId, tripDayId: dayId, placeId });
    },
    reorderVisits: async (tripId, dayId, visitIds) =>
      reorderVisitsInDay(db, {
        tripId,
        tripDayId: dayId,
        orderedVisitIds: visitIds,
      }),
    archiveVisit: async (tripId, dayId, visitId) =>
      archiveVisitFromDay(db, {
        tripId,
        tripDayId: dayId,
        visitId,
      }),
    updateLeg: (id, revision, changes) => updateLegWithRevision(db, id, revision, changes),
    getExplore: async () => {
      const points = await db
        .select({
          visitId: visits.id,
          tripId: visits.tripId,
          placeId: places.id,
          name: places.name,
          location: places.location,
        })
        .from(visits)
        .innerJoin(places, eq(visits.placeId, places.id))
        .where(and(eq(visits.isArchived, false), sql`${places.location} IS NOT NULL`));
      const routes = await db.execute(sql`
        SELECT l.trip_id, l.id AS leg_id, rv.id AS route_version_id,
          ST_AsGeoJSON(rv.geometry) AS geojson, rv.confidence
        FROM legs l JOIN route_versions rv ON rv.id = l.selected_route_version_id
        WHERE l.is_current = true AND rv.geometry IS NOT NULL
      `);
      return {
        type: 'FeatureCollection',
        features: [
          ...points.map((point) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: point.location },
            properties: {
              visitId: point.visitId,
              tripId: point.tripId,
              placeId: point.placeId,
              name: point.name,
              kind: 'visit',
            },
          })),
          ...routes.map((route) => ({
            type: 'Feature',
            geometry: JSON.parse(String(route.geojson)),
            properties: {
              tripId: route.trip_id,
              legId: route.leg_id,
              routeVersionId: route.route_version_id,
              confidence: route.confidence,
              kind: 'route',
            },
          })),
        ],
      };
    },
    close: () => client.end().then(() => undefined),
  };
}
