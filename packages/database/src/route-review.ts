import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, routeProposals, routeVersions } from './schema';

type ReviewResult =
  { status: 'accepted'; versionId: string; alreadyAccepted: boolean } | { status: 'invalidated' };

/**
 * Accept a stored route candidate in a serializable sequence for a single Leg.
 * The parent Leg row lock serializes concurrent reviews and version numbering.
 * Calculated routes remain Estimated even when the user accepts their geometry.
 */
export async function acceptRouteProposal(
  db: PostgresJsDatabase,
  input: { legId: string; proposalId: string },
): Promise<ReviewResult> {
  return db.transaction(async (tx) => {
    const [leg] = await tx.select().from(legs).where(eq(legs.id, input.legId)).for('update');
    if (!leg) {
      throw new Error('Leg not found');
    }

    const [proposal] = await tx
      .select()
      .from(routeProposals)
      .where(and(eq(routeProposals.id, input.proposalId), eq(routeProposals.legId, leg.id)))
      .for('update');
    if (!proposal) {
      throw new Error('Proposal not found on the specified Leg');
    }

    if (proposal.status === 'accepted' && proposal.acceptedRouteVersionId) {
      return {
        status: 'accepted',
        versionId: proposal.acceptedRouteVersionId,
        alreadyAccepted: true,
      };
    }
    if (proposal.status !== 'pending') {
      throw new Error('Only pending proposals may be accepted');
    }

    if (
      !leg.isCurrent ||
      proposal.fromVisitId !== leg.fromVisitId ||
      proposal.toVisitId !== leg.toVisitId ||
      proposal.transportMode !== leg.transportMode
    ) {
      await tx
        .update(routeProposals)
        .set({ status: 'invalidated', reviewedAt: new Date() })
        .where(eq(routeProposals.id, proposal.id));
      return { status: 'invalidated' };
    }

    const geometryRows = await tx.execute(sql`
      SELECT ST_AsGeoJSON(geometry) AS geojson,
        ST_Length(geometry::geography) AS distance_meters
      FROM route_proposals WHERE id = ${proposal.id}
    `);
    const geojson = geometryRows[0]?.geojson;
    if (typeof geojson !== 'string') {
      throw new Error('Cannot accept a proposal without route geometry');
    }

    const versionRows = await tx.execute(sql`
      SELECT COALESCE(MAX(version_number), 0)::int AS maximum
      FROM route_versions WHERE leg_id = ${leg.id}
    `);
    const number = Number(versionRows[0]?.maximum ?? 0) + 1;
    const [version] = await tx
      .insert(routeVersions)
      .values({
        tripId: leg.tripId,
        legId: leg.id,
        versionNumber: number,
        geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojson}),4326)`,
        confidence: 'estimated',
        origin: 'calculated',
        distanceMeters: Number(geometryRows[0]?.distance_meters),
        provider: proposal.provider,
      })
      .returning();

    await tx.update(legs).set({ selectedRouteVersionId: version.id }).where(eq(legs.id, leg.id));
    await tx
      .update(routeProposals)
      .set({
        status: 'accepted',
        reviewedAt: new Date(),
        acceptedRouteVersionId: version.id,
      })
      .where(eq(routeProposals.id, proposal.id));

    return { status: 'accepted', versionId: version.id, alreadyAccepted: false };
  });
}
