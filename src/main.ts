/**
 * Application controller: connects the time model, astronomy calculations,
 * both 3D views and the UI controls. Both views, all angles, the lighting
 * and the phase indicator always use the same observer and the same instant.
 */

import * as THREE from 'three';
import { computeAstroState, type AstroState } from './astro';
import { DEFAULT_LOCATION_ID, LOCATIONS, locationById, type LocationSpec } from './locations';
import { PhaseIndicator } from './phaseIndicator';
import { SkyView } from './scene/skyView';
import { SystemView } from './scene/systemView';
import {
  Temporal,
  formatDateTimeParts,
  instantToDate,
  nowInstant,
  parseDateTimeLocalValue,
  resolveLocalTime,
  toDateTimeLocalValue
} from './time';
import './styles.css';

type ViewId = 'sky' | 'system';
type TimeMode = 'live' | 'fixed';

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
};

const stage = element<HTMLDivElement>('main-view');
const canvas = element<HTMLCanvasElement>('scene');
const fallback = element<HTMLDivElement>('webgl-fallback');
const hint = element<HTMLParagraphElement>('scene-hint');
const scaleCaption = element<HTMLParagraphElement>('scene-scale-note');
const tabSky = element<HTMLButtonElement>('tab-sky');
const tabSystem = element<HTMLButtonElement>('tab-system');
const resetButton = element<HTMLButtonElement>('camera-reset');
const northButton = element<HTMLButtonElement>('camera-north');
const locationGroup = element<HTMLDivElement>('location-choice');
const locationDetail = element<HTMLParagraphElement>('location-detail');
const modeRow = element<HTMLParagraphElement>('time-mode');
const modeText = element<HTMLSpanElement>('time-mode-text');
const nowButton = element<HTMLButtonElement>('time-now');
const timeInput = element<HTMLInputElement>('time-input');
const timeDisplay = element<HTMLParagraphElement>('time-display');
const timeWarning = element<HTMLParagraphElement>('time-warning');
const ambiguousBox = element<HTMLDivElement>('time-ambiguous');
const earlierButton = element<HTMLButtonElement>('dst-earlier');
const laterButton = element<HTMLButtonElement>('dst-later');
const readout = element<HTMLDListElement>('values');
const phaseIndicator = new PhaseIndicator(element<HTMLDivElement>('phase-indicator'));

const app = {
  mode: 'live' as TimeMode,
  instant: nowInstant(),
  location: locationById(DEFAULT_LOCATION_ID),
  view: 'sky' as ViewId,
  /** Which of the two hours applies for an ambiguous local time. */
  dstPreference: 'earlier' as 'earlier' | 'later',
  /** Last entered local time, for switching the DST choice. */
  pendingLocal: null as Temporal.PlainDateTime | null
};

const skyView = new SkyView();
const systemView = new SystemView();

let renderer: THREE.WebGLRenderer | null = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0f1418, 1);
  skyView.attachControls(canvas);
  systemView.attachControls(canvas);
} catch {
  renderer = null;
}

if (!renderer) {
  fallback.hidden = false;
  canvas.hidden = true;
  hint.hidden = true;
  resetButton.disabled = true;
  northButton.disabled = true;
}

/* ------------------------------------------------------------------ Location */

const locationButtons = new Map<string, HTMLButtonElement>();
for (const location of LOCATIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'segmented__button';
  button.textContent = location.label;
  button.setAttribute('aria-pressed', String(location.id === app.location.id));
  button.addEventListener('click', () => selectLocation(location));
  locationGroup.append(button);
  locationButtons.set(location.id, button);
}

/**
 * Switch the observer location. The absolute instant is preserved; only the
 * displayed local time and time zone change.
 */
function selectLocation(location: LocationSpec): void {
  app.location = location;
  for (const [id, button] of locationButtons) {
    button.setAttribute('aria-pressed', String(id === location.id));
  }
  // A local time already chosen still refers to the same instant, so it is
  // not re-resolved here - only redisplayed.
  app.pendingLocal = null;
  hideTimeMessages();
  refresh();
}

/* -------------------------------------------------------------- Time control */

nowButton.addEventListener('click', () => {
  app.mode = 'live';
  app.instant = nowInstant();
  app.pendingLocal = null;
  hideTimeMessages();
  refresh();
});

