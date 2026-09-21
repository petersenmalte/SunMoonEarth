/**
 * Observer locations.
 *
 * Coordinates are checked against publicly documented sources:
 *
 * Hamburg   53°33'01"N, 9°59'32"E  (Rathausmarkt 1, Hamburg City Hall)
 *           = 53.55028 N / 9.99222 E, elevation ~8 m above sea level
 *           (Hamburg-Altstadt). Time zone Europe/Berlin (CET = UTC+1,
 *           CEST = UTC+2).
 *
 * Waterloo  43°28'N, 80°31'W (Waterloo, Ontario, Canada)
 *           = 43.46667 N / -80.51667 E, elevation 329 m above sea level.
 *           Time zone America/Toronto (EST = UTC-5, EDT = UTC-4).
 *
 * The time zone IDs come from the IANA Time Zone Database; the conversion
 * itself is handled by Temporal (see src/time.ts), not by this code.
 */

export interface LocationSpec {
  readonly id: 'hamburg' | 'waterloo';
  /** Display name in the UI. */
  readonly label: string;
  readonly country: string;
  /** Geographic latitude in degrees, positive north. */
  readonly latitude: number;
  /** Geographic longitude in degrees, positive east. */
  readonly longitude: number;
  /** Elevation above sea level in meters. */
  readonly elevation: number;
  /** IANA time zone ID. */
  readonly timeZone: string;
}

export const LOCATIONS: readonly LocationSpec[] = [
  {
    id: 'hamburg',
    label: 'Hamburg',
    country: 'Germany',
    latitude: 53.55028,
    longitude: 9.99222,
    elevation: 8,
    timeZone: 'Europe/Berlin'
  },
  {
    id: 'waterloo',
    label: 'Waterloo',
    country: 'Ontario, Canada',
    latitude: 43.46667,
    longitude: -80.51667,
    elevation: 329,
    timeZone: 'America/Toronto'
  }
];

/** Hamburg is the starting location. */
export const DEFAULT_LOCATION_ID = 'hamburg';

export function locationById(id: string): LocationSpec {
  const found = LOCATIONS.find((location) => location.id === id);
  if (!found) throw new Error(`Unknown location: ${id}`);
  return found;
}
