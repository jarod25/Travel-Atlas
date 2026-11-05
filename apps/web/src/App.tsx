import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Modal, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { atlasApi } from './api';
import type {
  FeatureCollection,
  ArchivedVisitRow,
  Feature,
  Place,
  Timeline,
  Trip,
  TripDay,
  VisitRow,
} from './api';
import { MapCanvas } from './MapCanvas';
import type { ColorMode } from './MapCanvas';
import { emptyFeatures, visibleFeatures } from './map-data';
import { describeLeg, describeLegTimes } from './leg-display';

type View = 'explore' | 'trips' | 'editor';
type MobilePanel = 'timeline' | 'map';

function exploreParams() {
  return new URLSearchParams(window.location.search);
}

function readLocation(): { view: View; tripId: string | null; dayId: string | null } {
  const path = window.location.pathname;
  if (path === '/explore' || path === '/') {
    return { view: 'explore', tripId: exploreParams().get('trip'), dayId: null };
  }
  if (path === '/trips') return { view: 'trips', tripId: null, dayId: null };
  if (path === '/editor') return { view: 'editor', tripId: null, dayId: null };
  const match = /^\/trips\/([0-9a-f-]{36})$/i.exec(path);
  if (match) {
    return {
      view: 'editor',
      tripId: match[1],
      dayId: new URLSearchParams(window.location.search).get('day'),
    };
  }
  return { view: 'explore', tripId: null, dayId: null };
}
function urlFor(view: View, tripId: string | null, dayId: string | null): string {
  if (view === 'trips') return '/trips';
  if (view !== 'editor') return '/explore';
  if (!tripId) return '/editor';
  return '/trips/' + tripId + (dayId ? '?day=' + encodeURIComponent(dayId) : '');
}

