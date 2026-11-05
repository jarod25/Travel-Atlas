import type { LegRow } from './api';

/** Resolve a local clock against an IANA zone without inventing a DST offset.
 * A gap yields no instants; an overlap yields more than one. */
export function matchingInstants(
  date: string | null,
  time: string | null,
  zone: string | null,
): number[] {
  if (!date || !time || !zone) return [];
  const input = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(date);
  const clock = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?/.exec(time);
  if (!input || !clock) return [];
  const [year, month, day] = input.slice(1).map(Number);
  const [hour, minute, second] = clock.slice(1).map((item) => Number(item ?? 0));
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return [];
  }
  const localParts = (instant: number) => {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    return [values.year, values.month, values.day, values.hour, values.minute, values.second];
  };
  const desired = [year, month, day, hour, minute, second];
  const matches = new Set<number>();
  // Sampling nearby offsets handles daylight-saving transitions without using
  // the browser's own timezone or choosing an earlier/later instant implicitly.
  for (let hours = -36; hours <= 36; hours += 3) {
    const sample = guess + hours * 3_600_000;
    const sampleParts = localParts(sample);
    const sampleUtc = Date.UTC(
      sampleParts[0],
      sampleParts[1] - 1,
      sampleParts[2],
      sampleParts[3],
      sampleParts[4],
      sampleParts[5],
    );
    const candidate = guess - (sampleUtc - sample);
    if (localParts(candidate).every((value, index) => value === desired[index]))
      matches.add(candidate);
  }
  return [...matches].sort((a, b) => a - b);
}

export function describeLegDuration(leg: LegRow): string {
  if (leg.departureTimePrecision === 'range' || leg.arrivalTimePrecision === 'range') {
    return 'Duration unknown: a time range does not identify one instant.';
  }
  if (
    !leg.departureLocalDate ||
    !leg.arrivalLocalDate ||
    !leg.departureLocalTime ||
    !leg.arrivalLocalTime ||
    !leg.departureTimeZone ||
    !leg.arrivalTimeZone
  ) {
    return 'Duration unknown: both local dates, times and time zones are needed.';
  }
  const departure = matchingInstants(
    leg.departureLocalDate,
    leg.departureLocalTime,
    leg.departureTimeZone,
  );
  const arrival = matchingInstants(leg.arrivalLocalDate, leg.arrivalLocalTime, leg.arrivalTimeZone);
  if (departure.length !== 1 || arrival.length !== 1) {
    return 'Duration unknown: a local time is nonexistent or ambiguous (DST).';
  }
  const minutes = Math.round((arrival[0] - departure[0]) / 60000);
  if (minutes < 0) return 'Duration unknown: arrival precedes departure in real time.';
  const hours = Math.floor(minutes / 60);
  const part = minutes % 60;
  const prefix =
    leg.departureTimePrecision === 'exact' && leg.arrivalTimePrecision === 'exact'
      ? 'Calculated duration'
      : 'Nominal duration from approximate clocks';
  return `${prefix}: ${hours}h ${String(part).padStart(2, '0')}m (time-zone aware; travel evidence separate)`;
}
