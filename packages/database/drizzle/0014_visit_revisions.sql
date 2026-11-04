ALTER TABLE visits ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE visits ADD CONSTRAINT visits_revision_positive CHECK (revision > 0);
