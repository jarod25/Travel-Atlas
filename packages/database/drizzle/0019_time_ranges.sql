ALTER TABLE legs ADD COLUMN departure_range_start timestamp without time zone;
ALTER TABLE legs ADD COLUMN departure_range_end timestamp without time zone;
ALTER TABLE legs ADD COLUMN arrival_range_start timestamp without time zone;
ALTER TABLE legs ADD COLUMN arrival_range_end timestamp without time zone;
ALTER TABLE legs ADD CONSTRAINT legs_departure_range_complete CHECK (
  (departure_range_start IS NULL AND departure_range_end IS NULL AND departure_time_precision <> 'range')
  OR (departure_range_start IS NOT NULL AND departure_range_end IS NOT NULL AND departure_time_precision = 'range' AND departure_range_start <= departure_range_end)
);
ALTER TABLE legs ADD CONSTRAINT legs_arrival_range_complete CHECK (
  (arrival_range_start IS NULL AND arrival_range_end IS NULL AND arrival_time_precision <> 'range')
  OR (arrival_range_start IS NOT NULL AND arrival_range_end IS NOT NULL AND arrival_time_precision = 'range' AND arrival_range_start <= arrival_range_end)
);
