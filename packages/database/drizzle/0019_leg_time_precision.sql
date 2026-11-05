ALTER TABLE "legs" ADD COLUMN "departure_time_precision" text NOT NULL DEFAULT 'unspecified';
--> statement-breakpoint
ALTER TABLE "legs" ADD COLUMN "arrival_time_precision" text NOT NULL DEFAULT 'unspecified';
--> statement-breakpoint
ALTER TABLE "legs" ADD COLUMN "departure_range_end_local_date" date;
--> statement-breakpoint
ALTER TABLE "legs" ADD COLUMN "departure_range_end_local_time" time;
--> statement-breakpoint
ALTER TABLE "legs" ADD COLUMN "arrival_range_end_local_date" date;
--> statement-breakpoint
ALTER TABLE "legs" ADD COLUMN "arrival_range_end_local_time" time;
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_departure_precision_valid" CHECK (departure_time_precision IN ('unspecified','precise','approximate','range'));
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_arrival_precision_valid" CHECK (arrival_time_precision IN ('unspecified','precise','approximate','range'));
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_departure_range_valid" CHECK (
 (departure_time_precision = 'range'
  AND departure_local_date IS NOT NULL AND departure_local_time IS NOT NULL
  AND departure_range_end_local_date IS NOT NULL AND departure_range_end_local_time IS NOT NULL
  AND (departure_range_end_local_date, departure_range_end_local_time) >= (departure_local_date, departure_local_time))
 OR
 (departure_time_precision <> 'range'
  AND departure_range_end_local_date IS NULL AND departure_range_end_local_time IS NULL
  AND (departure_time_precision = 'unspecified' OR (departure_local_date IS NOT NULL AND departure_local_time IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_arrival_range_valid" CHECK (
 (arrival_time_precision = 'range'
  AND arrival_local_date IS NOT NULL AND arrival_local_time IS NOT NULL
  AND arrival_range_end_local_date IS NOT NULL AND arrival_range_end_local_time IS NOT NULL
  AND (arrival_range_end_local_date, arrival_range_end_local_time) >= (arrival_local_date, arrival_local_time))
 OR
 (arrival_time_precision <> 'range'
  AND arrival_range_end_local_date IS NULL AND arrival_range_end_local_time IS NULL
  AND (arrival_time_precision = 'unspecified' OR (arrival_local_date IS NOT NULL AND arrival_local_time IS NOT NULL)))
);
