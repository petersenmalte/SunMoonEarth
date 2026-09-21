/**
 * Zeichenhilfen fuer beide Szenen.
 *
 * Hier steht ausschliesslich Darstellungs-Geometrie: Pfeile, Kreisboegen,
 * Beschriftungen, Kugeln. Astronomische Groessen kommen von aussen herein.
 */

import * as THREE from 'three';
import type { Vec3 } from '../astro';

export const PALETTE = {
  sun: 0xe8b23a,
  sunlight: 0xf2c94c,
  moonLit: 0xe8e4d8,
  moonDark: 0x3a3630,
  earthDay: 0x4a7f8c,
  earthNight: 0x1d2b33,
  horizon: 0x8a8375,
  axis: 0x9aa3a8,
  accent: 0xb6491f,
  accentAlt: 0x2c6e64,
  ink: 0x6b6558,
  below: 0x8c6b6b
} as const;

/** HOR-System (x = Nord, y = West, z = Zenit) -> Szene (x = Ost, y = oben, z = Sued). */
export function horizonToScene(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(-v.y, v.z, -v.x);
}

/** EQJ-System (z = Himmelsnordpol) -> Szene (y = oben entlang Nordpol). */
export function equatorialToScene(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) material.dispose();
  });
}

export function makeLine(points: THREE.Vector3[], color: number, opacity = 1, dashed = false): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: opacity < 1, opacity, dashSize: 0.12, gapSize: 0.08 })
    : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

