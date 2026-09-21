/**
 * Ansicht "Erde - Mond - Sonne".
 *
 * Schematische Szene: Groessen und Abstaende sind stark verkuerzt, die
 * Richtungen und Winkel dagegen nicht. Alle Richtungen sind die von
 * Astronomy Engine berechneten Einheitsvektoren im EQJ-System; nur ihre
 * Laengen werden fuer die Darstellung skaliert.
 *
 * Beleuchtung: Erde und Mond bekommen ihre Lichtrichtung als Uniform aus den
 * echten Richtungsvektoren (Erde -> Sonne bzw. Mond -> Sonne). Sie wird nicht
 * aus den verkuerzten Szenenpositionen abgeleitet, damit Tag-/Nachtgrenze und
 * Mondphase korrekt bleiben.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AstroState, Vec3 } from '../astro';
import { LOCATIONS } from '../locations';
import {
  PALETTE,
  arcMidpoint,
  disposeObject,
  equatorialToScene,
  formatDegrees,
  makeAngleArc,
  makeArrow,
  makeLabel,
  makeLine,
  makeTwoToneSphere
} from './helpers';

const EARTH_RADIUS = 0.62;
const MOON_RADIUS = 0.17;
const SUN_RADIUS = 0.46;
const MOON_DISTANCE = 2.7;
const SUN_DISTANCE = 5.0;
const HORIZON_RADIUS = 0.34;
/** Schrifthoehen in Weltmasseinheiten; die Szene ist rund 10 Einheiten breit. */
const LABEL = { body: 0.42, annotation: 0.32, small: 0.26 } as const;

