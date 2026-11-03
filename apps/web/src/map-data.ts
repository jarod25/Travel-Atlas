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
