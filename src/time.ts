/**
 * Time model.
 *
 * All time zone and daylight saving calculations go through Temporal
 * (@js-temporal/polyfill, TC39 proposal, Stage 3). This module contains no
 * time zone arithmetic of its own: Temporal knows the IANA database and
 * resolves daylight saving transitions via the `disambiguation` option.
 */

import { Temporal } from '@js-temporal/polyfill';

/** How an entered local time was mapped to an instant. */
export type ResolutionKind = 'unambiguous' | 'ambiguous' | 'nonexistent';

export interface ResolvedLocalTime {
  readonly instant: Temporal.Instant;
  readonly zoned: Temporal.ZonedDateTime;
  readonly kind: ResolutionKind;
  /**
   * For 'ambiguous', the two possible instants (earlier/later); otherwise
   * undefined.
   */
  readonly alternatives?: {
    readonly earlier: Temporal.ZonedDateTime;
    readonly later: Temporal.ZonedDateTime;
  };
}

/**
 * Maps a local wall-clock time to an absolute instant and makes daylight
 * saving edge cases explicit.
 *
 * - Normal case: exactly one instant.
 * - Fall back: the wall-clock time exists twice. Temporal returns both
 *   instants via 'earlier' and 'later'; `preference` picks one.
 * - Spring forward: the wall-clock time does not exist. Temporal shifts it
 *   forward by the length of the gap using 'compatible'.
 *
 * The two cases are told apart by whether the time Temporal returns still
 * carries the entered wall-clock time: for a gap it does not.
 */
export function resolveLocalTime(
  local: Temporal.PlainDateTime,
  timeZone: string,
  preference: 'earlier' | 'later' = 'earlier'
): ResolvedLocalTime {
  try {
    const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'reject' });
    return { instant: zoned.toInstant(), zoned, kind: 'unambiguous' };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }

  const earlier = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  const later = local.toZonedDateTime(timeZone, { disambiguation: 'later' });

  if (earlier.toPlainDateTime().equals(local)) {
    const chosen = preference === 'later' ? later : earlier;
    return {
      instant: chosen.toInstant(),
      zoned: chosen,
      kind: 'ambiguous',
      alternatives: { earlier, later }
    };
  }

  const shifted = local.toZonedDateTime(timeZone, { disambiguation: 'compatible' });
  return { instant: shifted.toInstant(), zoned: shifted, kind: 'nonexistent' };
}

export function nowInstant(): Temporal.Instant {
  return Temporal.Now.instant();
}

export function zonedAt(instant: Temporal.Instant, timeZone: string): Temporal.ZonedDateTime {
  return instant.toZonedDateTimeISO(timeZone);
}

export function instantToDate(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

/** Date and time of an instant in the location's time zone. */
export function formatDateTimeParts(
  instant: Temporal.Instant,
  timeZone: string
): { date: string; time: string; zone: string; offset: string } {
  const zoned = zonedAt(instant, timeZone);
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).format(new Date(instant.epochMilliseconds));
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone,
    hour12: false
  }).format(new Date(instant.epochMilliseconds));
  const zoneName =
    new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(instant.epochMilliseconds))
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  return { date, time, zone: zoneName, offset: zoned.offset };
}

/** Value for an <input type="datetime-local"> in the location's time zone. */
export function toDateTimeLocalValue(instant: Temporal.Instant, timeZone: string): string {
  const zoned = zonedAt(instant, timeZone);
  return zoned.toPlainDateTime().toString({ smallestUnit: 'minute' });
}

/** Reads an <input type="datetime-local"> value as a local wall-clock time. */
export function parseDateTimeLocalValue(value: string): Temporal.PlainDateTime | null {
  if (!value) return null;
  try {
    return Temporal.PlainDateTime.from(value);
  } catch {
    return null;
  }
}

export { Temporal };