export class SystemView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  controls: OrbitControls | null = null;

  /** Wegwerf-Objekte; werden bei jeder Aktualisierung neu aufgebaut. */
  private readonly dynamic = new THREE.Group();
  /**
   * Dauerhafte Objekte. Sie liegen bewusst ausserhalb von `dynamic`, damit
   * ihre Geometrie und ihr Material beim Aufraeumen nicht mit freigegeben
   * werden - sie werden nur neu positioniert.
   */
  private readonly persistent = new THREE.Group();
  private readonly earth = makeTwoToneSphere(EARTH_RADIUS, PALETTE.earthDay, PALETTE.earthNight, 72);
  private readonly moon = makeTwoToneSphere(MOON_RADIUS, PALETTE.moonLit, PALETTE.moonDark, 48);
  private lastState: AstroState | null = null;
  /** Wurde die Kamera schon auf einen echten Zustand eingepasst? */
  private framed = false;
  /** Hat der Benutzer die Kamera selbst bewegt? Dann nicht mehr nachfuehren. */
  private userMoved = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.scene.add(this.dynamic);
    this.persistent.add(this.earth.mesh, this.moon.mesh);
    this.scene.add(this.persistent);
    this.resetCamera();
  }

  attachControls(element: HTMLElement): void {
    const controls = new OrbitControls(this.camera, element);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.6;
    controls.maxDistance = 30;
    controls.target.set(0, 0, 0);
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.addEventListener('start', () => {
      this.userMoved = true;
    });
    this.controls = controls;
  }

  /**
   * Blick senkrecht auf die Ebene Sonne-Erde-Mond. In dieser Richtung
   * erscheint der Elongationswinkel in wahrer Groesse.
   */
  resetCamera(): void {
    this.userMoved = false;
    let normal = new THREE.Vector3(0, 1, 0);
    if (this.lastState) {
      const sun = equatorialToScene(this.lastState.geo.sunUnit);
      const moon = equatorialToScene(this.lastState.geo.moonUnit);
      const cross = new THREE.Vector3().crossVectors(sun, moon);
      if (cross.lengthSq() > 1e-4) {
        normal = cross.normalize();
        // Immer von der Nordseite der Ebene schauen, damit der Blick nicht
        // je nach Mondstellung umspringt.
        if (normal.y < 0) normal.negate();
      }
    }
    const { target, radius } = this.boundingSphere();
    // Sichtfeld in der schmaleren Bildrichtung, damit auch hochkant alles passt.
    const verticalFov = (this.camera.fov * Math.PI) / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.2));
    const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2);

    this.camera.position.copy(target).addScaledVector(normal, distance);
    this.camera.up.set(0, 1, 0);
    // Bei fast senkrechter Kamera ist "oben" mehrdeutig; Bezugsachse wechseln.
    if (Math.abs(normal.y) > 0.98) this.camera.up.set(0, 0, -1);
    this.camera.lookAt(target);
    this.camera.far = distance + radius * 4;
    this.camera.updateProjectionMatrix();
    this.controls?.target.copy(target);
    this.controls?.update();
    // Ohne Zustand ist das nur eine Startaufstellung, keine echte Einpassung.
    this.framed = this.lastState !== null;
  }

  /** Nach einer Groessenaenderung neu einpassen, solange niemand gedreht hat. */
  refit(): void {
    if (!this.userMoved) this.resetCamera();
  }

  /** Kugel, die Erde, Mond, Sonne und ihre Beschriftungen einschliesst. */
  private boundingSphere(): { target: THREE.Vector3; radius: number } {
    if (!this.lastState) return { target: new THREE.Vector3(), radius: SUN_DISTANCE * 0.75 };
    const moon = equatorialToScene(this.lastState.geo.moonUnit).multiplyScalar(MOON_DISTANCE);
    const sun = equatorialToScene(this.lastState.geo.sunUnit).multiplyScalar(SUN_DISTANCE);
    const points = [new THREE.Vector3(), moon, sun];
    const target = points
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .multiplyScalar(1 / points.length);
    const reach = Math.max(
      target.length() + EARTH_RADIUS,
      target.distanceTo(moon) + MOON_RADIUS,
      target.distanceTo(sun) + SUN_RADIUS
    );
    // Zuschlag fuer Beschriftungen und Winkelboegen.
    return { target, radius: reach + 1.0 };
  }

  update(state: AstroState): void {
    this.lastState = state;
    disposeObject(this.dynamic);
    this.dynamic.clear();
    if (!this.framed) this.resetCamera();

    const sunDirection = equatorialToScene(state.geo.sunUnit);
    const moonDirection = equatorialToScene(state.geo.moonUnit);
    const moonToSun = equatorialToScene(state.geo.moonToSunUnit);
    const northDirection = equatorialToScene(state.geo.earthNorthUnit);

    const moonPosition = moonDirection.clone().multiplyScalar(MOON_DISTANCE);
    const sunPosition = sunDirection.clone().multiplyScalar(SUN_DISTANCE);

    this.addEarth(state, sunDirection, northDirection);
    this.addMoon(moonPosition, moonToSun);
    this.addSun(sunPosition, sunDirection);
    this.addDirections(sunDirection, moonDirection, moonPosition, moonToSun);
    this.addAngles(state, sunDirection, moonDirection, moonPosition, moonToSun);
    this.addSunlight(sunDirection, moonPosition);
  }

  private addEarth(state: AstroState, sunDirection: THREE.Vector3, northDirection: THREE.Vector3): void {
    const earthMesh = this.earth.mesh;
    earthMesh.position.set(0, 0, 0);
    this.earth.setLightDirection(sunDirection);
    this.dynamic.add(earthMesh);

    // Erdachse.
    this.dynamic.add(
      makeLine(
        [
          northDirection.clone().multiplyScalar(-EARTH_RADIUS * 1.45),
          northDirection.clone().multiplyScalar(EARTH_RADIUS * 1.45)
        ],
        PALETTE.axis,
        0.8
      )
    );
    const axisLabel = makeLabel('Erdachse', LABEL.small, { color: '#9aa3a8' });
    // Am Suedende: beide Orte liegen auf der Nordhalbkugel.
    axisLabel.position.copy(northDirection.clone().multiplyScalar(-EARTH_RADIUS * 2.15));
    this.dynamic.add(axisLabel);

    // Aequator als Kreis senkrecht zur Erdachse.
    this.dynamic.add(circleAroundAxis(northDirection, EARTH_RADIUS * 1.004, PALETTE.axis, 0.45));

    // Ortsmarken.
    for (const site of LOCATIONS) {
      const unit = state.siteUnits.get(site.id);
      if (!unit) continue;
      const active = site.id === state.location.id;
      const position = equatorialToScene(unit).multiplyScalar(EARTH_RADIUS);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(active ? 0.055 : 0.035, 16, 12),
        new THREE.MeshBasicMaterial({ color: active ? PALETTE.accent : PALETTE.ink })
      );
      marker.position.copy(position);
      this.dynamic.add(marker);

      const label = makeLabel(active ? `${site.label} (Beobachter)` : site.label, active ? LABEL.annotation : LABEL.small, {
        color: active ? '#e2814f' : '#b0a894',
        bold: active
      });
      // Der aktive Ort wird entlang seiner Zenitrichtung nach aussen gesetzt,
      // oberhalb des Horizontpfeils; der zweite Ort bleibt dicht an der Marke.
      if (active) {
        const zenith = equatorialToScene(state.observerZenithUnit).normalize();
        label.position.copy(position).addScaledVector(zenith, 0.92);
      } else {
        label.position.copy(position.clone().multiplyScalar(1.45));
      }
      this.dynamic.add(label);

      if (active) {
        this.addHorizonPlane(state.observerZenithUnit, position);
      }
    }
  }

  /** Horizontebene des Beobachters: Scheibe senkrecht zu seinem Zenit. */
  private addHorizonPlane(zenithUnit: Vec3, position: THREE.Vector3): void {
    const zenith = equatorialToScene(zenithUnit).normalize();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(HORIZON_RADIUS, 64),
      new THREE.MeshBasicMaterial({
        color: 0xb6491f,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    disc.position.copy(position);
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), zenith);
    this.dynamic.add(disc);

    const rim = circleAroundAxis(zenith, HORIZON_RADIUS, PALETTE.accent, 0.85);
    rim.position.copy(position);
    this.dynamic.add(rim);

    this.dynamic.add(makeArrow(zenith, 0.5, PALETTE.accent, 0.1, position.clone()));
    // Seitlich versetzt, damit der Ortsname darueber frei bleibt.
    const sideways = Math.abs(zenith.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const offset = new THREE.Vector3().crossVectors(zenith, sideways).normalize();
    const label = makeLabel('Horizontebene', LABEL.small, { color: '#e2814f' });
    label.position.copy(position).addScaledVector(zenith, 0.08).addScaledVector(offset, HORIZON_RADIUS + 0.62);
    this.dynamic.add(label);
  }

  private addMoon(moonPosition: THREE.Vector3, moonToSun: THREE.Vector3): void {
    const moonMesh = this.moon.mesh;
    moonMesh.position.copy(moonPosition);
    this.moon.setLightDirection(moonToSun);
    this.dynamic.add(moonMesh);

    const label = makeLabel('Mond', LABEL.body, { color: '#efe9dd', bold: true });
    label.position.copy(moonPosition.clone().add(new THREE.Vector3(0, MOON_RADIUS + 0.42, 0)));
    this.dynamic.add(label);
  }

  private addSun(sunPosition: THREE.Vector3, sunDirection: THREE.Vector3): void {
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 40, 28),
      new THREE.MeshBasicMaterial({ color: PALETTE.sun })
    );
    sun.position.copy(sunPosition);
    this.dynamic.add(sun);

    // Strahlenkranz.
    const basis = Math.abs(sunDirection.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangentA = new THREE.Vector3().crossVectors(sunDirection, basis).normalize();
    const tangentB = new THREE.Vector3().crossVectors(sunDirection, tangentA).normalize();
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const direction = tangentA
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(tangentB, Math.sin(angle));
      this.dynamic.add(
        makeLine(
          [
            sunPosition.clone().addScaledVector(direction, SUN_RADIUS * 1.2),
            sunPosition.clone().addScaledVector(direction, SUN_RADIUS * 1.65)
          ],
          PALETTE.sunlight,
          0.9
        )
      );
    }

    const label = makeLabel('Sonne', LABEL.body, { color: '#f2c94c', bold: true });
    label.position.copy(sunPosition.clone().add(new THREE.Vector3(0, SUN_RADIUS + 0.34, 0)));
    this.dynamic.add(label);
  }

  private addDirections(
    sunDirection: THREE.Vector3,
    moonDirection: THREE.Vector3,
    moonPosition: THREE.Vector3,
    moonToSun: THREE.Vector3
  ): void {
    // Erde -> Sonne: zeigt genau auf das Sonnensymbol, weil beide dieselbe
    // berechnete Richtung benutzen.
    this.dynamic.add(makeArrow(sunDirection, SUN_DISTANCE - SUN_RADIUS, PALETTE.sunlight, 0.22));
    // Bruchmarke: der Abstand ist stark verkuerzt.
    this.dynamic.add(breakMark(sunDirection, SUN_DISTANCE * 0.62, 0.17));

    // Erde -> Mond.
    this.dynamic.add(makeArrow(moonDirection, MOON_DISTANCE - MOON_RADIUS, PALETTE.moonLit, 0.18));

    // Mond -> Sonne: echte Richtung. Sie trifft das Sonnensymbol nicht, weil
    // die Sonne in Wirklichkeit rund 390-mal weiter entfernt ist als der Mond.
    this.dynamic.add(makeArrow(moonToSun, 1.5, PALETTE.sunlight, 0.16, moonPosition.clone()));
    const label = makeLabel('Richtung Mond → Sonne', LABEL.small, { color: '#f2c94c' });
    label.position.copy(moonPosition.clone().addScaledVector(moonToSun, 1.72));
    this.dynamic.add(label);
  }

  private addAngles(
    state: AstroState,
    sunDirection: THREE.Vector3,
    moonDirection: THREE.Vector3,
    moonPosition: THREE.Vector3,
    moonToSun: THREE.Vector3
  ): void {
    // Elongation: Winkel Sonne-Erde-Mond, am Erdmittelpunkt.
    // Weit genug aussen, damit der Bogen nicht in die Beschriftungen am
    // Erdkoerper laeuft.
    const elongationRadius = 2.05;
    this.dynamic.add(makeAngleArc(sunDirection, moonDirection, elongationRadius, PALETTE.accentAlt));
    const elongationLabel = makeLabel(
      `Elongation Sonne–Erde–Mond: ${formatDegrees(state.phase.elongation)}`,
      LABEL.annotation,
      { color: '#7fc5b8' }
    );
    elongationLabel.position.copy(arcMidpoint(sunDirection, moonDirection, elongationRadius * 1.12));
    this.dynamic.add(elongationLabel);

    // Phasenwinkel: Winkel Sonne-Mond-Erde, am Mond.
    const toEarth = moonDirection.clone().negate();
    const phaseRadius = 0.62;
    const phaseArc = makeAngleArc(toEarth, moonToSun, phaseRadius, PALETTE.accent);
    phaseArc.position.copy(moonPosition);
    this.dynamic.add(phaseArc);
    const phaseLabel = makeLabel(`Phasenwinkel Sonne–Mond–Erde: ${formatDegrees(state.phase.phaseAngle)}`, LABEL.annotation, {
      color: '#e2814f'
    });
    phaseLabel.position.copy(moonPosition.clone().add(arcMidpoint(toEarth, moonToSun, phaseRadius * 1.5)));
    this.dynamic.add(phaseLabel);

    // Mond -> Erde als duenne Linie, damit der Winkel am Mond ablesbar ist.
    this.dynamic.add(
      makeLine([moonPosition.clone(), moonPosition.clone().addScaledVector(toEarth, 1.1)], PALETTE.axis, 0.5, true)
    );
  }

  /**
   * Paralleles Sonnenlicht als gelbe Linien. Auf der Strecke Erde-Mond ist
   * das Sonnenlicht praktisch parallel: die Richtungen Erde->Sonne und
   * Mond->Sonne unterscheiden sich um hoechstens etwa 0,15 Grad.
   */
  private addSunlight(sunDirection: THREE.Vector3, moonPosition: THREE.Vector3): void {
    const basis = Math.abs(sunDirection.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const across = new THREE.Vector3().crossVectors(sunDirection, basis).normalize();
    const centre = moonPosition.clone().multiplyScalar(0.5);
    for (let i = -2; i <= 2; i += 1) {
      const offset = across.clone().multiplyScalar(i * 0.75);
      const start = centre.clone().add(offset).addScaledVector(sunDirection, 3.1);
      const end = centre.clone().add(offset).addScaledVector(sunDirection, 1.7);
      this.dynamic.add(makeArrow(sunDirection.clone().negate(), start.distanceTo(end), PALETTE.sunlight, 0.16, start));
    }
    const label = makeLabel('Sonnenlicht', LABEL.small, { color: '#f2c94c' });
    label.position.copy(centre.clone().addScaledVector(sunDirection, 3.25).addScaledVector(across, 1.9));
    this.dynamic.add(label);
  }

  dispose(): void {
    disposeObject(this.dynamic);
    disposeObject(this.persistent);
    this.controls?.dispose();
  }
}

/** Kreis senkrecht zu einer Achse, um den Ursprung. */
function circleAroundAxis(axis: THREE.Vector3, radius: number, color: number, opacity: number): THREE.Line {
  const normal = axis.clone().normalize();
  const basis = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(normal, basis).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 128; i += 1) {
    const angle = (i / 128) * Math.PI * 2;
    points.push(
      u.clone().multiplyScalar(Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius)
    );
  }
  return makeLine(points, color, opacity);
}

/** Zwei Querstriche auf einer Linie: Zeichen fuer einen verkuerzten Abstand. */
function breakMark(direction: THREE.Vector3, distance: number, size: number): THREE.Group {
  const group = new THREE.Group();
  const unit = direction.clone().normalize();
  const basis = Math.abs(unit.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const across = new THREE.Vector3().crossVectors(unit, basis).normalize();
  for (const shift of [-0.09, 0.09]) {
    const centre = unit.clone().multiplyScalar(distance + shift);
    group.add(
      makeLine(
        [
          centre.clone().addScaledVector(across, -size).addScaledVector(unit, -size * 0.45),
          centre.clone().addScaledVector(across, size).addScaledVector(unit, size * 0.45)
        ],
        PALETTE.ink,
        0.9
      )
    );
  }
  return group;
}
