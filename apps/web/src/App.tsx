import { useCallback, useEffect, useMemo, useState } from 'react';
import { atlasApi } from './api';
import type {
  FeatureCollection,
  Feature,
  LegRow,
  Place,
  Timeline,
  Trip,
  TripDay,
  VisitRow,
} from './api';
import { MapCanvas } from './MapCanvas';
import type { ColorMode } from './MapCanvas';
import { emptyFeatures, visibleFeatures } from './map-data';

type View = 'explore' | 'trips' | 'editor';
type MobilePanel = 'timeline' | 'map';
function describeLeg(leg: LegRow | undefined): string {
  if (!leg) return 'No connected travel leg';
  return `${leg.transportMode ?? 'Transport unknown'} · ${leg.movementConfidence} travel · ${leg.geometryConfidence} route`;
}

export function App() {
  const [view, setView] = useState<View>('explore');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterMode, setFilterMode] = useState('');
  const [filterConfidence, setFilterConfidence] = useState<
    'all' | 'confirmed' | 'estimated' | 'unknown'
  >('all');
  const [colorBy, setColorBy] = useState<ColorMode>('trip');
  const [selectedMapItem, setSelectedMapItem] = useState<Feature['properties'] | null>(null);
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
  const [visitPlaceQuery, setVisitPlaceQuery] = useState('');
  const [visitPlaceId, setVisitPlaceId] = useState('');
  const [visitPlaces, setVisitPlaces] = useState<Place[]>([]);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [legMode, setLegMode] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [departureCertainty, setDepartureCertainty] = useState<
    'confirmed' | 'estimated' | 'unknown'
  >('unknown');
  const [arrivalCertainty, setArrivalCertainty] = useState<'confirmed' | 'estimated' | 'unknown'>(
    'unknown',
  );
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
  const followingDay = days.find((day) => selectedDay && day.position === selectedDay.position + 1);
  const activeTrips = trips.filter((trip) => !trip.isArchived);
  const displayedTrips = showArchived ? trips : activeTrips;
  useEffect(() => {
    setEditedDayDate(selectedDay?.localDate ?? '');
  }, [selectedDay?.id, selectedDay?.revision]);
  const outgoingCrossDay = timeline?.crossDayLegs.find((leg) =>
    timeline.visits.some((visit) => visit.id === leg.fromVisitId),
  );
  const selectedVisit = timeline?.visits.find((visit) => visit.id === selectedVisitId);
  const selectedLeg = [...(timeline?.legs ?? []), ...(timeline?.crossDayLegs ?? [])].find(
    (leg) => leg.id === selectedLegId,
  );
  useEffect(() => {
    setVisitPlaceQuery(selectedVisit?.placeName ?? '');
    setVisitPlaceId(selectedVisit?.placeId ?? '');
  }, [selectedVisit?.id, selectedVisit?.revision]);
  useEffect(() => {
    let active = true;
    atlasApi
      .places(visitPlaceQuery)
      .then((result) => {
        if (active) setVisitPlaces(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [visitPlaceQuery]);
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
    () =>
      visibleFeatures(features, {
        tripId,
        fromDate: view === 'explore' ? filterFrom : '',
        toDate: view === 'explore' ? filterTo : '',
        transportMode: view === 'explore' ? filterMode : '',
        confidence: view === 'explore' ? filterConfidence : 'all',
      }),
    [features, tripId, view, filterFrom, filterTo, filterMode, filterConfidence],
  );

  function openMapFeature(properties: Feature['properties']) {
    if (!properties.tripId) return;
    setTripId(properties.tripId);
    if (properties.dayId) setDayId(properties.dayId);
    setSelectedVisitId(properties.kind === 'visit' ? (properties.visitId ?? null) : null);
    setSelectedLegId(properties.kind === 'route' ? (properties.legId ?? null) : null);
    setMobilePanel('timeline');
    setView('editor');
  }

  function selectEditorMapFeature(properties: Feature['properties']) {
    if (properties.dayId && days.some((day) => day.id === properties.dayId)) {
      setDayId(properties.dayId);
    }
    setSelectedVisitId(properties.kind === 'visit' ? (properties.visitId ?? null) : null);
    setSelectedLegId(properties.kind === 'route' ? (properties.legId ?? null) : null);
    setMobilePanel('timeline');
  }

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
  async function toggleDayArchive() {
    if (!tripId || !dayId || !selectedDay) return;
    if (
      !selectedDay.isArchived &&
      !window.confirm('Archive this day? Its visits and historical Legs will be preserved.')
    ) {
      return;
    }
    await execute(async () => {
      await atlasApi.archiveDay(tripId, dayId, selectedDay.revision, !selectedDay.isArchived);
      setSelectedVisitId(null);
      setSelectedLegId(null);
      await Promise.all([loadDays(tripId), loadTimeline(tripId, dayId), loadExplore()]);
    });
  }
  async function updateDayDate() {
    if (!tripId || !dayId || !selectedDay) return;
    await execute(async () => {
      await atlasApi.editDay(tripId, dayId, selectedDay.revision, editedDayDate || null);
      await Promise.all([loadDays(tripId), loadTimeline(tripId, dayId)]);
    });
  }

  async function connectToFollowingDay() {
    if (!tripId || !selectedDay || !followingDay) return;
    if (!window.confirm('Connect the last Visit of this day to the first of the next day?')) return;
    await execute(async () => {
      await atlasApi.connectDays(tripId, selectedDay.id, followingDay.id);
      await Promise.all([loadTimeline(tripId, selectedDay.id), loadExplore()]);
    });
  }

  async function disconnectFromFollowingDay() {
    if (!tripId || !selectedDay || !followingDay || !outgoingCrossDay) return;
    if (!window.confirm('Disconnect these days? The previous Leg and its evidence remain saved.')) {
      return;
    }
    await execute(async () => {
      await atlasApi.disconnectDays(
        tripId,
        selectedDay.id,
        followingDay.id,
        outgoingCrossDay.id,
        outgoingCrossDay.revision,
      );
      await Promise.all([loadTimeline(tripId, selectedDay.id), loadExplore()]);
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
    const currentPlace = places.find((place) => place.id === placeId);
    if (!currentPlace) {
      setError('Select an existing Place before editing its coordinates.');
      return;
    }
    await execute(async () => {
      const updated = await atlasApi.updatePlace(
        placeId,
        currentPlace.revision,
        [lon, lat],
        placeConfidence,
      );
      setPlaces((previous) => previous.map((place) => (place.id === updated.id ? updated : place)));
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
    });
  }

  async function addVisit() {
    if (!tripId || !dayId || selectedDay?.isArchived) return;
    await execute(async () => {
      await atlasApi.addVisit(tripId, dayId, placeId || null);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
    });
  }
  async function moveVisit(index: number, direction: -1 | 1) {
    if (!tripId || !dayId || !timeline || selectedDay?.isArchived) return;
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

  async function saveVisitPlace() {
    if (
      !tripId ||
      !dayId ||
      !selectedVisit ||
      selectedDay?.isArchived ||
      selectedTrip?.isArchived
    ) {
      return;
    }
    await execute(async () => {
      await atlasApi.editVisitPlace(
        tripId,
        dayId,
        selectedVisit.id,
        selectedVisit.revision,
        visitPlaceId || null,
      );
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
    });
  }

  async function archiveVisit(visit: VisitRow) {
    if (!tripId || !dayId || selectedDay?.isArchived) return;
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
          <div className="explore-filters">
            <label htmlFor="explore-from">
              From date
              <input
                id="explore-from"
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </label>
            <label htmlFor="explore-to">
              To date
              <input
                id="explore-to"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </label>
            <label htmlFor="explore-transport">
              Transport
              <select
                id="explore-transport"
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value)}
              >
                <option value="">All transports</option>
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
            </label>
            <label htmlFor="explore-certainty">
              Geometry certainty
              <select
                id="explore-certainty"
                value={filterConfidence}
                onChange={(e) =>
                  setFilterConfidence(
                    e.target.value as 'all' | 'confirmed' | 'estimated' | 'unknown',
                  )
                }
              >
                <option value="all">All certainty</option>
                <option value="confirmed">Confirmed</option>
                <option value="estimated">Estimated</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label htmlFor="explore-colors">
              Colors
              <select
                id="explore-colors"
                value={colorBy}
                onChange={(e) => setColorBy(e.target.value as ColorMode)}
              >
                <option value="trip">By trip</option>
                <option value="transport">By transport</option>
              </select>
            </label>
            <button
              onClick={() => {
                setFilterFrom('');
                setFilterTo('');
                setFilterMode('');
                setFilterConfidence('all');
              }}
            >
              Clear filters
            </button>
          </div>
          {filterMode && (
            <p className="map-filter-note">
              Transport filters show saved route geometries only. Visits without a route are not
              assigned a transport.
            </p>
          )}
          <MapCanvas
            data={displayed}
            label="Interactive world map of saved visits and routes"
            colorBy={colorBy}
            onSelect={setSelectedMapItem}
          />
          {selectedMapItem && (
            <section className="map-selection" aria-label="Selected map feature">
              <div>
                <span className="eyebrow">Selected {selectedMapItem.kind ?? 'feature'}</span>
                <h2>{selectedMapItem.name ?? selectedMapItem.transportMode ?? 'Saved route'}</h2>
                <p>
                  Date: {selectedMapItem.localDate ?? 'Unknown'} · Certainty:{' '}
                  {selectedMapItem.locationConfidence ?? selectedMapItem.confidence ?? 'Unknown'}
                </p>
              </div>
              {selectedMapItem.tripId && (
                <button onClick={() => openMapFeature(selectedMapItem)}>
                  Open selected item in editor
                </button>
              )}
              <button aria-label="Close map details" onClick={() => setSelectedMapItem(null)}>
                Close
              </button>
            </section>
          )}
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
                      className={[
                        dayId === day.id ? 'selected' : '',
                        day.isArchived ? 'archived-day' : '',
                      ].join(' ')}
                      onClick={() => setDayId(day.id)}
                    >
                      {day.localDate ?? `Day ${day.position + 1} · date unknown`}
                      {day.isArchived ? ' (archived)' : ''}
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
                  <input
                    id="edit-day-date"
                    type="date"
                    value={editedDayDate}
                    onChange={(e) => setEditedDayDate(e.target.value)}
                  />
                  <button disabled={pending} onClick={() => void updateDayDate()}>
                    Save date
                  </button>
                  <button disabled={pending} onClick={() => void toggleDayArchive()}>
                    {selectedDay.isArchived ? 'Restore day' : 'Archive day'}
                  </button>
                </div>
              )}
              {selectedDay?.isArchived && (
                <p className="archived-day-note" role="status">
                  This day is archived. Restore it before editing visits or reconnecting journeys.
                  Historical Legs remain saved.
                </p>
              )}
              {selectedDay &&
                !selectedDay.isArchived &&
                followingDay &&
                !followingDay.isArchived && (
                  <div className="connect-day">
                    <span>
                      {outgoingCrossDay
                        ? 'The selected day is connected to the next day.'
                        : 'Days are not linked automatically.'}
                    </span>
                    {outgoingCrossDay ? (
                      <button disabled={pending} onClick={() => void disconnectFromFollowingDay()}>
                        Disconnect from next day
                      </button>
                    ) : (
                      <button disabled={pending} onClick={() => void connectToFollowingDay()}>
                        Connect to next day
                      </button>
                    )}
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
                        {timeline?.crossDayLegs
                          .filter((leg) =>
                            timeline.visits.some((visit) => visit.id === leg.toVisitId),
                          )
                          .map((leg) => (
                            <button
                              key={leg.id}
                              className="leg-pill cross-day-leg"
                              data-leg-id={leg.id}
                              onClick={() => {
                                setSelectedLegId(leg.id);
                                setSelectedVisitId(null);
                              }}
                            >
                              From previous day · {describeLeg(leg)} · Edit
                            </button>
                          ))}
                        {timeline?.visits.map((visit, index) => {
                          const incoming = timeline.legs.find((leg) => leg.toVisitId === visit.id);
                          return (
                            <div key={visit.id}>
                              {index > 0 && (
                                <button
                                  className="leg-pill"
                                  data-leg-id={incoming?.id ?? ''}
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
                                data-visit-id={visit.id}
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
                        {timeline?.crossDayLegs
                          .filter((leg) =>
                            timeline.visits.some((visit) => visit.id === leg.fromVisitId),
                          )
                          .map((leg) => (
                            <button
                              key={leg.id}
                              className="leg-pill cross-day-leg"
                              data-leg-id={leg.id}
                              onClick={() => {
                                setSelectedLegId(leg.id);
                                setSelectedVisitId(null);
                              }}
                            >
                              To next day · {describeLeg(leg)} · Edit
                            </button>
                          ))}
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
                  <MapCanvas
                    data={displayed}
                    label="Map of selected trip and its saved geometry"
                    onSelect={selectEditorMapFeature}
                  />
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
                        <input
                          id="departure-date"
                          type="date"
                          value={departureDate}
                          onChange={(e) => setDepartureDate(e.target.value)}
                        />
                        <label htmlFor="departure-time">Departure clock time</label>
                        <input
                          id="departure-time"
                          type="time"
                          value={departureTime}
                          onChange={(e) => setDepartureTime(e.target.value)}
                        />
                        <label htmlFor="departure-confidence">Departure certainty</label>
                        <select
                          id="departure-confidence"
                          value={departureCertainty}
                          onChange={(e) =>
                            setDepartureCertainty(
                              e.target.value as 'confirmed' | 'estimated' | 'unknown',
                            )
                          }
                        >
                          <option value="unknown">Unknown</option>
                          <option value="estimated">Estimated</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                        <label htmlFor="arrival-date">Arrival date</label>
                        <input
                          id="arrival-date"
                          type="date"
                          value={arrivalDate}
                          onChange={(e) => setArrivalDate(e.target.value)}
                        />
                        <label htmlFor="arrival-time">Arrival clock time</label>
                        <input
                          id="arrival-time"
                          type="time"
                          value={arrivalTime}
                          onChange={(e) => setArrivalTime(e.target.value)}
                        />
                        <label htmlFor="arrival-confidence">Arrival certainty</label>
                        <select
                          id="arrival-confidence"
                          value={arrivalCertainty}
                          onChange={(e) =>
                            setArrivalCertainty(
                              e.target.value as 'confirmed' | 'estimated' | 'unknown',
                            )
                          }
                        >
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
                      <div>
                        <label htmlFor="visit-place-search">Correct this visit's Place</label>
                        <input
                          id="visit-place-search"
                          value={visitPlaceQuery}
                          onChange={(event) => setVisitPlaceQuery(event.target.value)}
                          placeholder="Search existing Places"
                          disabled={pending || selectedDay?.isArchived || selectedTrip?.isArchived}
                        />
                        <select
                          aria-label="Place for selected visit"
                          value={visitPlaceId}
                          onChange={(event) => setVisitPlaceId(event.target.value)}
                          disabled={pending || selectedDay?.isArchived || selectedTrip?.isArchived}
                        >
                          <option value="">Unknown Place</option>
                          {selectedVisit.placeId &&
                            !visitPlaces.some((place) => place.id === selectedVisit.placeId) && (
                              <option value={selectedVisit.placeId}>
                                {selectedVisit.placeName ?? 'Current Place'}
                              </option>
                            )}
                          {visitPlaces.map((place) => (
                            <option key={place.id} value={place.id}>
                              {place.name ?? 'Unnamed Place'}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={
                            pending ||
                            selectedDay?.isArchived ||
                            selectedTrip?.isArchived ||
                            visitPlaceId === (selectedVisit.placeId ?? '')
                          }
                          onClick={() => void saveVisitPlace()}
                        >
                          Save Place correction
                        </button>
                        <p>This updates the Visit, not the reusable Place or its saved history.</p>
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
