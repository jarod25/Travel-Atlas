import type { FeatureCollection } from './api';

export type MapBounds = [[number, number], [number, number]];

export function geographicBounds(data: FeatureCollection): MapBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  function readCoordinates(value: unknown): void {
    if (!Array.isArray(value)) return;
    const pair = typeof value[0] === 'number' && typeof value[1] === 'number';
    if (!pair) {
      for (const item of value) readCoordinates(item);
      return;
    }
    const [longitude, latitude] = value as number[];
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    if (longitude < -180 || longitude > 180) return;
    if (latitude < -90 || latitude > 90) return;

    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  }

  const supported = /^(Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon)$/;
  for (const feature of data.features) {
    if (supported.test(feature.geometry.type)) {
      readCoordinates(feature.geometry.coordinates);
    }
  }
  return west === Infinity ? null : [[west, south], [east, north]];
}
