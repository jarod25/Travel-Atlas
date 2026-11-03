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
  foreignKey,
  geometry,
  integer,
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
    index('legs_trip_idx').on(table.tripId),
    uniqueIndex('legs_current_from_unique')
      .on(table.fromVisitId)
      .where(sql`${table.isCurrent} = true`),
    uniqueIndex('legs_current_to_unique')
      .on(table.toVisitId)
      .where(sql`${table.isCurrent} = true`),
  ],
);
