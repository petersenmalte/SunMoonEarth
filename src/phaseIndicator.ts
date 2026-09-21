/**
 * Moon phase indicator for the active observer.
 *
 * This indicator is not tied to the 3D camera: it shows the lunar disc the
 * way the observer sees it in the sky - with the zenith pointing up.
 *
 * Library values:
 *  - illuminated fraction k: Illumination(Body.Moon).phase_fraction
 *  - Moon and Sun directions: horizontal coordinates from Astronomy Engine
 *
 * The custom part is drawing geometry only:
 *  - The observer's picture plane is spanned by "up" (projection of the
 *    zenith) and "right" (Moon direction x up).
 *  - The angle of the bright limb follows from projecting the Sun direction
 *    into this plane.
 *  - The terminator is a half-ellipse with semi-axis R*(1-2k). For k = 0.5
 *    this becomes a straight line, for k = 1 the full circle.
 */

import type { AstroState, Vec3 } from './astro';
import { moonToSunInHorizonFrame } from './astro';

const SIZE = 120;
const CENTRE = SIZE / 2;
const RADIUS = SIZE / 2 - 8;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return length === 0 ? { x: 0, y: 0, z: 0 } : { x: v.x / length, y: v.y / length, z: v.z / length };
}

function subtractProjection(v: Vec3, onto: Vec3): Vec3 {
  const factor = dot(v, onto);
  return { x: v.x - factor * onto.x, y: v.y - factor * onto.y, z: v.z - factor * onto.z };
}

/**
 * Angle of the bright lunar limb, seen clockwise from "up" (the zenith
 * direction), in degrees.
 */
export function brightLimbAngle(state: AstroState): number {
  const moon = normalize(state.moon.horizonUnit);
  const sun = normalize(moonToSunInHorizonFrame(state.date, state.location, state.geo.moonToSunUnit));

  // Zenith in the HOR system.
  const zenith: Vec3 = { x: 0, y: 0, z: 1 };
  let up = subtractProjection(zenith, moon);
  if (Math.hypot(up.x, up.y, up.z) < 1e-6) {
    // Moon exactly at the zenith or nadir: use north as a fallback direction.
    up = subtractProjection({ x: 1, y: 0, z: 0 }, moon);
  }
  up = normalize(up);
  const right = normalize(cross(moon, up));

  const sunInPlane = subtractProjection(sun, moon);
  return (Math.atan2(dot(sunInPlane, right), dot(sunInPlane, up)) * 180) / Math.PI;
}

/**
 * SVG path of the illuminated area, bright limb facing +x.
 * The area is exactly k * pi * R^2.
 */
export function litAreaPath(fraction: number, radius = RADIUS, centre = CENTRE): string {
  const k = Math.min(Math.max(fraction, 0), 1);
  const terminator = radius * (1 - 2 * k);
  const top = `${centre} ${centre - radius}`;
  const bottom = `${centre} ${centre + radius}`;
  const brightLimb = `A ${radius} ${radius} 0 0 1 ${bottom}`;
  const sweep = terminator >= 0 ? 0 : 1;
  const back = `A ${Math.abs(terminator).toFixed(4)} ${radius} 0 0 ${sweep} ${top}`;
  return `M ${top} ${brightLimb} ${back} Z`;
}

export class PhaseIndicator {
  private readonly figure: HTMLElement;
  private readonly caption: HTMLElement;

  constructor(private readonly container: HTMLElement) {
    this.container.classList.add('phase-indicator');
    this.figure = document.createElement('div');
    this.figure.className = 'phase-indicator__figure';
    this.caption = document.createElement('p');
    this.caption.className = 'phase-indicator__caption';
    this.container.append(this.figure, this.caption);
  }

  update(state: AstroState): void {
    const angle = brightLimbAngle(state);
    const fraction = state.phase.illuminatedFraction;
    const percent = Math.round(fraction * 100);
    const description =
      `${state.phase.name}, ${percent} % illuminated, ` +
      `view for ${state.location.label}` +
      (state.moon.aboveHorizon ? '' : ' (Moon below the horizon)');

    this.figure.innerHTML = `
      <svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${escapeHtml(description)}" focusable="false">
        <circle class="phase-indicator__dark" cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}"></circle>
        <g transform="rotate(${(angle - 90).toFixed(2)} ${CENTRE} ${CENTRE})">
          <path class="phase-indicator__lit" d="${litAreaPath(fraction)}"></path>
        </g>
        <circle class="phase-indicator__rim" cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}"></circle>
        <line class="phase-indicator__zenith" x1="${CENTRE}" y1="6" x2="${CENTRE}" y2="16"></line>
        <text class="phase-indicator__zenith-label" x="${CENTRE}" y="${SIZE - 2}" text-anchor="middle">Horizon</text>
      </svg>
    `;
    this.figure.classList.toggle('phase-indicator__figure--below', !state.moon.aboveHorizon);
    this.caption.textContent = description;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
