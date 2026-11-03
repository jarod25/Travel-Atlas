import { sql } from 'drizzle-orm';

const confidenceValues = ['confirmed', 'estimated', 'unknown'] as const;
const transportValues = [
  'walking',
  'hiking',
  'cycling',
  'train',
  'metro',
  'tram',
  'car',
  'bus',
  'taxi',
  'plane',
  'boat',
  'ferry',
] as const;
import {
  check,
  date,
  doublePrecision,
  customType,
  foreignKey,
  geometry,
  integer,
  jsonb,
  timestamp,
  boolean,
  time,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Trips contain ordered days; no geographic coordinates or times are inferred. */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
  },
  (table) => [check('trips_title_nonempty', sql`length(btrim(${table.title})) > 0`)],
);

/** A date is a calendar value, not a UTC timestamp. */
export const tripDays = pgTable(
  'trip_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    localDate: date('local_date', { mode: 'string' }),
    position: integer('position').notNull(),
  },
  (table) => [
    unique('trip_days_trip_position_unique').on(table.tripId, table.position),
    unique('trip_days_trip_id_id_unique').on(table.tripId, table.id),
    check('trip_days_position_nonnegative', sql`${table.position} >= 0`),
  ],
);

/** Null means an unknown position; [0, 0] remains a valid, distinct point. */
export const places = pgTable('places', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  location: geometry('location', { type: 'point', mode: 'tuple', srid: 4326 }),
});

/** A visit belongs to a day of the same trip; places can be visited repeatedly. */
export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id').notNull(),
    tripDayId: uuid('trip_day_id').notNull(),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'visits_same_trip_day_fk',
      columns: [table.tripId, table.tripDayId],
      foreignColumns: [tripDays.tripId, tripDays.id],
    }).onDelete('cascade'),
    unique('visits_day_position_unique').on(table.tripDayId, table.position),
    unique('visits_trip_id_id_unique').on(table.tripId, table.id),
    check('visits_position_nonnegative', sql`${table.position} >= 0`),
  ],
);

/**
 * A Leg connects Visits in the same Trip. A cross-day Leg is only written by
 * a future explicit Connect Days operation, never inferred from adjacency.
 *
 * Local dates/times are not converted to UTC: the time zone may be unknown.
 * Each factual dimension has its own confidence level.
 */
export const legs = pgTable(
  'legs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id').notNull(),
    fromVisitId: uuid('from_visit_id').notNull(),
    toVisitId: uuid('to_visit_id').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    selectedRouteVersionId: uuid('selected_route_version_id'),
    transportMode: text('transport_mode', { enum: transportValues }),
    movementConfidence: text('movement_confidence', { enum: confidenceValues })
      .notNull()
      .default('unknown'),
    transportConfidence: text('transport_confidence', { enum: confidenceValues })
      .notNull()
      .default('unknown'),
    geometryConfidence: text('geometry_confidence', { enum: confidenceValues })
      .notNull()
      .default('unknown'),
    departureLocalDate: date('departure_local_date', { mode: 'string' }),
    departureLocalTime: time('departure_local_time'),
    departureTimeZone: text('departure_time_zone'),
    departureTimeConfidence: text('departure_time_confidence', { enum: confidenceValues })
      .notNull()
      .default('unknown'),
    arrivalLocalDate: date('arrival_local_date', { mode: 'string' }),
    arrivalLocalTime: time('arrival_local_time'),
    arrivalTimeZone: text('arrival_time_zone'),
    arrivalTimeConfidence: text('arrival_time_confidence', { enum: confidenceValues })
      .notNull()
      .default('unknown'),
  },
  (table) => [
    foreignKey({
      name: 'legs_from_visit_same_trip_fk',
      columns: [table.tripId, table.fromVisitId],
      foreignColumns: [visits.tripId, visits.id],
    }),
    foreignKey({
      name: 'legs_to_visit_same_trip_fk',
      columns: [table.tripId, table.toVisitId],
      foreignColumns: [visits.tripId, visits.id],
    }),
    check('legs_distinct_endpoints', sql`${table.fromVisitId} <> ${table.toVisitId}`),
    check(
      'legs_transport_valid',
      sql`${table.transportMode} IS NULL OR ${table.transportMode} IN ('walking','hiking','cycling','train','metro','tram','car','bus','taxi','plane','boat','ferry')`,
    ),
    check(
      'legs_movement_confidence_valid',
      sql`${table.movementConfidence} IN ('confirmed','estimated','unknown')`,
    ),
    check(
      'legs_transport_confidence_valid',
      sql`${table.transportConfidence} IN ('confirmed','estimated','unknown')`,
    ),
    check(
      'legs_geometry_confidence_valid',
      sql`${table.geometryConfidence} IN ('confirmed','estimated','unknown')`,
    ),
    check(
      'legs_departure_time_confidence_valid',
      sql`${table.departureTimeConfidence} IN ('confirmed','estimated','unknown')`,
    ),
    check(
      'legs_arrival_time_confidence_valid',
      sql`${table.arrivalTimeConfidence} IN ('confirmed','estimated','unknown')`,
    ),
    check(
      'legs_departure_time_needs_date',
      sql`${table.departureLocalTime} IS NULL OR ${table.departureLocalDate} IS NOT NULL`,
    ),
    check(
      'legs_arrival_time_needs_date',
      sql`${table.arrivalLocalTime} IS NULL OR ${table.arrivalLocalDate} IS NOT NULL`,
    ),
    foreignKey({
      name: 'legs_selected_version_same_leg_fk',
      columns: [table.id, table.selectedRouteVersionId],
      foreignColumns: [routeVersions.legId, routeVersions.id],
    }),
    unique('legs_trip_id_id_unique').on(table.tripId, table.id),
    index('legs_trip_idx').on(table.tripId),
    uniqueIndex('legs_current_from_unique')
      .on(table.fromVisitId)
      .where(sql`${table.isCurrent} = true`),
    uniqueIndex('legs_current_to_unique')
      .on(table.toVisitId)
      .where(sql`${table.isCurrent} = true`),
  ],
);

