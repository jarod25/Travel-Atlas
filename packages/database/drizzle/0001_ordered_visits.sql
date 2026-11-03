CREATE TABLE "visits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL,
  "trip_day_id" uuid NOT NULL,
  "place_id" uuid REFERENCES "places"("id") ON DELETE SET NULL,
  "position" integer NOT NULL,
  CONSTRAINT "visits_same_trip_day_fk" FOREIGN KEY ("trip_id", "trip_day_id") REFERENCES "trip_days"("trip_id", "id") ON DELETE CASCADE,
  CONSTRAINT "visits_day_position_unique" UNIQUE ("trip_day_id", "position"),
  CONSTRAINT "visits_trip_id_id_unique" UNIQUE ("trip_id", "id"),
  CONSTRAINT "visits_position_nonnegative" CHECK ("position" >= 0)
);
