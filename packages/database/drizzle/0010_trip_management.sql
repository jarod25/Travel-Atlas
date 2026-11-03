ALTER TABLE "trips" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_revision_positive" CHECK ("revision" > 0);
