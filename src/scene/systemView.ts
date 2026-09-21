/**
 * "Earth - Moon - Sun" view.
 *
 * Schematic scene: sizes and distances are strongly shortened, but
 * directions and angles are not. All directions are the unit vectors
 * computed by Astronomy Engine in the EQJ system; only their lengths are
 * scaled for display.
 *
 * Lighting: Earth and Moon get their lighting direction as a uniform from
 * the true direction vectors (Earth -> Sun and Moon -> Sun respectively).
 * It is not derived from the shortened scene positions, so the day/night
 * boundary and the Moon phase stay correct.
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
/** Font heights in world units; the scene is roughly 10 units wide. */
const LABEL = { body: 0.42, annotation: 0.32, small: 0.26 } as const;

export class SystemView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  controls: OrbitControls | null = null;

  /** Throwaway objects; rebuilt on every update. */
  private readonly dynamic = new THREE.Group();
  /**
   * Persistent objects. They deliberately live outside `dynamic` so their
   * geometry and material are not disposed of during cleanup - they are
   * only repositioned.
   */
  private readonly persistent = new THREE.Group();
  private readonly earth = makeTwoToneSphere(EARTH_RADIUS, PALETTE.earthDay, PALETTE.earthNight, 72);
  private readonly moon = makeTwoToneSphere(MOON_RADIUS, PALETTE.moonLit, PALETTE.moonDark, 48);
  private lastState: AstroState | null = null;
  /** Has the camera already been framed to a real state? */
  private framed = false;
  /** Has the user moved the camera themselves? Then stop auto-framing. */
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
   * View perpendicular to the Sun-Earth-Moon plane. In this direction the
   * elongation angle appears at its true size.
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
        // Always look from the north side of the plane, so the view does
        // not flip depending on the Moon's position.
        if (normal.y < 0) normal.negate();
      }
    }
    const { target, radius } = this.boundingSphere();
    // Field of view in the narrower image direction, so everything fits in portrait too.
    const verticalFov = (this.camera.fov * Math.PI) / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.2));
    const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2);

    this.camera.position.copy(target).addScaledVector(normal, distance);
    this.camera.up.set(0, 1, 0);
    // With a near-vertical camera "up" is ambiguous; switch the reference axis.
    if (Math.abs(normal.y) > 0.98) this.camera.up.set(0, 0, -1);
    this.camera.lookAt(target);
    this.camera.far = distance + radius * 4;
    this.camera.updateProjectionMatrix();
    this.controls?.target.copy(target);
    this.controls?.update();
    // Without a state this is only an initial position, not a real framing.
    this.framed = this.lastState !== null;
  }

  /** Re-frame after a resize, as long as no one has rotated the view. */
  refit(): void {
    if (!this.userMoved) this.resetCamera();
  }

  /** Sphere enclosing Earth, Moon, Sun and their labels. */
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
    // Margin for labels and angle arcs.
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

    // Earth's axis.
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
    const axisLabel = makeLabel("Earth's axis", LABEL.small, { color: '#9aa3a8' });
    // At the south end: both locations lie in the northern hemisphere.
    axisLabel.position.copy(northDirection.clone().multiplyScalar(-EARTH_RADIUS * 2.15));
    this.dynamic.add(axisLabel);

    // Equator as a circle perpendicular to Earth's axis.
    this.dynamic.add(circleAroundAxis(northDirection, EARTH_RADIUS * 1.004, PALETTE.axis, 0.45));

    // Location markers.
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

      const label = makeLabel(active ? `${site.label} (Observer)` : site.label, active ? LABEL.annotation : LABEL.small, {
        color: active ? '#e2814f' : '#b0a894',
        bold: active
      });
      // The active location is placed outward along its zenith direction,
      // above the horizon arrow; the other location stays close to its marker.
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

  /** The observer's horizon plane: a disc perpendicular to their zenith. */
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
    // Offset sideways so the location name above it stays clear.
    const sideways = Math.abs(zenith.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const offset = new THREE.Vector3().crossVectors(zenith, sideways).normalize();
    const label = makeLabel('Horizon plane', LABEL.small, { color: '#e2814f' });
    label.position.copy(position).addScaledVector(zenith, 0.08).addScaledVector(offset, HORIZON_RADIUS + 0.62);
    this.dynamic.add(label);
  }

  private addMoon(moonPosition: THREE.Vector3, moonToSun: THREE.Vector3): void {
    const moonMesh = this.moon.mesh;
    moonMesh.position.copy(moonPosition);
    this.moon.setLightDirection(moonToSun);
    this.dynamic.add(moonMesh);

    const label = makeLabel('Moon', LABEL.body, { color: '#efe9dd', bold: true });
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

    // Ray crown.
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

    const label = makeLabel('Sun', LABEL.body, { color: '#f2c94c', bold: true });
    label.position.copy(sunPosition.clone().add(new THREE.Vector3(0, SUN_RADIUS + 0.34, 0)));
    this.dynamic.add(label);
  }

  private addDirections(
    sunDirection: THREE.Vector3,
    moonDirection: THREE.Vector3,
    moonPosition: THREE.Vector3,
    moonToSun: THREE.Vector3
  ): void {
    // Earth -> Sun: points exactly at the Sun symbol, because both use the
    // same computed direction.
    this.dynamic.add(makeArrow(sunDirection, SUN_DISTANCE - SUN_RADIUS, PALETTE.sunlight, 0.22));
    // Break mark: the distance is strongly shortened.
    this.dynamic.add(breakMark(sunDirection, SUN_DISTANCE * 0.62, 0.17));

    // Earth -> Moon.
    this.dynamic.add(makeArrow(moonDirection, MOON_DISTANCE - MOON_RADIUS, PALETTE.moonLit, 0.18));

    // Moon -> Sun: true direction. It does not hit the Sun symbol, because
    // the Sun is in reality about 390 times farther away than the Moon.
    this.dynamic.add(makeArrow(moonToSun, 1.5, PALETTE.sunlight, 0.16, moonPosition.clone()));
    const label = makeLabel('Direction Moon → Sun', LABEL.small, { color: '#f2c94c' });
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
    // Elongation: Sun-Earth-Moon angle, at Earth's centre.
    // Far enough out that the arc does not run into the labels at the
    // Earth body.
    const elongationRadius = 2.05;
    this.dynamic.add(makeAngleArc(sunDirection, moonDirection, elongationRadius, PALETTE.accentAlt));
    const elongationLabel = makeLabel(
      `Elongation Sun–Earth–Moon: ${formatDegrees(state.phase.elongation)}`,
      LABEL.annotation,
      { color: '#7fc5b8' }
    );
    elongationLabel.position.copy(arcMidpoint(sunDirection, moonDirection, elongationRadius * 1.12));
    this.dynamic.add(elongationLabel);

    // Phase angle: Sun-Moon-Earth angle, at the Moon.
    const toEarth = moonDirection.clone().negate();
    const phaseRadius = 0.62;
    const phaseArc = makeAngleArc(toEarth, moonToSun, phaseRadius, PALETTE.accent);
    phaseArc.position.copy(moonPosition);
    this.dynamic.add(phaseArc);
    const phaseLabel = makeLabel(`Phase angle Sun–Moon–Earth: ${formatDegrees(state.phase.phaseAngle)}`, LABEL.annotation, {
      color: '#e2814f'
    });
    phaseLabel.position.copy(moonPosition.clone().add(arcMidpoint(toEarth, moonToSun, phaseRadius * 1.5)));
    this.dynamic.add(phaseLabel);

    // Moon -> Earth as a thin line, so the angle at the Moon is legible.
    this.dynamic.add(
      makeLine([moonPosition.clone(), moonPosition.clone().addScaledVector(toEarth, 1.1)], PALETTE.axis, 0.5, true)
    );
  }

  /**
   * Parallel sunlight as yellow lines. Over the Earth-Moon distance,
   * sunlight is practically parallel: the directions Earth->Sun and
   * Moon->Sun differ by at most about 0.15 degrees.
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
    const label = makeLabel('Sunlight', LABEL.small, { color: '#f2c94c' });
    label.position.copy(centre.clone().addScaledVector(sunDirection, 3.25).addScaledVector(across, 1.9));
    this.dynamic.add(label);
  }

  dispose(): void {
    disposeObject(this.dynamic);
    disposeObject(this.persistent);
    this.controls?.dispose();
  }
}

/** Circle perpendicular to an axis, around the origin. */
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

/** Two cross-ticks on a line: symbol for a shortened distance. */
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
