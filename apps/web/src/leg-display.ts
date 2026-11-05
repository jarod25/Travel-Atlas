import type { LegRow } from './api';

function displayLocalTime(
  label: string,
  date: string | null,
  time: string | null,
  timeZone: string | null,
  confidence: 'confirmed' | 'estimated' | 'unknown',
): string {
  if (!date && !time) return `${label}: Unknown`;
  const clock = time ? ` ${time.slice(0, 5)}` : '';
  const zone = timeZone ? ` (${timeZone})` : '';
  const certainty = confidence === 'unknown' ? ' · certainty unknown' : ` · ${confidence}`;
  return `${label}: ${date ?? 'Date unknown'}${clock}${zone}${certainty}`;
}

export function describeLeg(leg: LegRow | undefined): string {
  if (!leg) return 'No connected travel leg';
  const transport = leg.transportMode
    ? leg.transportMode.charAt(0).toUpperCase() + leg.transportMode.slice(1)
    : 'Transport unknown';
  const movement = leg.movementConfidence === 'unknown'
    ? 'Travel unknown'
    : `${leg.movementConfidence} travel`;
  const geometry = leg.geometryConfidence === 'unknown'
    ? 'Route unknown'
    : `${leg.geometryConfidence} route`;
  return `${transport} · ${movement} · ${geometry}`;
}

export function describeLegTimes(leg: LegRow): string {
  return [
    displayLocalTime(
      'Departure',
      leg.departureLocalDate,
      leg.departureLocalTime,
      leg.departureTimeZone,
      leg.departureTimeConfidence,
    ),
    displayLocalTime(
      'Arrival',
      leg.arrivalLocalDate,
      leg.arrivalLocalTime,
      leg.arrivalTimeZone,
      leg.arrivalTimeConfidence,
    ),
  ].join(' · ');
}
