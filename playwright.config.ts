import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4174/SunMoonEarth/',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      // Vorinstalliertes Chromium der Umgebung; SwiftShader liefert WebGL
      // auch ohne GPU, damit die 3D-Ansichten im Test wirklich zeichnen.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    },
    // Fester Zeitzonen-Kontext, damit Anzeigen unabhaengig vom Testrechner sind.
    timezoneId: 'UTC',
    locale: 'de-DE'
  },
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    port: 4174,
    reuseExistingServer: !process.env.CI
  }
});
