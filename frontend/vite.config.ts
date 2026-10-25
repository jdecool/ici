import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDomain = process.env['ROOT_DOMAIN'] ?? 'ici.localhost';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: [rootDomain, `.${rootDomain}`],
    proxy: {
      '/api': {
        target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000',
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            proxyRequest.setHeader(
              'X-Real-IP',
              request.socket.remoteAddress ?? 'unknown',
            );
          });
        },
      },
    },
  },
});
