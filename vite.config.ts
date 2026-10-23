import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['localhost'],
    cors: { origin: 'http://127.0.0.1:5173' },
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
    fs: {
      strict: true,
      allow: [process.cwd()],
      deny: ['.env', '.env.*', '**/.env', '**/.env.*', '**/data/**', '**/*orders*.json', '**/.cookie', '**/keys.toml', '*.{crt,pem,key,p12,pfx,cer,der}'],
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, allowedHosts: ['localhost'] },
});
