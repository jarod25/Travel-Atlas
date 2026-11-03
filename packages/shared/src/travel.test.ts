import { describe, expect, it } from 'vitest';
import { planDraftLegsForDay, type Visit } from './travel';

const first: Visit = { id: 'visit-1', tripId: 'trip-1', tripDayId: 'day-1', placeId: 'station' };
const second: Visit = { id: 'visit-2', tripId: 'trip-1', tripDayId: 'day-1', placeId: 'shop' };
const third: Visit = { id: 'visit-3', tripId: 'trip-1', tripDayId: 'day-1', placeId: 'station' };

describe('draft leg planning', () => {
  it('creates exactly one unknown leg between each consecutive pair', () => {
    expect(planDraftLegsForDay([first, second, third])).toEqual([
      {
        tripId: 'trip-1',
        fromVisitId: 'visit-1',
        toVisitId: 'visit-2',
        transportMode: null,
        movementConfidence: 'unknown',
        transportConfidence: 'unknown',
        geometryConfidence: 'unknown',
      },
      {
        tripId: 'trip-1',
        fromVisitId: 'visit-2',
        toVisitId: 'visit-3',
        transportMode: null,
        movementConfidence: 'unknown',
        transportConfidence: 'unknown',
        geometryConfidence: 'unknown',
      },
    ]);
  });

  it('does not invent a leg for zero or one visit', () => {
    expect(planDraftLegsForDay([])).toEqual([]);
    expect(planDraftLegsForDay([first])).toEqual([]);
  });

  it('never creates an automatic cross-day leg', () => {
    expect(() => planDraftLegsForDay([first, { ...second, tripDayId: 'day-2' }])).toThrow(
      /different days/,
    );
  });

  it('rejects visits belonging to another trip', () => {
    expect(() => planDraftLegsForDay([first, { ...second, tripId: 'trip-2' }])).toThrow(
      /different trips/,
    );
  });

  it('rejects duplicate visit identifiers, even when a Place is reused', () => {
    expect(() => planDraftLegsForDay([first, first])).toThrow(/duplicate visits/);
    expect(planDraftLegsForDay([first, third])).toHaveLength(1);
  });

  it('allows a visit with an unknown Place and leaves input untouched', () => {
    const input = Object.freeze([first, Object.freeze({ ...second, placeId: null })]);
    expect(planDraftLegsForDay(input)).toHaveLength(1);
    expect(input[1].placeId).toBeNull();
  });
});
