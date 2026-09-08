import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // wLipSync compiles its WASM with top-level await. The app targets modern Chromium.
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  build: { target: 'esnext', chunkSizeWarningLimit: 1200 },
});
