import { sql } from 'drizzle-orm';
import { check, date, geometry, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

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
export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name'),
    location: geometry('location', { type: 'point', mode: 'tuple', srid: 4326 }),
  },
);
