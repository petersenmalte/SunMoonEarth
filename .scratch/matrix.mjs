import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await b.newPage({ viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'UTC' });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:4174/SunMoonEarth/');
await page.waitForSelector('#werte .readout__group');

const read = (group, label) => page.evaluate(({group,label}) => {
  const n = Array.from(document.getElementById('werte').children);
  let inG = false;
  for (let i=0;i<n.length;i++){
    if (n[i].classList.contains('readout__group')) { inG = n[i].textContent.trim()===group; continue; }
    if (inG && n[i].tagName==='DT' && n[i].textContent.trim()===label) return n[i+1].textContent.trim();
  }
  return '';
}, {group,label});

const TIMES = [
  ['2026-01-03T10:03:00Z', 'Vollmond-Zeitpunkt'],
  ['2026-01-18T19:52:00Z', 'Neumond-Zeitpunkt'],
  ['2026-06-21T10:00:00Z', 'Sommersonnenwende, Tag'],
  ['2026-12-21T02:00:00Z', 'Wintersonnenwende, Nacht'],
  ['2026-03-29T00:30:00Z', 'DST-Wechsel DE'],
  ['2026-11-01T06:30:00Z', 'DST-Wechsel CA']
];
console.log('Ort       Ansicht  Zeitpunkt             Sonne(az/h)        Mond(az/h)         Phase');
for (const loc of ['hamburg','waterloo']) {
  await page.evaluate(id => window.__sunMoonEarth.setLocation(id), loc);
  for (const view of ['sky','system']) {
    await page.evaluate(v => window.__sunMoonEarth.setView(v), view);
    for (const [iso, note] of TIMES) {
      await page.evaluate(v => window.__sunMoonEarth.setInstant(v), iso);
      await page.waitForTimeout(120);
      const sa = await read('Sonne','Azimut'), sh = await read('Sonne','Höhe'), ss = await read('Sonne','Stand');
      const ma = await read('Mond','Azimut'), mh = await read('Mond','Höhe'), ms = await read('Mond','Stand');
      const ph = await read('Mondphase','Phase'), il = await read('Mondphase','Beleuchtet');
      const flag = (s) => s.startsWith('unter') ? '↓' : '↑';
      console.log(`${loc.padEnd(9)} ${view.padEnd(7)} ${iso.slice(0,16)}  ${sa.padStart(7)}/${sh.padStart(7)}${flag(ss)}  ${ma.padStart(7)}/${mh.padStart(7)}${flag(ms)}  ${ph} ${il}`);
      if (!sa || !ma || !ph) errors.push(`leere Werte bei ${loc}/${view}/${iso}`);
    }
  }
}
// Kamerabedienung in beiden Ansichten
for (const view of ['sky','system']) {
  await page.evaluate(v => window.__sunMoonEarth.setView(v), view);
  await page.locator('#kamera-reset').click();
  if (view === 'sky') await page.locator('#kamera-nord').click();
  await page.waitForTimeout(150);
}
// Maus- und Touch-Interaktion auf der Leinwand
await page.evaluate(v => window.__sunMoonEarth.setView(v), 'sky');
const box = await page.locator('#szene').boundingBox();
await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
await page.mouse.down(); await page.mouse.move(box.x + box.width/2 + 120, box.y + box.height/2 + 60); await page.mouse.up();
await page.mouse.wheel(0, -200);
await page.touchscreen?.tap?.(box.x + box.width/2, box.y + box.height/2).catch(()=>{});
await page.waitForTimeout(300);

console.log('\nFehler im Browser: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'keine'));
await b.close();
