/**
 * Drawing helpers shared by both scenes.
 *
 * This file contains only display geometry: arrows, arcs, labels, spheres.
 * Astronomical quantities come in from outside.
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

/** HOR system (x = north, y = west, z = zenith) -> scene (x = east, y = up, z = south). */
export function horizonToScene(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(-v.y, v.z, -v.x);
}

/** EQJ system (z = celestial north pole) -> scene (y = up along the north pole). */
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

/** Line from the origin in a direction, with a cone tip at the end. */
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
 * Circular arc between two directions, with radius `radius` around the
 * origin. Draws the shorter of the two possible arcs.
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

/** Point at the midpoint of an arc - where the degree label sits. */
export function arcMidpoint(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3 {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  const mid = a.clone().add(b);
  if (mid.lengthSq() < 1e-9) {
    // Opposite directions: pick an arbitrary perpendicular.
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
 * Text label as a sprite. The canvas is sized so the text stays sharp on
 * mobile devices too.
 */
export function makeLabel(text: string, worldHeight: number, options: LabelOptions = {}): THREE.Sprite {
  const fontSize = options.fontSize ?? 44;
  const padding = fontSize * 0.35;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D context not available');

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
 * Two-tone sphere: day and night side, separated by the plane perpendicular
 * to the lighting direction. The direction is set as a uniform rather than
 * derived from a light source position - this keeps the terminator correct
 * even when the scene shows strongly shortened distances.
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
        // Narrow soft edge so the terminator does not look ragged.
        float day = smoothstep(-0.03, 0.03, incidence);
        // Slight darkening toward the terminator makes the sphere shape legible.
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
 * Illuminated Moon area as a flat shape, as the observer sees it.
 * The bright limb lies on the local +x axis. The area is exactly
 * fraction * pi * radius^2: the terminator is a half-ellipse with semi-axis
 * radius * (1 - 2 * fraction).
 */
export function makeLitMoonShape(radius: number, fraction: number): THREE.Shape {
  const k = Math.min(Math.max(fraction, 0), 1);
  const terminator = radius * (1 - 2 * k);
  const shape = new THREE.Shape();
  // Bright limb: half-circle from bottom over +x to top.
  shape.absarc(0, 0, radius, -Math.PI / 2, Math.PI / 2, false);
  // Terminator: half-ellipse back down.
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
 * Orientation of a disc facing the origin: the local x axis points to the
 * bright lunar limb, the z axis toward the observer.
 */
export function limbBasis(toBody: THREE.Vector3, toLight: THREE.Vector3): THREE.Matrix4 {
  const body = toBody.clone().normalize();
  let limb = toLight.clone().addScaledVector(body, -toLight.dot(body));
  if (limb.lengthSq() < 1e-10) {
    // Light exactly behind or in front of the body: pick an arbitrary perpendicular.
    const fallback = Math.abs(body.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    limb = new THREE.Vector3().crossVectors(body, fallback);
  }
  limb.normalize();
  const towardObserver = body.clone().negate();
  const up = new THREE.Vector3().crossVectors(towardObserver, limb).normalize();
  return new THREE.Matrix4().makeBasis(limb, up, towardObserver);
}

export function formatDegrees(value: number, digits = 1): string {
  return `${value.toFixed(digits)}°`;
}
