import Fastify from 'fastify';
import type { AtlasStore } from '@travel-atlas/database';

const uuid = { type: 'string', format: 'uuid' } as const;
const nonblank = { type: 'string', minLength: 1, maxLength: 200 } as const;
const idParams = {
  type: 'object',
  required: ['tripId'],
  properties: { tripId: uuid },
  additionalProperties: false,
} as const;
const dayParams = {
  type: 'object',
  required: ['tripId', 'dayId'],
  properties: { tripId: uuid, dayId: uuid },
  additionalProperties: false,
} as const;

export function buildApp(store?: AtlasStore) {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ status: 'ok' }));

  if (!store) return app;

  app.get('/api/v1/trips', async () => store.listTrips());
  app.post<{ Body: { title: string } }>(
    '/api/v1/trips',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: { title: nonblank },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim();
      if (!title) return reply.code(400).send({ error: 'Invalid title' });
      return reply.code(201).send(await store.createTrip(title));
    },
  );
  app.get<{ Params: { tripId: string } }>(
    '/api/v1/trips/:tripId',
    {
      schema: { params: idParams },
    },
    async (request, reply) => {
      const trip = await store.getTrip(request.params.tripId);
      return trip ?? reply.code(404).send({ error: 'Trip not found' });
    },
  );
  app.get<{ Params: { tripId: string } }>(
    '/api/v1/trips/:tripId/days',
    {
      schema: { params: idParams },
    },
    async (request, reply) => {
      const days = await store.listDays(request.params.tripId);
      return days ?? reply.code(404).send({ error: 'Trip not found' });
    },
  );
  app.post<{ Params: { tripId: string }; Body: { localDate: string | null } }>(
    '/api/v1/trips/:tripId/days',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          properties: {
            localDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const created = await store.createDay(request.params.tripId, request.body.localDate ?? null);
      return created
        ? reply.code(201).send(created)
        : reply.code(404).send({ error: 'Trip not found' });
    },
  );
  app.get<{ Params: { tripId: string; dayId: string } }>(
    '/api/v1/trips/:tripId/days/:dayId/timeline',
    { schema: { params: dayParams } },
    async (request, reply) => {
      const result = await store.getTimeline(request.params.tripId, request.params.dayId);
      return result ?? reply.code(404).send({ error: 'Day not found' });
    },
  );
  app.get<{ Querystring: { q?: string } }>(
    '/api/v1/places',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => store.listPlaces(request.query.q ?? ''),
  );
  app.post<{ Body: { name: string } }>(
    '/api/v1/places',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: nonblank },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'Invalid name' });
      return reply.code(201).send(await store.createPlace(name));
    },
  );
  app.post<{ Params: { tripId: string; dayId: string }; Body: { placeId?: string | null } }>(
    '/api/v1/trips/:tripId/days/:dayId/visits',
    {
      schema: {
        params: dayParams,
        body: {
          type: 'object',
          properties: {
            placeId: { anyOf: [uuid, { type: 'null' }] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await store.addVisit(
              request.params.tripId,
              request.params.dayId,
              request.body.placeId ?? null,
            ),
          );
      } catch (error) {
        if (error instanceof Error && error.message.includes('Trip day not found')) {
          return reply.code(404).send({ error: 'Day not found' });
        }
        throw error;
      }
    },
  );
  app.post<{ Params: { tripId: string; dayId: string }; Body: { visitIds: string[] } }>(
    '/api/v1/trips/:tripId/days/:dayId/reorder',
    {
      schema: {
        params: dayParams,
        body: {
          type: 'object',
          required: ['visitIds'],
          properties: { visitIds: { type: 'array', items: uuid, uniqueItems: true } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        return await store.reorderVisits(
          request.params.tripId,
          request.params.dayId,
          request.body.visitIds,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('exact permutation')) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );
  app.delete<{ Params: { tripId: string; dayId: string; visitId: string } }>(
    '/api/v1/trips/:tripId/days/:dayId/visits/:visitId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['tripId', 'dayId', 'visitId'],
          properties: { tripId: uuid, dayId: uuid, visitId: uuid },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        return await store.archiveVisit(
          request.params.tripId,
          request.params.dayId,
          request.params.visitId,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );
  app.get('/api/v1/explore/geojson', async () => store.getExplore());
  return app;
}
