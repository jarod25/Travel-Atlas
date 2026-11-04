import { useEffect, useRef, useState } from 'react';
import type { FeatureCollection } from './api';

const moduleUrl = 'https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs';
const styleUrl = 'https://tiles.openfreemap.org/styles/liberty';

interface MapSource {
  setData: (data: FeatureCollection) => void;
}
interface MapInstance {
  on: (
    event: string,
    layerOrCallback: string | (() => void),
    callback?: (event: { features?: Array<{ properties?: Record<string, unknown> }> }) => void,
  ) => void;
  addSource: (name: string, options: unknown) => void;
  addLayer: (options: unknown) => void;
  getSource: (name: string) => MapSource | undefined;
  remove: () => void;
  resize: () => void;
  setPaintProperty: (layer: string, property: string, value: unknown) => void;
}
type MapLibrary = { Map: new (options: unknown) => MapInstance };

export type ColorMode = 'trip' | 'transport';
const palette = ['#23617c', '#c16a3b', '#3c8765', '#71549b', '#bc5d75', '#b38b36'];

function colorExpression(data: FeatureCollection, colorBy: ColorMode): unknown {
  if (colorBy === 'transport') {
    return [
      'match',
      ['get', 'transportMode'],
      'walking',
      '#31937b',
      'hiking',
      '#498c3d',
      'cycling',
      '#5a9f5f',
      'train',
      '#b56536',
      'metro',
      '#9a5b9f',
      'tram',
      '#b58a39',
      'car',
      '#52739a',
      'bus',
      '#6a8a9c',
      'taxi',
      '#aa7a61',
      'plane',
      '#507fc2',
      'boat',
      '#498fa2',
      'ferry',
      '#5399a8',
      '#657889',
    ];
  }
  const trips = [
    ...new Set(
      data.features
        .map((feature) => feature.properties.tripId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ].sort();
  if (trips.length === 0) return '#23617c';
  return [
    'match',
    ['get', 'tripId'],
    ...trips.flatMap((id, index) => [id, palette[index % palette.length]]),
    '#657889',
  ];
}

export function MapCanvas({
  data,
  label,
  colorBy = 'trip',
  onSelect,
}: {
  data: FeatureCollection;
  label: string;
  colorBy?: ColorMode;
  onSelect?: (properties: Record<string, string | null>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const latest = useRef<FeatureCollection>(data);
  const latestColor = useRef<ColorMode>(colorBy);
  const latestSelect = useRef(onSelect);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    latest.current = data;
    latestColor.current = colorBy;
    latestSelect.current = onSelect;
    map.current?.getSource('atlas')?.setData(data);
    if (map.current && loaded) {
      map.current.setPaintProperty('atlas-routes', 'line-color', colorExpression(data, colorBy));
    }
  }, [data, colorBy, onSelect, loaded]);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    let mapReady = false;
    let created: MapInstance | undefined;
    async function initialize() {
      try {
        // Vite deliberately leaves this documented CDN ESM import unchanged.
        // MapLibre/tile requests happen client-side and can fail independently of the API.
        const lib = (await import(/* @vite-ignore */ moduleUrl)) as MapLibrary;
        if (cancelled || !ref.current) return;
        created = new lib.Map({
          container: ref.current,
          style: styleUrl,
          center: [0, 15],
          zoom: 1.4,
          attributionControl: true,
        });
        map.current = created;
        created.on('error', () => {
          if (!cancelled && !mapReady) {
            setError('Map style could not be loaded. Your timeline remains available.');
          }
        });
        created.on('load', () => {
          mapReady = true;
          setError(null);
          if (cancelled || !created) return;
          created.addSource('atlas', { type: 'geojson', data: latest.current });
          created.addLayer({
            id: 'atlas-routes',
            type: 'line',
            source: 'atlas',
            filter: ['==', ['get', 'kind'], 'route'],
            paint: {
              'line-color': colorExpression(latest.current, latestColor.current),
              'line-width': 4,
              'line-opacity': 0.85,
            },
          });
          created.addLayer({
            id: 'atlas-visits',
            type: 'circle',
            source: 'atlas',
            filter: ['==', ['get', 'kind'], 'visit'],
            paint: {
              'circle-radius': 6,
              'circle-color': '#2677a3',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });
          function registerSelection(layer: string) {
            created?.on('click', layer, (event) => {
              const raw = event.features?.[0]?.properties;
              if (!raw || !latestSelect.current) return;
              const properties = Object.fromEntries(
                Object.entries(raw).map(([key, value]) => [
                  key,
                  value === null || value === undefined ? null : String(value),
                ]),
              );
              latestSelect.current(properties);
            });
          }
          registerSelection('atlas-visits');
          registerSelection('atlas-routes');
          setLoaded(true);
        });
      } catch {
        if (!cancelled)
          setError('Map tiles or MapLibre could not be loaded. Your timeline remains available.');
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      created?.remove();
      map.current = null;
    };
  }, []);

  return (
    <section className="map-shell" aria-label={label}>
      <div ref={ref} className="map-surface" role="img" aria-label={label} />
      {!loaded && !error && <p className="map-hint">Loading interactive map…</p>}
      {error && (
        <p className="map-hint" role="status">
          {error}
        </p>
      )}
      {data.features.length === 0 && (
        <p className="map-empty">
          No recorded geographic coordinates or saved routes to display yet.
        </p>
      )}
    </section>
  );
}