/**
 * PostGIS geometry(Geometry,4326) supports both linear geometry variants.
 * Use parameterized ST_GeomFromGeoJSON for writes and ST_AsGeoJSON for reads.
 * The driver representation is not assumed to be GeoJSON.
 */
const linearGeometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Geometry,4326)';
  },
});

export const routeVersions = pgTable(
  'route_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id').notNull(),
    legId: uuid('leg_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    geometry: linearGeometry('geometry'),
    origin: text('origin', { enum: ['gps', 'calculated', 'manual', 'schematic'] }),
    confidence: text('confidence', { enum: confidenceValues }).notNull().default('unknown'),
    distanceMeters: doublePrecision('distance_meters'),
    provider: text('provider'),
  },
  (table) => [
    foreignKey({
      name: 'route_versions_same_trip_leg_fk',
      columns: [table.tripId, table.legId],
      foreignColumns: [legs.tripId, legs.id],
    }),
    unique('route_versions_leg_version_unique').on(table.legId, table.versionNumber),
    unique('route_versions_leg_id_id_unique').on(table.legId, table.id),
    check('route_versions_positive_number', sql`${table.versionNumber} > 0`),
    check(
      'route_versions_distance_nonnegative',
      sql`${table.distanceMeters} IS NULL OR ${table.distanceMeters} >= 0`,
    ),
    check(
      'route_versions_origin_valid',
      sql`${table.origin} IS NULL OR ${table.origin} IN ('gps','calculated','manual','schematic')`,
    ),
    check(
      'route_versions_confidence_valid',
      sql`${table.confidence} IN ('confirmed','estimated','unknown')`,
    ),
    check(
      'route_versions_linear_geometry',
      sql`${table.geometry} IS NULL OR GeometryType(${table.geometry}) IN ('LINESTRING','MULTILINESTRING')`,
    ),
    index('route_versions_geometry_gist_idx').using('gist', table.geometry),
  ],
);

export const routeWaypoints = pgTable(
  'route_waypoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeVersionId: uuid('route_version_id')
      .notNull()
      .references(() => routeVersions.id),
    position: integer('position').notNull(),
    location: geometry('location', { type: 'point', mode: 'tuple', srid: 4326 }).notNull(),
  },
  (table) => [
    unique('route_waypoints_version_position_unique').on(table.routeVersionId, table.position),
    check('route_waypoints_position_nonnegative', sql`${table.position} >= 0`),
  ],
);

/**
 * Route proposals are durable review candidates, not proof of historical travel.
 * Their endpoint/transport snapshots enable later invalidation on changed inputs.
 */
export const routeProposals = pgTable(
  'route_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id').notNull(),
    legId: uuid('leg_id').notNull(),
    fromVisitId: uuid('from_visit_id').notNull(),
    toVisitId: uuid('to_visit_id').notNull(),
    transportMode: text('transport_mode', { enum: transportValues }),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'invalidated'] })
      .notNull()
      .default('pending'),
    geometry: linearGeometry('geometry'),
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),
    provider: text('provider'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'route_proposals_same_trip_leg_fk',
      columns: [table.tripId, table.legId],
      foreignColumns: [legs.tripId, legs.id],
    }),
    check('route_proposals_status_valid', sql`${table.status} IN ('pending','accepted','rejected','invalidated')`),
    check('route_proposals_transport_valid', sql`${table.transportMode} IS NULL OR ${table.transportMode} IN ('walking','hiking','cycling','train','metro','tram','car','bus','taxi','plane','boat','ferry')`),
    check('route_proposals_distinct_endpoints', sql`${table.fromVisitId} <> ${table.toVisitId}`),
    check('route_proposals_linear_geometry', sql`${table.geometry} IS NULL OR GeometryType(${table.geometry}) IN ('LINESTRING','MULTILINESTRING')`),
    check('route_proposals_review_timestamp_valid', sql`(${table.status} = 'pending' AND ${table.reviewedAt} IS NULL) OR (${table.status} <> 'pending' AND ${table.reviewedAt} IS NOT NULL)`),
    index('route_proposals_leg_idx').on(table.legId),
    index('route_proposals_geometry_gist_idx').using('gist', table.geometry),
  ],
);
