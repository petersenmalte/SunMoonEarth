# SunMoonEarth

Schematic 3D visualisation of the Sun, Moon and Earth for two observer
locations: **Hamburg** (Germany) and **Waterloo** (Ontario, Canada).

Two coordinated views show the same instant and the same observer:

1. **Local Sky** – Sun and Moon above the horizon plane with N/E/S/W,
   azimuth and altitude arrows, angle arcs and degree labels.
2. **Earth–Moon–Sun** – Earth, Moon and Sun in space, with Earth's day and
   night side, the Moon's lit and dark half, both location markers, the
   active observer's horizon plane, and elongation and phase angle.

The interface is in English.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # development server
npm run typecheck  # check TypeScript without emitting output
npm run build      # typecheck and production bundle into dist/
npm run preview    # serve dist/ locally under /
npm test           # Playwright checks against the built application
```

The checks start `vite preview` themselves. They need a Chromium build; if
none is available via `npx playwright install chromium`, an existing browser
can be used with `CHROMIUM_PATH=/path/to/chrome npm test`.

## Deployment

The application is a static site. `.github/workflows/deploy.yml` builds on
every push to `main` and publishes `dist/` via GitHub Pages at the custom
domain `https://lunarcompass.app/`.

The custom domain is set via `public/CNAME` (copied into `dist/` as-is by
Vite) plus four DNS `A` records at the domain's registrar pointing at
GitHub Pages' load balancer IPs (185.199.108.153, .109.153, .110.153,
.111.153). See GitHub's
[custom domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
for the exact steps and optional `AAAA`/`www` records.

The base path lives in `vite.config.ts` and can be changed without a code
change via the `BASE_PATH` environment variable, e.g.
`BASE_PATH=/SunMoonEarth/ npm run build` for a deployment back under a
github.io project-page path instead of the custom domain's root.

For the workflow to take effect, the source under *Settings → Pages* must be
set to **GitHub Actions**.

## Libraries and licenses

| Library | Version | License | Role |
| --- | --- | --- | --- |
| [Astronomy Engine](https://github.com/cosinekitty/astronomy) | 2.1.19 | MIT | all astronomical quantities |
| [Three.js](https://threejs.org/) | 0.186.0 | MIT | 3D rendering, `OrbitControls` for the camera |
| [@js-temporal/polyfill](https://github.com/js-temporal/temporal-polyfill) | 0.5.1 | ISC | time zones and daylight saving (Temporal, TC39 Stage 3) |
| [Vite](https://vite.dev/) | 8 | MIT | development server and bundling |
| [TypeScript](https://www.typescriptlang.org/) | 5.9 | Apache-2.0 | type checking |
| [Playwright](https://playwright.dev/) | 1.62 | Apache-2.0 | browser checks |

This project is licensed under the MIT license (see `LICENSE`).

## Where the numbers come from

The project contains **no astronomical algorithms of its own**. All
quantities come from Astronomy Engine (`src/astro.ts`), which implements
VSOP87 planetary theory for the Sun/Earth and an ELP2000-derived lunar
theory for the Moon:

| Quantity | Call |
| --- | --- |
| Equatorial coordinates of Sun and Moon | `Equator(body, date, observer, true, true)` |
| Azimuth and altitude | `Horizon(date, observer, ra, dec, 'normal')` |
| Illuminated fraction, phase angle | `Illumination(Body.Moon, date)` |
| Moon phase as a longitude difference | `MoonPhase(date)` |
| Sun–Earth–Moon elongation | `AngleFromSun(Body.Moon, date)` |
| Geocentric directions | `GeoVector(Body.Sun, …)`, `GeoMoon(date)` |
| An observer's site vector | `ObserverVector(date, observer, false)` |
| Local zenith in the EQJ system | `Rotation_HOR_EQJ(date, observer)` |
| Direction Moon → Sun in the horizon system | `Rotation_EQJ_HOR(date, observer)` |
| Earth's rotation axis | `RotationAxis(Body.Earth, date)` |
| Rise and set times | `SearchRiseSet(body, observer, ±1, date, 1)` |

Custom computation is limited to drawing geometry: spherical to Cartesian
coordinates, angle arcs, arrows, the Moon disc's basis, and the
terminator's half-ellipse.

### Coordinate systems

* **HOR** (Astronomy Engine): x = north, y = west, z = zenith. Azimuth
  clockwise from north, east = 90°.
* **EQJ** (Astronomy Engine): x = J2000 vernal equinox, z = celestial
  north pole.
* **Scene** (Three.js, y up): the local sky maps HOR via
  (x, y, z) → (−y, z, −x), i.e. x = east, y = up, z = south. The system
  view maps EQJ via (x, y, z) → (x, z, −y), i.e. y = celestial north pole.
  Both mappings preserve rotation, so angles are preserved.
* Lengths: Astronomy Engine computes in AU; the display converts to
  kilometers using `KM_PER_AU`. Angles are in degrees throughout.

### Time and daylight saving

Time zones and daylight saving are handled by Temporal (`src/time.ts`). An
entered local time is resolved via
`PlainDateTime.toZonedDateTime(zone, { disambiguation })`:

* **unambiguous** – `disambiguation: 'reject'` returns a single instant.
* **ambiguous** (end of daylight saving, the time occurs twice) – `'reject'`
  throws, `'earlier'` keeps the entered time. The UI shows both hours with
  their UTC offset for the user to choose.
* **nonexistent** (start of daylight saving, the time is skipped) –
  `'earlier'` returns a different time than entered. The UI explains this
  and shows the time shifted forward by `'compatible'`.

When switching locations, the absolute instant stays fixed; only the
displayed local time and time zone change.

## Schematic simplifications

The system view is deliberately **not to scale**. What is shortened and
what is not:

**Shortened (display only):**

* The radii of Earth, Moon and Sun, and the Earth–Moon and Earth–Sun
  distances. In reality the Sun is about 390 times farther away than the
  Moon; in the image the ratio is just under 2. A break mark on the
  Earth–Sun line flags this.
* Earth is drawn as a sphere. Its oblateness only enters the calculation
  through the library.

**Not shortened (from the calculated values):**

* All directions: Earth→Sun, Earth→Moon, Moon→Sun, the site vectors of
  both cities, Earth's axis and the observer's zenith.
* All angles: elongation and phase angle are drawn between the true
  direction vectors and are therefore measurable at true size in the image
  when looking perpendicular to the Sun–Earth–Moon plane. That is exactly
  how "Reset View" positions the camera.
* The lighting. Earth and Moon get their lighting direction as a uniform
  from the true direction vectors, **not** from the Sun's shortened
  position in the scene. The day/night boundary and the Moon phase
  therefore stay correct. For the same reason, the "Direction Moon → Sun"
  arrow does not point at the drawn Sun symbol but in the true direction;
  it runs nearly parallel to the Earth–Sun line, because the two
  directions differ by at most about 0.15°.

Further conventions:

* Moon phases arise solely from the Sun illuminating the lunar sphere.
  Earth's shadow plays no role; eclipses are not depicted.
* Altitude and azimuth include the refraction correction recommended by
  Astronomy Engine (`'normal'`). The system view, by contrast, shows
  geocentric directions without refraction — an atmospheric effect has no
  meaning there.
* "Above" and "below the horizon" refer to the **centre** of the body.
  `SearchRiseSet` additionally accounts for the disc's edge, so rise and
  set times fall a little later or earlier respectively.
* In the local sky, the Moon is a **disc** facing the observer, not a
  sphere. The camera stands outside the sky dome; a sphere would show it a
  different phase than the observer at the centre sees.

## Observer locations

| Location | Latitude | Longitude | Elevation | Time zone |
| --- | --- | --- | --- | --- |
| Hamburg, Germany | 53.55028° N | 9.99222° E | 8 m | `Europe/Berlin` |
| Waterloo, Ontario, Canada | 43.46667° N | 80.51667° W | 329 m | `America/Toronto` |

Hamburg refers to the City Hall at Rathausmarkt (53°33′01″N, 9°59′32″E),
Waterloo to the city coordinate 43°28′N, 80°31′W.

## Accessibility

* All controls are real buttons and input fields, and therefore reachable
  by keyboard; focus is visible.
* All key values are available as text outside the canvas under
  "Calculated Values"; the canvas itself is `aria-hidden`.
* The Moon phase indicator carries a text description and is independent
  of the 3D camera.
* Without WebGL the 3D scene stays empty; a notice explains this, and all
  numeric values and the phase indicator keep working.

## Checks

`npm test` verifies, among other things:

* starting in live mode with Hamburg,
* full and new moon against the library values,
* that a fixed moment stays put and "Now / Live" returns to the present,
* that switching location keeps the instant and shows the other local time,
* the below-the-horizon indication,
* both views, keyboard camera controls and the mobile layout,
* both daylight saving edge cases,
* that the drawn illuminated Moon area matches the calculated fraction
  (the path is rasterised and its pixels counted).
