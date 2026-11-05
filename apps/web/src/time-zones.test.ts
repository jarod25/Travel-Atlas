import { describe, expect, it } from 'vitest';
import { matchingInstants, describeLegDuration } from './time-zones';
import type { LegRow } from './api';

describe('local IANA time conversion without fabricated offsets', () => {
  it('calculates Paris to Tokyo flight duration using the endpoint zones', () => {
    const flight = {
      departureLocalDate: '2026-09-12', departureLocalTime: '20:00:00',
      departureTimeZone: 'Europe/Paris', departureTimePrecision: 'exact',
      arrivalLocalDate: '2026-09-13', arrivalLocalTime: '16:00:00',
      arrivalTimeZone: 'Asia/Tokyo', arrivalTimePrecision: 'exact',
    } as LegRow;
    expect(describeLegDuration(flight)).toContain('13h 00m');
  });
  it('does not choose an ambiguous fall-back instant', () => {
    expect(matchingInstants('2026-10-25','02:30:00','Europe/Paris')).toHaveLength(2);
  });
  it('does not invent a spring-forward instant', () => {
    expect(matchingInstants('2026-03-29','02:30:00','Europe/Paris')).toHaveLength(0);
  });
  it('does not convert times without a timezone', () => {
    expect(matchingInstants('2026-09-12','14:00:00',null)).toEqual([]);
  });
});
