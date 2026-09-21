/**
 * Ansicht "Lokaler Himmel".
 *
 * Der Beobachter steht im Ursprung. Die Horizontebene ist die XZ-Ebene,
 * der Zenit zeigt nach +Y. Alle Richtungen stammen aus astro.ts; hier wird
 * nur gezeichnet.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AstroState } from '../astro';
import { moonToSunInHorizonFrame } from '../astro';
import {
  PALETTE,
  arcMidpoint,
  disposeObject,
  formatDegrees,
  horizonToScene,
  makeAngleArc,
  makeArrow,
  makeLabel,
  makeLine,
  makeLitMoonShape,
  limbBasis
} from './helpers';

const DOME_RADIUS = 1;
const BODY_RADIUS = 0.055;
// Sonne und Mond bekommen unterschiedliche Bogenradien, damit sich ihre
// Beschriftungen nicht ueberlagern.
const ARC_RADII = {
  sun: { azimuth: 0.36, altitude: 0.55 },
  moon: { azimuth: 0.58, altitude: 0.82 }
} as const;

/** Himmelsrichtungen: Beschriftung und Richtung im HOR-System. */
const CARDINALS: ReadonlyArray<{ label: string; hor: { x: number; y: number; z: number } }> = [
  { label: 'N', hor: { x: 1, y: 0, z: 0 } },
  { label: 'O', hor: { x: 0, y: -1, z: 0 } },
  { label: 'S', hor: { x: -1, y: 0, z: 0 } },
  { label: 'W', hor: { x: 0, y: 1, z: 0 } }
];

