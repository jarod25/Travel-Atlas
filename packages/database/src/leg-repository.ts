import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, routeProposals } from './schema';

export type LegChanges = Partial<Pick<
  typeof legs.$inferInsert,
  'transportMode' | 'movementConfidence' | 'transportConfidence' |
  'departureLocalDate' | 'departureLocalTime' | 'departureTimeZone' |
  'departureTimeConfidence' | 'arrivalLocalDate' | 'arrivalLocalTime' |
  'arrivalTimeZone' | 'arrivalTimeConfidence'
>>;

export type LegUpdateResult =
  | { status: 'not_found' }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'updated'; leg: typeof legs.$inferSelect };

/** Optimistic revisions protect a user from overwriting another edit. */
export async function updateLegWithRevision(
  db: PostgresJsDatabase,
  id: string,
  expectedRevision: number,
  changes: LegChanges,
): Promise<LegUpdateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(legs).where(eq(legs.id, id)).for('update');
    if (!current) return { status: 'not_found' };
    if (current.revision !== expectedRevision) {
      return { status: 'conflict', currentRevision: current.revision };
    }
    const modeChanged = changes.transportMode !== undefined &&
      changes.transportMode !== current.transportMode;
    const [updated] = await tx.update(legs).set({
      ...changes,
      revision: current.revision + 1,
      ...(modeChanged ? {
        selectedRouteVersionId: null,
        geometryConfidence: 'unknown' as const,
      } : {}),
    }).where(eq(legs.id, id)).returning();

    if (modeChanged) {
      await tx.update(routeProposals).set({
        status: 'invalidated', reviewedAt: new Date(),
      }).where(
        // Database SQL checks pending; update only pending candidates.
        // Accepted routes remain in history, but selection is cleared.
        and(eq(routeProposals.legId, id), eq(routeProposals.status, 'pending')),
      );
    }
    return { status: 'updated', leg: updated };
  });
}
