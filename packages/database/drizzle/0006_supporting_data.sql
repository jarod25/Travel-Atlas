CREATE TABLE "place_external_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "external_id" text NOT NULL,
  CONSTRAINT "place_external_refs_provider_external_unique" UNIQUE ("provider","external_id"),
  CONSTRAINT "place_external_refs_provider_nonempty" CHECK (length(btrim("provider")) > 0),
  CONSTRAINT "place_external_refs_external_id_nonempty" CHECK (length(btrim("external_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "description" text,
  "reference" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "recorded_at" timestamptz,
  CONSTRAINT "evidence_kind_valid" CHECK ("kind" IN ('user_statement','ticket','photo','gps_trace','document','other'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text,
  "sha256" text,
  "location" geometry(Point,4326),
  "captured_local_date" date,
  "captured_local_time" time,
  "captured_time_zone" text,
  CONSTRAINT "media_assets_filename_nonempty" CHECK (length(btrim("filename")) > 0),
  CONSTRAINT "media_assets_time_needs_date" CHECK ("captured_local_time" IS NULL OR "captured_local_date" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL REFERENCES "evidence"("id") ON DELETE CASCADE,
  "trip_id" uuid REFERENCES "trips"("id") ON DELETE CASCADE,
  "trip_day_id" uuid REFERENCES "trip_days"("id") ON DELETE CASCADE,
  "place_id" uuid REFERENCES "places"("id") ON DELETE CASCADE,
  "visit_id" uuid REFERENCES "visits"("id") ON DELETE CASCADE,
  "leg_id" uuid REFERENCES "legs"("id") ON DELETE CASCADE,
  "route_version_id" uuid REFERENCES "route_versions"("id") ON DELETE CASCADE,
  "route_proposal_id" uuid REFERENCES "route_proposals"("id") ON DELETE CASCADE,
  "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE CASCADE,
  "field_name" text NOT NULL,
  "confidence" text DEFAULT 'unknown' NOT NULL,
  CONSTRAINT "evidence_links_exactly_one_target" CHECK (num_nonnulls("trip_id","trip_day_id","place_id","visit_id","leg_id","route_version_id","route_proposal_id","media_asset_id") = 1),
  CONSTRAINT "evidence_links_field_nonempty" CHECK (length(btrim("field_name")) > 0),
  CONSTRAINT "evidence_links_confidence_valid" CHECK ("confidence" IN ('confirmed','estimated','unknown'))
);
--> statement-breakpoint
CREATE INDEX "evidence_links_evidence_idx" ON "evidence_links" ("evidence_id");
--> statement-breakpoint
CREATE TABLE "visit_time_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "visit_id" uuid NOT NULL REFERENCES "visits"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "local_date" date,
  "local_time" time,
  "time_zone" text,
  "confidence" text DEFAULT 'unknown' NOT NULL,
  "evidence_id" uuid REFERENCES "evidence"("id") ON DELETE SET NULL,
  CONSTRAINT "visit_time_observations_kind_valid" CHECK ("kind" IN ('arrival','departure','presence')),
  CONSTRAINT "visit_time_observations_confidence_valid" CHECK ("confidence" IN ('confirmed','estimated','unknown')),
  CONSTRAINT "visit_time_observations_time_needs_date" CHECK ("local_time" IS NULL OR "local_date" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "app_settings_key_nonempty" CHECK (length(btrim("key")) > 0)
);