export class SkyView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  controls: OrbitControls | null = null;

  private readonly dynamic = new THREE.Group();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.scene.add(this.dynamic);
    this.buildStatic();
    this.resetCamera();
  }

  attachControls(element: HTMLElement): void {
    const controls = new OrbitControls(this.camera, element);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 8;
    // Etwas unter den Horizont schauen zu koennen ist gewollt: nur dort sind
    // Sonne und Mond bei negativer Hoehe zu sehen.
    controls.maxPolarAngle = Math.PI * 0.95;
    controls.target.set(0, 0, 0);
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls = controls;
  }

  resetCamera(): void {
    // Blick von Sued-Suedost leicht von oben auf den Beobachter.
    this.camera.position.set(1.5, 1.35, 2.3);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls?.target.set(0, 0, 0);
    this.controls?.update();
  }

  /** Kamera exakt suedlich des Beobachters: der Blick geht nach Norden. */
  alignNorth(): void {
    const distance = this.camera.position.length() || 3.2;
    // Norden liegt bei -Z, also steht die Kamera bei +Z.
    this.camera.position.set(0, distance * 0.42, distance * 0.91);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls?.target.set(0, 0, 0);
    this.controls?.update();
  }

  private buildStatic(): void {
    const staticGroup = new THREE.Group();

    // Horizontebene als Scheibe, leicht durchscheinend, damit Objekte
    // unter dem Horizont sichtbar bleiben.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(DOME_RADIUS, 96),
      new THREE.MeshBasicMaterial({
        color: 0x6f6a5d,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    disc.rotation.x = -Math.PI / 2;
    staticGroup.add(disc);

    // Horizontkreis und Hilfskreise der Kuppel.
    staticGroup.add(circle(DOME_RADIUS, PALETTE.horizon, 1, 'xz'));
    for (const altitude of [30, 60]) {
      const r = DOME_RADIUS * Math.cos((altitude * Math.PI) / 180);
      const ring = circle(r, PALETTE.horizon, 0.35, 'xz');
      ring.position.y = DOME_RADIUS * Math.sin((altitude * Math.PI) / 180);
      staticGroup.add(ring);
    }
    // Meridian (Nord-Zenit-Sued) und Vertikalkreis Ost-West.
    staticGroup.add(halfCircle(DOME_RADIUS, PALETTE.horizon, 0.3, 'ns'));
    staticGroup.add(halfCircle(DOME_RADIUS, PALETTE.horizon, 0.3, 'ew'));

    // Zenitrichtung.
    const zenith = makeArrow(new THREE.Vector3(0, 1, 0), DOME_RADIUS * 0.98, PALETTE.axis, 0.08);
    staticGroup.add(zenith);
    const zenithLabel = makeLabel('Zenit', 0.09, { color: '#9aa3a8' });
    zenithLabel.position.set(0.08, DOME_RADIUS * 1.03, 0);
    staticGroup.add(zenithLabel);

    for (const cardinal of CARDINALS) {
      const direction = horizonToScene(cardinal.hor);
      staticGroup.add(makeLine([new THREE.Vector3(), direction.clone().multiplyScalar(DOME_RADIUS)], PALETTE.horizon, 0.45));
      const label = makeLabel(cardinal.label, 0.13, {
        color: cardinal.label === 'N' ? '#e2814f' : '#b8b0a0',
        bold: true
      });
      label.position.copy(direction.clone().multiplyScalar(DOME_RADIUS * 1.09));
      staticGroup.add(label);
    }

    // Beobachterpunkt.
    const observer = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 16, 12),
      new THREE.MeshBasicMaterial({ color: PALETTE.accentAlt })
    );
    staticGroup.add(observer);

    this.scene.add(staticGroup);
  }

  update(state: AstroState): void {
    disposeObject(this.dynamic);
    this.dynamic.clear();

    this.addBody(state, 'sun');
    this.addBody(state, 'moon');
  }

  private addBody(state: AstroState, which: 'sun' | 'moon'): void {
    const body = which === 'sun' ? state.sun : state.moon;
    const direction = horizonToScene(body.horizonUnit);
    const position = direction.clone().multiplyScalar(DOME_RADIUS);
    const below = !body.aboveHorizon;
    const lineColor = which === 'sun' ? PALETTE.sunlight : PALETTE.moonLit;
    const label = which === 'sun' ? 'Sonne' : 'Mond';
    const radii = ARC_RADII[which];

    const group = new THREE.Group();

    // Sichtlinie Beobachter -> Gestirn. Unter dem Horizont gestrichelt.
    group.add(makeLine([new THREE.Vector3(), position], lineColor, below ? 0.5 : 0.9, below));

    // Fusspunkt des Azimuts auf der Horizontebene.
    const groundDirection = new THREE.Vector3(direction.x, 0, direction.z);
    if (groundDirection.lengthSq() > 1e-9) {
      groundDirection.normalize();
      const groundPoint = groundDirection.clone().multiplyScalar(DOME_RADIUS);

      // Azimutpfeil in der Horizontebene.
      group.add(makeArrow(groundDirection, DOME_RADIUS * 0.92, PALETTE.accentAlt, 0.09));

      // Lotlinie vom Gestirn auf die Horizontebene.
      group.add(makeLine([position, groundPoint], PALETTE.axis, 0.45, true));

      // Azimutbogen von Nord bis zur Azimutrichtung, in der Horizontebene.
      const north = horizonToScene({ x: 1, y: 0, z: 0 });
      const azimuthArc = makeAngleArcInPlane(north, groundDirection, radii.azimuth, PALETTE.accentAlt);
      group.add(azimuthArc);
      const azimuthLabel = makeLabel(`${label}: Azimut ${formatDegrees(body.azimuth)}`, 0.082, {
        color: '#7fc5b8'
      });
      azimuthLabel.position.copy(arcMidpointInPlane(north, groundDirection, radii.azimuth * 1.25));
      azimuthLabel.position.y += 0.05;
      group.add(azimuthLabel);

      // Hoehenbogen vom Fusspunkt zur Gestirnsrichtung.
      group.add(makeAngleArc(groundDirection, direction, radii.altitude, PALETTE.accent));
      const altitudeLabel = makeLabel(`Höhe ${formatDegrees(body.altitude)}`, 0.082, {
        color: below ? '#d09a9a' : '#e2814f'
      });
      altitudeLabel.position.copy(arcMidpoint(groundDirection, direction, radii.altitude * 1.2));
      group.add(altitudeLabel);
    }

    // Koerper.
    if (which === 'sun') {
      const sun = new THREE.Mesh(
        new THREE.SphereGeometry(BODY_RADIUS, 32, 24),
        new THREE.MeshBasicMaterial({ color: below ? 0x8f7a3a : PALETTE.sun })
      );
      sun.position.copy(position);
      group.add(sun);
      // Strahlenkranz aus kurzen gelben Linien.
      group.add(sunRays(position, BODY_RADIUS, below ? 0.35 : 0.9));
    } else {
      // Der Mond wird als Scheibe gezeichnet, die dem Beobachter im Ursprung
      // zugewandt ist - nicht als Kugel. Die Kamera steht ausserhalb der
      // Himmelskuppel; eine Kugel wuerde ihr eine andere Phase zeigen als dem
      // Beobachter. Die Scheibe zeigt immer die Phase des Beobachters.
      const lightHor = moonToSunInHorizonFrame(state.date, state.location, state.geo.moonToSunUnit);
      const toLight = horizonToScene(lightHor);
      const basis = limbBasis(direction, toLight);

      // Helle Flaeche und Rand liegen in derselben Ebene wie die dunkle
      // Scheibe. polygonOffset entscheidet die Reihenfolge unabhaengig davon,
      // von welcher Seite die Kamera schaut - ein Versatz entlang der
      // Blickrichtung waere nur fuer eine Kameraposition richtig.
      const coplanar = (color: number, offset: number, opacity = 1) =>
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          transparent: opacity < 1,
          opacity,
          polygonOffset: true,
          polygonOffsetFactor: offset,
          polygonOffsetUnits: offset
        });

      const dark = new THREE.Mesh(new THREE.CircleGeometry(BODY_RADIUS, 48), coplanar(PALETTE.moonDark, 0));
      dark.applyMatrix4(basis);
      dark.position.copy(position);
      group.add(dark);

      const lit = new THREE.Mesh(
        new THREE.ShapeGeometry(makeLitMoonShape(BODY_RADIUS, state.phase.illuminatedFraction), 48),
        coplanar(PALETTE.moonLit, -2)
      );
      lit.applyMatrix4(basis);
      lit.position.copy(position);
      group.add(lit);

      const rim = new THREE.Mesh(
        new THREE.RingGeometry(BODY_RADIUS * 0.97, BODY_RADIUS, 48),
        coplanar(PALETTE.moonLit, -4, 0.5)
      );
      rim.applyMatrix4(basis);
      rim.position.copy(position);
      group.add(rim);
    }

    const nameLabel = makeLabel(
      below ? `${label} (unter dem Horizont)` : label,
      0.095,
      { color: below ? '#c89a9a' : which === 'sun' ? '#f2c94c' : '#efe9dd', bold: true }
    );
    nameLabel.position.copy(position).add(new THREE.Vector3(0, BODY_RADIUS + 0.075, 0));
    group.add(nameLabel);

    this.dynamic.add(group);
  }

  dispose(): void {
    disposeObject(this.scene);
    this.controls?.dispose();
  }
}

