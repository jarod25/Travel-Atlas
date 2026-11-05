import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from './api';
import { geographicBounds } from './map-bounds';

type Geometry = { type: string; coordinates: unknown };

function collection(...geometries: Geometry[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometries.map((geometry) => ({
      type: 'Feature',
      geometry,
      properties: {},
    })),
  };
}

describe('Geographic framing', () => {
  it('does not invent unknown coordinates', () => {
    expect(geographicBounds(collection())).toBeNull();
    const point = { type: 'Point', coordinates: [] };
    expect(geographicBounds(collection(point))).toBeNull();
  });

  it('bounds a single recorded point', () => {
    const point = { type: 'Point', coordinates: [6.9, 47.6] };
    expect(geographicBounds(collection(point))).toEqual([
      [6.9, 47.6],
      [6.9, 47.6],
    ]);
  });

  it('bounds saved points and line geometry together', () => {
    const point = { type: 'Point', coordinates: [7, 48] };
    const line = {
      type: 'LineString',
      coordinates: [
        [6, 47],
        [9, 50],
      ],
    };
    const multi = {
      type: 'MultiLineString',
      coordinates: [
        [
          [8, 49],
          [10, 46],
        ],
      ],
    };
    expect(geographicBounds(collection(point, line, multi))).toEqual([
      [6, 46],
      [10, 50],
    ]);
  });

  it('ignores invalid and unsupported positions', () => {
    const invalid = { type: 'Point', coordinates: [190, 95] };
    const unsupported = { type: 'Unknown', coordinates: [0, 0] };
    const valid = { type: 'Point', coordinates: [135, 35] };
    expect(geographicBounds(collection(invalid, unsupported, valid))).toEqual([
      [135, 35],
      [135, 35],
    ]);
  });
});