/** Linie vom Ursprung in eine Richtung, mit Kegelspitze am Ende. */
export function makeArrow(
  direction: THREE.Vector3,
  length: number,
  color: number,
  headLength = 0.12,
  origin = new THREE.Vector3()
): THREE.Group {
  const group = new THREE.Group();
  const unit = direction.clone().normalize();
  const tip = origin.clone().addScaledVector(unit, length);
  const shaftEnd = origin.clone().addScaledVector(unit, Math.max(length - headLength, 0));
  group.add(makeLine([origin.clone(), shaftEnd], color));

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(headLength * 0.4, headLength, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  head.position.copy(tip).addScaledVector(unit, -headLength / 2);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
  group.add(head);
  return group;
}

/**
 * Kreisbogen zwischen zwei Richtungen, mit dem Radius `radius` um `origin`.
 * Zeichnet den kuerzeren der beiden moeglichen Boegen.
 */
export function makeAngleArc(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  color: number,
  segments = 48
): THREE.Line {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  const points: THREE.Vector3[] = [];
  const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  if (angle < 1e-6) return makeLine([a.multiplyScalar(radius)], color);
  const axis = new THREE.Vector3().crossVectors(a, b).normalize();
  for (let i = 0; i <= segments; i += 1) {
    const point = a.clone().applyAxisAngle(axis, (angle * i) / segments).multiplyScalar(radius);
    points.push(point);
  }
  return makeLine(points, color);
}

/** Punkt in der Mitte eines Bogens - dort sitzt die Gradbeschriftung. */
export function arcMidpoint(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3 {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  const mid = a.clone().add(b);
  if (mid.lengthSq() < 1e-9) {
    // Gegenueberliegende Richtungen: irgendeine Senkrechte waehlen.
    const fallback = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    mid.copy(new THREE.Vector3().crossVectors(a, fallback));
  }
  return mid.normalize().multiplyScalar(radius);
}

export interface LabelOptions {
  color?: string;
  background?: string;
  fontSize?: number;
  bold?: boolean;
}

/**
 * Textbeschriftung als Sprite. Die Zeichenflaeche wird mit der Geraete-
 * Pixeldichte skaliert, damit die Schrift auch auf Mobilgeraeten scharf ist.
 */
export function makeLabel(text: string, worldHeight: number, options: LabelOptions = {}): THREE.Sprite {
  const fontSize = options.fontSize ?? 44;
  const padding = fontSize * 0.35;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D-Kontext nicht verfuegbar');

  const font = `${options.bold ? '600 ' : ''}${fontSize}px "IBM Plex Sans", system-ui, sans-serif`;
  context.font = font;
  const metrics = context.measureText(text);
  canvas.width = Math.ceil(metrics.width + padding * 2);
  canvas.height = Math.ceil(fontSize * 1.4 + padding);

  context.font = font;
  context.textBaseline = 'middle';
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.fillStyle = options.color ?? '#efe9dd';
  context.fillText(text, padding, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  );
  sprite.scale.set((worldHeight * canvas.width) / canvas.height, worldHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * Zweifarbige Kugel: Tag- und Nachtseite, getrennt durch die Ebene senkrecht
 * zur Beleuchtungsrichtung. Die Richtung wird als Uniform gesetzt, nicht aus
 * einer Lichtquellenposition abgeleitet - so bleibt der Terminator korrekt,
 * auch wenn die Szene stark verkleinerte Abstaende zeigt.
 */
export function makeTwoToneSphere(
  radius: number,
  litColor: number,
  darkColor: number,
  segments = 64
): { mesh: THREE.Mesh; setLightDirection: (direction: THREE.Vector3) => void } {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uLightDirection: { value: new THREE.Vector3(1, 0, 0) },
      uLitColor: { value: new THREE.Color(litColor) },
      uDarkColor: { value: new THREE.Color(darkColor) }
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uLightDirection;
      uniform vec3 uLitColor;
      uniform vec3 uDarkColor;
      varying vec3 vNormal;
      void main() {
        float incidence = dot(normalize(vNormal), normalize(uLightDirection));
        // Schmaler weicher Saum, damit der Terminator nicht ausgefranst wirkt.
        float day = smoothstep(-0.03, 0.03, incidence);
        // Leichte Abdunklung zum Terminator hin macht die Kugelform lesbar.
        float shading = mix(0.75, 1.0, clamp(incidence, 0.0, 1.0));
        vec3 color = mix(uDarkColor, uLitColor * shading, day);
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), material);
  return {
    mesh,
    setLightDirection(direction: THREE.Vector3) {
      (material.uniforms.uLightDirection!.value as THREE.Vector3).copy(direction).normalize();
    }
  };
}

/**
 * Beleuchtete Mondflaeche als ebene Form, wie der Beobachter sie sieht.
 * Helle Kante liegt auf der lokalen +x-Achse. Die Flaeche betraegt exakt
 * fraction * pi * radius^2: der Terminator ist eine Halbellipse mit der
 * Halbachse radius * (1 - 2 * fraction).
 */
export function makeLitMoonShape(radius: number, fraction: number): THREE.Shape {
  const k = Math.min(Math.max(fraction, 0), 1);
  const terminator = radius * (1 - 2 * k);
  const shape = new THREE.Shape();
  // Helle Kante: Halbkreis von unten ueber +x nach oben.
  shape.absarc(0, 0, radius, -Math.PI / 2, Math.PI / 2, false);
  // Terminator: Halbellipse zurueck nach unten.
  shape.absellipse(
    0,
    0,
    Math.max(Math.abs(terminator), radius * 1e-4),
    radius,
    Math.PI / 2,
    -Math.PI / 2,
    terminator >= 0,
    0
  );
  shape.closePath();
  return shape;
}

/**
 * Orientierung einer Scheibe, die dem Ursprung zugewandt ist: die lokale
 * x-Achse zeigt zur hellen Mondkante, die z-Achse zum Beobachter.
 */
export function limbBasis(toBody: THREE.Vector3, toLight: THREE.Vector3): THREE.Matrix4 {
  const body = toBody.clone().normalize();
  let limb = toLight.clone().addScaledVector(body, -toLight.dot(body));
  if (limb.lengthSq() < 1e-10) {
    // Licht genau hinter oder vor dem Koerper: beliebige Senkrechte waehlen.
    const fallback = Math.abs(body.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    limb = new THREE.Vector3().crossVectors(body, fallback);
  }
  limb.normalize();
  const towardObserver = body.clone().negate();
  const up = new THREE.Vector3().crossVectors(towardObserver, limb).normalize();
  return new THREE.Matrix4().makeBasis(limb, up, towardObserver);
}

export function formatDegrees(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace('.', ',')}°`;
}
