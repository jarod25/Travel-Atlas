import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from './api';
import { geographicBounds } from './map-bounds';

function collection(
  ...geometries: Array<{ type: string; coordinates: unknown }>
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometries.map((geometry) => ({ type: 'Feature', geometry, properties: {} })),
  };
}

describe('Geographic framing', () => {
  it('keeps unknown places empty instead of inventing coordinates', () => {
    expect(geographicBounds(collection())).toBeNull();
    expect(geographicBounds(collection({ type: 'Point', coordinates: [] }))).toBeNull();
  });

  it('centers one recorded Place with an exact point bound', () => {
    expect(geographicBounds(collection({ type: 'Point', coordinates: [6.9, 47.6] }))).toEqual([
      [6.9, 47.6],
      [6.9, 47.6],
    ]);
  });

  it('uses known route geometry and Places together', () => {
    expect(
      geographicBounds(
        collection(
          { type: 'Point', coordinates: [7, 48] },
          { type: 'LineString', coordinates: [[6, 47], [9, 50]] },
          { type: 'MultiLineString', coordinates: [[[8, 49], [10, 46]]] },
        ),
      ),
    ).toEqual([
      [6, 46],
      [10, 50],
    ]);
  });

  it('rejects invalid or unsupported positions instead of shifting the map', () => {
    expect(
      geographicBounds(
        collection(
          { type: 'Point', coordinates: [190, 95] },
          { type: 'Unknown', coordinates: [0, 0] },
          { type: 'Point', coordinates: [135, 35] },
        ),
      ),
    ).toEqual([
      [135, 35],
      [135, 35],
    ]);
  });
});
