/**
 * Astronomical quantities.
 *
 * All positions, angles, phases and illumination fractions come from
 * Astronomy Engine (https://github.com/cosinekitty/astronomy, MIT). This
 * module calls the library and shapes its results for what the scenes need.
 * It contains no astronomical algorithms of its own.
 *
 * Conventions per the Astronomy Engine documentation:
 *  - Observer(latitude, longitude, height): degrees, degrees, meters.
 *  - Equator(body, date, observer, ofdate, aberration): ofdate = true
 *    returns coordinates of date, as expected by Horizon().
 *  - Horizon(date, observer, ra, dec, refraction): azimuth in degrees
 *    clockwise from north (east = 90), altitude in degrees above the
 *    horizon.
 *  - HOR system: x = north, y = west, z = zenith.
 *  - EQJ system: x = J2000 vernal equinox, z = J2000 celestial north pole.
 *  - GeoVector / GeoMoon / ObserverVector: vectors in AU (astronomical
 *    units), geocentric.
 *  - Illumination(body, date).phase_fraction: illuminated fraction, 0..1.
 *  - MoonPhase(date): 0 = new moon, 90 = first quarter, 180 = full moon,
 *    270 = last quarter (difference of ecliptic longitudes).
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

/** Simple 3D vector for exchange with the scenes. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BodyView {
  /** Azimuth in degrees, clockwise from north (east = 90). */
  readonly azimuth: number;
  /** Altitude above the horizon in degrees, with refraction correction. */
  readonly altitude: number;
  /** Right ascension in hours, coordinates of date. */
  readonly rightAscension: number;
  /** Declination in degrees, coordinates of date. */
  readonly declination: number;
  /** Distance in kilometers. */
  readonly distanceKm: number;
  /** Unit vector in the HOR system (x = north, y = west, z = zenith). */
  readonly horizonUnit: Vec3;
  readonly aboveHorizon: boolean;
}

export interface MoonPhaseInfo {
  /** Illuminated fraction of the visible lunar disc, 0..1. */
  readonly illuminatedFraction: number;
  /** Sun-Moon-Earth phase angle in degrees (0 = full moon, 180 = new moon). */
  readonly phaseAngle: number;
  /** Phase as a difference of ecliptic longitudes in degrees, 0..360. */
  readonly phaseLongitude: number;
  /** Sun-Earth-Moon elongation in degrees. */
  readonly elongation: number;
  readonly waxing: boolean;
  /** Phase name. */
  readonly name: string;
}

export interface GeocentricView {
  /** Unit vector Earth -> Sun in the EQJ system. */
  readonly sunUnit: Vec3;
  /** Unit vector Earth -> Moon in the EQJ system. */
  readonly moonUnit: Vec3;
  /** Unit vector Moon -> Sun in the EQJ system (determines Moon lighting). */
  readonly moonToSunUnit: Vec3;
  /** Unit vector along Earth's rotation axis (north pole) in the EQJ system. */
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
  /** Unit vector Earth centre -> observer in the EQJ system (site vector). */
  readonly observerUnit: Vec3;
  /**
   * The observer's local zenith as a unit vector in the EQJ system.
   * On the oblate Earth it deviates by up to ~0.2 degrees from the site
   * vector; the rotation is supplied by Astronomy Engine.
   */
  readonly observerZenithUnit: Vec3;
  /** Unit vectors of all locations in the EQJ system, by location ID. */
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
 * Unit vector from azimuth and altitude in the HOR system.
 * Pure drawing geometry: spherical to Cartesian coordinates, with
 * x = north, y = west, z = zenith and azimuth clockwise from north.
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
  // ofdate = true and aberration = true return the apparent coordinates
  // that Horizon() expects, per the documentation.
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
 * Phase name derived from the library's values.
 * phaseLongitude is the longitude difference returned by MoonPhase().
 */
function phaseName(phaseLongitude: number, fraction: number): string {
  const percent = fraction * 100;
  if (percent < 1) return 'New Moon';
  if (percent > 99) return 'Full Moon';
  const waxing = phaseLongitude < 180;
  if (Math.abs(percent - 50) <= 2) return waxing ? 'First Quarter' : 'Last Quarter';
  if (percent < 50) return waxing ? 'Waxing Crescent' : 'Waning Crescent';
  return waxing ? 'Waxing Gibbous' : 'Waning Gibbous';
}

function riseSet(body: Body, date: Date, observer: Observer): RiseSetInfo {
  // SearchRiseSet(body, observer, direction, dateStart, limitDays):
  // direction +1 = rise, -1 = set.
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

  // Geocentric vectors in AU, EQJ orientation.
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
 * The observer's local zenith, expressed in the EQJ system.
 * The HOR -> EQJ rotation comes from Astronomy Engine.
 */
export function zenithInEqj(date: Date, location: LocationSpec): Vec3 {
  const rotation = Rotation_HOR_EQJ(date, makeObserver(location));
  const rotated = RotateVector(rotation, new Vector(0, 0, 1, MakeTime(date)));
  return normalize(toVec3(rotated));
}

/**
 * Direction Moon -> Sun, expressed in the observer's HOR system.
 * The EQJ -> HOR rotation comes from Astronomy Engine; nothing is computed
 * here beyond applying the matrix to the unit vector.
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
