-- Upgrade the already-published 0018 and 0019 schema without losing their data.
ALTER TABLE trips RENAME COLUMN start_date_override TO manual_start_date;
--> statement-breakpoint
ALTER TABLE trips RENAME COLUMN end_date_override TO manual_end_date;
--> statement-breakpoint
ALTER TABLE trips DROP CONSTRAINT trips_date_override_order;
--> statement-breakpoint
ALTER TABLE trips ADD COLUMN parent_trip_id uuid REFERENCES trips(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE trips ADD CONSTRAINT trips_not_own_parent CHECK (parent_trip_id IS NULL OR parent_trip_id <> id);
--> statement-breakpoint
ALTER TABLE trips ADD CONSTRAINT trips_manual_date_range CHECK (manual_start_date IS NULL OR manual_end_date IS NULL OR manual_start_date <= manual_end_date);
--> statement-breakpoint
CREATE INDEX trips_parent_idx ON trips(parent_trip_id);
--> statement-breakpoint
ALTER TABLE legs DROP CONSTRAINT legs_departure_precision_valid;
--> statement-breakpoint
ALTER TABLE legs DROP CONSTRAINT legs_arrival_precision_valid;
--> statement-breakpoint
ALTER TABLE legs DROP CONSTRAINT legs_departure_range_valid;
--> statement-breakpoint
ALTER TABLE legs DROP CONSTRAINT legs_arrival_range_valid;
--> statement-breakpoint
ALTER TABLE legs ADD COLUMN departure_range_start timestamp without time zone;
--> statement-breakpoint
ALTER TABLE legs ADD COLUMN departure_range_end timestamp without time zone;
--> statement-breakpoint
ALTER TABLE legs ADD COLUMN arrival_range_start timestamp without time zone;
--> statement-breakpoint
ALTER TABLE legs ADD COLUMN arrival_range_end timestamp without time zone;
--> statement-breakpoint
UPDATE legs SET
  departure_range_start = departure_local_date + departure_local_time,
  departure_range_end = departure_range_end_local_date + departure_range_end_local_time
WHERE departure_time_precision = 'range';
--> statement-breakpoint
UPDATE legs SET
  arrival_range_start = arrival_local_date + arrival_local_time,
  arrival_range_end = arrival_range_end_local_date + arrival_range_end_local_time
WHERE arrival_time_precision = 'range';
--> statement-breakpoint
ALTER TABLE legs DROP COLUMN departure_range_end_local_date;
--> statement-breakpoint
ALTER TABLE legs DROP COLUMN departure_range_end_local_time;
--> statement-breakpoint
ALTER TABLE legs DROP COLUMN arrival_range_end_local_date;
--> statement-breakpoint
ALTER TABLE legs DROP COLUMN arrival_range_end_local_time;
--> statement-breakpoint
UPDATE legs SET departure_time_precision = CASE
  WHEN departure_time_precision = 'unspecified' THEN 'unknown'
  WHEN departure_time_precision = 'precise' THEN 'exact'
  ELSE departure_time_precision END;
--> statement-breakpoint
UPDATE legs SET arrival_time_precision = CASE
  WHEN arrival_time_precision = 'unspecified' THEN 'unknown'
  WHEN arrival_time_precision = 'precise' THEN 'exact'
  ELSE arrival_time_precision END;
--> statement-breakpoint
ALTER TABLE legs ALTER COLUMN departure_time_precision SET DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE legs ALTER COLUMN arrival_time_precision SET DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE legs ADD CONSTRAINT legs_departure_precision_valid CHECK (departure_time_precision IN ('exact','approximate','range','unknown'));
--> statement-breakpoint
ALTER TABLE legs ADD CONSTRAINT legs_arrival_precision_valid CHECK (arrival_time_precision IN ('exact','approximate','range','unknown'));
--> statement-breakpoint
ALTER TABLE legs ADD CONSTRAINT legs_departure_range_complete CHECK (
  (departure_range_start IS NULL AND departure_range_end IS NULL AND departure_time_precision <> 'range')
  OR (departure_range_start IS NOT NULL AND departure_range_end IS NOT NULL AND departure_time_precision = 'range' AND departure_range_start <= departure_range_end)
);
--> statement-breakpoint
ALTER TABLE legs ADD CONSTRAINT legs_arrival_range_complete CHECK (
  (arrival_range_start IS NULL AND arrival_range_end IS NULL AND arrival_time_precision <> 'range')
  OR (arrival_range_start IS NOT NULL AND arrival_range_end IS NOT NULL AND arrival_time_precision = 'range' AND arrival_range_start <= arrival_range_end)
);
