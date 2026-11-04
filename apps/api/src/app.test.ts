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
    archiveDay: async (id: string, dayId: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    editDay: async (id: string, dayId: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    getTimeline: async (id: string, day: string) =>
      id === tripId && day === dayId ? { visits: [], legs: [] } : null,
    listPlaces: async () => [],
    createPlace: async (name: string) => ({ id: 'new-place', name }),
    updatePlace: async (id: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    addVisit: async () => ({ visit: { id: visitId }, draftLeg: null }),
    reorderVisits: async () => ({ changed: true }),
    archiveVisit: async () => ({ archivedVisitId: visitId }),
    editVisitPlace: async (id: string, day: string, visit: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    updateLeg: async (id: string, revision: number) => ({
      status: 'conflict',
      currentRevision: revision + 1,
    }),
    connectDays: async () => ({ status: 'invalid', reason: 'Synthetic conflict' }),
    disconnectDays: async () => ({ status: 'invalid', reason: 'Synthetic conflict' }),
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

describe('Explicit day disconnection API', () => {
  it('requires a Leg revision and refuses invalid disconnects', async () => {
    const app = buildApp(stub());
    const url = `/api/v1/trips/${tripId}/disconnect-days`;
    const payload = { fromDayId: dayId, toDayId: visitId, legId: visitId };
    try {
      const missing = await app.inject({ method: 'POST', url, payload });
      expect(missing.statusCode).toBe(428);
      const invalid = await app.inject({
        method: 'POST',
        url,
        payload,
        headers: { 'if-match': '"1"' },
      });
      expect(invalid.statusCode).toBe(409);
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
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path,
            payload: { fromDayId: 'invalid', toDayId: dayId },
          })
        ).statusCode,
      ).toBe(400);
      const blocked = await app.inject({
        method: 'POST',
        url: path,
        payload: { fromDayId: dayId, toDayId: visitId },
      });
      expect(blocked.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});

describe('Day archive optimistic locking API', () => {
  it('validates the request and rejects stale revisions', async () => {
    const app = buildApp(stub());
    const url = `/api/v1/trips/${tripId}/days/${dayId}/archive`;
    try {
      expect(
        (await app.inject({ method: 'PATCH', url, payload: { isArchived: true } })).statusCode,
      ).toBe(428);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            headers: { 'if-match': '"1"' },
            payload: { isArchived: 'yes' },
          })
        ).statusCode,
      ).toBe(400);
      const stale = await app.inject({
        method: 'PATCH',
        url,
        headers: { 'if-match': '"1"' },
        payload: { isArchived: true },
      });
      expect(stale.statusCode).toBe(412);
      expect(stale.headers.etag).toBe('"2"');
    } finally {
      await app.close();
    }
  });
});

describe('Existing Visit Place correction API', () => {
  it('requires If-Match and validates the proposed Place identifier', async () => {
    const app = buildApp(stub());
    const url = `/api/v1/trips/${tripId}/days/${dayId}/visits/${visitId}`;
    try {
      const missing = await app.inject({
        method: 'PATCH',
        url,
        payload: { placeId: null },
      });
      expect(missing.statusCode).toBe(428);
      const badPlace = await app.inject({
        method: 'PATCH',
        url,
        headers: { 'if-match': '"1"' },
        payload: { placeId: 'not-a-uuid' },
      });
      expect(badPlace.statusCode).toBe(400);
      const conflict = await app.inject({
        method: 'PATCH',
        url,
        headers: { 'if-match': '"1"' },
        payload: { placeId: null },
      });
      expect(conflict.statusCode).toBe(412);
      expect(conflict.headers.etag).toBe('"2"');
    } finally {
      await app.close();
    }
  });
});

describe('Place revisions API', () => {
  it('requires an If-Match revision and rejects stale updates', async () => {
    const app = buildApp(stub());
    const url = '/api/v1/places/44444444-4444-4444-8444-444444444444';
    const payload = { coordinates: [1, 2], confidence: 'estimated' };
    try {
      const missing = await app.inject({ method: 'PATCH', url, payload });
      expect(missing.statusCode).toBe(428);
      const conflict = await app.inject({
        method: 'PATCH',
        url,
        payload,
        headers: { 'if-match': '"1"' },
      });
      expect(conflict.statusCode).toBe(412);
      expect(conflict.headers.etag).toBe('"2"');
    } finally {
      await app.close();
    }
  });
});

describe('Archived Trip timeline HTTP errors', () => {
  it('returns 409 rather than 500 for all archived Trip Visit writes', async () => {
    const store = stub();
    store.addVisit = async () => {
      throw new Error('Trip is archived');
    };
    store.reorderVisits = async () => {
      throw new Error('Trip is archived');
    };
    store.archiveVisit = async () => {
      throw new Error('Trip is archived');
    };
    const app = buildApp(store);
    const root = `/api/v1/trips/${tripId}/days/${dayId}`;
    try {
      const create = await app.inject({ method: 'POST', url: `${root}/visits`, payload: {} });
      const reorder = await app.inject({
        method: 'POST',
        url: `${root}/reorder`,
        payload: { visitIds: [visitId] },
      });
      const archive = await app.inject({
        method: 'DELETE',
        url: `${root}/visits/${visitId}`,
      });
      for (const response of [create, reorder, archive]) {
        expect(response.statusCode).toBe(409);
        expect(response.json().error).toBe('Trip is archived');
      }
    } finally {
      await app.close();
    }
  });
});
