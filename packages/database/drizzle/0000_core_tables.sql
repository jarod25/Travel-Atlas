CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "trips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  CONSTRAINT "trips_title_nonempty" CHECK (length(btrim("title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "trip_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "local_date" date,
  "position" integer NOT NULL,
  CONSTRAINT "trip_days_trip_position_unique" UNIQUE ("trip_id", "position"),
  CONSTRAINT "trip_days_trip_id_id_unique" UNIQUE ("trip_id", "id"),
  CONSTRAINT "trip_days_position_nonnegative" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "places" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text,
  "location" geometry(Point, 4326)
);
--> statement-breakpoint
CREATE INDEX "places_location_gist_idx" ON "places" USING gist ("location");