/**
 * Value the application itself last wrote into the input field. A change
 * event carrying exactly this value is not a new user entry - otherwise a
 * notice about a nonexistent local time would vanish immediately, because
 * the corrected time was written back into the field.
 */
let lastWrittenTimeValue = '';

timeInput.addEventListener('change', () => {
  if (timeInput.value === lastWrittenTimeValue) return;
  const local = parseDateTimeLocalValue(timeInput.value);
  if (!local) return;
  app.pendingLocal = local;
  applyPendingLocalTime();
});

earlierButton.addEventListener('click', () => {
  app.dstPreference = 'earlier';
  applyPendingLocalTime();
});
laterButton.addEventListener('click', () => {
  app.dstPreference = 'later';
  applyPendingLocalTime();
});

/** Resolves the entered local time to an instant via Temporal. */
function applyPendingLocalTime(): void {
  const local = app.pendingLocal;
  if (!local) return;
  const resolved = resolveLocalTime(local, app.location.timeZone, app.dstPreference);
  app.mode = 'fixed';
  app.instant = resolved.instant;

  if (resolved.kind === 'ambiguous') {
    ambiguousBox.hidden = false;
    earlierButton.setAttribute('aria-pressed', String(app.dstPreference === 'earlier'));
    laterButton.setAttribute('aria-pressed', String(app.dstPreference === 'later'));
    const alternatives = resolved.alternatives!;
    earlierButton.textContent = `First hour (${alternatives.earlier.offset})`;
    laterButton.textContent = `Second hour (${alternatives.later.offset})`;
    timeWarning.hidden = true;
  } else if (resolved.kind === 'nonexistent') {
    ambiguousBox.hidden = true;
    timeWarning.hidden = false;
    timeWarning.textContent =
      `This local time does not exist: the clock skips forward at the start of daylight ` +
      `saving time. Showing ${resolved.zoned.toPlainTime().toString({ smallestUnit: 'minute' })} ` +
      `(${resolved.zoned.offset}) instead.`;
  } else {
    hideTimeMessages();
  }
  refresh();
}

function hideTimeMessages(): void {
  timeWarning.hidden = true;
  ambiguousBox.hidden = true;
}

/* -------------------------------------------------------------- View choice */

tabSky.addEventListener('click', () => selectView('sky'));
tabSystem.addEventListener('click', () => selectView('system'));

function selectView(view: ViewId): void {
  app.view = view;
  tabSky.setAttribute('aria-selected', String(view === 'sky'));
  tabSystem.setAttribute('aria-selected', String(view === 'system'));
  stage.setAttribute('aria-labelledby', view === 'sky' ? 'tab-sky' : 'tab-system');
  northButton.disabled = renderer === null || view !== 'sky';
  // The scale note belongs to the schematic system view.
  scaleCaption.hidden = renderer === null || view !== 'system';
  if (skyView.controls) skyView.controls.enabled = view === 'sky';
  if (systemView.controls) systemView.controls.enabled = view === 'system';
  resize();
}

resetButton.addEventListener('click', () => {
  if (app.view === 'sky') skyView.resetCamera();
  else systemView.resetCamera();
});
northButton.addEventListener('click', () => skyView.alignNorth());

/* -------------------------------------------------------------------- Output */

function refresh(): void {
  if (app.mode === 'live') app.instant = nowInstant();

  const date = instantToDate(app.instant);
  const state = computeAstroState(date, app.location, LOCATIONS);

  updateTimeDisplay();
  updateReadout(state);
  phaseIndicator.update(state);

  skyView.update(state);
  systemView.update(state);
}

function updateTimeDisplay(): void {
  const parts = formatDateTimeParts(app.instant, app.location.timeZone);
  const live = app.mode === 'live';
  modeRow.classList.toggle('mode--fixed', !live);
  modeText.textContent = live ? 'Live – current time' : 'Fixed moment';
  nowButton.disabled = live;
  timeDisplay.innerHTML =
    `${app.location.label}, ${app.location.country}<br>${parts.date}<br>${parts.time} ` +
    `(${parts.zone}, UTC${parts.offset})`;
  locationDetail.textContent =
    `${formatCoordinate(app.location.latitude, 'lat')}, ${formatCoordinate(app.location.longitude, 'lon')}, ` +
    `${app.location.elevation} m above sea level · ${app.location.timeZone}`;

  const value = toDateTimeLocalValue(app.instant, app.location.timeZone);
  if (timeInput.value !== value) timeInput.value = value;
  lastWrittenTimeValue = value;
}

