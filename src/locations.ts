/**
 * Beobachtungsorte.
 *
 * Koordinaten sind gegen oeffentlich belegte Quellen geprueft:
 *
 * Hamburg   53°33'01"N, 9°59'32"E  (Rathausmarkt 1, Hamburger Rathaus)
 *           = 53.55028 N / 9.99222 E, Hoehe ~8 m ue. NN (Hamburg-Altstadt).
 *           Zeitzone Europe/Berlin (CET = UTC+1, CEST = UTC+2).
 *
 * Waterloo  43°28'N, 80°31'W (Waterloo, Ontario, Kanada)
 *           = 43.46667 N / -80.51667 E, Hoehe 329 m ue. NN.
 *           Zeitzone America/Toronto (EST = UTC-5, EDT = UTC-4).
 *
 * Die Zeitzonen-IDs stammen aus der IANA Time Zone Database; die Umrechnung
 * uebernimmt Temporal (siehe src/time.ts), nicht dieser Code.
 */

export interface LocationSpec {
  readonly id: 'hamburg' | 'waterloo';
  /** Anzeigename in der Oberflaeche. */
  readonly label: string;
  readonly country: string;
  /** Geographische Breite in Grad, noerdlich positiv. */
  readonly latitude: number;
  /** Geographische Laenge in Grad, oestlich positiv. */
  readonly longitude: number;
  /** Hoehe ueber dem Meeresspiegel in Metern. */
  readonly elevation: number;
  /** IANA-Zeitzonen-ID. */
  readonly timeZone: string;
}

export const LOCATIONS: readonly LocationSpec[] = [
  {
    id: 'hamburg',
    label: 'Hamburg',
    country: 'Deutschland',
    latitude: 53.55028,
    longitude: 9.99222,
    elevation: 8,
    timeZone: 'Europe/Berlin'
  },
  {
    id: 'waterloo',
    label: 'Waterloo',
    country: 'Ontario, Kanada',
    latitude: 43.46667,
    longitude: -80.51667,
    elevation: 329,
    timeZone: 'America/Toronto'
  }
];

/** Hamburg ist der Startort. */
export const DEFAULT_LOCATION_ID = 'hamburg';

export function locationById(id: string): LocationSpec {
  const found = LOCATIONS.find((location) => location.id === id);
  if (!found) throw new Error(`Unbekannter Ort: ${id}`);
  return found;
}
