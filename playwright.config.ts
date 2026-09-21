import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4174/',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      // Pre-installed Chromium of this environment; SwiftShader provides
      // WebGL even without a GPU, so the 3D views actually render in tests.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    },
    // Fixed time zone context, so the display is independent of the test machine.
    timezoneId: 'UTC',
    locale: 'en-GB'
  },
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    port: 4174,
    reuseExistingServer: !process.env.CI
  }
});
