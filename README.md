# SunMoonEarth

Schematische 3D-Darstellung von Sonne, Mond und Erde für zwei Beobachtungsorte:
**Hamburg** (Deutschland) und **Waterloo** (Ontario, Kanada).

Zwei gekoppelte Ansichten zeigen denselben Zeitpunkt und denselben Beobachter:

1. **Lokaler Himmel** – Sonne und Mond über der Horizontebene mit N/O/S/W,
   Azimut- und Höhenpfeilen, Winkelbögen und Gradangaben.
2. **Erde–Mond–Sonne** – Erde, Mond und Sonne im Raum, mit Tag- und Nachtseite
   der Erde, beleuchteter und dunkler Mondhälfte, beiden Ortsmarken, der
   Horizontebene des aktiven Beobachters sowie Elongation und Phasenwinkel.

Die Oberfläche ist deutsch.

## Entwicklung

Voraussetzung: Node.js 22 oder neuer.

```sh
npm install
npm run dev        # Entwicklungsserver
npm run typecheck  # TypeScript ohne Ausgabe prüfen
npm run build      # Typprüfung und Produktionsbündel nach dist/
npm run preview    # dist/ lokal unter /SunMoonEarth/ ausliefern
npm test           # Playwright-Prüfungen gegen die gebaute Anwendung
```

Die Prüfungen starten `vite preview` selbst. Sie brauchen einen Chromium-Build;
ist keiner über `npx playwright install chromium` vorhanden, lässt sich mit
`CHROMIUM_PATH=/pfad/zu/chrome npm test` ein vorhandener Browser verwenden.

## Auslieferung

Die Anwendung ist eine statische Seite. `.github/workflows/deploy.yml` baut bei
jedem Push auf `main` und veröffentlicht `dist/` über GitHub Pages unter
`https://petersenmalte.github.io/SunMoonEarth/`.

Der Basispfad steht in `vite.config.ts` und lässt sich ohne Codeänderung über
die Umgebungsvariable `BASE_PATH` umstellen, etwa `BASE_PATH=/ npm run build`
für eine Auslieferung im Wurzelverzeichnis einer anderen Domain.

Damit der Arbeitsablauf greift, muss unter *Settings → Pages* als Quelle
**GitHub Actions** eingestellt sein.

## Bibliotheken und Lizenzen

