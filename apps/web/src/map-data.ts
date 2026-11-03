import type { FeatureCollection } from './api';

describe('Explore map filtering', () => {
  it('does not invent paths when no routes or coordinates exist', () => {
    expect(visibleFeatures(emptyFeatures, null).features).toEqual([]);
  });
  it('filters by trip and preserves only the real geometries', () => {
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { tripId: 'a', kind: 'visit' },
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
          properties: { tripId: 'b', kind: 'route' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [] },
          properties: { tripId: 'a', kind: 'unsupported' },
        },
      ],
    };
    expect(visibleFeatures(data, 'a').features).toHaveLength(1);
    expect(visibleFeatures(data, 'a').features[0].geometry.coordinates).toEqual([0, 0]);
    expect(visibleFeatures(data, 'b').features).toHaveLength(1);
    expect(visibleFeatures(data, null).features).toHaveLength(2);
  });
});
import type { FeatureCollection } from './api';

export const emptyFeatures: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Only persisted geographic features are rendered. Never derive straight lines. */
export function visibleFeatures(data: FeatureCollection, tripId: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.features.filter(
      (feature) =>
        (!tripId || feature.properties.tripId === tripId) &&
        (feature.geometry.type === 'Point' ||
          feature.geometry.type === 'LineString' ||
          feature.geometry.type === 'MultiLineString'),
    ),
  };
}
