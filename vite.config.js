import { defineConfig } from 'vite';

// Keep API credentials on the server. Vite proxies only the local development
// requests; the production server in server.mjs serves both the API and dist/.
export default defineConfig({
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
