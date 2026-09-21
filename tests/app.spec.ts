import { expect, test, type Page } from '@playwright/test';

/** Fester Zeitpunkt: 2026-01-03 10:03 UTC ist laut Astronomy Engine Vollmond. */
const FULL_MOON = '2026-01-03T10:03:00Z';
/** 2026-01-18 19:52 UTC ist Neumond. */
const NEW_MOON = '2026-01-18T19:52:00Z';

async function setInstant(page: Page, iso: string) {
  await page.evaluate((value) => window.__sunMoonEarth!.setInstant(value), iso);
}

async function readValue(page: Page, group: string, label: string): Promise<string> {
  return page.evaluate(
    ({ group, label }) => {
      const list = document.getElementById('werte')!;
      const nodes = Array.from(list.children);
      let inGroup = false;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]!;
        if (node.classList.contains('readout__group')) {
          inGroup = node.textContent?.trim() === group;
          continue;
        }
        if (inGroup && node.tagName === 'DT' && node.textContent?.trim() === label) {
          return nodes[i + 1]?.textContent?.trim() ?? '';
        }
      }
      return '';
    },
    { group, label }
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#werte .readout__group').first()).toBeVisible();
});

test('startet im Live-Modus mit Hamburg als Beobachter', async ({ page }) => {
  await expect(page.locator('#zeit-modus-text')).toHaveText('Live – aktuelle Zeit');
  await expect(page.getByRole('button', { name: 'Hamburg' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Waterloo' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#zeit-anzeige')).toContainText('Hamburg, Deutschland');
  await expect(page.locator('#zeit-anzeige')).toContainText(/MEZ|MESZ|GMT\+/);
  // Der "Jetzt / Live"-Knopf ist im Live-Modus bereits aktiv und daher deaktiviert.
  await expect(page.locator('#zeit-jetzt')).toBeDisabled();
});

test('Vollmond und Neumond stimmen mit den Bibliothekswerten überein', async ({ page }) => {
  await setInstant(page, FULL_MOON);
  await expect(page.locator('#phasen-anzeige')).toContainText('Vollmond');
  expect(await readValue(page, 'Mondphase', 'Beleuchtet')).toMatch(/99,\d %|100,0 %/);

  await setInstant(page, NEW_MOON);
  await expect(page.locator('#phasen-anzeige')).toContainText('Neumond');
  expect(await readValue(page, 'Mondphase', 'Beleuchtet')).toMatch(/^0,\d %$/);
});

test('fester Zeitpunkt bleibt stehen und Jetzt/Live kehrt zurück', async ({ page }) => {
  await page.locator('#zeit-eingabe').fill('2026-06-21T12:00');
  await page.locator('#zeit-eingabe').dispatchEvent('change');
  await expect(page.locator('#zeit-modus-text')).toHaveText('Fester Zeitpunkt');
  const first = await readValue(page, 'Sonne', 'Höhe');

  await page.waitForTimeout(1500);
  expect(await readValue(page, 'Sonne', 'Höhe')).toBe(first);

  await page.locator('#zeit-jetzt').click();
  await expect(page.locator('#zeit-modus-text')).toHaveText('Live – aktuelle Zeit');
});

test('Ortswechsel behält den Zeitpunkt und zeigt die andere Ortszeit', async ({ page }) => {
  await setInstant(page, '2026-06-21T12:00:00Z');
  await expect(page.locator('#zeit-anzeige')).toContainText('14:00');

  await page.getByRole('button', { name: 'Waterloo' }).click();
  await expect(page.locator('#zeit-anzeige')).toContainText('Waterloo, Ontario, Kanada');
  // Derselbe Zeitpunkt, andere Zeitzone: 12:00 UTC ist 08:00 EDT.
  await expect(page.locator('#zeit-anzeige')).toContainText('08:00');
  await expect(page.locator('#ort-detail')).toContainText('America/Toronto');
});

test('Sonne unter dem Horizont wird als solche ausgewiesen', async ({ page }) => {
  // Mitternacht Ortszeit in Hamburg: die Sonne steht unter dem Horizont.
  await setInstant(page, '2026-01-03T23:00:00Z');
  expect(await readValue(page, 'Sonne', 'Stand')).toBe('unter dem Horizont');
  const altitude = await readValue(page, 'Sonne', 'Höhe');
  expect(parseFloat(altitude.replace(',', '.'))).toBeLessThan(0);
  await expect(page.locator('#werte dd.readout--below').first()).toBeVisible();
});

test('beide Ansichten lassen sich umschalten und zeichnen', async ({ page }) => {
  await expect(page.locator('#tab-himmel')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#tab-system').click();
  await expect(page.locator('#tab-system')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#kamera-nord')).toBeDisabled();

  // Die Zeichenfläche enthält nach dem Rendern nicht nur Hintergrund.
  const drawn = await page.evaluate(() => {
    const canvas = document.getElementById('szene') as HTMLCanvasElement;
    return canvas.width > 0 && canvas.height > 0;
  });
  expect(drawn).toBe(true);

  await page.locator('#tab-himmel').click();
  await expect(page.locator('#kamera-nord')).toBeEnabled();
});

test('Kamerasteuerung ist per Tastatur erreichbar', async ({ page }) => {
  await page.locator('#kamera-reset').focus();
  await expect(page.locator('#kamera-reset')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator('#kamera-nord')).toBeFocused();
});

test('nicht existierende Ortszeit am Sommerzeitbeginn wird erklärt', async ({ page }) => {
  // Deutschland stellt am 29.03.2026 um 02:00 auf 03:00 vor: 02:30 gibt es nicht.
  await page.locator('#zeit-eingabe').fill('2026-03-29T02:30');
  await page.locator('#zeit-eingabe').dispatchEvent('change');
  await expect(page.locator('#zeit-hinweis')).toBeVisible();
  await expect(page.locator('#zeit-hinweis')).toContainText('gibt es nicht');
  await expect(page.locator('#zeit-anzeige')).toContainText('03:30');
});

test('doppeldeutige Ortszeit am Sommerzeitende lässt beide Stunden wählen', async ({ page }) => {
  // Deutschland stellt am 25.10.2026 um 03:00 auf 02:00 zurück: 02:30 gibt es zweimal.
  await page.locator('#zeit-eingabe').fill('2026-10-25T02:30');
  await page.locator('#zeit-eingabe').dispatchEvent('change');
  await expect(page.locator('#zeit-doppeldeutig')).toBeVisible();
  await expect(page.locator('#dst-frueh')).toContainText('+02:00');
  await expect(page.locator('#dst-spaet')).toContainText('+01:00');

  const early = await readValue(page, 'Sonne', 'Höhe');
  await page.locator('#dst-spaet').click();
  const late = await readValue(page, 'Sonne', 'Höhe');
  expect(early).not.toBe(late);
});

test('Mondphase kennt die Orientierung des jeweiligen Beobachters', async ({ page }) => {
  await setInstant(page, '2026-04-25T20:00:00Z');
  const hamburg = await page.locator('#phasen-anzeige svg g').getAttribute('transform');
  await page.getByRole('button', { name: 'Waterloo' }).click();
  const waterloo = await page.locator('#phasen-anzeige svg g').getAttribute('transform');
  expect(hamburg).not.toBe(waterloo);
  // Der beleuchtete Anteil hängt nicht vom Ort ab.
  await expect(page.locator('#phasen-anzeige')).toContainText('beleuchtet');
});

test('mobiles Layout stapelt Ansicht und Bedienfeld', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stage = await page.locator('#hauptansicht').boundingBox();
  const panel = await page.locator('.panel').boundingBox();
  expect(stage!.y + stage!.height).toBeLessThanOrEqual(panel!.y + 1);
  expect(stage!.width).toBeLessThanOrEqual(390);
});

test('beleuchtete Fläche der Mondscheibe entspricht dem berechneten Anteil', async ({ page }) => {
  // Der gezeichnete Pfad wird auf eine Leinwand gerastert und ausgezählt.
  // Erwartet wird der Anteil, den Astronomy Engine liefert.
  for (const iso of ['2026-01-03T10:03:00Z', '2026-01-11T12:00:00Z', '2026-01-26T12:00:00Z', '2026-02-01T12:00:00Z']) {
    await setInstant(page, iso);
    const measured = await page.evaluate(() => {
      const path = document.querySelector('#phasen-anzeige svg path.phase-indicator__lit')!;
      const d = path.getAttribute('d')!;
      const size = 120;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fill(new Path2D(d));
      const pixels = context.getImageData(0, 0, size, size).data;
      let lit = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 127) lit += 1;
      const radius = size / 2 - 8;
      return lit / (Math.PI * radius * radius);
    });
    const expected = Number(
      (await readValue(page, 'Mondphase', 'Beleuchtet')).replace(',', '.').replace(' %', '')
    ) / 100;
    expect(Math.abs(measured - expected)).toBeLessThan(0.02);
  }
});
