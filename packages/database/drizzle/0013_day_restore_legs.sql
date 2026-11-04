CREATE TABLE "day_restore_legs" (
  "day_id" uuid NOT NULL REFERENCES "trip_days"("id") ON DELETE CASCADE,
  "leg_id" uuid NOT NULL REFERENCES "legs"("id") ON DELETE CASCADE,
  CONSTRAINT "day_restore_legs_pk" PRIMARY KEY ("day_id", "leg_id")
);
