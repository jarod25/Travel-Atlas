ALTER TABLE places ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE places ADD CONSTRAINT places_revision_positive CHECK (revision > 0);
