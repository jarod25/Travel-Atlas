ALTER TABLE "visits" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_day_position_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "visits_active_day_position_unique" ON "visits" ("trip_day_id","position")
  WHERE "is_archived" = false;
