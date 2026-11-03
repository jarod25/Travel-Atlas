import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { acceptRouteProposal } from '../../packages/database/src/route-review';
import {
  legs,
  routeProposals,
  routeVersions,
  tripDays,
  trips,
  visits,
} from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL must point to a disposable integration-test database.');
}
const client = postgres(url, { max: 5 });
const db = drizzle(client);
const tripIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) {
    await db.delete(routeProposals).where(eq(routeProposals.tripId, id));
    await db.update(legs).set({ selectedRouteVersionId: null }).where(eq(legs.tripId, id));
    await db.delete(routeVersions).where(eq(routeVersions.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await client.end();
});

async function fixture() {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic route review' }).returning();
  tripIds.push(trip.id);
  const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
  const points = await db
    .insert(visits)
    .values([
      { tripId: trip.id, tripDayId: day.id, position: 0 },
      { tripId: trip.id, tripDayId: day.id, position: 1 },
    ])
    .returning();
  const [leg] = await db
    .insert(legs)
    .values({
      tripId: trip.id,
      fromVisitId: points[0].id,
      toVisitId: points[1].id,
      transportMode: 'train',
    })
    .returning();
  return { trip, leg, points };
}

const line = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [0, 1],
  ],
};
async function proposalFor(
  f: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {},
) {
  const [candidate] = await db
    .insert(routeProposals)
    .values({
      tripId: f.trip.id,
      legId: f.leg.id,
      fromVisitId: f.points[0].id,
      toVisitId: f.points[1].id,
      transportMode: 'train',
      provider: 'synthetic',
      parameters: { profile: 'tgv' },
      geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(line)}),4326)`,
      ...overrides,
    })
    .returning();
  return candidate;
}

describe('Transactional route proposal review', () => {
  it('accepts once, versions geometry and keeps actual-travel certainty unknown', async () => {
    const f = await fixture();
    const candidate = await proposalFor(f);
    const first = await acceptRouteProposal(db, { legId: f.leg.id, proposalId: candidate.id });
    expect(first.status).toBe('accepted');
    if (first.status !== 'accepted') throw new Error('Unexpected invalidation');
    expect(first.alreadyAccepted).toBe(false);
    const second = await acceptRouteProposal(db, { legId: f.leg.id, proposalId: candidate.id });
    expect(second).toEqual({
      status: 'accepted',
      versionId: first.versionId,
      alreadyAccepted: true,
    });
    const versions = await db.select().from(routeVersions).where(eq(routeVersions.legId, f.leg.id));
    expect(versions).toHaveLength(1);
    expect(versions[0].confidence).toBe('estimated');
    expect(versions[0].distanceMeters).toBeGreaterThan(0);
    const [leg] = await db.select().from(legs).where(eq(legs.id, f.leg.id));
    expect(leg.selectedRouteVersionId).toBe(first.versionId);
    expect(leg.geometryConfidence).toBe('unknown');
    const [proposal] = await db
      .select()
      .from(routeProposals)
      .where(eq(routeProposals.id, candidate.id));
    expect(proposal.status).toBe('accepted');
    expect(proposal.acceptedRouteVersionId).toBe(first.versionId);
  });

  it('invalidates a stale transport snapshot and creates no version', async () => {
    const f = await fixture();
    const candidate = await proposalFor(f);
    await db.update(legs).set({ transportMode: 'bus' }).where(eq(legs.id, f.leg.id));
    const result = await acceptRouteProposal(db, { legId: f.leg.id, proposalId: candidate.id });
    expect(result).toEqual({ status: 'invalidated' });
    const [proposal] = await db
      .select()
      .from(routeProposals)
      .where(eq(routeProposals.id, candidate.id));
    expect(proposal.status).toBe('invalidated');
    expect(proposal.reviewedAt).not.toBeNull();
    expect(
      await db.select().from(routeVersions).where(eq(routeVersions.legId, f.leg.id)),
    ).toHaveLength(0);
  });

  it('rolls back if geometry is missing', async () => {
    const f = await fixture();
    const candidate = await proposalFor(f, { geometry: null });
    await expect(
      acceptRouteProposal(db, {
        legId: f.leg.id,
        proposalId: candidate.id,
      }),
    ).rejects.toThrow('without route geometry');
    const [proposal] = await db
      .select()
      .from(routeProposals)
      .where(eq(routeProposals.id, candidate.id));
    expect(proposal.status).toBe('pending');
    expect(
      await db.select().from(routeVersions).where(eq(routeVersions.legId, f.leg.id)),
    ).toHaveLength(0);
  });

  it('serializes two concurrent accepts of the same proposal', async () => {
    const f = await fixture();
    const candidate = await proposalFor(f);
    const results = await Promise.all([
      acceptRouteProposal(db, { legId: f.leg.id, proposalId: candidate.id }),
      acceptRouteProposal(db, { legId: f.leg.id, proposalId: candidate.id }),
    ]);
    expect(results.every((result) => result.status === 'accepted')).toBe(true);
    expect(
      await db.select().from(routeVersions).where(eq(routeVersions.legId, f.leg.id)),
    ).toHaveLength(1);
  });

  it('rejects an unrelated leg and leaves proposal unchanged', async () => {
    const a = await fixture();
    const b = await fixture();
    const candidate = await proposalFor(a);
    await expect(
      acceptRouteProposal(db, {
        legId: b.leg.id,
        proposalId: candidate.id,
      }),
    ).rejects.toThrow('Proposal not found');
    const [saved] = await db
      .select()
      .from(routeProposals)
      .where(eq(routeProposals.id, candidate.id));
    expect(saved.status).toBe('pending');
  });
});
