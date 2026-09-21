/**
 * Anwendungssteuerung: verbindet Zeitmodell, Astronomie, beide 3D-Ansichten
 * und die Bedienelemente. Beide Ansichten, alle Winkel, die Beleuchtung und
 * die Phasenanzeige benutzen immer denselben Beobachter und denselben
 * Zeitpunkt.
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
  if (!found) throw new Error(`Element fehlt: ${id}`);
  return found as T;
};

const stage = element<HTMLDivElement>('hauptansicht');
const canvas = element<HTMLCanvasElement>('szene');
const fallback = element<HTMLDivElement>('webgl-fallback');
const hint = element<HTMLParagraphElement>('szene-hinweis');
const scaleCaption = element<HTMLParagraphElement>('szene-massstab');
const tabSky = element<HTMLButtonElement>('tab-himmel');
const tabSystem = element<HTMLButtonElement>('tab-system');
const resetButton = element<HTMLButtonElement>('kamera-reset');
const northButton = element<HTMLButtonElement>('kamera-nord');
const locationGroup = element<HTMLDivElement>('ort-auswahl');
const locationDetail = element<HTMLParagraphElement>('ort-detail');
const modeRow = element<HTMLParagraphElement>('zeit-modus');
const modeText = element<HTMLSpanElement>('zeit-modus-text');
const nowButton = element<HTMLButtonElement>('zeit-jetzt');
const timeInput = element<HTMLInputElement>('zeit-eingabe');
const timeDisplay = element<HTMLParagraphElement>('zeit-anzeige');
const timeWarning = element<HTMLParagraphElement>('zeit-hinweis');
const ambiguousBox = element<HTMLDivElement>('zeit-doppeldeutig');
const earlierButton = element<HTMLButtonElement>('dst-frueh');
const laterButton = element<HTMLButtonElement>('dst-spaet');
const readout = element<HTMLDListElement>('werte');
const phaseIndicator = new PhaseIndicator(element<HTMLDivElement>('phasen-anzeige'));

const app = {
  mode: 'live' as TimeMode,
  instant: nowInstant(),
  location: locationById(DEFAULT_LOCATION_ID),
  view: 'sky' as ViewId,
  /** Welche der beiden Stunden bei einer doppeldeutigen Ortszeit gilt. */
  dstPreference: 'earlier' as 'earlier' | 'later',
  /** Zuletzt eingegebene Ortszeit, fuer den Wechsel der DST-Auswahl. */
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

/* ------------------------------------------------------------------ Ortswahl */

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
 * Ortswechsel. Der absolute Zeitpunkt bleibt erhalten; nur die angezeigte
 * Ortszeit und die Zeitzone aendern sich.
 */
function selectLocation(location: LocationSpec): void {
  app.location = location;
  for (const [id, button] of locationButtons) {
    button.setAttribute('aria-pressed', String(id === location.id));
  }
  // Eine bereits gewaehlte Ortszeit gilt weiter als derselbe Zeitpunkt,
  // also wird sie nicht neu aufgeloest - nur neu angezeigt.
  app.pendingLocal = null;
  hideTimeMessages();
  refresh();
}

/* ---------------------------------------------------------------- Zeitsteuerung */

nowButton.addEventListener('click', () => {
  app.mode = 'live';
  app.instant = nowInstant();
  app.pendingLocal = null;
  hideTimeMessages();
  refresh();
});

/**
 * Wert, den die Anwendung zuletzt selbst in das Eingabefeld geschrieben hat.
 * Ein change-Ereignis mit genau diesem Wert ist keine neue Eingabe - sonst
 * wuerde etwa der Hinweis auf eine nicht existierende Ortszeit sofort wieder
 * verschwinden, weil die korrigierte Zeit zurueckgeschrieben wurde.
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

/** Rechnet die eingegebene Ortszeit ueber Temporal in einen Zeitpunkt um. */
function applyPendingLocalTime(): void {
  const local = app.pendingLocal;
  if (!local) return;
  const resolved = resolveLocalTime(local, app.location.timeZone, app.dstPreference);
  app.mode = 'fixed';
  app.instant = resolved.instant;

  if (resolved.kind === 'doppeldeutig') {
    ambiguousBox.hidden = false;
    earlierButton.setAttribute('aria-pressed', String(app.dstPreference === 'earlier'));
    laterButton.setAttribute('aria-pressed', String(app.dstPreference === 'later'));
    const alternatives = resolved.alternatives!;
    earlierButton.textContent = `Erste Stunde (${alternatives.earlier.offset})`;
    laterButton.textContent = `Zweite Stunde (${alternatives.later.offset})`;
    timeWarning.hidden = true;
  } else if (resolved.kind === 'nicht-existent') {
    ambiguousBox.hidden = true;
    timeWarning.hidden = false;
    timeWarning.textContent =
      `Diese Ortszeit gibt es nicht: die Uhr springt am Beginn der Sommerzeit vor. ` +
      `Gezeigt wird stattdessen ${resolved.zoned.toPlainTime().toString({ smallestUnit: 'minute' })} Uhr (${resolved.zoned.offset}).`;
  } else {
    hideTimeMessages();
  }
  refresh();
}

