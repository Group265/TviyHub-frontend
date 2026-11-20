import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
          // Spring Security's existing CORS allowlist accepts this origin.
          // Browser -> Vite is same-origin; this is a server -> server request.
          headers: { Origin: 'http://localhost:5173' },
        },
      },
    },
  };
});
