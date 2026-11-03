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
    editTrip: async (id: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    getTrip: async (id: string) => (id === tripId ? { id, title: 'Synthetic' } : null),
    listDays: async (id: string) => (id === tripId ? [] : null),
    createDay: async (id: string, localDate: string | null) =>
      id === tripId ? { id: dayId, tripId: id, localDate } : null,
    editDay: async (id: string, dayId: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    getTimeline: async (id: string, day: string) =>
      id === tripId && day === dayId ? { visits: [], legs: [] } : null,
    listPlaces: async () => [],
    createPlace: async (name: string) => ({ id: 'new-place', name }),
    updatePlace: async (id: string, coordinates: [number, number] | null, confidence: string) => ({
      id,
      location: coordinates,
      locationConfidence: confidence,
    }),
    addVisit: async () => ({ visit: { id: visitId }, draftLeg: null }),
    reorderVisits: async () => ({ changed: true }),
    archiveVisit: async () => ({ archivedVisitId: visitId }),
    updateLeg: async (id: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    connectDays: async () => ({ status: 'invalid', reason: 'Synthetic conflict' }),
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
      expect(
        (await app.inject({ method: 'PATCH', url, payload: { transportMode: 'train' } }))
          .statusCode,
      ).toBe(428);
      const conflict = await app.inject({
        method: 'PATCH',
        url,
        payload: { transportMode: 'train' },
        headers: { 'if-match': '"1"' },
      });
      expect(conflict.statusCode).toBe(412);
      expect(conflict.headers.etag).toBe('"2"');
    } finally {
      await app.close();
    }
  });
});

describe('Place coordinate API', () => {
  it('validates bounds and requires Unknown when coordinates are null', async () => {
    const app = buildApp(stub());
    const url = `/api/v1/places/${visitId}`;
    try {
      const ok = await app.inject({
        method: 'PATCH',
        url,
        payload: { coordinates: [0, 0], confidence: 'confirmed' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().location).toEqual([0, 0]);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            payload: { coordinates: [200, 0], confidence: 'estimated' },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            payload: { coordinates: null, confidence: 'confirmed' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('Trip metadata API', () => {
  it('enforces optimistic revision and rejects blank titles', async () => {
    const app = buildApp(stub());
    const url = `/api/v1/trips/${tripId}`;
    try {
      expect(
        (await app.inject({ method: 'PATCH', url, payload: { title: 'Changed' } })).statusCode,
      ).toBe(428);
      const conflict = await app.inject({
        method: 'PATCH',
        url,
        headers: { 'if-match': '"1"' },
        payload: { isArchived: true },
      });
      expect(conflict.statusCode).toBe(412);
      expect(conflict.headers.etag).toBe('"2"');
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            headers: { 'if-match': '"1"' },
            payload: { title: ' ' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('Trip day revision API', () => {
  it('requires an optimistic revision for calendar dates', async () => {
    const app = buildApp(stub());
    const url = `/api/v1/trips/${tripId}/days/${dayId}`;
    try {
      expect(
        (await app.inject({ method: 'PATCH', url, payload: { localDate: null } })).statusCode,
      ).toBe(428);
      const stale = await app.inject({
        method: 'PATCH',
        url,
        headers: { 'if-match': '"1"' },
        payload: { localDate: '2026-09-12' },
      });
      expect(stale.statusCode).toBe(412);
      expect(stale.headers.etag).toBe('"2"');
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            headers: { 'if-match': '"1"' },
            payload: { localDate: 'not a date' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('Explicit day connections API', () => {
  it('validates day UUIDs and reports a domain conflict', async () => {
    const app = buildApp(stub());
    try {
      const path = `/api/v1/trips/${tripId}/connect-days`;
      expect((await app.inject({ method: 'POST', url: path,
        payload: { fromDayId: 'invalid', toDayId: dayId } })).statusCode).toBe(400);
      const blocked = await app.inject({ method: 'POST', url: path,
        payload: { fromDayId: dayId, toDayId: visitId } });
      expect(blocked.statusCode).toBe(409);
    } finally { await app.close(); }
  });
});
