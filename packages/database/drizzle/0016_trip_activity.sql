ALTER TABLE trips ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE trip_days ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE visits ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE legs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE FUNCTION atlas_update_activity_timestamp() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trips_activity_timestamp BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION atlas_update_activity_timestamp();
--> statement-breakpoint
CREATE TRIGGER trip_days_activity_timestamp BEFORE UPDATE ON trip_days FOR EACH ROW EXECUTE FUNCTION atlas_update_activity_timestamp();
--> statement-breakpoint
CREATE TRIGGER visits_activity_timestamp BEFORE UPDATE ON visits FOR EACH ROW EXECUTE FUNCTION atlas_update_activity_timestamp();
--> statement-breakpoint
CREATE TRIGGER legs_activity_timestamp BEFORE UPDATE ON legs FOR EACH ROW EXECUTE FUNCTION atlas_update_activity_timestamp();