function hideTimeMessages(): void {
  timeWarning.hidden = true;
  ambiguousBox.hidden = true;
}

/* -------------------------------------------------------------- Ansichtswahl */

tabSky.addEventListener('click', () => selectView('sky'));
tabSystem.addEventListener('click', () => selectView('system'));

function selectView(view: ViewId): void {
  app.view = view;
  tabSky.setAttribute('aria-selected', String(view === 'sky'));
  tabSystem.setAttribute('aria-selected', String(view === 'system'));
  stage.setAttribute('aria-labelledby', view === 'sky' ? 'tab-himmel' : 'tab-system');
  northButton.disabled = renderer === null || view !== 'sky';
  // Der Maßstabs-Hinweis gehört zur schematischen Systemansicht.
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

/* ------------------------------------------------------------------- Ausgabe */

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
  modeText.textContent = live ? 'Live – aktuelle Zeit' : 'Fester Zeitpunkt';
  nowButton.disabled = live;
  timeDisplay.innerHTML =
    `${app.location.label}, ${app.location.country}<br>${parts.date}<br>${parts.time} Uhr ` +
    `(${parts.zone}, UTC${parts.offset})`;
  locationDetail.textContent =
    `${formatCoordinate(app.location.latitude, 'lat')}, ${formatCoordinate(app.location.longitude, 'lon')}, ` +
    `${app.location.elevation} m ü. NN · ${app.location.timeZone}`;

  const value = toDateTimeLocalValue(app.instant, app.location.timeZone);
  if (timeInput.value !== value) timeInput.value = value;
  lastWrittenTimeValue = value;
}

function formatCoordinate(value: number, kind: 'lat' | 'lon'): string {
  const hemisphere = kind === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'O' : 'W';
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return `${degrees}° ${minutes.toFixed(1).replace('.', ',')}′ ${hemisphere}`;
}

function degrees(value: number, digits = 1): string {
  // Verhindert die Ausgabe "-0,0" bei Werten knapp unter null.
  const rounded = Number(value.toFixed(digits));
  return `${(rounded === 0 ? 0 : rounded).toFixed(digits).replace('.', ',')}°`;
}

function formatClock(date: Date | null, timeZone: string): string {
  if (!date) return 'kein Ereignis in 24 h';
  return `${new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    hour12: false
  }).format(date)} Uhr`;
}

function updateReadout(state: AstroState): void {
  const zone = state.location.timeZone;
  const rows: Array<[string, string, boolean?] | { group: string }> = [
    { group: 'Sonne' },
    ['Azimut', degrees(state.sun.azimuth)],
    ['Höhe', degrees(state.sun.altitude), !state.sun.aboveHorizon],
    ['Stand', state.sun.aboveHorizon ? 'über dem Horizont' : 'unter dem Horizont', !state.sun.aboveHorizon],
    ['Aufgang', formatClock(state.sunRiseSet.rise, zone)],
    ['Untergang', formatClock(state.sunRiseSet.set, zone)],
    ['Entfernung', `${(state.geo.sunDistanceKm / 1e6).toFixed(2).replace('.', ',')} Mio. km`],

    { group: 'Mond' },
    ['Azimut', degrees(state.moon.azimuth)],
    ['Höhe', degrees(state.moon.altitude), !state.moon.aboveHorizon],
    ['Stand', state.moon.aboveHorizon ? 'über dem Horizont' : 'unter dem Horizont', !state.moon.aboveHorizon],
    ['Aufgang', formatClock(state.moonRiseSet.rise, zone)],
    ['Untergang', formatClock(state.moonRiseSet.set, zone)],
    ['Entfernung', `${Math.round(state.geo.moonDistanceKm).toLocaleString('de-DE')} km`],

    { group: 'Mondphase' },
    ['Phase', state.phase.name],
    ['Beleuchtet', `${(state.phase.illuminatedFraction * 100).toFixed(1).replace('.', ',')} %`],
    ['Phasenwinkel', degrees(state.phase.phaseAngle)],
    ['Elongation', degrees(state.phase.elongation)],
    ['Phasenlänge', degrees(state.phase.phaseLongitude)]
  ];

  readout.innerHTML = rows
    .map((row) => {
      if ('group' in row) return `<div class="readout__group">${row.group}</div>`;
      const [label, value, below] = row;
      return `<dt>${label}</dt><dd${below ? ' class="readout--below"' : ''}>${value}</dd>`;
    })
    .join('');
}

/* ------------------------------------------------------------------ Rendering */

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
  // Das Seitenverhaeltnis bestimmt die Einpassung der Systemansicht mit.
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

// Live-Modus: einmal pro Sekunde neu rechnen.
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

// Kleine Testschnittstelle fuer die automatisierten Pruefungen.
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
