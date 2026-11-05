-- A Leg is owned by its departure Trip, but its destination Visit may belong to a related Trip.
ALTER TABLE legs DROP CONSTRAINT legs_from_visit_same_trip_fk;
ALTER TABLE legs DROP CONSTRAINT legs_to_visit_same_trip_fk;
ALTER TABLE legs ADD CONSTRAINT legs_trip_fk FOREIGN KEY (trip_id) REFERENCES trips(id);
ALTER TABLE legs ADD CONSTRAINT legs_from_visit_fk FOREIGN KEY (from_visit_id) REFERENCES visits(id);
ALTER TABLE legs ADD CONSTRAINT legs_to_visit_fk FOREIGN KEY (to_visit_id) REFERENCES visits(id);
CREATE OR REPLACE FUNCTION travel_atlas_check_leg_family() RETURNS trigger AS $$
DECLARE
  source_trip uuid;
  target_trip uuid;
  source_root uuid;
  target_root uuid;
BEGIN
  SELECT trip_id INTO source_trip FROM visits WHERE id = NEW.from_visit_id;
  SELECT trip_id INTO target_trip FROM visits WHERE id = NEW.to_visit_id;
  IF source_trip IS NULL OR target_trip IS NULL OR source_trip <> NEW.trip_id THEN
    RAISE EXCEPTION 'Leg owner must be the departure Visit Trip' USING ERRCODE = '23514';
  END IF;
  WITH RECURSIVE a AS (
    SELECT id, parent_trip_id FROM trips WHERE id = source_trip
    UNION ALL SELECT t.id, t.parent_trip_id FROM trips t JOIN a ON a.parent_trip_id = t.id
  ) SELECT id INTO source_root FROM a WHERE parent_trip_id IS NULL;
  WITH RECURSIVE a AS (
    SELECT id, parent_trip_id FROM trips WHERE id = target_trip
    UNION ALL SELECT t.id, t.parent_trip_id FROM trips t JOIN a ON a.parent_trip_id = t.id
  ) SELECT id INTO target_root FROM a WHERE parent_trip_id IS NULL;
  IF source_root IS NULL OR target_root IS NULL OR source_root <> target_root THEN
    RAISE EXCEPTION 'Cross-trip Leg endpoints must share a trip family' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER travel_atlas_leg_family BEFORE INSERT OR UPDATE OF trip_id, from_visit_id, to_visit_id ON legs
FOR EACH ROW EXECUTE FUNCTION travel_atlas_check_leg_family();
