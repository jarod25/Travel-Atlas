ALTER TABLE "legs" ADD CONSTRAINT "legs_trip_id_id_unique" UNIQUE ("trip_id","id");
--> statement-breakpoint
CREATE TABLE "route_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL,
  "leg_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "geometry" geometry(Geometry,4326),
  "origin" text,
  "confidence" text DEFAULT 'unknown' NOT NULL,
  "distance_meters" double precision,
  "provider" text,
  CONSTRAINT "route_versions_same_trip_leg_fk" FOREIGN KEY ("trip_id","leg_id") REFERENCES "legs"("trip_id","id"),
  CONSTRAINT "route_versions_leg_version_unique" UNIQUE ("leg_id","version_number"),
  CONSTRAINT "route_versions_leg_id_id_unique" UNIQUE ("leg_id","id"),
  CONSTRAINT "route_versions_positive_number" CHECK ("version_number" > 0),
  CONSTRAINT "route_versions_distance_nonnegative" CHECK ("distance_meters" IS NULL OR "distance_meters" >= 0),
  CONSTRAINT "route_versions_origin_valid" CHECK ("origin" IS NULL OR "origin" IN ('gps','calculated','manual','schematic')),
  CONSTRAINT "route_versions_confidence_valid" CHECK ("confidence" IN ('confirmed','estimated','unknown')),
  CONSTRAINT "route_versions_linear_geometry" CHECK ("geometry" IS NULL OR GeometryType("geometry") IN ('LINESTRING','MULTILINESTRING'))
);
--> statement-breakpoint
CREATE INDEX "route_versions_geometry_gist_idx" ON "route_versions" USING gist ("geometry");
--> statement-breakpoint
CREATE TABLE "route_waypoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "route_version_id" uuid NOT NULL REFERENCES "route_versions"("id"),
  "position" integer NOT NULL,
  "location" geometry(Point,4326) NOT NULL,
  CONSTRAINT "route_waypoints_version_position_unique" UNIQUE ("route_version_id","position"),
  CONSTRAINT "route_waypoints_position_nonnegative" CHECK ("position" >= 0)
);