/** Kreis in der XZ- oder XY-Ebene. */
function circle(radius: number, color: number, opacity: number, plane: 'xz'): THREE.Line {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 128; i += 1) {
    const angle = (i / 128) * Math.PI * 2;
    points.push(
      plane === 'xz'
        ? new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
        : new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
    );
  }
  return makeLine(points, color, opacity);
}

/** Halbkreis ueber dem Horizont: Meridian (ns) oder Ost-West-Vertikalkreis (ew). */
function halfCircle(radius: number, color: number, opacity: number, orientation: 'ns' | 'ew'): THREE.Line {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i += 1) {
    const angle = (i / 64) * Math.PI;
    const horizontal = Math.cos(angle) * radius;
    const vertical = Math.sin(angle) * radius;
    points.push(
      orientation === 'ns'
        ? new THREE.Vector3(0, vertical, horizontal)
        : new THREE.Vector3(horizontal, vertical, 0)
    );
  }
  return makeLine(points, color, opacity);
}

/** Bogen in der Horizontebene (immer um die Y-Achse, also ueber den Kompass). */
function makeAngleArcInPlane(from: THREE.Vector3, to: THREE.Vector3, radius: number, color: number): THREE.Line {
  const start = Math.atan2(from.x, -from.z);
  const end = Math.atan2(to.x, -to.z);
  let sweep = end - start;
  while (sweep < 0) sweep += Math.PI * 2;
  const points: THREE.Vector3[] = [];
  const segments = Math.max(8, Math.round((sweep / (Math.PI * 2)) * 128));
  for (let i = 0; i <= segments; i += 1) {
    const angle = start + (sweep * i) / segments;
    points.push(new THREE.Vector3(Math.sin(angle) * radius, 0, -Math.cos(angle) * radius));
  }
  return makeLine(points, color);
}

function arcMidpointInPlane(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3 {
  const start = Math.atan2(from.x, -from.z);
  const end = Math.atan2(to.x, -to.z);
  let sweep = end - start;
  while (sweep < 0) sweep += Math.PI * 2;
  const angle = start + sweep / 2;
  return new THREE.Vector3(Math.sin(angle) * radius, 0, -Math.cos(angle) * radius);
}

/** Kurze gelbe Strahlen um die Sonnenscheibe. */
function sunRays(position: THREE.Vector3, radius: number, opacity: number): THREE.Group {
  const group = new THREE.Group();
  const basis = new THREE.Vector3(0, 1, 0);
  const normal = position.clone().normalize();
  const tangentA = new THREE.Vector3().crossVectors(normal, basis).normalize();
  const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const direction = tangentA
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(tangentB, Math.sin(angle));
    group.add(
      makeLine(
        [
          position.clone().addScaledVector(direction, radius * 1.35),
          position.clone().addScaledVector(direction, radius * 2.1)
        ],
        PALETTE.sunlight,
        opacity
      )
    );
  }
  return group;
}
