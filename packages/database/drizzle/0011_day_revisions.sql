ALTER TABLE "trip_days" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "trip_days" ADD CONSTRAINT "trip_days_revision_positive" CHECK ("revision" > 0);
