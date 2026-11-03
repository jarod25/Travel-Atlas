import { useEffect, useRef, useState } from 'react';
import type { FeatureCollection } from './api';
import { emptyFeatures } from './map-data';

const moduleUrl = 'https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs';
const styleUrl = 'https://tiles.openfreemap.org/styles/liberty';

interface MapSource { setData: (data: FeatureCollection) => void }
interface MapInstance {
  on: (event: string, callback: () => void) => void;
  addSource: (name: string, options: unknown) => void;
  addLayer: (options: unknown) => void;
  getSource: (name: string) => MapSource | undefined;
  remove: () => void;
  resize: () => void;
}
type MapLibrary = { Map: new (options: unknown) => MapInstance };

export function MapCanvas({ data, label }: { data: FeatureCollection; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const latest = useRef<FeatureCollection>(data);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    latest.current = data;
    map.current?.getSource('atlas')?.setData(data);
  }, [data]);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    let created: MapInstance | undefined;
    async function initialize() {
      try {
        // Vite deliberately leaves this documented CDN ESM import unchanged.
        // MapLibre/tile requests happen client-side and can fail independently of the API.
        const lib = (await import(/* @vite-ignore */ moduleUrl)) as MapLibrary;
        if (cancelled || !ref.current) return;
        created = new lib.Map({
          container: ref.current, style: styleUrl, center: [0, 15], zoom: 1.4,
          attributionControl: true,
        });
        map.current = created;
        created.on('load', () => {
          if (cancelled || !created) return;
          created.addSource('atlas', { type: 'geojson', data: latest.current });
          created.addLayer({
            id: 'atlas-routes', type: 'line', source: 'atlas',
            filter: ['==', ['get', 'kind'], 'route'],
            paint: { 'line-color': '#cf6e35', 'line-width': 4, 'line-opacity': 0.85 },
          });
          created.addLayer({
            id: 'atlas-visits', type: 'circle', source: 'atlas',
            filter: ['==', ['get', 'kind'], 'visit'],
            paint: {
              'circle-radius': 6, 'circle-color': '#2677a3',
              'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
            },
          });
          setLoaded(true);
        });
      } catch {
        if (!cancelled) setError('Map tiles or MapLibre could not be loaded. Your timeline remains available.');
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
      {error && <p className="map-hint" role="status">{error}</p>}
      {data.features.length === 0 && <p className="map-empty">
        No confirmed geographic coordinates or saved routes to display yet.
      </p>}
    </section>
  );
}
