import type { LegRow } from './api';

function displayLocalTime(
  label: string,
  date: string | null,
  time: string | null,
  timeZone: string | null,
  confidence: 'confirmed' | 'estimated' | 'unknown',
  precision: 'exact' | 'approximate' | 'range' | 'unknown',
  rangeStart: string | null,
  rangeEnd: string | null,
): string {
  if (precision === 'range' && rangeStart && rangeEnd) {
    const zoneLabel = timeZone ? ` (${timeZone})` : '';
    return `${label}: between ${rangeStart.replace('T', ' ').slice(0, 16)} and ${rangeEnd.replace('T', ' ').slice(0, 16)}${zoneLabel} · ${confidence}`;
  }
  if (!date && !time) return `${label}: Unknown`;
  const clock = time ? ` ${time.slice(0, 5)}` : '';
  const zone = timeZone ? ` (${timeZone})` : '';
  const certainty = confidence === 'unknown' ? ' · certainty unknown' : ` · ${confidence}`;
  return `${label}: ${date ?? 'Date unknown'}${clock}${zone} · precision ${precision}${certainty}`;
}

export function describeLeg(leg: LegRow | undefined): string {
  if (!leg) return 'No connected travel leg';
  const transport = leg.transportMode
    ? leg.transportMode.charAt(0).toUpperCase() + leg.transportMode.slice(1)
    : 'Transport unknown';
  const movement = leg.movementConfidence;
  const geometry = leg.geometryConfidence;
  const travelLabel = movement.charAt(0).toUpperCase() + movement.slice(1);
  const routeLabel = geometry.charAt(0).toUpperCase() + geometry.slice(1);
  return `${transport} · Travel: ${travelLabel} · Route: ${routeLabel}`;
}

export function describeLegTimes(leg: LegRow): string {
  return [
    displayLocalTime(
      'Departure',
      leg.departureLocalDate,
      leg.departureLocalTime,
      leg.departureTimeZone,
      leg.departureTimeConfidence,
      leg.departureTimePrecision,
      leg.departureRangeStart,
      leg.departureRangeEnd,
    ),
    displayLocalTime(
      'Arrival',
      leg.arrivalLocalDate,
      leg.arrivalLocalTime,
      leg.arrivalTimeZone,
      leg.arrivalTimeConfidence,
      leg.arrivalTimePrecision,
      leg.arrivalRangeStart,
      leg.arrivalRangeEnd,
    ),
  ].join(' · ');
}
