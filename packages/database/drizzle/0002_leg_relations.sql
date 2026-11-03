CREATE TABLE "legs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL,
  "from_visit_id" uuid NOT NULL,
  "to_visit_id" uuid NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "transport_mode" text,
  "movement_confidence" text DEFAULT 'unknown' NOT NULL,
  "transport_confidence" text DEFAULT 'unknown' NOT NULL,
  "geometry_confidence" text DEFAULT 'unknown' NOT NULL,
  "departure_local_date" date,
  "departure_local_time" time,
  "departure_time_zone" text,
  "departure_time_confidence" text DEFAULT 'unknown' NOT NULL,
  "arrival_local_date" date,
  "arrival_local_time" time,
  "arrival_time_zone" text,
  "arrival_time_confidence" text DEFAULT 'unknown' NOT NULL,
  CONSTRAINT "legs_from_visit_same_trip_fk" FOREIGN KEY ("trip_id", "from_visit_id") REFERENCES "visits"("trip_id", "id"),
  CONSTRAINT "legs_to_visit_same_trip_fk" FOREIGN KEY ("trip_id", "to_visit_id") REFERENCES "visits"("trip_id", "id"),
  CONSTRAINT "legs_distinct_endpoints" CHECK ("from_visit_id" <> "to_visit_id"),
  CONSTRAINT "legs_transport_valid" CHECK ("transport_mode" IS NULL OR "transport_mode" IN ('walking','hiking','cycling','train','metro','tram','car','bus','taxi','plane','boat','ferry')),
  CONSTRAINT "legs_movement_confidence_valid" CHECK ("movement_confidence" IN ('confirmed','estimated','unknown')),
  CONSTRAINT "legs_transport_confidence_valid" CHECK ("transport_confidence" IN ('confirmed','estimated','unknown')),
  CONSTRAINT "legs_geometry_confidence_valid" CHECK ("geometry_confidence" IN ('confirmed','estimated','unknown')),
  CONSTRAINT "legs_departure_time_confidence_valid" CHECK ("departure_time_confidence" IN ('confirmed','estimated','unknown')),
  CONSTRAINT "legs_arrival_time_confidence_valid" CHECK ("arrival_time_confidence" IN ('confirmed','estimated','unknown')),
  CONSTRAINT "legs_departure_time_needs_date" CHECK ("departure_local_time" IS NULL OR "departure_local_date" IS NOT NULL),
  CONSTRAINT "legs_arrival_time_needs_date" CHECK ("arrival_local_time" IS NULL OR "arrival_local_date" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "legs_trip_idx" ON "legs" ("trip_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "legs_current_from_unique" ON "legs" ("from_visit_id") WHERE "is_current" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX "legs_current_to_unique" ON "legs" ("to_visit_id") WHERE "is_current" = true;
