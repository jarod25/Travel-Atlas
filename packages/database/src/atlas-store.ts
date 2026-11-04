import { and, asc, eq, sql } from 'drizzle-orm';
import { updateTripWithRevision } from './trip-repository.js';
import { connectAdjacentDays, disconnectAdjacentDays } from './day-connection.js';
import { setDayArchivedWithRevision } from './day-archive.js';
import type { DayArchiveResult } from './day-archive.js';
import type { DayConnectionResult, DayDisconnectionResult } from './day-connection.js';
import type { TripUpdateResult } from './trip-repository.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appendVisitToDay, archiveVisitFromDay, reorderVisitsInDay } from './visit-repository.js';
import { legs, places, tripDays, trips, visits } from './schema.js';
import { updateLegWithRevision } from './leg-repository.js';
import type { LegChanges, LegUpdateResult } from './leg-repository.js';

export interface AtlasStore {
  listTrips(includeArchived?: boolean): Promise<unknown>;
  createTrip(title: string): Promise<unknown>;
  getTrip(tripId: string): Promise<unknown | null>;
  editTrip(
    id: string,
    revision: number,
    changes: { title?: string; isArchived?: boolean },
  ): Promise<TripUpdateResult>;
  listDays(tripId: string): Promise<unknown[] | null>;
  createDay(tripId: string, localDate: string | null): Promise<unknown | null>;
  archiveDay(
    tripId: string,
    dayId: string,
    revision: number,
    isArchived: boolean,
  ): Promise<DayArchiveResult>;
  editDay(
    tripId: string,
    dayId: string,
    revision: number,
    localDate: string | null,
  ): Promise<
    | { status: 'not_found' }
    | { status: 'conflict'; currentRevision: number }
    | { status: 'updated'; day: typeof tripDays.$inferSelect }
  >;
  getTimeline(tripId: string, dayId: string): Promise<unknown | null>;
  listPlaces(search: string): Promise<unknown[]>;
  createPlace(name: string): Promise<unknown>;
  updatePlace(
    id: string,
    coordinates: [number, number] | null,
    confidence: 'confirmed' | 'estimated' | 'unknown',
  ): Promise<unknown | null>;
  addVisit(tripId: string, dayId: string, placeId: string | null): Promise<unknown>;
  reorderVisits(tripId: string, dayId: string, visitIds: string[]): Promise<unknown>;
  archiveVisit(tripId: string, dayId: string, visitId: string): Promise<unknown>;
  getExplore(): Promise<unknown>;
  connectDays(tripId: string, fromDayId: string, toDayId: string): Promise<DayConnectionResult>;
  disconnectDays(
    tripId: string,
    fromDayId: string,
    toDayId: string,
    legId: string,
    revision: number,
  ): Promise<DayDisconnectionResult>;
  updateLeg(id: string, revision: number, changes: LegChanges): Promise<LegUpdateResult>;
  close(): Promise<void>;
}

