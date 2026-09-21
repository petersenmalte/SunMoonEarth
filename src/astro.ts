/**
 * Astronomische Groessen.
 *
 * Saemtliche Positionen, Winkel, Phasen und Beleuchtungsgrade stammen aus
 * Astronomy Engine (https://github.com/cosinekitty/astronomy, MIT). Dieses
 * Modul ruft die Bibliothek auf und bringt ihre Ergebnisse in die Form, die
 * die Szenen brauchen. Es enthaelt keine eigenen astronomischen Algorithmen.
 *
 * Konventionen laut Astronomy-Engine-Dokumentation:
 *  - Observer(latitude, longitude, height): Grad, Grad, Meter.
 *  - Equator(body, date, observer, ofdate, aberration): ofdate = true liefert
 *    Koordinaten des Datums, wie sie Horizon() erwartet.
 *  - Horizon(date, observer, ra, dec, refraction): azimuth in Grad im
 *    Uhrzeigersinn ab Nord (Ost = 90), altitude in Grad ueber dem Horizont.
 *  - HOR-System: x = Nord, y = West, z = Zenit.
 *  - EQJ-System: x = Fruehlingspunkt J2000, z = Himmelsnordpol J2000.
 *  - GeoVector / GeoMoon / ObserverVector: Vektoren in AE (astronomische
 *    Einheiten), geozentrisch.
 *  - Illumination(body, date).phase_fraction: beleuchteter Anteil 0..1.
 *  - MoonPhase(date): 0 = Neumond, 90 = zunehmendes, 180 = Vollmond,
 *    270 = abnehmendes Halb (Differenz der ekliptikalen Laengen).
 */

import {
  AngleFromSun,
  Body,
  Equator,
  GeoMoon,
  GeoVector,
  Horizon,
  Illumination,
  KM_PER_AU,
  MakeTime,
  MoonPhase,
  Observer,
  ObserverVector,
  RotateVector,
  Rotation_EQJ_HOR,
  Rotation_HOR_EQJ,
  RotationAxis,
  SearchRiseSet,
  Vector
} from 'astronomy-engine';
import type { LocationSpec } from './locations';

/** Einfacher 3D-Vektor fuer den Austausch mit den Szenen. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BodyView {
  /** Azimut in Grad, im Uhrzeigersinn ab Nord (Ost = 90). */
  readonly azimuth: number;
  /** Hoehe ueber dem Horizont in Grad, mit Refraktionskorrektur. */
  readonly altitude: number;
  /** Rektaszension in Stunden, Koordinaten des Datums. */
  readonly rightAscension: number;
  /** Deklination in Grad, Koordinaten des Datums. */
  readonly declination: number;
  /** Entfernung in Kilometern. */
  readonly distanceKm: number;
  /** Einheitsvektor im HOR-System (x = Nord, y = West, z = Zenit). */
  readonly horizonUnit: Vec3;
  readonly aboveHorizon: boolean;
}

export interface MoonPhaseInfo {
  /** Beleuchteter Anteil der sichtbaren Mondscheibe, 0..1. */
  readonly illuminatedFraction: number;
  /** Phasenwinkel Sonne-Mond-Erde in Grad (0 = Vollmond, 180 = Neumond). */
  readonly phaseAngle: number;
  /** Phase als Differenz der ekliptikalen Laengen in Grad, 0..360. */
  readonly phaseLongitude: number;
  /** Elongation Sonne-Erde-Mond in Grad. */
  readonly elongation: number;
  readonly waxing: boolean;
  /** Deutscher Phasenname. */
  readonly name: string;
}

export interface GeocentricView {
  /** Einheitsvektor Erde -> Sonne im EQJ-System. */
  readonly sunUnit: Vec3;
  /** Einheitsvektor Erde -> Mond im EQJ-System. */
  readonly moonUnit: Vec3;
  /** Einheitsvektor Mond -> Sonne im EQJ-System (bestimmt die Mondbeleuchtung). */
  readonly moonToSunUnit: Vec3;
  /** Einheitsvektor entlang der Erdrotationsachse (Nordpol) im EQJ-System. */
  readonly earthNorthUnit: Vec3;
  readonly sunDistanceKm: number;
  readonly moonDistanceKm: number;
}

export interface RiseSetInfo {
  readonly rise: Date | null;
  readonly set: Date | null;
}

export interface AstroState {
  readonly date: Date;
  readonly location: LocationSpec;
  readonly sun: BodyView;
  readonly moon: BodyView;
  readonly phase: MoonPhaseInfo;
  readonly geo: GeocentricView;
  /** Einheitsvektor Erdmittelpunkt -> Beobachter im EQJ-System (Ortsvektor). */
  readonly observerUnit: Vec3;
  /**
   * Lokaler Zenit des Beobachters als Einheitsvektor im EQJ-System.
   * Auf dem abgeplatteten Erdkoerper weicht er um bis zu ~0,2 Grad vom
   * Ortsvektor ab; die Drehung liefert Astronomy Engine.
   */
  readonly observerZenithUnit: Vec3;
  /** Einheitsvektoren aller Orte im EQJ-System, nach Orts-ID. */
  readonly siteUnits: ReadonlyMap<string, Vec3>;
  readonly sunRiseSet: RiseSetInfo;
  readonly moonRiseSet: RiseSetInfo;
}

export function makeObserver(location: LocationSpec): Observer {
  return new Observer(location.latitude, location.longitude, location.elevation);
}

function toVec3(v: Vector): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * Einheitsvektor aus Azimut und Hoehe im HOR-System.
 * Reine Zeichen-Geometrie: Kugel- in kartesische Koordinaten, mit
 * x = Nord, y = West, z = Zenit und Azimut im Uhrzeigersinn ab Nord.
 */