function formatCoordinate(value: number, kind: 'lat' | 'lon'): string {
  const hemisphere = kind === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return `${degrees}° ${minutes.toFixed(1)}′ ${hemisphere}`;
}

function degrees(value: number, digits = 1): string {
  // Avoids printing "-0.0" for values just below zero.
  const rounded = Number(value.toFixed(digits));
  return `${(rounded === 0 ? 0 : rounded).toFixed(digits)}°`;
}

function formatClock(date: Date | null, timeZone: string): string {
  if (!date) return 'no event in 24 h';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    hour12: false
  }).format(date);
}

function updateReadout(state: AstroState): void {
  const zone = state.location.timeZone;
  const rows: Array<[string, string, boolean?] | { group: string }> = [
    { group: 'Sun' },
    ['Azimuth', degrees(state.sun.azimuth)],
    ['Altitude', degrees(state.sun.altitude), !state.sun.aboveHorizon],
    ['Position', state.sun.aboveHorizon ? 'above the horizon' : 'below the horizon', !state.sun.aboveHorizon],
    ['Rise', formatClock(state.sunRiseSet.rise, zone)],
    ['Set', formatClock(state.sunRiseSet.set, zone)],
    ['Distance', `${(state.geo.sunDistanceKm / 1e6).toFixed(2)} million km`],

    { group: 'Moon' },
    ['Azimuth', degrees(state.moon.azimuth)],
    ['Altitude', degrees(state.moon.altitude), !state.moon.aboveHorizon],
    ['Position', state.moon.aboveHorizon ? 'above the horizon' : 'below the horizon', !state.moon.aboveHorizon],
    ['Rise', formatClock(state.moonRiseSet.rise, zone)],
    ['Set', formatClock(state.moonRiseSet.set, zone)],
    ['Distance', `${Math.round(state.geo.moonDistanceKm).toLocaleString('en-GB')} km`],

    { group: 'Moon phase' },
    ['Phase', state.phase.name],
    ['Illuminated', `${(state.phase.illuminatedFraction * 100).toFixed(1)} %`],
    ['Phase angle', degrees(state.phase.phaseAngle)],
    ['Elongation', degrees(state.phase.elongation)],
    ['Phase longitude', degrees(state.phase.phaseLongitude)]
  ];

  readout.innerHTML = rows
    .map((row) => {
      if ('group' in row) return `<div class="readout__group">${row.group}</div>`;
      const [label, value, below] = row;
      return `<dt>${label}</dt><dd${below ? ' class="readout--below"' : ''}>${value}</dd>`;
    })
    .join('');
}

/* ---------------------------------------------------------------- Rendering */

function resize(): void {
  if (!renderer) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width === 0 || height === 0) return;
  renderer.setSize(width, height, false);
  for (const view of [skyView, systemView]) {
    view.camera.aspect = width / height;
    view.camera.updateProjectionMatrix();
  }
  // The aspect ratio also determines how the system view is framed.
  systemView.refit();
}

function animate(): void {
  requestAnimationFrame(animate);
  if (!renderer) return;
  const active = app.view === 'sky' ? skyView : systemView;
  active.controls?.update();
  renderer.render(active.scene, active.camera);
}

new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);

selectView('sky');
resize();
refresh();
if (renderer) animate();

// Live mode: recompute once per second.
window.setInterval(() => {
  if (app.mode === 'live') refresh();
}, 1000);

declare global {
  interface Window {
    __sunMoonEarth?: {
      state: () => AstroState;
      setInstant: (iso: string) => void;
      setLocation: (id: string) => void;
      setView: (view: ViewId) => void;
    };
  }
}

// Small test interface for the automated checks.
window.__sunMoonEarth = {
  state: () => computeAstroState(instantToDate(app.instant), app.location, LOCATIONS),
  setInstant: (iso: string) => {
    app.mode = 'fixed';
    app.instant = Temporal.Instant.from(iso);
    app.pendingLocal = null;
    hideTimeMessages();
    refresh();
  },
  setLocation: (id: string) => selectLocation(locationById(id)),
  setView: (view: ViewId) => selectView(view)
};

export {};
