ALTER TABLE "route_proposals" ADD COLUMN "accepted_route_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "route_proposals" ADD CONSTRAINT "route_proposals_accepted_version_same_leg_fk"
  FOREIGN KEY ("leg_id","accepted_route_version_id") REFERENCES "route_versions"("leg_id","id");
