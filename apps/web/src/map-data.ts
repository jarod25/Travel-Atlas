import type { FeatureCollection } from './api';

export const emptyFeatures: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Only persisted geographic features are rendered. Never derive straight lines. */
export function visibleFeatures(data: FeatureCollection, tripId: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.features.filter((feature) =>
      (!tripId || feature.properties.tripId === tripId) &&
      (feature.geometry.type === 'Point' ||
        feature.geometry.type === 'LineString' ||
        feature.geometry.type === 'MultiLineString')),
  };
}
