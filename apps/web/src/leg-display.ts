import type { LegRow } from './api';

function displayLocalTime(
  label: string,
  date: string | null,
  time: string | null,
  timeZone: string | null,
  confidence: 'confirmed' | 'estimated' | 'unknown',
  precision: 'unspecified' | 'precise' | 'approximate' | 'range',
  rangeEndDate: string | null,
  rangeEndTime: string | null,
): string {
  if (!date && !time) return `${label}: Unknown`;
  const zone = timeZone ? ` (${timeZone})` : '';
  const certainty = confidence === 'unknown' ? ' · certainty unknown' : ` · ${confidence}`;
  let clock = time ? ` ${time.slice(0, 5)}` : ' · clock unknown';
  if (time && precision === 'approximate') clock = ` around ${time.slice(0, 5)}`;
  if (time && precision === 'unspecified') {
    clock = ` ${time.slice(0, 5)} (precision unspecified)`;
  }
  if (time && precision === 'range' && rangeEndDate && rangeEndTime) {
    clock = ` ${time.slice(0, 5)} – ${rangeEndDate} ${rangeEndTime.slice(0, 5)}`;
  }
  return `${label}: ${date ?? 'Date unknown'}${clock}${zone}${certainty}`;
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
      leg.departureTimePrecision ?? 'unspecified',
      leg.departureRangeEndLocalDate ?? null,
      leg.departureRangeEndLocalTime ?? null,
    ),
    displayLocalTime(
      'Arrival',
      leg.arrivalLocalDate,
      leg.arrivalLocalTime,
      leg.arrivalTimeZone,
      leg.arrivalTimeConfidence,
      leg.arrivalTimePrecision ?? 'unspecified',
      leg.arrivalRangeEndLocalDate ?? null,
      leg.arrivalRangeEndLocalTime ?? null,
    ),
  ].join(' · ');
}
