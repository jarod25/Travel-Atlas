ALTER TABLE "legs" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_revision_positive" CHECK ("revision" > 0);
