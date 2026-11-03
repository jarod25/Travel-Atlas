ALTER TABLE "places" ADD COLUMN "location_confidence" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_location_confidence_valid" CHECK ("location_confidence" IN ('confirmed','estimated','unknown'));
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_location_bounds" CHECK ("location" IS NULL OR (ST_X("location") BETWEEN -180 AND 180 AND ST_Y("location") BETWEEN -90 AND 90));
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_null_location_unknown" CHECK ("location" IS NOT NULL OR "location_confidence" = 'unknown');
