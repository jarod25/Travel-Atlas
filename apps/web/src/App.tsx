import { useCallback, useEffect, useMemo, useState } from 'react';
import { atlasApi } from './api';
import type { FeatureCollection, LegRow, Place, Timeline, Trip, TripDay, VisitRow } from './api';
import { MapCanvas } from './MapCanvas';
import { emptyFeatures, visibleFeatures } from './map-data';

type View = 'explore' | 'trips' | 'editor';
type MobilePanel = 'timeline' | 'map';
function describeLeg(leg: LegRow | undefined): string {
  if (!leg) return 'No connected travel leg';
  return `${leg.transportMode ?? 'Transport unknown'} · ${leg.movementConfidence} travel · ${leg.geometryConfidence} route`;
}

export function App() {
  const [view, setView] = useState<View>('explore');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState<string | null>(null);
  const [days, setDays] = useState<TripDay[]>([]);
  const [dayId, setDayId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [features, setFeatures] = useState<FeatureCollection>(emptyFeatures);
  const [tripName, setTripName] = useState('');
  const [dayDate, setDayDate] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [newPlace, setNewPlace] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('timeline');
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unexpected error');
    } finally {
      setPending(false);
    }
  }, []);

  const loadTrips = useCallback(async () => {
    const data = await atlasApi.trips();
    setTrips(data);
  }, []);
  const loadDays = useCallback(async (id: string) => {
    const data = await atlasApi.days(id);
    setDays(data);
    return data;
  }, []);
  const loadTimeline = useCallback(async (id: string, day: string) => {
    setTimeline(await atlasApi.timeline(id, day));
  }, []);
  const loadExplore = useCallback(async () => {
    setFeatures(await atlasApi.explore());
  }, []);

  useEffect(() => {
    void execute(async () => {
      await Promise.all([loadTrips(), loadExplore()]);
    });
  }, [execute, loadTrips, loadExplore]);

  useEffect(() => {
    if (!tripId) {
      setDays([]);
      setDayId(null);
      setTimeline(null);
      return;
    }
    let active = true;
    atlasApi
      .days(tripId)
      .then((result) => {
        if (!active) return;
        setDays(result);
        setDayId((current) =>
          result.some((day) => day.id === current) ? current : (result[0]?.id ?? null),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [tripId]);

  useEffect(() => {
    if (!tripId || !dayId) {
      setTimeline(null);
      return;
    }
    let active = true;
    atlasApi
      .timeline(tripId, dayId)
      .then((result) => {
        if (active) setTimeline(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [tripId, dayId]);

  useEffect(() => {
    let active = true;
    atlasApi
      .places(placeQuery)
      .then((result) => {
        if (active) setPlaces(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [placeQuery]);

  const selectedTrip = trips.find((trip) => trip.id === tripId);
  const selectedVisit = timeline?.visits.find((visit) => visit.id === selectedVisitId);
  const displayed = useMemo(
    () => visibleFeatures(features, view === 'explore' ? tripId : tripId),
    [features, tripId, view],
  );

  async function addTrip() {
    const title = tripName.trim();
    if (!title) return;
    await execute(async () => {
      const trip = await atlasApi.addTrip(title);
      await loadTrips();
      setTripId(trip.id);
      setTripName('');
      setView('editor');
    });
  }
  async function addDay() {
    if (!tripId) return;
    await execute(async () => {
      const created = await atlasApi.addDay(tripId, dayDate || null);
      await loadDays(tripId);
      setDayId(created.id);
      setDayDate('');
    });
  }
  async function addPlace() {
    const name = newPlace.trim();
    if (!name) return;
    await execute(async () => {
      const place = await atlasApi.addPlace(name);
      setPlaceQuery(name);
      setPlaceId(place.id);
      setNewPlace('');
    });
  }
  async function addVisit() {
    if (!tripId || !dayId) return;
    await execute(async () => {
      await atlasApi.addVisit(tripId, dayId, placeId || null);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
    });
  }
  async function moveVisit(index: number, direction: -1 | 1) {
    if (!tripId || !dayId || !timeline) return;
    const next = timeline.visits.map((visit) => visit.id);
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    await execute(async () => {
      await atlasApi.reorder(tripId, dayId, next);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
    });
  }
  async function archiveVisit(visit: VisitRow) {
    if (!tripId || !dayId) return;
    if (!window.confirm('Archive this visit? Historical legs will be preserved.')) return;
    await execute(async () => {
      await atlasApi.archiveVisit(tripId, dayId, visit.id);
      setSelectedVisitId(null);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
    });
  }

  return (
    <div className="atlas-app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">◎</span>
          <span>Travel Atlas</span>
        </div>
        <nav aria-label="Main navigation">
          <button className={view === 'explore' ? 'active' : ''} onClick={() => setView('explore')}>
            Explore
          </button>
          <button className={view === 'trips' ? 'active' : ''} onClick={() => setView('trips')}>
            Trips
          </button>
          <button className={view === 'editor' ? 'active' : ''} onClick={() => setView('editor')}>
            Trip Editor
          </button>
        </nav>
        <span className="local-label">Local workspace</span>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {view === 'explore' && (
        <main className="explore">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Your travel history</span>
              <h1>Explore the atlas</h1>
              <p>Only stored locations and route geometries appear on the map.</p>
            </div>
            <select
              aria-label="Filter map by trip"
              value={tripId ?? ''}
              onChange={(e) => setTripId(e.target.value || null)}
            >
              <option value="">All trips</option>
              {trips.map((trip) => (
                <option value={trip.id} key={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
          </div>
          <MapCanvas data={displayed} label="Interactive world map of saved visits and routes" />
          <div className="info-strip">
            <span>
              {displayed.features.filter((feature) => feature.properties.kind === 'visit').length}{' '}
              mapped visits
            </span>
            <span>
              {displayed.features.filter((feature) => feature.properties.kind === 'route').length}{' '}
              saved routes
            </span>
            <span>Missing geometry is not drawn</span>
          </div>
        </main>
      )}

      {view === 'trips' && (
        <main className="trips-page">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Travel library</span>
              <h1>Trips</h1>
              <p>Create a trip once, then add your days and visits.</p>
            </div>
          </div>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void addTrip();
            }}
          >
            <label htmlFor="trip-title">New trip</label>
            <input
              id="trip-title"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="Trip name"
              maxLength={200}
              required
            />
            <button type="submit" disabled={pending}>
              Create trip
            </button>
          </form>
          <div className="trip-grid">
            {trips.map((trip) => (
              <button
                key={trip.id}
                className="trip-card"
                onClick={() => {
                  setTripId(trip.id);
                  setView('editor');
                }}
              >
                <span>TRIP</span>
                <strong>{trip.title}</strong>
                <small>Open timeline →</small>
              </button>
            ))}
          </div>
          {trips.length === 0 && (
            <p className="empty-state">No trips yet. Create your first one above.</p>
          )}
        </main>
      )}

      {view === 'editor' && (
        <main className="editor">
          <div className="editor-top">
            <div>
              <span className="eyebrow">Trip Editor</span>
              <h1>{selectedTrip?.title ?? 'Choose a trip'}</h1>
            </div>
            <select
              aria-label="Select trip"
              value={tripId ?? ''}
              onChange={(e) => setTripId(e.target.value || null)}
            >
              <option value="">Select trip</option>
              {trips.map((trip) => (
                <option value={trip.id} key={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
          </div>
          {!tripId ? (
            <div className="empty-state">Choose an existing trip, or create one in Trips.</div>
          ) : (
            <>
              <div className="day-bar">
                <div className="day-tabs">
                  {days.map((day) => (
                    <button
                      key={day.id}
                      className={dayId === day.id ? 'selected' : ''}
                      onClick={() => setDayId(day.id)}
                    >
                      {day.localDate ?? `Day ${day.position + 1} · date unknown`}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addDay();
                  }}
                  className="day-add"
                >
                  <label htmlFor="day-date">Add day (optional date)</label>
                  <input
                    id="day-date"
                    type="date"
                    value={dayDate}
                    onChange={(e) => setDayDate(e.target.value)}
                  />
                  <button type="submit" disabled={pending}>
                    + Day
                  </button>
                </form>
              </div>
              <div className="mobile-tabs" aria-label="Editor panels">
                <button
                  className={mobilePanel === 'timeline' ? 'selected' : ''}
                  onClick={() => setMobilePanel('timeline')}
                >
                  Timeline
                </button>
                <button
                  className={mobilePanel === 'map' ? 'selected' : ''}
                  onClick={() => setMobilePanel('map')}
                >
                  Map
                </button>
              </div>
              <div className="editor-layout">
                <aside className={`timeline-panel mobile-${mobilePanel}`}>
                  <div className="panel-heading">
                    <h2>Timeline</h2>
                    <span>{timeline?.visits.length ?? 0} visits</span>
                  </div>
                  {!dayId && <p className="empty-state">Add a day to begin.</p>}
                  {dayId && (
                    <>
                      <div className="visit-list">
                        {timeline?.visits.map((visit, index) => {
                          const incoming = timeline.legs.find((leg) => leg.toVisitId === visit.id);
                          return (
                            <div key={visit.id}>
                              {index > 0 && <div className="leg-pill">{describeLeg(incoming)}</div>}
                              <div
                                className={`visit-row ${selectedVisitId === visit.id ? 'selected' : ''}`}
                              >
                                <button
                                  className="visit-title"
                                  onClick={() => setSelectedVisitId(visit.id)}
                                >
                                  <span className="visit-number">{index + 1}</span>
                                  <strong>{visit.placeName ?? 'Unknown place'}</strong>
                                  <small>
                                    {visit.placeLocation
                                      ? 'Mapped location'
                                      : 'Coordinates unknown'}
                                  </small>
                                </button>
                                <div className="order-controls">
                                  <button
                                    aria-label={`Move visit ${index + 1} up`}
                                    disabled={pending || index === 0}
                                    onClick={() => void moveVisit(index, -1)}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    aria-label={`Move visit ${index + 1} down`}
                                    disabled={pending || index === timeline.visits.length - 1}
                                    onClick={() => void moveVisit(index, 1)}
                                  >
                                    ↓
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="composer">
                        <h3>Add a visit</h3>
                        <label htmlFor="place-search">Search existing places</label>
                        <input
                          id="place-search"
                          value={placeQuery}
                          onChange={(e) => {
                            setPlaceQuery(e.target.value);
                            setPlaceId('');
                          }}
                          placeholder="Place name"
                        />
                        <select
                          aria-label="Existing place"
                          value={placeId}
                          onChange={(e) => setPlaceId(e.target.value)}
                        >
                          <option value="">Unknown place</option>
                          {places.map((place) => (
                            <option key={place.id} value={place.id}>
                              {place.name ?? 'Unnamed place'}
                            </option>
                          ))}
                        </select>
                        <button disabled={pending} onClick={() => void addVisit()}>
                          + Add visit
                        </button>
                        <div className="sub-form">
                          <label htmlFor="new-place">Place not listed?</label>
                          <input
                            id="new-place"
                            value={newPlace}
                            onChange={(e) => setNewPlace(e.target.value)}
                            placeholder="Create a named place"
                            maxLength={200}
                          />
                          <button
                            disabled={pending || !newPlace.trim()}
                            onClick={() => void addPlace()}
                          >
                            Create place
                          </button>
                        </div>
                        <p className="muted">
                          Adding visits creates unknown draft legs within this day only.
                        </p>
                      </div>
                    </>
                  )}
                </aside>
                <section className={`editor-map mobile-${mobilePanel}`}>
                  <MapCanvas data={displayed} label="Map of selected trip and its saved geometry" />
                  {selectedVisit && (
                    <div className="details-panel">
                      <div>
                        <span className="eyebrow">Details</span>
                        <h2>{selectedVisit.placeName ?? 'Unknown place'}</h2>
                        <p>
                          {selectedVisit.placeLocation
                            ? 'Coordinates recorded'
                            : 'No recorded coordinates'}
                        </p>
                      </div>
                      <button onClick={() => void archiveVisit(selectedVisit)} disabled={pending}>
                        Archive visit
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </main>
      )}
      <footer className="app-footer">Private local atlas · Unknown means not recorded</footer>
    </div>
  );
}
