import { defineConfig } from 'vite';

// Served at the custom domain https://lunarcompass.app/ (see public/CNAME),
// so the default base is the site root. BASE_PATH lets a different
// deployment target override the prefix without a code change - e.g.
// BASE_PATH=/SunMoonEarth/ for the old github.io project-page path.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true
  }
});
