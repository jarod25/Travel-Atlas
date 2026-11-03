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
  const [showArchived, setShowArchived] = useState(false);
  const [dayDate, setDayDate] = useState('');
  const [editedDayDate, setEditedDayDate] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [newPlace, setNewPlace] = useState('');
  const [placeLon, setPlaceLon] = useState('');
  const [placeLat, setPlaceLat] = useState('');
  const [placeConfidence, setPlaceConfidence] = useState<'confirmed' | 'estimated' | 'unknown'>(
    'estimated',
  );
  const [placeId, setPlaceId] = useState('');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('timeline');
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [legMode, setLegMode] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [departureCertainty, setDepartureCertainty] = useState<'confirmed' | 'estimated' | 'unknown'>('unknown');
  const [arrivalCertainty, setArrivalCertainty] = useState<'confirmed' | 'estimated' | 'unknown'>('unknown');
  const [legConfidence, setLegConfidence] = useState<'confirmed' | 'estimated' | 'unknown'>(
    'unknown',
  );
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
    const data = await atlasApi.trips(true);
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
  const selectedDay = days.find((day) => day.id === dayId);
  const activeTrips = trips.filter((trip) => !trip.isArchived);
  const displayedTrips = showArchived ? trips : activeTrips;
  useEffect(() => {
    setEditedDayDate(selectedDay?.localDate ?? '');
  }, [selectedDay?.id, selectedDay?.revision]);
  const selectedVisit = timeline?.visits.find((visit) => visit.id === selectedVisitId);
  const selectedLeg = timeline?.legs.find((leg) => leg.id === selectedLegId);
  useEffect(() => {
    if (!selectedLeg) return;
    setLegMode(selectedLeg.transportMode ?? '');
    setDepartureDate(selectedLeg.departureLocalDate ?? '');
    setDepartureTime(selectedLeg.departureLocalTime?.slice(0, 5) ?? '');
    setArrivalDate(selectedLeg.arrivalLocalDate ?? '');
    setArrivalTime(selectedLeg.arrivalLocalTime?.slice(0, 5) ?? '');
    setDepartureCertainty(selectedLeg.departureTimeConfidence);
    setArrivalCertainty(selectedLeg.arrivalTimeConfidence);
    setLegConfidence(selectedLeg.transportConfidence as 'confirmed' | 'estimated' | 'unknown');
  }, [selectedLeg?.id, selectedLeg?.revision]);

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
  async function changeTrip(trip: Trip, changes: { title?: string; isArchived?: boolean }) {
    await execute(async () => {
      await atlasApi.updateTrip(trip.id, trip.revision, changes);
      await Promise.all([loadTrips(), loadExplore()]);
      if (changes.isArchived && tripId === trip.id) {
        setTripId(null);
        setView('trips');
      }
    });
  }

  async function renameTrip(trip: Trip) {
    const title = window.prompt('Rename trip', trip.title)?.trim();
    if (title && title !== trip.title) await changeTrip(trip, { title });
  }

  async function toggleTripArchive(trip: Trip) {
    if (!trip.isArchived && !window.confirm('Archive this trip? Its history will remain saved.'))
      return;
    await changeTrip(trip, { isArchived: !trip.isArchived });
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
  async function updateDayDate() {
    if (!tripId || !dayId || !selectedDay) return;
    await execute(async () => {
      await atlasApi.editDay(tripId, dayId, selectedDay.revision, editedDayDate || null);
      await Promise.all([loadDays(tripId), loadTimeline(tripId, dayId)]);
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
  async function saveCoordinates() {
    if (!placeId || !tripId || !dayId) return;
    if (!placeLon.trim() || !placeLat.trim()) {
      setError('Enter both longitude and latitude.');
      return;
    }
    const lon = Number(placeLon),
      lat = Number(placeLat);
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90
    ) {
      setError('Coordinates are outside valid longitude/latitude bounds.');
      return;
    }
    await execute(async () => {
      await atlasApi.updatePlace(placeId, [lon, lat], placeConfidence);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
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
  async function saveLeg() {
    if (!selectedLeg || !tripId || !dayId) return;
    if ((!departureDate && departureTime) || (!arrivalDate && arrivalTime)) {
      setError('A clock time needs a date; leave both empty if unknown.');
      return;
    }
    await execute(async () => {
      await atlasApi.updateLeg(selectedLeg.id, selectedLeg.revision, {
        transportMode: legMode || null,
        transportConfidence: legConfidence,
        departureLocalDate: departureDate || null,
        departureLocalTime: departureDate && departureTime ? departureTime + ':00' : null,
        departureTimeConfidence: departureCertainty,
        arrivalLocalDate: arrivalDate || null,
        arrivalLocalTime: arrivalDate && arrivalTime ? arrivalTime + ':00' : null,
        arrivalTimeConfidence: arrivalCertainty,
      });
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
              {activeTrips.map((trip) => (
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
          <label className="archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived trips
          </label>
          <div className="trip-grid">
            {displayedTrips.map((trip) => (
              <div className="trip-card" key={trip.id}>
                <span>{trip.isArchived ? 'ARCHIVED TRIP' : 'TRIP'}</span>
                <strong>{trip.title}</strong>
                <div className="trip-actions">
                  {!trip.isArchived && (
                    <button
                      onClick={() => {
                        setTripId(trip.id);
                        setView('editor');
                      }}
                    >
                      Open timeline
                    </button>
                  )}
                  <button onClick={() => void renameTrip(trip)} disabled={pending}>
                    Rename
                  </button>
                  <button onClick={() => void toggleTripArchive(trip)} disabled={pending}>
                    {trip.isArchived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {activeTrips.length === 0 && !showArchived && (
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
              {selectedDay && (
                <div className="edit-day-date">
                  <label htmlFor="edit-day-date">Selected day's date (optional)</label>
                  <input id="edit-day-date" type="date" value={editedDayDate}
                    onChange={(e) => setEditedDayDate(e.target.value)} />
                  <button disabled={pending} onClick={() => void updateDayDate()}>Save date</button>
                </div>
              )}
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
                              {index > 0 && (
                                <button
                                  className="leg-pill"
                                  disabled={!incoming}
                                  onClick={() => {
                                    setSelectedLegId(incoming?.id ?? null);
                                    setSelectedVisitId(null);
                                  }}
                                >
                                  {describeLeg(incoming)} · Edit
                                </button>
                              )}
                              <div
                                className={`visit-row ${selectedVisitId === visit.id ? 'selected' : ''}`}
                              >
                                <button
                                  className="visit-title"
                                  onClick={() => {
                                    setSelectedVisitId(visit.id);
                                    setSelectedLegId(null);
                                  }}
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
                        <details className="coordinate-editor">
                          <summary>Coordinates (optional)</summary>
                          <p className="muted">
                            Changes this reusable Place for every Visit linked to it.
                          </p>
                          <label htmlFor="place-lon">Longitude</label>
                          <input
                            id="place-lon"
                            type="number"
                            min="-180"
                            max="180"
                            step="any"
                            value={placeLon}
                            onChange={(e) => setPlaceLon(e.target.value)}
                          />
                          <label htmlFor="place-lat">Latitude</label>
                          <input
                            id="place-lat"
                            type="number"
                            min="-90"
                            max="90"
                            step="any"
                            value={placeLat}
                            onChange={(e) => setPlaceLat(e.target.value)}
                          />
                          <label htmlFor="place-coord-confidence">Location confidence</label>
                          <select
                            id="place-coord-confidence"
                            value={placeConfidence}
                            onChange={(e) =>
                              setPlaceConfidence(
                                e.target.value as 'confirmed' | 'estimated' | 'unknown',
                              )
                            }
                          >
                            <option value="estimated">Estimated</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="unknown">Unknown</option>
                          </select>
                          <button
                            disabled={pending || !placeId}
                            onClick={() => void saveCoordinates()}
                          >
                            Save coordinates
                          </button>
                        </details>
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
                  {selectedLeg && (
                    <div className="details-panel leg-details">
                      <div>
                        <span className="eyebrow">Leg details</span>
                        <h2>Travel between visits</h2>
                        <p>Transport and geometry have independent certainty.</p>
                      </div>
                      <label htmlFor="leg-transport">Transport mode</label>
                      <select
                        id="leg-transport"
                        value={legMode}
                        onChange={(e) => setLegMode(e.target.value)}
                      >
                        <option value="">Unknown</option>
                        {[
                          'walking',
                          'hiking',
                          'cycling',
                          'train',
                          'metro',
                          'tram',
                          'car',
                          'bus',
                          'taxi',
                          'plane',
                          'boat',
                          'ferry',
                        ].map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                      <label htmlFor="leg-confidence">Transport certainty</label>
                      <select
                        id="leg-confidence"
                        value={legConfidence}
                        onChange={(e) =>
                          setLegConfidence(e.target.value as 'confirmed' | 'estimated' | 'unknown')
                        }
                      >
                        <option value="unknown">Unknown</option>
                        <option value="estimated">Estimated</option>
                        <option value="confirmed">Confirmed</option>
                      </select>
                      <details className="time-details">
                        <summary>Departure and arrival times (optional)</summary>
                        <p className="muted">Local calendar values; no timezone is inferred.</p>
                        <label htmlFor="departure-date">Departure date</label>
                        <input id="departure-date" type="date" value={departureDate}
                          onChange={(e) => setDepartureDate(e.target.value)} />
                        <label htmlFor="departure-time">Departure clock time</label>
                        <input id="departure-time" type="time" value={departureTime}
                          onChange={(e) => setDepartureTime(e.target.value)} />
                        <label htmlFor="departure-confidence">Departure certainty</label>
                        <select id="departure-confidence" value={departureCertainty}
                          onChange={(e) => setDepartureCertainty(e.target.value as 'confirmed' | 'estimated' | 'unknown')}>
                          <option value="unknown">Unknown</option>
                          <option value="estimated">Estimated</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                        <label htmlFor="arrival-date">Arrival date</label>
                        <input id="arrival-date" type="date" value={arrivalDate}
                          onChange={(e) => setArrivalDate(e.target.value)} />
                        <label htmlFor="arrival-time">Arrival clock time</label>
                        <input id="arrival-time" type="time" value={arrivalTime}
                          onChange={(e) => setArrivalTime(e.target.value)} />
                        <label htmlFor="arrival-confidence">Arrival certainty</label>
                        <select id="arrival-confidence" value={arrivalCertainty}
                          onChange={(e) => setArrivalCertainty(e.target.value as 'confirmed' | 'estimated' | 'unknown')}>
                          <option value="unknown">Unknown</option>
                          <option value="estimated">Estimated</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                      </details>
                      <button disabled={pending} onClick={() => void saveLeg()}>
                        Save Leg
                      </button>
                    </div>
                  )}
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
