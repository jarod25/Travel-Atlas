import type { FeatureCollection } from './api';

const data: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {
        tripId: 'a',
        kind: 'visit',
        localDate: '2026-09-12',
        locationConfidence: 'confirmed',
      },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [0, 1],
        ],
      },
      properties: {
        tripId: 'a',
        kind: 'route',
        localDate: '2026-09-12',
        transportMode: 'train',
        confidence: 'estimated',
      },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [1, 1],
            [2, 2],
          ],
        ],
      },
      properties: {
        tripId: 'b',
        kind: 'route',
        localDate: null,
        transportMode: 'bus',
        confidence: 'unknown',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: { tripId: 'a', kind: 'unsupported' },
    },
  ],
};

describe('Explore map filtering', () => {
  it('does not invent paths for unknown geography', () => {
    expect(visibleFeatures(emptyFeatures, null).features).toEqual([]);
  });
  it('filters stored geometry by trip without losing valid (0,0) coordinates', () => {
    const result = visibleFeatures(data, 'a');
    expect(result.features).toHaveLength(2);
    expect(result.features[0].geometry.coordinates).toEqual([0, 0]);
    expect(visibleFeatures(data, 'b').features).toHaveLength(1);
    expect(visibleFeatures(data, null).features).toHaveLength(3);
  });
  it('filters by local calendar date without guessing dates for unknown entries', () => {
    expect(
      visibleFeatures(data, { fromDate: '2026-09-12', toDate: '2026-09-12' }).features,
    ).toHaveLength(2);
    expect(visibleFeatures(data, { fromDate: '2026-09-13' }).features).toHaveLength(0);
  });
  it('filters by transport on routes only, with independent geometry confidence', () => {
    const train = visibleFeatures(data, { transportMode: 'train' });
    expect(train.features).toHaveLength(1);
    expect(train.features[0].properties.kind).toBe('route');
    expect(visibleFeatures(data, { confidence: 'confirmed' }).features).toHaveLength(1);
    expect(visibleFeatures(data, { confidence: 'estimated' }).features).toHaveLength(1);
    expect(visibleFeatures(data, { confidence: 'unknown' }).features).toHaveLength(1);
  });
});
import type { FeatureCollection } from './api';

export const emptyFeatures: FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface ExploreFilters {
  tripId?: string | null;
  fromDate?: string;
  toDate?: string;
  transportMode?: string;
  confidence?: 'confirmed' | 'estimated' | 'unknown' | 'all';
}

/**
 * Unknown dates are excluded only when a date filter is active. A transport
 * filter shows routes, not unrelated visits. Never synthesize line segments.
 */
export function visibleFeatures(
  data: FeatureCollection,
  filters: ExploreFilters | string | null,
): FeatureCollection {
  const options: ExploreFilters =
    typeof filters === 'object' && filters !== null ? filters : { tripId: filters };
  return {
    type: 'FeatureCollection',
    features: data.features.filter((feature) => {
      const { geometry, properties } = feature;
      if (!['Point', 'LineString', 'MultiLineString'].includes(geometry.type)) return false;
      if (options.tripId && properties.tripId !== options.tripId) return false;
      if (options.fromDate || options.toDate) {
        if (!properties.localDate) return false;
        if (options.fromDate && properties.localDate < options.fromDate) return false;
        if (options.toDate && properties.localDate > options.toDate) return false;
      }
      if (
        options.transportMode &&
        (properties.kind !== 'route' || properties.transportMode !== options.transportMode)
      ) {
        return false;
      }
      if (options.confidence && options.confidence !== 'all') {
        const certainty =
          properties.kind === 'visit' ? properties.locationConfidence : properties.confidence;
        if (certainty !== options.confidence) return false;
      }
      return true;
    }),
  };
}
