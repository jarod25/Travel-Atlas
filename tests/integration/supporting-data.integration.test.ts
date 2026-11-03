import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  appSettings,
  evidence,
  evidenceLinks,
  mediaAssets,
  placeExternalRefs,
  places,
  tripDays,
  trips,
  visitTimeObservations,
  visits,
} from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL must point to a disposable integration-test database.');
}
const client = postgres(url, { max: 1 });
const db = drizzle(client);
const tripIds: string[] = [];
const evidenceIds: string[] = [];
const placeIds: string[] = [];
const mediaIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of evidenceIds) {
    await db.delete(evidence).where(eq(evidence.id, id));
  }
  for (const id of tripIds) {
    await db.delete(trips).where(eq(trips.id, id));
  }
  for (const id of placeIds) {
    await db.delete(places).where(eq(places.id, id));
  }
  for (const id of mediaIds) {
    await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  }
  await db.delete(appSettings).where(eq(appSettings.key, 'synthetic.test'));
  await client.end();
});

function pgCode(error: unknown) {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}
async function rejected(action: () => Promise<unknown>, expected: string) {
  try {
    await action();
    throw new Error('Expected database constraint violation');
  } catch (error) {
    expect(pgCode(error)).toBe(expected);
  }
}
async function fixture() {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic sources' }).returning();
  tripIds.push(trip.id);
  const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
  const [visit] = await db
    .insert(visits)
    .values({
      tripId: trip.id,
      tripDayId: day.id,
      position: 0,
    })
    .returning();
  const [source] = await db
    .insert(evidence)
    .values({
      kind: 'user_statement',
      description: 'Synthetic statement',
      metadata: { imported: false },
    })
    .returning();
  evidenceIds.push(source.id);
  return { trip, day, visit, source };
}

describe('Evidence and supporting data', () => {
  it('stores typed evidence linked to exactly one field and one target', async () => {
    const f = await fixture();
    const [link] = await db
      .insert(evidenceLinks)
      .values({
        evidenceId: f.source.id,
        visitId: f.visit.id,
        fieldName: 'presence',
        confidence: 'confirmed',
      })
      .returning();
    expect(link.tripId).toBeNull();
    expect(link.visitId).toBe(f.visit.id);
    expect(link.confidence).toBe('confirmed');
    await rejected(
      () =>
        db.insert(evidenceLinks).values({
          evidenceId: f.source.id,
          fieldName: 'presence',
        }),
      '23514',
    );
    await rejected(
      () =>
        db.insert(evidenceLinks).values({
          evidenceId: f.source.id,
          tripId: f.trip.id,
          visitId: f.visit.id,
          fieldName: 'presence',
        }),
      '23514',
    );
  });

  it('stores a time observation without inventing a UTC instant or affecting legs', async () => {
    const f = await fixture();
    const [observation] = await db
      .insert(visitTimeObservations)
      .values({
        visitId: f.visit.id,
        kind: 'arrival',
        localDate: '2026-09-12',
        localTime: '14:30:00',
        confidence: 'estimated',
        evidenceId: f.source.id,
      })
      .returning();
    expect(observation.localTime).toBe('14:30:00');
    expect(observation.timeZone).toBeNull();
    expect(observation.confidence).toBe('estimated');
    await rejected(
      () =>
        db.insert(visitTimeObservations).values({
          visitId: f.visit.id,
          kind: 'presence',
          localTime: '12:00:00',
        }),
      '23514',
    );
  });

  it('stores nullable media coordinates and provider IDs without duplicate identities', async () => {
    const [place] = await db
      .insert(places)
      .values({ name: 'Synthetic station', location: null })
      .returning();
    placeIds.push(place.id);
    const [ref] = await db
      .insert(placeExternalRefs)
      .values({
        placeId: place.id,
        provider: 'synthetic',
        externalId: place.id,
      })
      .returning();
    expect(ref.provider).toBe('synthetic');
    await rejected(
      () =>
        db.insert(placeExternalRefs).values({
          placeId: place.id,
          provider: 'synthetic',
          externalId: place.id,
        }),
      '23505',
    );
    const [media] = await db.insert(mediaAssets).values({ filename: 'synthetic.jpg' }).returning();
    mediaIds.push(media.id);
    expect(media.location).toBeNull();
    expect(media.capturedLocalDate).toBeNull();
    const rows = await db.execute(sql`SELECT location IS NULL AS unknown
      FROM media_assets WHERE id = ${media.id}`);
    expect(rows[0].unknown).toBe(true);
  });

  it('stores JSON settings in the database', async () => {
    const [saved] = await db
      .insert(appSettings)
      .values({
        key: 'synthetic.test',
        value: { mapStyle: 'base', private: true },
      })
      .returning();
    expect(saved.value).toEqual({ mapStyle: 'base', private: true });
    await db
      .update(appSettings)
      .set({ value: { mapStyle: 'alternate' } })
      .where(eq(appSettings.key, 'synthetic.test'));
    const [updated] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'synthetic.test'));
    expect(updated.value).toEqual({ mapStyle: 'alternate' });
  });
});