| Bibliothek | Version | Lizenz | Aufgabe |
| --- | --- | --- | --- |
| [Astronomy Engine](https://github.com/cosinekitty/astronomy) | 2.1.19 | MIT | sämtliche astronomischen Größen |
| [Three.js](https://threejs.org/) | 0.186.0 | MIT | 3D-Darstellung, `OrbitControls` für die Kamera |
| [@js-temporal/polyfill](https://github.com/js-temporal/temporal-polyfill) | 0.5.1 | ISC | Zeitzonen und Sommerzeit (Temporal, TC39 Stage 3) |
| [Vite](https://vite.dev/) | 8 | MIT | Entwicklungsserver und Bündelung |
| [TypeScript](https://www.typescriptlang.org/) | 5.9 | Apache-2.0 | Typprüfung |
| [Playwright](https://playwright.dev/) | 1.62 | Apache-2.0 | Browser-Prüfungen |

Dieses Projekt steht unter der MIT-Lizenz (siehe `LICENSE`).

## Woher die Zahlen kommen

Es sind **keine eigenen astronomischen Algorithmen** im Projekt. Alle Größen
stammen aus Astronomy Engine (`src/astro.ts`):

| Größe | Aufruf |
| --- | --- |
| Äquatorkoordinaten von Sonne und Mond | `Equator(body, date, observer, true, true)` |
| Azimut und Höhe | `Horizon(date, observer, ra, dec, 'normal')` |
| beleuchteter Anteil, Phasenwinkel | `Illumination(Body.Moon, date)` |
| Mondphase als Längendifferenz | `MoonPhase(date)` |
| Elongation Sonne–Erde–Mond | `AngleFromSun(Body.Moon, date)` |
| geozentrische Richtungen | `GeoVector(Body.Sun, …)`, `GeoMoon(date)` |
| Ortsvektor eines Beobachters | `ObserverVector(date, observer, false)` |
| lokaler Zenit im EQJ-System | `Rotation_HOR_EQJ(date, observer)` |
| Richtung Mond → Sonne im Horizontsystem | `Rotation_EQJ_HOR(date, observer)` |
| Erdachse | `RotationAxis(Body.Earth, date)` |
| Auf- und Untergänge | `SearchRiseSet(body, observer, ±1, date, 1)` |

Eigene Rechnung ist auf Zeichen-Geometrie beschränkt: Kugel- in kartesische
Koordinaten, Winkelbögen, Pfeile, die Basis der Mondscheibe und die Halbellipse
des Terminators.

### Koordinatensysteme

* **HOR** (Astronomy Engine): x = Nord, y = West, z = Zenit. Azimut im
  Uhrzeigersinn ab Nord, Ost = 90°.
* **EQJ** (Astronomy Engine): x = Frühlingspunkt J2000, z = Himmelsnordpol.
* **Szene** (Three.js, y oben): Der lokale Himmel bildet HOR ab über
  (x, y, z) → (−y, z, −x), also x = Ost, y = oben, z = Süd. Die Systemansicht
  bildet EQJ ab über (x, y, z) → (x, z, −y), also y = Himmelsnordpol. Beide
  Abbildungen sind drehungserhaltend, Winkel bleiben also erhalten.
* Längen: Astronomy Engine rechnet in AE, die Anzeige rechnet mit `KM_PER_AU`
  in Kilometer um. Winkel sind durchgehend Grad.

### Zeit und Sommerzeit

Zeitzonen und Sommerzeit übernimmt Temporal (`src/time.ts`). Eine eingegebene
Ortszeit wird über `PlainDateTime.toZonedDateTime(zone, { disambiguation })`
aufgelöst:

* **eindeutig** – `disambiguation: 'reject'` liefert einen Zeitpunkt.
* **doppeldeutig** (Ende der Sommerzeit, die Uhrzeit gibt es zweimal) –
  `'reject'` wirft, `'earlier'` behält die eingegebene Uhrzeit. Die Oberfläche
  zeigt beide Stunden mit ihrem UTC-Versatz zur Auswahl.
* **nicht existent** (Beginn der Sommerzeit, die Uhrzeit wird übersprungen) –
  `'earlier'` liefert eine andere Uhrzeit als eingegeben. Die Oberfläche
  erklärt das und zeigt die von `'compatible'` nach vorn verschobene Zeit.

Beim Ortswechsel bleibt der absolute Zeitpunkt stehen; nur die angezeigte
Ortszeit und die Zeitzone ändern sich.

## Schematische Vereinfachungen

Die Systemansicht ist bewusst **nicht maßstabsgetreu**. Was verkürzt ist und
was nicht:

**Verkürzt (nur Darstellung):**

* Radien von Erde, Mond und Sonne sowie die Abstände Erde–Mond und Erde–Sonne.
  In Wirklichkeit ist die Sonne rund 390-mal weiter entfernt als der Mond; im
  Bild ist das Verhältnis knapp 2. Eine Bruchmarke auf der Linie Erde–Sonne
  weist darauf hin.
* Die Erde ist als Kugel gezeichnet. Ihre Abplattung geht nur über die
  Bibliothek in die Rechnung ein.

**Nicht verkürzt (aus den berechneten Werten):**

* Alle Richtungen: Erde→Sonne, Erde→Mond, Mond→Sonne, die Ortsvektoren beider
  Städte, die Erdachse und der Zenit des Beobachters.
* Alle Winkel: Elongation und Phasenwinkel werden zwischen den echten
  Richtungsvektoren gezeichnet und sind daher im Bild in wahrer Größe messbar,
  wenn man senkrecht auf die Ebene Sonne–Erde–Mond schaut. Genau so setzt
  „Ansicht zurücksetzen“ die Kamera.
* Die Beleuchtung. Erde und Mond bekommen ihre Lichtrichtung als Uniform aus
  den echten Richtungsvektoren, **nicht** aus der verkürzten Position der
  Sonne in der Szene. Tag-/Nachtgrenze und Mondphase bleiben dadurch korrekt.
  Aus demselben Grund zeigt der Pfeil „Richtung Mond → Sonne“ nicht auf das
  gezeichnete Sonnensymbol, sondern in die echte Richtung; er verläuft nahezu
  parallel zur Linie Erde–Sonne, weil sich beide Richtungen um höchstens etwa
  0,15° unterscheiden.

Weitere Festlegungen:

* Mondphasen entstehen ausschließlich durch die Beleuchtung der Mondkugel
  durch die Sonne. Der Erdschatten spielt keine Rolle; Finsternisse werden
  nicht dargestellt.
* Azimut und Höhe enthalten die von Astronomy Engine empfohlene
  Refraktionskorrektur (`'normal'`). Die Systemansicht zeigt dagegen
  geozentrische Richtungen ohne Refraktion — ein atmosphärischer Effekt hat
  dort keine Bedeutung.
* „Über“ und „unter dem Horizont“ beziehen sich auf den **Mittelpunkt** des
  Gestirns. `SearchRiseSet` berücksichtigt zusätzlich den Scheibenrand, daher
  liegen Auf- und Untergangszeiten etwas später beziehungsweise früher.
* Im lokalen Himmel ist der Mond eine dem Beobachter zugewandte **Scheibe**,
  keine Kugel. Die Kamera steht außerhalb der Himmelskuppel; eine Kugel würde
  ihr eine andere Phase zeigen als dem Beobachter im Mittelpunkt.

## Beobachtungsorte

| Ort | Breite | Länge | Höhe | Zeitzone |
| --- | --- | --- | --- | --- |
| Hamburg, Deutschland | 53,55028° N | 9,99222° O | 8 m | `Europe/Berlin` |
| Waterloo, Ontario, Kanada | 43,46667° N | 80,51667° W | 329 m | `America/Toronto` |

Hamburg bezieht sich auf das Rathaus am Rathausmarkt (53°33′01″N, 9°59′32″E),
Waterloo auf die Stadtkoordinate 43°28′N, 80°31′W.

## Barrierefreiheit

* Alle Bedienelemente sind echte Knöpfe und Eingabefelder und damit über die
  Tastatur erreichbar; der Fokus ist sichtbar.
* Alle wichtigen Werte stehen als Text außerhalb der Zeichenfläche unter
  „Berechnete Werte“; die Zeichenfläche selbst ist `aria-hidden`.
* Die Mondphasen-Anzeige trägt eine Textbeschreibung und ist von der
  3D-Kamera unabhängig.
* Ohne WebGL bleibt die 3D-Szene leer; ein Hinweis erklärt das, und alle
  Zahlenwerte sowie die Phasenanzeige funktionieren weiter.

## Prüfungen

`npm test` prüft unter anderem:

* Start im Live-Modus mit Hamburg,
* Voll- und Neumond gegen die Bibliothekswerte,
* dass ein fester Zeitpunkt stehen bleibt und „Jetzt / Live“ zurückführt,
* dass ein Ortswechsel den Zeitpunkt behält und die andere Ortszeit zeigt,
* die Kennzeichnung unter dem Horizont,
* beide Ansichten, die Kamerabedienung über die Tastatur und das mobile Layout,
* beide Sommerzeit-Sonderfälle,
* dass die gezeichnete helle Mondfläche dem berechneten Anteil entspricht
  (der Pfad wird gerastert und ausgezählt).
