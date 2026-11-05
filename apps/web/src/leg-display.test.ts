import { describe, expect, it } from 'vitest';
import type { LegRow } from './api';
import { describeLeg, describeLegTimes } from './leg-display';

const leg = {
  transportMode: 'train',
  movementConfidence: 'confirmed',
  geometryConfidence: 'unknown',
  departureLocalDate: '2026-09-12',
  departureLocalTime: '14:30:00',
  departureTimeZone: null,
  departureTimeConfidence: 'estimated',
  arrivalLocalDate: '2026-09-13',
  arrivalLocalTime: '00:15:00',
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
    ).toBe(
      'Departure: Unknown · Arrival: 2026-09-13 00:15 (Asia/Tokyo) · certainty unknown',
    );
  });

  it('uses readable labels without changing the stored transport or certainty', () => {
    expect(describeLeg(leg)).toBe('Train · confirmed travel · Route unknown');
    expect(leg.transportMode).toBe('train');
  });
});
