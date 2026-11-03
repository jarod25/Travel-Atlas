const prefix = '/api/v1';

export interface Trip {
  id: string;
  title: string;
  revision: number;
  isArchived: boolean;
}
export interface TripDay {
  id: string;
  tripId: string;
  localDate: string | null;
  position: number;
  revision: number;
}
export interface Place {
  id: string;
  name: string | null;
  location: [number, number] | null;
  locationConfidence: 'confirmed' | 'estimated' | 'unknown';
}
export interface VisitRow {
  id: string;
  position: number;
  placeId: string | null;
  placeName: string | null;
  placeLocation: [number, number] | null;
}
export interface LegRow {
  id: string;
  fromVisitId: string;
  toVisitId: string;
  transportMode: string | null;
  revision: number;
  departureLocalDate: string | null;
  departureLocalTime: string | null;
  departureTimeZone: string | null;
  departureTimeConfidence: 'confirmed' | 'estimated' | 'unknown';
  arrivalLocalDate: string | null;
  arrivalLocalTime: string | null;
  arrivalTimeZone: string | null;
  arrivalTimeConfidence: 'confirmed' | 'estimated' | 'unknown';
  movementConfidence: string;
  transportConfidence: string;
  geometryConfidence: string;
}
export interface Timeline {
  day: TripDay;
  visits: VisitRow[];
  legs: LegRow[];
}
export interface Feature {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string | null>;
}
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(prefix + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
function post<T>(path: string, payload: unknown) {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload) });
}
export const atlasApi = {
  trips: (includeArchived = false) => request<Trip[]>(`/trips?includeArchived=${includeArchived}`),
  updateTrip: (id: string, revision: number, changes: { title?: string; isArchived?: boolean }) =>
    request<Trip>(`/trips/${id}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify(changes),
    }),
  trip: (id: string) => request<Trip>(`/trips/${encodeURIComponent(id)}`),
  addTrip: (title: string) => post<Trip>('/trips', { title }),
  days: (id: string) => request<TripDay[]>(`/trips/${encodeURIComponent(id)}/days`),
  addDay: (id: string, localDate: string | null) =>
    post<TripDay>(`/trips/${id}/days`, { localDate }),
  editDay: (id: string, day: string, revision: number, localDate: string | null) =>
    request<TripDay>(`/trips/${id}/days/${day}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ localDate }),
    }),
  timeline: (id: string, day: string) => request<Timeline>(`/trips/${id}/days/${day}/timeline`),
  places: (search: string) => request<Place[]>(`/places?q=${encodeURIComponent(search)}`),
  addPlace: (name: string) => post<Place>('/places', { name }),
  updatePlace: (
    id: string,
    coordinates: [number, number] | null,
    confidence: 'confirmed' | 'estimated' | 'unknown',
  ) =>
    request<Place>(`/places/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ coordinates, confidence }),
    }),
  addVisit: (id: string, day: string, placeId: string | null) =>
    post<unknown>(`/trips/${id}/days/${day}/visits`, { placeId }),
  reorder: (id: string, day: string, visitIds: string[]) =>
    post<unknown>(`/trips/${id}/days/${day}/reorder`, { visitIds }),
  archiveVisit: (id: string, day: string, visit: string) =>
    request<unknown>(`/trips/${id}/days/${day}/visits/${visit}`, { method: 'DELETE' }),
  updateLeg: (
    id: string,
    revision: number,
    changes: {
      transportMode?: string | null;
      transportConfidence?: 'confirmed' | 'estimated' | 'unknown';
      departureLocalDate?: string | null;
      departureLocalTime?: string | null;
      departureTimeConfidence?: 'confirmed' | 'estimated' | 'unknown';
      arrivalLocalDate?: string | null;
      arrivalLocalTime?: string | null;
      arrivalTimeConfidence?: 'confirmed' | 'estimated' | 'unknown';
    },
  ) =>
    request<LegRow>(`/legs/${id}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify(changes),
    }),
  explore: () => request<FeatureCollection>('/explore/geojson'),
};
