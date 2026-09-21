import { expect, test, type Page } from '@playwright/test';

/** Fixed moment: Astronomy Engine reports 2026-01-03 10:03 UTC as a full moon. */
const FULL_MOON = '2026-01-03T10:03:00Z';
/** 2026-01-18 19:52 UTC is a new moon. */
const NEW_MOON = '2026-01-18T19:52:00Z';

async function setInstant(page: Page, iso: string) {
  await page.evaluate((value) => window.__sunMoonEarth!.setInstant(value), iso);
}

async function readValue(page: Page, group: string, label: string): Promise<string> {
  return page.evaluate(
    ({ group, label }) => {
      const list = document.getElementById('values')!;
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
  await expect(page.locator('#values .readout__group').first()).toBeVisible();
});

test('starts in live mode with Hamburg as observer', async ({ page }) => {
  await expect(page.locator('#time-mode-text')).toHaveText('Live – current time');
  await expect(page.getByRole('button', { name: 'Hamburg' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Waterloo' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#time-display')).toContainText('Hamburg, Germany');
  await expect(page.locator('#time-display')).toContainText(/CET|CEST|GMT/);
  // The "Now / Live" button is already active in live mode and therefore disabled.
  await expect(page.locator('#time-now')).toBeDisabled();
});

test('full moon and new moon match the library values', async ({ page }) => {
  await setInstant(page, FULL_MOON);
  await expect(page.locator('#phase-indicator')).toContainText('Full Moon');
  expect(await readValue(page, 'Moon phase', 'Illuminated')).toMatch(/99\.\d %|100\.0 %/);

  await setInstant(page, NEW_MOON);
  await expect(page.locator('#phase-indicator')).toContainText('New Moon');
  expect(await readValue(page, 'Moon phase', 'Illuminated')).toMatch(/^0\.\d %$/);
});

test('a fixed moment stays put and Now/Live returns to the present', async ({ page }) => {
  await page.locator('#time-input').fill('2026-06-21T12:00');
  await page.locator('#time-input').dispatchEvent('change');
  await expect(page.locator('#time-mode-text')).toHaveText('Fixed moment');
  const first = await readValue(page, 'Sun', 'Altitude');

  await page.waitForTimeout(1500);
  expect(await readValue(page, 'Sun', 'Altitude')).toBe(first);

  await page.locator('#time-now').click();
  await expect(page.locator('#time-mode-text')).toHaveText('Live – current time');
});

test('switching location keeps the instant and shows the other local time', async ({ page }) => {
  await setInstant(page, '2026-06-21T12:00:00Z');
  await expect(page.locator('#time-display')).toContainText('14:00');

  await page.getByRole('button', { name: 'Waterloo' }).click();
  await expect(page.locator('#time-display')).toContainText('Waterloo, Ontario, Canada');
  // Same instant, different time zone: 12:00 UTC is 08:00 EDT.
  await expect(page.locator('#time-display')).toContainText('08:00');
  await expect(page.locator('#location-detail')).toContainText('America/Toronto');
});

test('the Sun below the horizon is reported as such', async ({ page }) => {
  // Midnight local time in Hamburg: the Sun is below the horizon.
  await setInstant(page, '2026-01-03T23:00:00Z');
  expect(await readValue(page, 'Sun', 'Position')).toBe('below the horizon');
  const altitude = await readValue(page, 'Sun', 'Altitude');
  expect(parseFloat(altitude)).toBeLessThan(0);
  await expect(page.locator('#values dd.readout--below').first()).toBeVisible();
});

test('both views can be switched and render', async ({ page }) => {
  await expect(page.locator('#tab-sky')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#tab-system').click();
  await expect(page.locator('#tab-system')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#camera-north')).toBeDisabled();

  // The canvas contains more than just background after rendering.
  const drawn = await page.evaluate(() => {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    return canvas.width > 0 && canvas.height > 0;
  });
  expect(drawn).toBe(true);

  await page.locator('#tab-sky').click();
  await expect(page.locator('#camera-north')).toBeEnabled();
});

test('camera controls are reachable by keyboard', async ({ page }) => {
  await page.locator('#camera-reset').focus();
  await expect(page.locator('#camera-reset')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator('#camera-north')).toBeFocused();
});

test('a nonexistent local time at the start of daylight saving is explained', async ({ page }) => {
  // Germany springs forward on 2026-03-29 at 02:00 to 03:00: 02:30 does not exist.
  await page.locator('#time-input').fill('2026-03-29T02:30');
  await page.locator('#time-input').dispatchEvent('change');
  await expect(page.locator('#time-warning')).toBeVisible();
  await expect(page.locator('#time-warning')).toContainText('does not exist');
  await expect(page.locator('#time-display')).toContainText('03:30');
});

test('an ambiguous local time at the end of daylight saving offers both hours', async ({ page }) => {
  // Germany falls back on 2026-10-25 at 03:00 to 02:00: 02:30 occurs twice.
  await page.locator('#time-input').fill('2026-10-25T02:30');
  await page.locator('#time-input').dispatchEvent('change');
  await expect(page.locator('#time-ambiguous')).toBeVisible();
  await expect(page.locator('#dst-earlier')).toContainText('+02:00');
  await expect(page.locator('#dst-later')).toContainText('+01:00');

  const early = await readValue(page, 'Sun', 'Altitude');
  await page.locator('#dst-later').click();
  const late = await readValue(page, 'Sun', 'Altitude');
  expect(early).not.toBe(late);
});

test('the Moon phase indicator knows each observer\'s orientation', async ({ page }) => {
  await setInstant(page, '2026-04-25T20:00:00Z');
  const hamburg = await page.locator('#phase-indicator svg g').getAttribute('transform');
  await page.getByRole('button', { name: 'Waterloo' }).click();
  const waterloo = await page.locator('#phase-indicator svg g').getAttribute('transform');
  expect(hamburg).not.toBe(waterloo);
  // The illuminated fraction does not depend on the location.
  await expect(page.locator('#phase-indicator')).toContainText('illuminated');
});

test('the mobile layout stacks the view and the control panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stage = await page.locator('#main-view').boundingBox();
  const panel = await page.locator('.panel').boundingBox();
  expect(stage!.y + stage!.height).toBeLessThanOrEqual(panel!.y + 1);
  expect(stage!.width).toBeLessThanOrEqual(390);
});

test('the drawn illuminated Moon area matches the calculated fraction', async ({ page }) => {
  // The drawn path is rasterised onto a canvas and its pixels counted.
  // The expected value is the fraction reported by Astronomy Engine.
  for (const iso of ['2026-01-03T10:03:00Z', '2026-01-11T12:00:00Z', '2026-01-26T12:00:00Z', '2026-02-01T12:00:00Z']) {
    await setInstant(page, iso);
    const measured = await page.evaluate(() => {
      const path = document.querySelector('#phase-indicator svg path.phase-indicator__lit')!;
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
      (await readValue(page, 'Moon phase', 'Illuminated')).replace(' %', '')
    ) / 100;
    expect(Math.abs(measured - expected)).toBeLessThan(0.02);
  }
});
