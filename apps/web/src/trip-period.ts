import type { Trip } from './api';

type TripDateFields = Pick<
  Trip,
  'manualStartDate' | 'manualEndDate' | 'computedStartDate' | 'computedEndDate'
>;

export function resolveTripPeriod(trip: TripDateFields) {
  const start = trip.manualStartDate ?? trip.computedStartDate;
  const end = trip.manualEndDate ?? trip.computedEndDate;
  return {
    start,
    end,
    isConflicting: start !== null && end !== null && start > end,
  };
}
