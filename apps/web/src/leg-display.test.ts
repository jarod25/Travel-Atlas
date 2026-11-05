import { describe, expect, it } from 'vitest';
import type { LegRow } from './api';
import { describeLeg, describeLegTimes } from './leg-display';

const leg = {
  transportMode: 'train',
  movementConfidence: 'confirmed',
  geometryConfidence: 'unknown',
  departureLocalDate: '2026-09-12',
  departureLocalTime: '14:30:00',
  departureTimePrecision: 'precise',
  departureRangeEndLocalDate: null,
  departureRangeEndLocalTime: null,
  departureTimeZone: null,
  departureTimeConfidence: 'estimated',
  arrivalLocalDate: '2026-09-13',
  arrivalLocalTime: '00:15:00',
  arrivalTimePrecision: 'precise',
  arrivalRangeEndLocalDate: null,
  arrivalRangeEndLocalTime: null,
  arrivalTimeZone: null,
  arrivalTimeConfidence: 'confirmed',
} as LegRow;

describe('Leg timeline presentation', () => {
  it('displays known times, their certainty, and a midnight crossing without inferring a timezone', () => {
    expect(describeLegTimes(leg)).toBe(
      'Departure: 2026-09-12 14:30 · estimated · Arrival: 2026-09-13 00:15 · confirmed',
    );
  });

  it('shows missing times as unknown and respects a recorded timezone', () => {
    expect(
      describeLegTimes({
        ...leg,
        departureLocalDate: null,
        departureLocalTime: null,
        arrivalTimeZone: 'Asia/Tokyo',
        arrivalTimeConfidence: 'unknown',
      }),
    ).toBe('Departure: Unknown · Arrival: 2026-09-13 00:15 (Asia/Tokyo) · certainty unknown');
  });

  it('distinguishes approximate clocks from a confirmed source and displays ranges over midnight', () => {
    const modified = {
      ...leg,
      departureTimePrecision: 'approximate' as const,
      departureTimeConfidence: 'confirmed' as const,
      arrivalTimePrecision: 'range' as const,
      arrivalRangeEndLocalDate: '2026-09-13',
      arrivalRangeEndLocalTime: '01:30:00',
    };
    expect(describeLegTimes(modified)).toContain('Departure: 2026-09-12 around 14:30 · confirmed');
    expect(describeLegTimes(modified)).toContain('Arrival: 2026-09-13 00:15 – 2026-09-13 01:30');
  });

  it('uses readable labels without changing the stored transport or certainty', () => {
    expect(describeLeg(leg)).toBe('Train · Travel: Confirmed · Route: Unknown');
    expect(leg.transportMode).toBe('train');
  });
});
