import { describe, expect, it } from 'vitest';
import { resolveTripPeriod } from './trip-period';

const dates = {
  manualStartDate: null,
  manualEndDate: null,
  computedStartDate: '2026-09-11',
  computedEndDate: '2026-09-14',
};

describe('Trip period presentation', () => {
  it('uses calculated descendant bounds without changing them', () => {
    expect(resolveTripPeriod(dates)).toEqual({
      start: '2026-09-11',
      end: '2026-09-14',
      isConflicting: false,
    });
  });

  it('uses a manual start when the resulting interval remains valid', () => {
    expect(resolveTripPeriod({ ...dates, manualStartDate: '2026-09-12' })).toEqual({
      start: '2026-09-12',
      end: '2026-09-14',
      isConflicting: false,
    });
  });

  it('detects an inverted interval after a descendant day moves earlier', () => {
    expect(
      resolveTripPeriod({
        ...dates,
        manualStartDate: '2026-09-14',
        computedStartDate: '2026-09-10',
        computedEndDate: '2026-09-13',
      }),
    ).toEqual({
      start: '2026-09-14',
      end: '2026-09-13',
      isConflicting: true,
    });
  });

  it('detects a manual end earlier than the calculated start', () => {
    expect(resolveTripPeriod({ ...dates, manualEndDate: '2026-09-10' }).isConflicting).toBe(
      true,
    );
  });

  it('returns to calculated bounds when the override is removed', () => {
    const conflict = resolveTripPeriod({
      ...dates,
      manualStartDate: '2026-09-14',
      computedEndDate: '2026-09-13',
    });
    expect(conflict.isConflicting).toBe(true);
    const cleared = resolveTripPeriod({ ...dates, computedEndDate: '2026-09-13' });
    expect(cleared).toEqual({
      start: '2026-09-11',
      end: '2026-09-13',
      isConflicting: false,
    });
  });

  it('keeps completely unknown periods unknown', () => {
    expect(
      resolveTripPeriod({
        manualStartDate: null,
        manualEndDate: null,
        computedStartDate: null,
        computedEndDate: null,
      }),
    ).toEqual({ start: null, end: null, isConflicting: false });
  });

  it('does not invent the missing end of a partially known period', () => {
    expect(
      resolveTripPeriod({
        manualStartDate: '2026-09-10',
        manualEndDate: null,
        computedStartDate: null,
        computedEndDate: null,
      }),
    ).toEqual({ start: '2026-09-10', end: null, isConflicting: false });
  });
});
