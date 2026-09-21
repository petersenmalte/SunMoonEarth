import { defineConfig } from 'vite';

// GitHub Pages serves this project site under https://petersenmalte.github.io/SunMoonEarth/.
// BASE_PATH lets a different deployment target override the prefix without a code change.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/SunMoonEarth/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true
  }
});
