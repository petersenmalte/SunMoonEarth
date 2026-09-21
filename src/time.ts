/**
 * Zeitmodell.
 *
 * Alle Zeitzonen- und Sommerzeit-Rechnungen laufen ueber Temporal
 * (@js-temporal/polyfill, TC39-Vorschlag Stage 3). Dieses Modul enthaelt
 * keine eigene Zeitzonen-Arithmetik: Temporal kennt die IANA-Datenbank und
 * loest Sommerzeit-Uebergaenge ueber die Option `disambiguation` auf.
 */

import { Temporal } from '@js-temporal/polyfill';

/** Wie eine eingegebene Ortszeit auf einen Zeitpunkt abgebildet wurde. */
export type ResolutionKind = 'eindeutig' | 'doppeldeutig' | 'nicht-existent';

export interface ResolvedLocalTime {
  readonly instant: Temporal.Instant;
  readonly zoned: Temporal.ZonedDateTime;
  readonly kind: ResolutionKind;
  /**
   * Bei 'doppeldeutig' die beiden moeglichen Zeitpunkte (frueher/spaeter),
   * sonst undefined.
   */
  readonly alternatives?: {
    readonly earlier: Temporal.ZonedDateTime;
    readonly later: Temporal.ZonedDateTime;
  };
}

/**
 * Bildet eine lokale Wanduhrzeit auf einen absoluten Zeitpunkt ab und macht
 * Sommerzeit-Sonderfaelle explizit sichtbar.
 *
 * - Normalfall: genau ein Zeitpunkt.
 * - Rueckstellung (Herbst): die Wanduhrzeit existiert zweimal. Temporal liefert
 *   mit 'earlier' bzw. 'later' beide Zeitpunkte; `preference` waehlt einen aus.
 * - Vorstellung (Fruehjahr): die Wanduhrzeit existiert nicht. Temporal
 *   verschiebt sie mit 'compatible' um die Laenge der Luecke nach vorn.
 *
 * Unterschieden werden die beiden Faelle daran, ob die von Temporal gelieferte
 * Zeit die eingegebene Wanduhrzeit noch traegt: bei einer Luecke tut sie das
 * nicht.
 */
export function resolveLocalTime(
  local: Temporal.PlainDateTime,
  timeZone: string,
  preference: 'earlier' | 'later' = 'earlier'
): ResolvedLocalTime {
  try {
    const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'reject' });
    return { instant: zoned.toInstant(), zoned, kind: 'eindeutig' };
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
      kind: 'doppeldeutig',
      alternatives: { earlier, later }
    };
  }

  const shifted = local.toZonedDateTime(timeZone, { disambiguation: 'compatible' });
  return { instant: shifted.toInstant(), zoned: shifted, kind: 'nicht-existent' };
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

/** Datum und Uhrzeit eines Zeitpunkts in der Zeitzone des Ortes. */
export function formatDateTimeParts(
  instant: Temporal.Instant,
  timeZone: string
): { date: string; time: string; zone: string; offset: string } {
  const zoned = zonedAt(instant, timeZone);
  const date = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).format(new Date(instant.epochMilliseconds));
  const time = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone,
    hour12: false
  }).format(new Date(instant.epochMilliseconds));
  const zoneName =
    new Intl.DateTimeFormat('de-DE', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(instant.epochMilliseconds))
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  return { date, time, zone: zoneName, offset: zoned.offset };
}

/** Wert fuer ein <input type="datetime-local"> in der Zeitzone des Ortes. */
export function toDateTimeLocalValue(instant: Temporal.Instant, timeZone: string): string {
  const zoned = zonedAt(instant, timeZone);
  return zoned.toPlainDateTime().toString({ smallestUnit: 'minute' });
}

/** Liest einen <input type="datetime-local">-Wert als lokale Wanduhrzeit. */
export function parseDateTimeLocalValue(value: string): Temporal.PlainDateTime | null {
  if (!value) return null;
  try {
    return Temporal.PlainDateTime.from(value);
  } catch {
    return null;
  }
}

export { Temporal };
