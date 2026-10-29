import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Preview hosts are supplied per-process via __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
    // so a stale tunnel hostname is never baked into the repo.
  },
  build: {
    target: 'es2020',
  },
});
