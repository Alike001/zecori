import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { orderApi } from './server/order-api';

export default defineConfig({
  plugins: [react(), { name: 'testnet-order-coordinator', configureServer(server) { server.middlewares.use(orderApi()); } }],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['localhost'],
    cors: { origin: 'http://127.0.0.1:5173' },
    fs: {
      strict: true,
      allow: [process.cwd()],
      deny: ['.env', '.env.*', '**/.env', '**/.env.*', '**/data/**', '**/*orders*.json', '**/.cookie', '**/keys.toml', '*.{crt,pem,key,p12,pfx,cer,der}'],
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, allowedHosts: ['localhost'] },
});