export function App() {
  const addVisitRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => readLocation().view);
  const [filterFrom, setFilterFrom] = useState(() => exploreParams().get('from') ?? '');
  const [filterTo, setFilterTo] = useState(() => exploreParams().get('to') ?? '');
  const [filterMode, setFilterMode] = useState(() => exploreParams().get('transport') ?? '');
  const [filterConfidence, setFilterConfidence] = useState<
    'all' | 'confirmed' | 'estimated' | 'unknown'
  >(() => {
    const value = exploreParams().get('certainty');
    return value === 'confirmed' || value === 'estimated' || value === 'unknown' ? value : 'all';
  });
  const [colorBy, setColorBy] = useState<ColorMode>('trip');
  const [selectedMapItem, setSelectedMapItem] = useState<Feature['properties'] | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState<string | null>(() => readLocation().tripId);
  const [days, setDays] = useState<TripDay[]>([]);
  const [dayId, setDayId] = useState<string | null>(() => readLocation().dayId);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [archivedVisits, setArchivedVisits] = useState<ArchivedVisitRow[]>([]);
  const [visitVisibility, setVisitVisibility] = useState<'active' | 'archived' | 'all'>('active');
  const [places, setPlaces] = useState<Place[]>([]);
  const [features, setFeatures] = useState<FeatureCollection>(emptyFeatures);
  const [tripName, setTripName] = useState('');
  const [newTripParentId, setNewTripParentId] = useState('');
  const [nextDayFirstVisit, setNextDayFirstVisit] = useState<VisitRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dayDate, setDayDate] = useState('');
  const [editedDayDate, setEditedDayDate] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
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
  const [departureZone, setDepartureZone] = useState('');
  const [arrivalZone, setArrivalZone] = useState('');
  const [departurePrecision, setDeparturePrecision] = useState<'exact' | 'approximate' | 'range' | 'unknown'>(
    'unknown',
  );
  const [arrivalPrecision, setArrivalPrecision] = useState<'exact' | 'approximate' | 'range' | 'unknown'>(
    'unknown',
  );
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
  const [renameTarget, setRenameTarget] = useState<Trip | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function navigate(
    nextView: View,
    nextTripId: string | null = tripId,
    nextDayId: string | null = null,
  ) {
    const targetView = nextView;
    const url = urlFor(targetView, nextTripId, nextDayId);
    if (window.location.pathname + window.location.search !== url) {
      window.history.pushState(null, '', url);
    }
    setView(targetView);
    if (targetView === 'editor') {
      setTripId(nextTripId);
      setDayId(nextDayId);
    }
  }
  useEffect(() => {
    const onPopState = () => {
      const next = readLocation();
      setView(next.view);
      setTripId(next.tripId);
      setDayId(next.dayId);
      if (next.view === 'explore') {
        const params = exploreParams();
        setFilterFrom(params.get('from') ?? '');
        setFilterTo(params.get('to') ?? '');
        setFilterMode(params.get('transport') ?? '');
        const certainty = params.get('certainty');
        setFilterConfidence(
          certainty === 'confirmed' || certainty === 'estimated' || certainty === 'unknown'
            ? certainty
            : 'all',
        );
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (view !== 'editor' || !tripId || window.location.pathname !== '/trips/' + tripId) {
      return;
    }
    const url = urlFor('editor', tripId, dayId);
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, '', url);
    }
  }, [view, tripId, dayId]);

  useEffect(() => {
    if (view !== 'explore') return;
    const params = new URLSearchParams();
    if (tripId) params.set('trip', tripId);
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    if (filterMode) params.set('transport', filterMode);
    if (filterConfidence !== 'all') params.set('certainty', filterConfidence);
    const query = params.toString();
    const url = '/explore' + (query ? '?' + query : '');
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, '', url);
    }
  }, [view, tripId, filterFrom, filterTo, filterMode, filterConfidence]);

  function confirmAction(
    title: string,
    message: string,
    confirmLabel: string,
    action: () => Promise<void>,
    destructive = false,
  ) {
    modals.openConfirmModal({
      title,
      children: message,
      labels: { confirm: confirmLabel, cancel: 'Cancel' },
      confirmProps: destructive ? { color: 'red' } : undefined,
      onConfirm: () => {
        void action();
      },
    });
  }

  const execute = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unexpected error';
      setError(message);
      notifications.show({ title: 'Operation failed', message, color: 'red' });
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
    const [current, archived] = await Promise.all([
      atlasApi.timeline(id, day),
      atlasApi.archivedVisits(id, day),
    ]);
    setTimeline(current);
    setArchivedVisits(archived);
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
      setArchivedVisits([]);
      return;
    }
    let active = true;
    Promise.all([atlasApi.timeline(tripId, dayId), atlasApi.archivedVisits(tripId, dayId)])
      .then(([result, archived]) => {
        if (active) {
          setTimeline(result);
          setArchivedVisits(archived);
        }
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
  const dayReadOnly = Boolean(selectedDay?.isArchived || selectedTrip?.isArchived);
  const followingDay = days.find((day) => selectedDay && day.position === selectedDay.position + 1);
  useEffect(() => {
    let active = true;
    setNextDayFirstVisit(null);
    if (tripId && followingDay && !followingDay.isArchived) {
      atlasApi.timeline(tripId, followingDay.id).then((next) => {
        if (active) setNextDayFirstVisit(next.visits[0] ?? null);
      }).catch(() => { if (active) setNextDayFirstVisit(null); });
    }
    return () => { active = false; };
  }, [tripId, followingDay?.id, followingDay?.revision, followingDay?.isArchived]);
  const activeTrips = trips.filter((trip) => !trip.isArchived);
  const recentTrips = activeTrips.slice(0, 3);
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
    const sameDay = Boolean(
      timeline?.visits.some((visit) => visit.id === selectedLeg.fromVisitId) &&
      timeline?.visits.some((visit) => visit.id === selectedLeg.toVisitId),
    );
    const suggestedDate = sameDay ? (selectedDay?.localDate ?? '') : '';
    setLegMode(selectedLeg.transportMode ?? '');
    setDepartureDate(selectedLeg.departureLocalDate ?? suggestedDate);
    setDepartureTime(selectedLeg.departureLocalTime?.slice(0, 5) ?? '');
    setArrivalDate(selectedLeg.arrivalLocalDate ?? suggestedDate);
    setArrivalTime(selectedLeg.arrivalLocalTime?.slice(0, 5) ?? '');
    setDepartureZone(selectedLeg.departureTimeZone ?? '');
    setArrivalZone(selectedLeg.arrivalTimeZone ?? '');
    setDeparturePrecision(
      selectedLeg.departureTimePrecision === 'range'
        ? 'unknown'
        : selectedLeg.departureTimePrecision,
    );
    setArrivalPrecision(
      selectedLeg.arrivalTimePrecision === 'range' ? 'unknown' : selectedLeg.arrivalTimePrecision,
    );
    setDepartureCertainty(selectedLeg.departureTimeConfidence);
    setArrivalCertainty(selectedLeg.arrivalTimeConfidence);
    setLegConfidence(selectedLeg.transportConfidence as 'confirmed' | 'estimated' | 'unknown');
  }, [selectedLeg?.id, selectedLeg?.revision, selectedDay?.localDate, timeline?.visits]);

  const displayed = useMemo(
    () =>
      visibleFeatures(features, {
        tripId,
        tripIds: tripId
          ? (() => {
              const ids = new Set([tripId]);
              let changed = true;
              while (changed) {
                changed = false;
                for (const trip of trips) {
                  if (trip.parentTripId && ids.has(trip.parentTripId) && !ids.has(trip.id)) {
                    ids.add(trip.id);
                    changed = true;
                  }
                }
              }
              return [...ids];
            })()
          : undefined,
        fromDate: view === 'explore' ? filterFrom : '',
        toDate: view === 'explore' ? filterTo : '',
        transportMode: view === 'explore' ? filterMode : '',
        confidence: view === 'explore' ? filterConfidence : 'all',
      }),
    [features, tripId, trips, view, filterFrom, filterTo, filterMode, filterConfidence],
  );

  const focusFeatures = useMemo(() => {
    if (view !== 'editor') return displayed;
    const bySelection = selectedVisitId
      ? displayed.features.filter((feature) => feature.properties.visitId === selectedVisitId)
      : selectedLegId
        ? displayed.features.filter((feature) => feature.properties.legId === selectedLegId)
        : [];
    const byDay = dayId
      ? displayed.features.filter((feature) => feature.properties.dayId === dayId)
      : [];
    return {
      type: 'FeatureCollection' as const,
      features:
        selectedVisitId || selectedLegId ? bySelection : byDay.length ? byDay : displayed.features,
    };
  }, [displayed, view, dayId, selectedVisitId, selectedLegId]);

  function openMapFeature(properties: Feature['properties']) {
    if (!properties.tripId) return;
    navigate('editor', properties.tripId, properties.dayId ?? null);
    setSelectedVisitId(properties.kind === 'visit' ? (properties.visitId ?? null) : null);
    setSelectedLegId(properties.kind === 'route' ? (properties.legId ?? null) : null);
    setMobilePanel('timeline');
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
      const trip = await atlasApi.addTrip(title, newTripParentId || null);
      await loadTrips();
      setTripName('');
      setNewTripParentId('');
      navigate('editor', trip.id);
      notifications.show({
        title: 'Trip created',
        message: title,
        color: 'teal',
      });
    });
  }
  async function changeTrip(
    trip: Trip,
    changes: {
      title?: string;
      isArchived?: boolean;
      manualStartDate?: string | null;
      manualEndDate?: string | null;
    },
  ) {
    await execute(async () => {
      await atlasApi.updateTrip(trip.id, trip.revision, changes);
      await Promise.all([loadTrips(), loadExplore()]);
      if (changes.isArchived && tripId === trip.id) {
        setTripId(null);
        navigate('trips');
      }
      if (changes.title) setRenameTarget(null);
      notifications.show({
        title: 'Trip saved',
        message: changes.title
          ? 'Trip renamed successfully.'
          : changes.isArchived
            ? 'Trip archived.'
            : 'Trip restored.',
        color: 'teal',
      });
    });
  }

  function renameTrip(trip: Trip) {
    setRenameTarget(trip);
    setRenameValue(trip.title);
  }

  async function submitRename() {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title || title === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    await changeTrip(renameTarget, { title });
  }

  async function toggleTripArchive(trip: Trip) {
    if (!trip.isArchived) {
      confirmAction(
        'Archive trip',
        'Archive this trip? Its history will remain saved.',
        'Archive',
        () => changeTrip(trip, { isArchived: true }),
        true,
      );
      return;
    }
    await changeTrip(trip, { isArchived: false });
  }

  async function addDay() {
    if (!tripId) return;
    await execute(async () => {
      const created = await atlasApi.addDay(tripId, dayDate || null);
      await loadDays(tripId);
      setDayId(created.id);
      setDayDate('');
      notifications.show({
        title: 'Day created',
        message: 'Day saved.',
        color: 'teal',
      });
    });
  }
  async function toggleDayArchive() {
    if (!tripId || !dayId || !selectedDay) return;
    if (!selectedDay.isArchived) {
      confirmAction(
        'Archive day',
        'Archive this day? Its Visits and historical Legs will be preserved.',
        'Archive',
        async () => {
          await performDayArchive();
        },
        true,
      );
      return;
    }
    await performDayArchive();
  }

  async function performDayArchive() {
    if (!tripId || !dayId || !selectedDay) return;
    await execute(async () => {
      await atlasApi.archiveDay(tripId, dayId, selectedDay.revision, !selectedDay.isArchived);
      setSelectedVisitId(null);
      setSelectedLegId(null);
      await Promise.all([loadDays(tripId), loadTimeline(tripId, dayId), loadExplore()]);
      notifications.show({
        title: 'Day saved',
        message: selectedDay.isArchived ? 'Day restored.' : 'Day archived.',
        color: 'teal',
      });
    });
  }
  async function updateDayDate() {
    if (!tripId || !dayId || !selectedDay) return;
    await execute(async () => {
      await atlasApi.editDay(tripId, dayId, selectedDay.revision, editedDayDate || null);
      await Promise.all([loadDays(tripId), loadTimeline(tripId, dayId)]);
      notifications.show({
        title: 'Day date saved',
        message: 'Changes saved.',
        color: 'teal',
      });
    });
  }

  async function connectToFollowingDay() {
    if (!tripId || !selectedDay || !followingDay) return;
    confirmAction(
      'Connect days',
      'Connect the last Visit of this day to the first of the next day?',
      'Connect',
      performConnectToFollowingDay,
    );
  }

  async function performConnectToFollowingDay() {
    if (!tripId || !selectedDay || !followingDay) return;
    await execute(async () => {
      await atlasApi.connectDays(tripId, selectedDay.id, followingDay.id);
      await Promise.all([loadTimeline(tripId, selectedDay.id), loadExplore()]);
      notifications.show({
        title: 'Days connected',
        message: 'Travel Leg created.',
        color: 'teal',
      });
    });
  }

  async function disconnectFromFollowingDay() {
    if (!tripId || !selectedDay || !followingDay || !outgoingCrossDay) return;
    confirmAction(
      'Disconnect days',
      'Disconnect these days? The previous Leg and its evidence remain saved.',
      'Disconnect',
      performDisconnectFromFollowingDay,
      true,
    );
  }

  async function performDisconnectFromFollowingDay() {
    if (!tripId || !selectedDay || !followingDay || !outgoingCrossDay) return;
    await execute(async () => {
      await atlasApi.disconnectDays(
        tripId,
        selectedDay.id,
        followingDay.id,
        outgoingCrossDay.id,
        outgoingCrossDay.revision,
      );
      await Promise.all([loadTimeline(tripId, selectedDay.id), loadExplore()]);
      notifications.show({
        title: 'Days disconnected',
        message: 'Historical travel details remain saved.',
        color: 'teal',
      });
    });
  }

  async function addPlace() {
    const name = placeQuery.trim();
    if (!name || placeId) return;
    await execute(async () => {
      const place = await atlasApi.addPlace(name);
      setPlaceQuery(name);
      setPlaceId(place.id);
      setPlaces((previous) => [
        ...previous.filter((candidate) => candidate.id !== place.id),
        place,
      ]);
      notifications.show({ title: 'Place created', message: name, color: 'teal' });
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
      notifications.show({
        title: 'Coordinates saved',
        message: 'Place updated.',
        color: 'teal',
      });
    });
  }

  async function addVisit() {
    if (!tripId || !dayId || selectedDay?.isArchived) return;
    await execute(async () => {
      await atlasApi.addVisit(tripId, dayId, placeId || null);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
      notifications.show({
        title: 'Visit added',
        message: 'Visit saved.',
        color: 'teal',
      });
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
      notifications.show({
        title: 'Visit order saved',
        message: 'Timeline updated.',
        color: 'teal',
      });
    });
  }
  async function saveLeg() {
    if (!selectedLeg || !tripId || !dayId) return;
    if ((!departureDate && departureTime) || (!arrivalDate && arrivalTime)) {
      setError('A clock time needs a date; leave both empty if unknown.');
      return;
    }
    for (const zone of [departureZone, arrivalZone]) {
      if (!zone) continue;
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
      } catch {
        setError('Invalid IANA time zone: ' + zone);
        return;
      }
    }
    await execute(async () => {
      await atlasApi.updateLeg(selectedLeg.id, selectedLeg.revision, {
        transportMode: legMode || null,
        transportConfidence: legConfidence,
        departureLocalDate: departureDate || null,
        departureLocalTime: departureDate && departureTime ? departureTime + ':00' : null,
        departureTimeConfidence: departureCertainty,
        departureTimeZone: departureZone || null,
        departureTimePrecision: departureTime ? departurePrecision : 'unknown',
        arrivalLocalDate: arrivalDate || null,
        arrivalLocalTime: arrivalDate && arrivalTime ? arrivalTime + ':00' : null,
        arrivalTimeConfidence: arrivalCertainty,
        arrivalTimeZone: arrivalZone || null,
        arrivalTimePrecision: arrivalTime ? arrivalPrecision : 'unknown',
      });
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
      notifications.show({
        title: 'Leg saved',
        message: 'Travel details updated.',
        color: 'teal',
      });
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
      notifications.show({
        title: 'Visit place saved',
        message: 'Visit updated.',
        color: 'teal',
      });
    });
  }

  async function restoreArchivedVisit(visit: ArchivedVisitRow) {
    if (!tripId || !dayId || selectedDay?.isArchived) return;
    await execute(async () => {
      await atlasApi.restoreVisit(tripId, dayId, visit.id);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
      notifications.show({
        title: 'Visit restored',
        message: 'Visit active again.',
        color: 'teal',
      });
    });
  }

  async function archiveVisit(visit: VisitRow) {
    if (!tripId || !dayId || selectedDay?.isArchived) return;
    confirmAction(
      'Archive visit',
      'Archive this Visit? Historical Legs will be preserved.',
      'Archive',
      async () => {
        await performArchiveVisit(visit);
      },
      true,
    );
  }

  async function performArchiveVisit(visit: VisitRow) {
    if (!tripId || !dayId || selectedDay?.isArchived) return;
    await execute(async () => {
      await atlasApi.archiveVisit(tripId, dayId, visit.id);
      setSelectedVisitId(null);
      await Promise.all([loadTimeline(tripId, dayId), loadExplore()]);
      notifications.show({
        title: 'Visit archived',
        message: 'Visit history saved.',
        color: 'teal',
      });
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
          <button
            className={view === 'explore' ? 'active' : ''}
            onClick={() => navigate('explore')}
          >
            Explore
          </button>
          <button className={view === 'trips' ? 'active' : ''} onClick={() => navigate('trips')}>
            Trips
          </button>
          <button className={view === 'editor' ? 'active' : ''} onClick={() => navigate('editor')}>
            Trip Editor
          </button>
        </nav>
        <span className="local-label">Local workspace</span>
      </header>

      <Modal
        opened={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename trip"
        centered
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitRename();
          }}
        >
          <TextInput
            label="Trip name"
            value={renameValue}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            maxLength={200}
            required
            autoFocus
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!renameValue.trim()}>
              Save
            </Button>
          </Group>
        </form>
      </Modal>

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
            <label htmlFor="parent-trip">Inside trip (optional)</label>
            <select
              id="parent-trip"
              value={newTripParentId}
              onChange={(event) => setNewTripParentId(event.target.value)}
            >
              <option value="">Top-level trip</option>
              {activeTrips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
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
                <strong>
                  {trip.parentTripId ? '↳ ' : ''}
                  {trip.title}
                </strong>
                <small>
                  {trip.manualStartDate ?? trip.computedStartDate ?? 'Start unknown'} —{' '}
                  {trip.manualEndDate ?? trip.computedEndDate ?? 'End unknown'}
                  {trip.parentTripId ? ' · Subtrip' : ''}
                </small>
                <div className="trip-actions">
                  {!trip.isArchived && (
                    <button
                      onClick={() => {
                        navigate('editor', trip.id);
                      }}
                    >
                      Open timeline
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const start = window.prompt(
                        'Override start date (YYYY-MM-DD, blank = automatic)',
                        trip.manualStartDate ?? '',
                      );
                      if (start === null) return;
                      const end = window.prompt(
                        'Override end date (YYYY-MM-DD, blank = automatic)',
                        trip.manualEndDate ?? '',
                      );
                      if (end === null) return;
                      if (
                        (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) ||
                        (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))
                      ) {
                        setError('Use YYYY-MM-DD or leave blank.');
                        return;
                      }
                      void changeTrip(trip, {
                        manualStartDate: start || null,
                        manualEndDate: end || null,
                      });
                    }}
                    disabled={pending}
                  >
                    Edit dates
                  </button>
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
              onChange={(e) => navigate('editor', e.target.value || null)}
            >
              <option value="">Select trip</option>
              {trips
                .filter((trip) => showArchived || !trip.isArchived || trip.id === tripId)
                .map((trip) => (
                  <option value={trip.id} key={trip.id}>
                    {trip.title}
                  </option>
                ))}
            </select>
            <label className="archived-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Include archived trips
            </label>
          </div>
          {!tripId ? (
            <section className="recent-trips" aria-label="Recently modified trips">
              <h2>Recently modified trips</h2>
              {recentTrips.length > 0 ? (
                <div className="recent-trip-grid">
                  {recentTrips.map((trip) => (
                    <button key={trip.id} onClick={() => navigate('editor', trip.id)}>
                      <strong>{trip.title}</strong>
                      <span>Open timeline</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No active trips yet. Create one in Trips.</p>
              )}
            </section>
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
                  <button type="submit" disabled={pending || Boolean(selectedTrip?.isArchived)}>
                    + Day
                  </button>
                </form>
              </div>
              {selectedDay && (
                <div className="edit-day-date">
                  <label htmlFor="edit-day-date">Selected day's date (optional)</label>
                  <input
                    id="edit-day-date"
                    disabled={dayReadOnly}
                    type="date"
                    value={editedDayDate}
                    onChange={(e) => setEditedDayDate(e.target.value)}
                  />
                  <button disabled={pending || dayReadOnly} onClick={() => void updateDayDate()}>
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
                        : timeline?.visits.length && nextDayFirstVisit
                          ? 'Suggested connection: last recorded Visit → first Visit of the next day. Review before creating.'
                          : 'No complete candidate endpoints recorded; no connection is suggested.'}
                    </span>
                    {outgoingCrossDay ? (
                      <button disabled={pending} onClick={() => void disconnectFromFollowingDay()}>
                        Disconnect from next day
                      </button>
                    ) : (
                      <button disabled={pending || !timeline?.visits.length || !nextDayFirstVisit} onClick={() => void connectToFollowingDay()}>
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
                    <div className="timeline-heading-actions">
                      <span>{timeline?.visits.length ?? 0} active visits</span>
                      {dayId && (
                        <button
                          className="jump-to-add-visit"
                          disabled={dayReadOnly}
                          onClick={() =>
                            addVisitRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            })
                          }
                        >
                          Go to Add visit
                        </button>
                      )}
                    </div>
                  </div>
                  <label htmlFor="visit-visibility">Show visits</label>
                  <select
                    id="visit-visibility"
                    value={visitVisibility}
                    onChange={(event) =>
                      setVisitVisibility(event.target.value as 'active' | 'archived' | 'all')
                    }
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                    <option value="all">All</option>
                  </select>
                  {!dayId && <p className="empty-state">Add a day to begin.</p>}
                  {dayId && (
                    <>
                      {visitVisibility !== 'archived' && (
                        <div className="visit-list">
                          {timeline?.crossDayLegs
                            .filter((leg) =>
                              timeline?.visits.some((visit) => visit.id === leg.toVisitId),
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
                                <span className="leg-main">
                                  <strong className="leg-summary">
                                    From previous day · {describeLeg(leg)}
                                  </strong>
                                  <span className="leg-edit">Edit</span>
                                </span>
                                <small className="leg-schedule">{describeLegTimes(leg)}</small>
                              </button>
                            ))}
                          {timeline?.visits.map((visit, index) => {
                            const incoming = timeline.legs.find(
                              (leg) => leg.toVisitId === visit.id,
                            );
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
                                    <span className="leg-main">
                                      <strong className="leg-summary">
                                        {describeLeg(incoming)}
                                      </strong>
                                      <span className="leg-edit">Edit</span>
                                    </span>
                                    {incoming && (
                                      <small className="leg-schedule">
                                        {describeLegTimes(incoming)}
                                      </small>
                                    )}
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
                                      disabled={pending || dayReadOnly || index === 0}
                                      onClick={() => void moveVisit(index, -1)}
                                    >
                                      ↑
                                    </button>
                                    <button
                                      aria-label={`Move visit ${index + 1} down`}
                                      disabled={
                                        pending ||
                                        dayReadOnly ||
                                        index === timeline.visits.length - 1
                                      }
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
                              timeline?.visits.some((visit) => visit.id === leg.fromVisitId),
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
                                <span className="leg-main">
                                  <strong className="leg-summary">
                                    To next day · {describeLeg(leg)}
                                  </strong>
                                  <span className="leg-edit">Edit</span>
                                </span>
                                <small className="leg-schedule">{describeLegTimes(leg)}</small>
                              </button>
                            ))}
                        </div>
                      )}
                      {visitVisibility !== 'active' && (
                        <div className="archived-visits" aria-label="Archived visits">
                          <h3>Archived visits</h3>
                          {archivedVisits.length === 0 && <p>No archived visits in this day.</p>}
                          {archivedVisits.map((visit) => (
                            <div className="visit-row" key={visit.id}>
                              <span>{visit.placeName ?? 'Unknown place'}</span>
                              <button
                                disabled={
                                  pending || selectedDay?.isArchived || selectedTrip?.isArchived
                                }
                                onClick={() => void restoreArchivedVisit(visit)}
                              >
                                Restore visit
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="composer" ref={addVisitRef}>
                        <h3>Add a visit</h3>
                        <label htmlFor="place-search">Search or name a Place</label>
                        <input
                          id="place-search"
                          disabled={dayReadOnly}
                          value={placeQuery}
                          onChange={(e) => {
                            setPlaceQuery(e.target.value);
                            setPlaceId('');
                          }}
                          placeholder="Search existing Places or enter a new name"
                        />
                        <select
                          aria-label="Existing place"
                          disabled={dayReadOnly}
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
                        <button
                          disabled={pending || dayReadOnly || (!placeId && !!placeQuery.trim())}
                          onClick={() => void addVisit()}
                        >
                          + Add visit
                        </button>
                        {placeQuery.trim() && !placeId && (
                          <>
                            <button
                              disabled={pending || dayReadOnly}
                              onClick={() => void addPlace()}
                            >
                              Create new Place from this name
                            </button>
                            <button
                              disabled={pending || dayReadOnly}
                              onClick={() => {
                                setPlaceQuery('');
                                setPlaceId('');
                              }}
                            >
                              Use unknown place
                            </button>
                            <p className="muted">
                              Select a Place, create one, or record an unknown location.
                            </p>
                          </>
                        )}
                        <details className="coordinate-editor">
                          <summary>Coordinates (optional)</summary>
                          <p className="muted">
                            Changes this reusable Place for every Visit linked to it.
                          </p>
                          <label htmlFor="place-lon">Longitude</label>
                          <input
                            id="place-lon"
                            disabled={dayReadOnly}
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
                            disabled={dayReadOnly}
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
                            disabled={dayReadOnly}
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
                            disabled={pending || dayReadOnly || !placeId}
                            onClick={() => void saveCoordinates()}
                          >
                            Save coordinates
                          </button>
                        </details>
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
                    fitData={focusFeatures}
                    focusKey={`${tripId ?? ''}:${dayId ?? ''}:${selectedVisitId ?? ''}:${selectedLegId ?? ''}`}
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
                        disabled={dayReadOnly}
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
                        disabled={dayReadOnly}
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
                        <p className="muted">
                          Local time at each endpoint. Enter an IANA zone if known (e.g.
                          Europe/Paris, Asia/Tokyo). No zone is guessed.
                        </p>
                        <label htmlFor="departure-date">Departure date</label>
                        <input
                          id="departure-date"
                          disabled={dayReadOnly}
                          type="date"
                          value={departureDate}
                          onChange={(e) => setDepartureDate(e.target.value)}
                        />
                        <label htmlFor="departure-time">Departure clock time</label>
                        <input
                          id="departure-time"
                          disabled={dayReadOnly}
                          type="time"
                          value={departureTime}
                          onChange={(e) => setDepartureTime(e.target.value)}
                        />
                        <label htmlFor="departure-zone">Departure time zone (IANA, optional)</label>
                        <input
                          id="departure-zone"
                          disabled={dayReadOnly}
                          value={departureZone}
                          placeholder="Europe/Paris"
                          onChange={(e) => setDepartureZone(e.target.value)}
                        />
                        <label htmlFor="departure-precision">Departure precision</label>
                        <select
                          id="departure-precision"
                          disabled={dayReadOnly}
                          value={departurePrecision}
                          onChange={(e) =>
                            setDeparturePrecision(
                              e.target.value as 'exact' | 'approximate' | 'range' | 'unknown',
                            )
                          }
                        >
                          <option value="unknown">Unknown</option>
                          <option value="approximate">Approximate</option><option value="range" disabled>Range (not editable yet)</option>
                          <option value="exact">Exact</option>
                        </select>
                        <label htmlFor="departure-confidence">Departure certainty</label>
                        <select
                          id="departure-confidence"
                          disabled={dayReadOnly}
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
                          disabled={dayReadOnly}
                          type="date"
                          value={arrivalDate}
                          onChange={(e) => setArrivalDate(e.target.value)}
                        />
                        <label htmlFor="arrival-time">Arrival clock time</label>
                        <input
                          id="arrival-time"
                          disabled={dayReadOnly}
                          type="time"
                          value={arrivalTime}
                          onChange={(e) => setArrivalTime(e.target.value)}
                        />
                        <label htmlFor="arrival-zone">Arrival time zone (IANA, optional)</label>
                        <input
                          id="arrival-zone"
                          disabled={dayReadOnly}
                          value={arrivalZone}
                          placeholder="Asia/Tokyo"
                          onChange={(e) => setArrivalZone(e.target.value)}
                        />
                        <label htmlFor="arrival-precision">Arrival precision</label>
                        <select
                          id="arrival-precision"
                          disabled={dayReadOnly}
                          value={arrivalPrecision}
                          onChange={(e) =>
                            setArrivalPrecision(
                              e.target.value as 'exact' | 'approximate' | 'range' | 'unknown',
                            )
                          }
                        >
                          <option value="unknown">Unknown</option>
                          <option value="approximate">Approximate</option><option value="range" disabled>Range (not editable yet)</option>
                          <option value="exact">Exact</option>
                        </select>
                        <label htmlFor="arrival-confidence">Arrival certainty</label>
                        <select
                          id="arrival-confidence"
                          disabled={dayReadOnly}
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
                      <button disabled={pending || dayReadOnly} onClick={() => void saveLeg()}>
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
                      <details className="visit-place-editor">
                        <summary>Change place</summary>
                        <p>
                          Current place:{' '}
                          <strong>{selectedVisit.placeName ?? 'Unknown place'}</strong>
                        </p>
                        <label htmlFor="visit-place-search">Search an existing Place</label>
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
                      </details>
                      <button
                        onClick={() => void archiveVisit(selectedVisit)}
                        disabled={pending || dayReadOnly}
                      >
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
