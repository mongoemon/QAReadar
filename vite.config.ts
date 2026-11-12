import { defineConfig } from 'vite'
import pkg from './package.json'

// Relative base so the build can be hosted from any sub-path
// (GitHub Pages, Cloudflare Pages, a plain static folder).
export default defineConfig({
  base: './',
  // Single source of truth for the version shown in the header.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022' },
})
