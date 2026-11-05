const prefix = '/api/v1';

export interface Trip {
  id: string;
  title: string;
  parentTripId: string | null;
  manualStartDate: string | null;
  manualEndDate: string | null;
  computedStartDate: string | null;
  computedEndDate: string | null;
  revision: number;
  isArchived: boolean;
  updatedAt?: string;
  lastActivityAt?: string;
}
export interface TripDay {
  id: string;
  tripId: string;
  localDate: string | null;
  position: number;
  revision: number;
  isArchived: boolean;
}
export interface Place {
  id: string;
  revision: number;
  name: string | null;
  location: [number, number] | null;
  locationConfidence: 'confirmed' | 'estimated' | 'unknown';
}
export interface VisitRow {
  id: string;
  position: number;
  revision: number;
  placeId: string | null;
  placeName: string | null;
  placeLocation: [number, number] | null;
}
export interface ArchivedVisitRow extends VisitRow {
  isArchived: true;
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
  departureTimePrecision: 'exact' | 'approximate' | 'range' | 'unknown';
  departureTimeConfidence: 'confirmed' | 'estimated' | 'unknown';
  arrivalLocalDate: string | null;
  arrivalLocalTime: string | null;
  arrivalTimeZone: string | null;
  arrivalTimePrecision: 'exact' | 'approximate' | 'range' | 'unknown';
  arrivalTimeConfidence: 'confirmed' | 'estimated' | 'unknown';
  movementConfidence: string;
  transportConfidence: string;
  geometryConfidence: string;
}
export interface Timeline {
  day: TripDay;
  visits: VisitRow[];
  legs: LegRow[];
  crossDayLegs: LegRow[];
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
    headers: {
      ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
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
  updateTrip: (
    id: string,
    revision: number,
    changes: {
      title?: string;
      isArchived?: boolean;
      manualStartDate?: string | null;
      manualEndDate?: string | null;
    },
  ) =>
    request<Trip>(`/trips/${id}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify(changes),
    }),
  trip: (id: string) => request<Trip>(`/trips/${encodeURIComponent(id)}`),
  addTrip: (title: string, parentTripId: string | null = null) =>
    post<Trip>('/trips', { title, parentTripId }),
  days: (id: string) => request<TripDay[]>(`/trips/${encodeURIComponent(id)}/days`),
  addDay: (id: string, localDate: string | null) =>
    post<TripDay>(`/trips/${id}/days`, { localDate }),
  archiveDay: (id: string, day: string, revision: number, isArchived: boolean) =>
    request<TripDay>(`/trips/${id}/days/${day}/archive`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ isArchived }),
    }),
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
    revision: number,
    coordinates: [number, number] | null,
    confidence: 'confirmed' | 'estimated' | 'unknown',
  ) =>
    request<Place>(`/places/${id}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ coordinates, confidence }),
    }),
  editVisitPlace: (
    tripId: string,
    dayId: string,
    visitId: string,
    revision: number,
    placeId: string | null,
  ) =>
    request<VisitRow>(`/trips/${tripId}/days/${dayId}/visits/${visitId}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ placeId }),
    }),
  addVisit: (id: string, day: string, placeId: string | null) =>
    post<unknown>(`/trips/${id}/days/${day}/visits`, { placeId }),
  reorder: (id: string, day: string, visitIds: string[]) =>
    post<unknown>(`/trips/${id}/days/${day}/reorder`, { visitIds }),
  archiveVisit: (id: string, day: string, visit: string) =>
    request<unknown>(`/trips/${id}/days/${day}/visits/${visit}`, { method: 'DELETE' }),
  archivedVisits: (id: string, day: string) =>
    request<ArchivedVisitRow[]>(`/trips/${id}/days/${day}/archived-visits`),
  restoreVisit: (id: string, day: string, visit: string) =>
    post<unknown>(`/trips/${id}/days/${day}/visits/${visit}/restore`, {}),
  updateLeg: (
    id: string,
    revision: number,
    changes: {
      transportMode?: string | null;
      transportConfidence?: 'confirmed' | 'estimated' | 'unknown';
      departureLocalDate?: string | null;
      departureLocalTime?: string | null;
      departureTimeConfidence?: 'confirmed' | 'estimated' | 'unknown';
      departureTimeZone?: string | null;
      departureTimePrecision?: 'exact' | 'approximate' | 'range' | 'unknown';
      arrivalLocalDate?: string | null;
      arrivalLocalTime?: string | null;
      arrivalTimeConfidence?: 'confirmed' | 'estimated' | 'unknown';
      arrivalTimeZone?: string | null;
      arrivalTimePrecision?: 'exact' | 'approximate' | 'range' | 'unknown';
    },
  ) =>
    request<LegRow>(`/legs/${id}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify(changes),
    }),
  connectDays: (tripId: string, fromDayId: string, toDayId: string) =>
    post<unknown>(`/trips/${tripId}/connect-days`, { fromDayId, toDayId }),
  disconnectDays: (
    tripId: string,
    fromDayId: string,
    toDayId: string,
    legId: string,
    revision: number,
  ) =>
    request<unknown>(`/trips/${tripId}/disconnect-days`, {
      method: 'POST',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ fromDayId, toDayId, legId }),
    }),
  explore: () => request<FeatureCollection>('/explore/geojson'),
};
