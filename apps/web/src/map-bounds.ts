import type { FeatureCollection } from './api';

export type MapBounds = [[number, number], [number, number]];

export function geographicBounds(data: FeatureCollection): MapBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  function readCoordinates(value: unknown): void {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      const [longitude, latitude] = value;
      if (
        Number.isFinite(longitude) &&
        Number.isFinite(latitude) &&
        longitude >= -180 &&
        longitude <= 180 &&
        latitude >= -90 &&
        latitude <= 90
      ) {
        west = Math.min(west, longitude);
        east = Math.max(east, longitude);
        south = Math.min(south, latitude);
        north = Math.max(north, latitude);
      }
      return;
    }
    for (const item of value) readCoordinates(item);
  }
  for (const feature of data.features) {
    if (
      ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(
        feature.geometry.type,
      )
    ) {
      readCoordinates(feature.geometry.coordinates);
    }
  }
  return west === Infinity ? null : [[west, south], [east, north]];
}
