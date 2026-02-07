// vite.config.kernel.js (ESM)
import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wasmPath = require.resolve('manifold-3d/manifold.wasm');
const wasmBase64 = fs.readFileSync(wasmPath, 'base64');

export default defineConfig({
  resolve: {
    conditions: ['node', 'import', 'module', 'default'],
    alias: {
      '#textToFace/fontUrlLoaders': resolve(__dirname, 'src/features/textToFace/fontUrlLoaders.kernel.js'),
    },
  },
  esbuild: {
    keepNames: true,
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      formats: ['es'],
      fileName: () => 'brep-kernel.js',
    },
    outDir: 'dist-kernel',
    emptyOutDir: true,
    target: 'esnext',
    minify: 'esbuild',
    cssCodeSplit: false,
    rollupOptions: {
      external: [
        'module',
        'node:module',
        'fs',
        'node:fs',
        'fs/promises',
        'node:fs/promises',
        'path',
        'node:path',
        'url',
        'node:url',
      ],
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
  define: {
    __MANIFOLD_WASM_BASE64__: JSON.stringify(wasmBase64),
  },
});
