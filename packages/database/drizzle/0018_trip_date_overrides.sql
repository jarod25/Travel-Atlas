ALTER TABLE "trips" ADD COLUMN "start_date_override" date;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "end_date_override" date;
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_date_override_order" CHECK ("start_date_override" IS NULL OR "end_date_override" IS NULL OR "start_date_override" <= "end_date_override");
