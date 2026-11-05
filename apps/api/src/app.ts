import Fastify from 'fastify';
import { find as findTimeZones } from 'geo-tz';
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

  app.get<{ Querystring: { includeArchived?: boolean } }>(
    '/api/v1/trips',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { includeArchived: { type: 'boolean' } },
        },
      },
    },
    async (request) => store.listTrips(request.query.includeArchived ?? false),
  );
  app.patch<{
    Params: { tripId: string };
    Headers: { 'if-match'?: string };
    Body: {
      title?: string;
      isArchived?: boolean;
      parentTripId?: string | null;
      manualStartDate?: string | null;
      manualEndDate?: string | null;
    };
  }>(
    '/api/v1/trips/:tripId',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            title: nonblank,
            isArchived: { type: 'boolean' },
            parentTripId: { anyOf: [uuid, { type: 'null' }] },
            manualStartDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
            manualEndDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
          },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['if-match'];
      if (!header) return reply.code(428).send({ error: 'If-Match is required' });
      const match = /^"([1-9][0-9]*)"$/.exec(header);
      if (!match) return reply.code(400).send({ error: 'Invalid revision' });
      const title = request.body.title?.trim();
      if (title !== undefined && !title) {
        return reply.code(400).send({ error: 'Invalid trip title' });
      }
      const result = await store.editTrip(request.params.tripId, Number(match[1]), {
        ...request.body,
        ...(title === undefined ? {} : { title }),
      });
      if (result.status === 'invalid') return reply.code(422).send({ error: result.reason });
      if (result.status === 'not_found') {
        return reply.code(404).send({ error: 'Trip not found' });
      }
      if (result.status === 'conflict') {
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Trip was modified; reload before editing' });
      }
      return reply.header('ETag', `"${result.trip.revision}"`).send(result.trip);
    },
  );

  app.post<{ Body: { title: string; parentTripId?: string | null } }>(
    '/api/v1/trips',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: { title: nonblank, parentTripId: { anyOf: [uuid, { type: 'null' }] } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim();
      if (!title) return reply.code(400).send({ error: 'Invalid title' });
      const created = await store.createTrip(title, request.body.parentTripId ?? null);
      return created
        ? reply.code(201).send(created)
        : reply.code(400).send({ error: 'Parent trip not found or archived' });
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
  app.patch<{
    Params: { tripId: string; dayId: string };
    Headers: { 'if-match'?: string };
    Body: { localDate: string | null };
  }>(
    '/api/v1/trips/:tripId/days/:dayId',
    {
      schema: {
        params: dayParams,
        body: {
          type: 'object',
          required: ['localDate'],
          additionalProperties: false,
          properties: {
            localDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
          },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['if-match'];
      if (!header) return reply.code(428).send({ error: 'If-Match is required' });
      const match = /^"([1-9][0-9]*)"$/.exec(header);
      if (!match) return reply.code(400).send({ error: 'Invalid revision' });
      const result = await store.editDay(
        request.params.tripId,
        request.params.dayId,
        Number(match[1]),
        request.body.localDate,
      );
      if (result.status === 'not_found') {
        return reply.code(404).send({ error: 'Day not found' });
      }
      if (result.status === 'archived') {
        return reply.code(409).send({ error: 'Restore the Trip before editing its days' });
      }
      if (result.status === 'conflict') {
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Day was modified; reload before editing' });
      }
      return reply.header('ETag', `"${result.day.revision}"`).send(result.day);
    },
  );
  app.patch<{
    Params: { tripId: string; dayId: string };
    Headers: { 'if-match'?: string };
    Body: { isArchived: boolean };
  }>(
    '/api/v1/trips/:tripId/days/:dayId/archive',
    {
      schema: {
        params: dayParams,
        body: {
          type: 'object',
          required: ['isArchived'],
          additionalProperties: false,
          properties: { isArchived: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['if-match'];
      if (!header) return reply.code(428).send({ error: 'If-Match is required' });
      const match = /^"([1-9][0-9]*)"$/.exec(header);
      if (!match) return reply.code(400).send({ error: 'Invalid revision' });
      const result = await store.archiveDay(
        request.params.tripId,
        request.params.dayId,
        Number(match[1]),
        request.body.isArchived,
      );
      if (result.status === 'not_found') {
        return reply.code(404).send({ error: 'Day not found' });
      }
      if (result.status === 'archived') {
        return reply.code(409).send({ error: 'Restore the Trip before editing its days' });
      }
      if (result.status === 'conflict') {
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Day was modified; reload before editing' });
      }
      return reply.header('ETag', `"${result.day.revision}"`).send(result.day);
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
  app.patch<{
    Params: { placeId: string };
    Headers: { 'if-match'?: string };
    Body: {
      coordinates: [number, number] | null;
      confidence: 'confirmed' | 'estimated' | 'unknown';
    };
  }>(
    '/api/v1/places/:placeId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['placeId'],
          properties: { placeId: uuid },
          additionalProperties: false,
        },
        body: {
          type: 'object',
          required: ['coordinates', 'confidence'],
          additionalProperties: false,
          properties: {
            coordinates: {
              anyOf: [
                {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: { type: 'number', minimum: -180, maximum: 180 },
                },
                { type: 'null' },
              ],
            },
            confidence: { type: 'string', enum: ['confirmed', 'estimated', 'unknown'] },
          },
        },
      },
    },
    async (request, reply) => {
      if (
        request.body.coordinates !== null &&
        (request.body.coordinates[1] < -90 || request.body.coordinates[1] > 90)
      ) {
        return reply.code(400).send({ error: 'Latitude must be between -90 and 90' });
      }
      if (request.body.coordinates === null && request.body.confidence !== 'unknown') {
        return reply.code(400).send({ error: 'Missing coordinates must be Unknown' });
      }
      const header = request.headers['if-match'];
      if (!header) return reply.code(428).send({ error: 'If-Match is required' });
      const match = /^"([1-9][0-9]*)"$/.exec(header);
      if (!match) return reply.code(400).send({ error: 'Invalid Place revision' });
      const result = await store.updatePlace(
        request.params.placeId,
        Number(match[1]),
        request.body.coordinates,
        request.body.confidence,
      );
      if (result.status === 'not_found') {
        return reply.code(404).send({ error: 'Place not found' });
      }
      if (result.status === 'conflict') {
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Place was modified; reload before editing' });
      }
      return reply.header('ETag', `"${result.place.revision}"`).send(result.place);
    },
  );
  app.patch<{
    Params: { tripId: string; dayId: string; visitId: string };
    Headers: { 'if-match'?: string };
    Body: { placeId: string | null };
  }>(
    '/api/v1/trips/:tripId/days/:dayId/visits/:visitId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['tripId', 'dayId', 'visitId'],
          additionalProperties: false,
          properties: { tripId: uuid, dayId: uuid, visitId: uuid },
        },
        body: {
          type: 'object',
          required: ['placeId'],
          additionalProperties: false,
          properties: { placeId: { anyOf: [uuid, { type: 'null' }] } },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['if-match'];
      if (!header) return reply.code(428).send({ error: 'If-Match is required' });
      const match = /^"([1-9][0-9]*)"$/.exec(header);
      if (!match) return reply.code(400).send({ error: 'Invalid Visit revision' });
      const result = await store.editVisitPlace(
        request.params.tripId,
        request.params.dayId,
        request.params.visitId,
        Number(match[1]),
        request.body.placeId,
      );
      if (result.status === 'not_found' || result.status === 'place_not_found') {
        return reply.code(404).send({ error: 'Visit, day or Place not found' });
      }
      if (result.status === 'archived') {
        return reply.code(409).send({ error: 'Restore the trip and day before editing Visits' });
      }
      if (result.status === 'conflict') {
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Visit was modified; reload before editing' });
      }
      return reply.header('ETag', `"${result.visit.revision}"`).send(result.visit);
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
        if (
          error instanceof Error &&
          (error.message === 'Trip day is archived' || error.message === 'Trip is archived')
        ) {
          return reply.code(409).send({ error: error.message });
        }
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
        if (
          error instanceof Error &&
          (error.message === 'Trip day is archived' || error.message === 'Trip is archived')
        ) {
          return reply.code(409).send({ error: error.message });
        }
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
        if (
          error instanceof Error &&
          (error.message === 'Trip day is archived' || error.message === 'Trip is archived')
        ) {
          return reply.code(409).send({ error: error.message });
        }
        if (error instanceof Error && error.message.includes('not found')) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { tripId: string; dayId: string } }>(
    '/api/v1/trips/:tripId/days/:dayId/archived-visits',
    { schema: { params: dayParams } },
    async (request) => store.listArchivedVisits(request.params.tripId, request.params.dayId),
  );
  app.post<{ Params: { tripId: string; dayId: string; visitId: string } }>(
    '/api/v1/trips/:tripId/days/:dayId/visits/:visitId/restore',
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
        return await store.restoreVisit(
          request.params.tripId,
          request.params.dayId,
          request.params.visitId,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'Trip day is archived' ||
            error.message === 'Trip is archived' ||
            error.message.includes('cross-day Leg'))
        ) {
          return reply.code(409).send({ error: error.message });
        }
        if (error instanceof Error && error.message.includes('not found')) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { legId: string } }>(
    '/api/v1/legs/:legId/time-zone-suggestions',
    {
      schema: {
        params: {
          type: 'object',
          required: ['legId'],
          properties: { legId: uuid },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const positions = await store.getLegEndpointCoordinates(request.params.legId);
      if (!positions) return reply.code(404).send({ error: 'Current Leg not found' });
      const suggest = (point: [number, number] | null) =>
        point ? findTimeZones(point[1], point[0]) : [];
      return {
        departure: suggest(positions.from),
        arrival: suggest(positions.to),
        source: 'recorded-place-coordinates',
        confirmed: false,
      };
    },
  );
  app.patch<{
    Params: { legId: string };
    Body: {
      transportMode?:
        | 'walking'
        | 'hiking'
        | 'cycling'
        | 'train'
        | 'metro'
        | 'tram'
        | 'car'
        | 'bus'
        | 'taxi'
        | 'plane'
        | 'boat'
        | 'ferry'
        | null;
      movementConfidence?: 'confirmed' | 'estimated' | 'unknown';
      transportConfidence?: 'confirmed' | 'estimated' | 'unknown';
      departureLocalDate?: string | null;
      departureLocalTime?: string | null;
      departureTimeZone?: string | null;
      departureTimePrecision?: 'exact' | 'approximate' | 'range' | 'unknown';
      departureRangeStart?: string | null;
      departureRangeEnd?: string | null;
      departureTimeConfidence?: 'confirmed' | 'estimated' | 'unknown';
      arrivalLocalDate?: string | null;
      arrivalLocalTime?: string | null;
      arrivalTimeZone?: string | null;
      arrivalTimePrecision?: 'exact' | 'approximate' | 'range' | 'unknown';
      arrivalRangeStart?: string | null;
      arrivalRangeEnd?: string | null;
      arrivalTimeConfidence?: 'confirmed' | 'estimated' | 'unknown';
    };
    Headers: { 'if-match'?: string };
  }>(
    '/api/v1/legs/:legId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['legId'],
          properties: { legId: uuid },
          additionalProperties: false,
        },
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            transportMode: {
              anyOf: [
                {
                  type: 'string',
                  enum: [
                    'walking',
                    'hiking',
                    'cycling',
                    'train',
                    'metro',
                    'tram',
                    'car',
                    'bus',
                    'taxi',
                    'plane',
                    'boat',
                    'ferry',
                  ],
                },
                { type: 'null' },
              ],
            },
            movementConfidence: { type: 'string', enum: ['confirmed', 'estimated', 'unknown'] },
            transportConfidence: { type: 'string', enum: ['confirmed', 'estimated', 'unknown'] },
            departureLocalDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
            departureLocalTime: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            departureTimeZone: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
            departureTimePrecision: {
              type: 'string',
              enum: ['exact', 'approximate', 'range', 'unknown'],
            },
            departureRangeStart: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            departureRangeEnd: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            departureTimeConfidence: {
              type: 'string',
              enum: ['confirmed', 'estimated', 'unknown'],
            },
            arrivalLocalDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
            arrivalLocalTime: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            arrivalTimeZone: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
            arrivalTimePrecision: {
              type: 'string',
              enum: ['exact', 'approximate', 'range', 'unknown'],
            },
            arrivalRangeStart: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            arrivalRangeEnd: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            arrivalTimeConfidence: { type: 'string', enum: ['confirmed', 'estimated', 'unknown'] },
          },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['if-match'];
      if (!header) return reply.code(428).send({ error: 'If-Match is required' });
      const match = /^"([1-9][0-9]*)"$/.exec(header);
      if (!match) return reply.code(400).send({ error: 'Invalid If-Match revision' });
      // Fastify's AJV coercion may turn JSON null into an empty string when
      // validating a nullable string. Store unknown calendar values as SQL NULL,
      // never as an invalid empty PostgreSQL DATE/TIME.
      const changes = { ...request.body };
      for (const field of [
        'departureLocalDate',
        'departureLocalTime',
        'arrivalLocalDate',
        'arrivalLocalTime',
        'departureRangeStart',
        'departureRangeEnd',
        'arrivalRangeStart',
        'arrivalRangeEnd',
      ] as const) {
        if (changes[field] === '') changes[field] = null;
      }
      const result = await store.updateLeg(request.params.legId, Number(match[1]), changes);
      if (result.status === 'not_found') return reply.code(404).send({ error: 'Leg not found' });
      if (result.status === 'conflict') {
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Leg was modified; reload before editing' });
      }
      return reply.header('ETag', `"${result.leg.revision}"`).send(result.leg);
    },
  );
  app.post<{
    Params: { tripId: string };
    Body: { fromDayId: string; toDayId: string };
  }>(
    '/api/v1/trips/:tripId/connect-days',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['fromDayId', 'toDayId'],
          properties: { fromDayId: uuid, toDayId: uuid },
        },
      },
    },
    async (request, reply) => {
      const result = await store.connectDays(
        request.params.tripId,
        request.body.fromDayId,
        request.body.toDayId,
      );
      if (result.status === 'not_found') {
        return reply.code(404).send({ error: 'Day not found in this trip' });
      }
      if (result.status === 'invalid') {
        return reply.code(409).send({ error: result.reason });
      }
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );
  app.post<{
    Params: { tripId: string };
    Body: { fromDayId: string; toDayId: string; legId: string };
    Headers: { 'if-match'?: string };
  }>(
    '/api/v1/trips/:tripId/disconnect-days',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['fromDayId', 'toDayId', 'legId'],
          properties: { fromDayId: uuid, toDayId: uuid, legId: uuid },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers['if-match'];
      if (!header) return reply.code(428).send({ error: 'If-Match is required' });
      const match = /^"([1-9][0-9]*)"$/.exec(header);
      if (!match) return reply.code(400).send({ error: 'Invalid If-Match revision' });
      const result = await store.disconnectDays(
        request.params.tripId,
        request.body.fromDayId,
        request.body.toDayId,
        request.body.legId,
        Number(match[1]),
      );
      if (result.status === 'not_found') return reply.code(404).send({ error: 'Day not found' });
      if (result.status === 'invalid') return reply.code(409).send({ error: result.reason });
      if (result.status === 'conflict') {
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Leg was modified; reload before disconnecting' });
      }
      return reply.header('ETag', `"${result.leg.revision}"`).send(result);
    },
  );
  app.post<{
    Params: { tripId: string };
    Body: { fromDayId: string; toTripId: string; toDayId: string };
  }>(
    '/api/v1/trips/:tripId/connect-trip',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['fromDayId', 'toTripId', 'toDayId'],
          additionalProperties: false,
          properties: { fromDayId: uuid, toTripId: uuid, toDayId: uuid },
        },
      },
    },
    async (request, reply) => {
      const result = await store.connectTrips(
        request.params.tripId,
        request.body.fromDayId,
        request.body.toTripId,
        request.body.toDayId,
      );
      if (result.status === 'not_found') return reply.code(404).send({ error: 'Day not found' });
      if (result.status === 'invalid') return reply.code(409).send({ error: result.reason });
      if (result.status !== 'connected')
        return reply.code(409).send({ error: 'Unexpected connection status' });
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );
  app.post<{
    Params: { legId: string };
    Headers: { 'if-match'?: string };
  }>(
    '/api/v1/legs/:legId/disconnect-trip',
    {
      schema: {
        params: {
          type: 'object',
          required: ['legId'],
          properties: { legId: uuid },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const match = /^"([1-9][0-9]*)"$/.exec(request.headers['if-match'] ?? '');
      if (!request.headers['if-match'])
        return reply.code(428).send({ error: 'If-Match is required' });
      if (!match) return reply.code(400).send({ error: 'Invalid revision' });
      const result = await store.disconnectTrips(request.params.legId, Number(match[1]));
      if (result.status === 'not_found') return reply.code(404).send({ error: 'Leg not found' });
      if (result.status === 'invalid') return reply.code(409).send({ error: result.reason });
      if (result.status === 'conflict')
        return reply
          .code(412)
          .header('ETag', `"${result.currentRevision}"`)
          .send({ error: 'Leg changed; reload' });
      if (result.status !== 'disconnected')
        return reply.code(409).send({ error: 'Unexpected disconnection status' });
      return reply.header('ETag', `"${result.leg.revision}"`).send(result);
    },
  );
  app.get('/api/v1/explore/geojson', async () => store.getExplore());
  return app;
}