/** All geographic data stays behind the REST API; no routes are interpolated. */
export function createAtlasStore(databaseUrl: string): AtlasStore {
  const client = postgres(databaseUrl);
  const db = drizzle(client);

  return {
    listTrips: (includeArchived = false) =>
      db
        .select()
        .from(trips)
        .where(includeArchived ? undefined : eq(trips.isArchived, false))
        .orderBy(asc(trips.title)),
    createTrip: async (title) => {
      const [trip] = await db.insert(trips).values({ title }).returning();
      return trip;
    },
    getTrip: async (id) => {
      const [trip] = await db.select().from(trips).where(eq(trips.id, id));
      return trip ?? null;
    },
    editTrip: (id, revision, changes) => updateTripWithRevision(db, id, revision, changes),
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
    archiveDay: (tripId, dayId, revision, archived) =>
      setDayArchivedWithRevision(db, {
        tripId,
        dayId,
        revision,
        isArchived: archived,
      }),
    editDay: (tripId, dayId, revision, localDate) =>
      db.transaction(async (tx) => {
        const [day] = await tx
          .select()
          .from(tripDays)
          .where(and(eq(tripDays.tripId, tripId), eq(tripDays.id, dayId)))
          .for('update');
        if (!day) return { status: 'not_found' as const };
        if (day.revision !== revision) {
          return { status: 'conflict' as const, currentRevision: day.revision };
        }
        const [saved] = await tx
          .update(tripDays)
          .set({
            localDate,
            revision: revision + 1,
          })
          .where(eq(tripDays.id, dayId))
          .returning();
        return { status: 'updated' as const, day: saved };
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
          departureLocalDate: legs.departureLocalDate,
          departureLocalTime: legs.departureLocalTime,
          departureTimeZone: legs.departureTimeZone,
          departureTimeConfidence: legs.departureTimeConfidence,
          arrivalLocalDate: legs.arrivalLocalDate,
          arrivalLocalTime: legs.arrivalLocalTime,
          arrivalTimeZone: legs.arrivalTimeZone,
          arrivalTimeConfidence: legs.arrivalTimeConfidence,
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
        crossDayLegs: edges.filter(
          (edge) => memberIds.has(edge.fromVisitId) !== memberIds.has(edge.toVisitId),
        ),
      };
    },
    listPlaces: async (search) =>
      db
        .select({
          id: places.id,
          name: places.name,
          location: places.location,
          locationConfidence: places.locationConfidence,
        })
        .from(places)
        .where(sql`${places.name} ILIKE ${'%' + search + '%'}`)
        .orderBy(asc(places.name))
        .limit(30),
    createPlace: async (name) => {
      const [place] = await db.insert(places).values({ name }).returning();
      return place;
    },
    updatePlace: (id, coordinates, confidence) =>
      db.transaction(async (tx) => {
        // Lock the shared Place so concurrent coordinate changes cannot interleave
        // with invalidation of route candidates derived from its previous location.
        const [current] = await tx
          .select({ location: places.location })
          .from(places)
          .where(eq(places.id, id))
          .for('update');
        if (!current) return null;
        const oldLongitude = current.location?.[0];
        const oldLatitude = current.location?.[1];
        const changed = oldLongitude !== coordinates?.[0] || oldLatitude !== coordinates?.[1];
        const [updated] = await tx
          .update(places)
          .set({ location: coordinates, locationConfidence: coordinates ? confidence : 'unknown' })
          .where(eq(places.id, id))
          .returning();

        if (changed) {
          // Only pending proposals become stale. Accepted routes and historical
          // versions/evidence remain untouched, even for a shared Place.
          await tx.execute(sql`
            UPDATE route_proposals AS proposal
            SET status = 'invalidated', reviewed_at = NOW()
            FROM legs AS leg
            JOIN visits AS start_visit ON start_visit.id = leg.from_visit_id
            JOIN visits AS end_visit ON end_visit.id = leg.to_visit_id
            WHERE proposal.leg_id = leg.id
              AND proposal.status = 'pending'
              AND (start_visit.place_id = ${id} OR end_visit.place_id = ${id})
          `);
        }
        return updated;
      }),
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
    connectDays: (tripId, fromDayId, toDayId) =>
      connectAdjacentDays(db, {
        tripId,
        fromDayId,
        toDayId,
      }),
    disconnectDays: (tripId, fromDayId, toDayId, legId, revision) =>
      disconnectAdjacentDays(db, { tripId, fromDayId, toDayId, legId, revision }),
    getExplore: async () => {
      const points = await db
        .select({
          visitId: visits.id,
          tripId: visits.tripId,
          placeId: places.id,
          name: places.name,
          location: places.location,
          locationConfidence: places.locationConfidence,
          localDate: tripDays.localDate,
        })
        .from(visits)
        .innerJoin(places, eq(visits.placeId, places.id))
        .innerJoin(tripDays, eq(visits.tripDayId, tripDays.id))
        .innerJoin(trips, eq(visits.tripId, trips.id))
        .where(
          and(
            eq(visits.isArchived, false),
            eq(trips.isArchived, false),
            eq(tripDays.isArchived, false),
            sql`${places.location} IS NOT NULL`,
          ),
        );
      const routes = await db.execute(sql`
        SELECT l.trip_id, l.id AS leg_id, rv.id AS route_version_id,
          l.transport_mode, l.movement_confidence,
          td.local_date::text AS local_date,
          ST_AsGeoJSON(rv.geometry) AS geojson, rv.confidence
        FROM legs l JOIN route_versions rv ON rv.id = l.selected_route_version_id
          JOIN visits v ON v.id = l.from_visit_id
          JOIN trip_days td ON td.id = v.trip_day_id
          JOIN visits v2 ON v2.id = l.to_visit_id
          JOIN trip_days td2 ON td2.id = v2.trip_day_id
          JOIN trips t ON t.id = l.trip_id
        WHERE l.is_current = true AND t.is_archived = false
          AND td.is_archived = false AND td2.is_archived = false
          AND rv.geometry IS NOT NULL
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
              localDate: point.localDate,
              locationConfidence: point.locationConfidence,
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
              transportMode: route.transport_mode,
              movementConfidence: route.movement_confidence,
              localDate: route.local_date,
              kind: 'route',
            },
          })),
        ],
      };
    },
    close: () => client.end().then(() => undefined),
  };
}