function horizonUnitVector(azimuthDeg: number, altitudeDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  const cosAlt = Math.cos(alt);
  return {
    x: cosAlt * Math.cos(az),
    y: -cosAlt * Math.sin(az),
    z: Math.sin(alt)
  };
}

function bodyView(body: Body, date: Date, observer: Observer): BodyView {
  // ofdate = true und aberration = true liefern die scheinbaren Koordinaten,
  // die Horizon() laut Dokumentation erwartet.
  const equatorial = Equator(body, date, observer, true, true);
  const horizontal = Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal');
  return {
    azimuth: horizontal.azimuth,
    altitude: horizontal.altitude,
    rightAscension: equatorial.ra,
    declination: equatorial.dec,
    distanceKm: equatorial.dist * KM_PER_AU,
    horizonUnit: horizonUnitVector(horizontal.azimuth, horizontal.altitude),
    aboveHorizon: horizontal.altitude > 0
  };
}

/**
 * Deutscher Phasenname aus den Bibliothekswerten.
 * phaseLongitude ist die von MoonPhase() gelieferte Laengendifferenz.
 */
function phaseName(phaseLongitude: number, fraction: number): string {
  const percent = fraction * 100;
  if (percent < 1) return 'Neumond';
  if (percent > 99) return 'Vollmond';
  const waxing = phaseLongitude < 180;
  if (Math.abs(percent - 50) <= 2) return waxing ? 'Erstes Viertel' : 'Letztes Viertel';
  if (percent < 50) return waxing ? 'Zunehmende Sichel' : 'Abnehmende Sichel';
  return waxing ? 'Zunehmender Mond' : 'Abnehmender Mond';
}

function riseSet(body: Body, date: Date, observer: Observer): RiseSetInfo {
  // SearchRiseSet(body, observer, direction, dateStart, limitDays):
  // direction +1 = Aufgang, -1 = Untergang.
  const rise = SearchRiseSet(body, observer, +1, date, 1);
  const set = SearchRiseSet(body, observer, -1, date, 1);
  return { rise: rise ? rise.date : null, set: set ? set.date : null };
}

export function computeAstroState(
  date: Date,
  location: LocationSpec,
  allLocations: readonly LocationSpec[]
): AstroState {
  const observer = makeObserver(location);

  const sun = bodyView(Body.Sun, date, observer);
  const moon = bodyView(Body.Moon, date, observer);

  const illumination = Illumination(Body.Moon, date);
  const phaseLongitude = MoonPhase(date);
  const elongation = AngleFromSun(Body.Moon, date);

  const phase: MoonPhaseInfo = {
    illuminatedFraction: illumination.phase_fraction,
    phaseAngle: illumination.phase_angle,
    phaseLongitude,
    elongation,
    waxing: phaseLongitude < 180,
    name: phaseName(phaseLongitude, illumination.phase_fraction)
  };

  // Geozentrische Vektoren in AE, EQJ-Orientierung.
  const sunVector = GeoVector(Body.Sun, date, false);
  const moonVector = GeoMoon(date);
  const moonToSun: Vec3 = {
    x: sunVector.x - moonVector.x,
    y: sunVector.y - moonVector.y,
    z: sunVector.z - moonVector.z
  };

  const geo: GeocentricView = {
    sunUnit: normalize(toVec3(sunVector)),
    moonUnit: normalize(toVec3(moonVector)),
    moonToSunUnit: normalize(moonToSun),
    earthNorthUnit: normalize(toVec3(RotationAxis(Body.Earth, date).north)),
    sunDistanceKm: Math.hypot(sunVector.x, sunVector.y, sunVector.z) * KM_PER_AU,
    moonDistanceKm: Math.hypot(moonVector.x, moonVector.y, moonVector.z) * KM_PER_AU
  };

  const siteUnits = new Map<string, Vec3>();
  for (const site of allLocations) {
    siteUnits.set(site.id, normalize(toVec3(ObserverVector(date, makeObserver(site), false))));
  }

  return {
    date,
    location,
    sun,
    moon,
    phase,
    geo,
    observerUnit: siteUnits.get(location.id) ?? { x: 0, y: 0, z: 1 },
    observerZenithUnit: zenithInEqj(date, location),
    siteUnits,
    sunRiseSet: riseSet(Body.Sun, date, observer),
    moonRiseSet: riseSet(Body.Moon, date, observer)
  };
}

/**
 * Lokaler Zenit des Beobachters, ausgedrueckt im EQJ-System.
 * Die Drehung HOR -> EQJ stammt aus Astronomy Engine.
 */
export function zenithInEqj(date: Date, location: LocationSpec): Vec3 {
  const rotation = Rotation_HOR_EQJ(date, makeObserver(location));
  const rotated = RotateVector(rotation, new Vector(0, 0, 1, MakeTime(date)));
  return normalize(toVec3(rotated));
}

/**
 * Richtung Mond -> Sonne, ausgedrueckt im HOR-System des Beobachters.
 * Die Drehung EQJ -> HOR liefert Astronomy Engine; hier wird nichts gerechnet
 * ausser der Anwendung der Matrix auf den Einheitsvektor.
 */
export function moonToSunInHorizonFrame(date: Date, location: LocationSpec, moonToSunUnit: Vec3): Vec3 {
  const rotation = Rotation_EQJ_HOR(date, makeObserver(location));
  const time = MakeTime(date);
  const rotated = RotateVector(
    rotation,
    new Vector(moonToSunUnit.x, moonToSunUnit.y, moonToSunUnit.z, time)
  );
  return normalize(toVec3(rotated));
}

export { Body, KM_PER_AU };
