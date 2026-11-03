import type { ConfidenceLevel, TransportMode } from './index';

/**
 * Identifiers here are supplied by persistence. These contracts do not create
 * database records, synthesize coordinates, or infer unobserved travel.
 */
export interface Trip {
  readonly id: string;
  readonly title: string;
}

export interface TripDay {
  readonly id: string;
  readonly tripId: string;
  /** Optional calendar date in the trip's local context, not an inferred UTC instant. */
  readonly localDate: string | null;
  readonly order: number;
}

export interface Place {
  readonly id: string;
  readonly name: string | null;
  /** Unknown coordinates are represented by null, never by (0, 0). */
  readonly geometry: {
    readonly type: 'Point';
    readonly coordinates: readonly [longitude: number, latitude: number];
  } | null;
}

export interface Visit {
  readonly id: string;
  readonly tripId: string;
  readonly tripDayId: string;
  readonly placeId: string | null;
}

/**
 * An unpersisted draft connecting adjacent visits supplied in timeline order.
 * The application will assign an ID and persist it atomically in a later layer.
 */
export interface DraftLegPlan {
  readonly tripId: string;
  readonly fromVisitId: string;
  readonly toVisitId: string;
  readonly transportMode: null;
  readonly movementConfidence: 'unknown';
  readonly transportConfidence: 'unknown';
  readonly geometryConfidence: 'unknown';
}

/**
 * Creates a plan for adjacent visits in ONE day. The order of the input
 * determines adjacency. No leg is ever generated across day boundaries.
 *
 * This is a pure planning function; a database transaction must apply the
 * resulting changes together when visits are created/reordered.
 */
export function planDraftLegsForDay(visits: readonly Visit[]): DraftLegPlan[] {
  if (visits.length < 2) {
    return [];
  }

  const { tripId, tripDayId } = visits[0];
  const seen = new Set<string>();

  for (const visit of visits) {
    if (!visit.id || !visit.tripId || !visit.tripDayId) {
      throw new Error('Visit identifiers must be non-empty');
    }
    if (visit.tripId !== tripId) {
      throw new Error('Cannot create automatic legs between different trips');
    }
    if (visit.tripDayId !== tripDayId) {
      throw new Error('Cannot create automatic legs across different days');
    }
    if (seen.has(visit.id)) {
      throw new Error('Cannot create automatic legs from duplicate visits');
    }
    seen.add(visit.id);
  }

  return visits.slice(1).map((to, index) => ({
    tripId,
    fromVisitId: visits[index].id,
    toVisitId: to.id,
    transportMode: null,
    movementConfidence: 'unknown',
    transportConfidence: 'unknown',
    geometryConfidence: 'unknown',
  }));
}

/**
 * Keep confidence attributes independent: an evidenced transport mode
 * never upgrades an unknown or estimated geometry.
 */
export interface LegProvenance {
  readonly movement: ConfidenceLevel;
  readonly transport: ConfidenceLevel;
  readonly geometry: ConfidenceLevel;
  readonly departureTime: ConfidenceLevel;
  readonly arrivalTime: ConfidenceLevel;
  readonly transportMode: TransportMode | null;
}
