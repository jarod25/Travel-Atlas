import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { AtlasStore } from '@travel-atlas/database';

const tripId = '11111111-1111-4111-8111-111111111111';
const dayId = '22222222-2222-4222-8222-222222222222';
const visitId = '33333333-3333-4333-8333-333333333333';

function stub(): AtlasStore {
  return {
    listTrips: async () => [{ id: tripId, title: 'Synthetic' }],
    createTrip: async (title: string) => ({ id: tripId, title }),
    getTrip: async (id: string) => (id === tripId ? { id, title: 'Synthetic' } : null),
    listDays: async (id: string) => (id === tripId ? [] : null),
    createDay: async (id: string, localDate: string | null) =>
      id === tripId ? { id: dayId, tripId: id, localDate } : null,
    getTimeline: async (id: string, day: string) =>
      id === tripId && day === dayId ? { visits: [], legs: [] } : null,
    listPlaces: async () => [],
    createPlace: async (name: string) => ({ id: 'new-place', name }),
    addVisit: async () => ({ visit: { id: visitId }, draftLeg: null }),
    reorderVisits: async () => ({ changed: true }),
    archiveVisit: async () => ({ archivedVisitId: visitId }),
    updateLeg: async (id: string, revision: number) => ({ status: 'conflict', currentRevision: revision + 1 }),
    getExplore: async () => ({ type: 'FeatureCollection', features: [] }),
    close: async () => undefined,
  };
}

describe('Trip API', () => {
  it('keeps the health check available without database access', async () => {
    const app = buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
  it('creates a trip with a validated title', async () => {
    const app = buildApp(stub());
    try {
      const valid = await app.inject({
        method: 'POST',
        url: '/api/v1/trips',
        payload: { title: ' Synthetic ' },
      });
      expect(valid.statusCode).toBe(201);
      expect(valid.json().title).toBe('Synthetic');
      const bad = await app.inject({
        method: 'POST',
        url: '/api/v1/trips',
        payload: { title: '' },
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
  it('validates UUIDs, lists days and preserves absent dates', async () => {
    const app = buildApp(stub());
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/trips/not-a-uuid' })).statusCode,
      ).toBe(400);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/days`,
        payload: {},
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().localDate).toBeNull();
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/trips/44444444-4444-4444-8444-444444444444/days',
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('creates visits through one store operation, never in the UI', async () => {
    const app = buildApp(stub());
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/days/${dayId}/visits`,
        payload: {},
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().draftLeg).toBeNull();
      const invalid = await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/days/${dayId}/reorder`,
        payload: { visitIds: [visitId, visitId] },
      });
      expect(invalid.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('Leg optimistic locking API', () => {
  it('requires If-Match and rejects conflicting revisions', async () => {
    const app = buildApp(stub());
    try {
      const url = `/api/v1/legs/${visitId}`;
      expect((await app.inject({ method: 'PATCH', url, payload: { transportMode: 'train' } }))
        .statusCode).toBe(428);
      const conflict = await app.inject({ method: 'PATCH', url, payload: { transportMode: 'train' },
        headers: { 'if-match': '"1"' } });
      expect(conflict.statusCode).toBe(412);
      expect(conflict.headers.etag).toBe('"2"');
    } finally { await app.close(); }
  });
});
