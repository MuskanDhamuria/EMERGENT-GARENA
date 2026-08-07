import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';

// Keep API credentials on the server. Vite proxies only the local development
// requests; the production server in server.mjs serves both the API and dist/.
export default defineConfig({
  // The user keeps large source packs under public/assets for map authoring.
  // Ship only the small, curated runtime set rather than duplicating every
  // source sheet into dist on each build.
  plugins: [{
    name: 'copy-curated-game-art',
    closeBundle() {
      mkdirSync('dist/game-art', { recursive: true });
      cpSync('public/game-art', 'dist/game-art', { recursive: true });
    },
  }],
  build: { copyPublicDir: false },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/socket.io': {
        target: 'http://127.0.0.1:8787',
        ws: true,
      },
    },
  },
});
