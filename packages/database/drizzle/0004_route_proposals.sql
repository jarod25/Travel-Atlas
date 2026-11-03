ALTER TABLE "legs" ADD COLUMN "selected_route_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_selected_version_same_leg_fk"
  FOREIGN KEY ("id","selected_route_version_id") REFERENCES "route_versions"("leg_id","id");
--> statement-breakpoint
CREATE TABLE "route_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL,
  "leg_id" uuid NOT NULL,
  "from_visit_id" uuid NOT NULL,
  "to_visit_id" uuid NOT NULL,
  "transport_mode" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "geometry" geometry(Geometry,4326),
  "parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provider" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "reviewed_at" timestamptz,
  CONSTRAINT "route_proposals_same_trip_leg_fk" FOREIGN KEY ("trip_id","leg_id") REFERENCES "legs"("trip_id","id"),
  CONSTRAINT "route_proposals_status_valid" CHECK ("status" IN ('pending','accepted','rejected','invalidated')),
  CONSTRAINT "route_proposals_transport_valid" CHECK ("transport_mode" IS NULL OR "transport_mode" IN ('walking','hiking','cycling','train','metro','tram','car','bus','taxi','plane','boat','ferry')),
  CONSTRAINT "route_proposals_distinct_endpoints" CHECK ("from_visit_id" <> "to_visit_id"),
  CONSTRAINT "route_proposals_linear_geometry" CHECK ("geometry" IS NULL OR GeometryType("geometry") IN ('LINESTRING','MULTILINESTRING')),
  CONSTRAINT "route_proposals_review_timestamp_valid" CHECK (("status" = 'pending' AND "reviewed_at" IS NULL) OR ("status" <> 'pending' AND "reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "route_proposals_leg_idx" ON "route_proposals" ("leg_id");
--> statement-breakpoint
CREATE INDEX "route_proposals_geometry_gist_idx" ON "route_proposals" USING gist ("geometry");
