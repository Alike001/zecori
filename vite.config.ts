import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';

export default defineConfig({
  // The reviewed submission image excludes the vulnerable Privy React graph.
  // Re-enabling requires a dependency-clean release and a separately reviewed build change.
  define: { __PRIVY_UI_COMPILED__: 'false' },
  plugins: [
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(js|jsx|md|mdx|ts|tsx)$/ }),
  ],
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
