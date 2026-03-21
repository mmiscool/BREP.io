// vite.config.kernel.js (ESM)
import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import { MANIFOLD_SOURCE_LOCAL, readManifoldSource } from './scripts/manifoldSourceConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const manifoldSource = readManifoldSource();
const useLocalManifold = manifoldSource === MANIFOLD_SOURCE_LOCAL;
const wasmPath = useLocalManifold
  ? resolve(__dirname, 'manifold-plus/dist/manifold.wasm')
  : require.resolve('manifold-3d/manifold.wasm');
const wasmBase64 = fs.readFileSync(wasmPath, 'base64');

function patchManifoldNodeImports() {
  return {
    name: 'patch-manifold-node-imports',
    transform(code, id) {
      const normalizedId = id.replaceAll('\\', '/');
      const isLocalModule = normalizedId.includes('/manifold-plus/dist/manifold.js');
      const isNpmModule = normalizedId.includes('/node_modules/manifold-3d/manifold.js');
      if (!isLocalModule && !isNpmModule) return null;

      return {
        code: code
          .replace('await import("module")', 'await import("node:module")')
          .replaceAll('require("fs")', 'require("node:fs")')
          .replaceAll('require("path")', 'require("node:path")')
          .replaceAll('require("url")', 'require("node:url")'),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [patchManifoldNodeImports()],
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
    alias: {
      '#textToFace/fontUrlLoaders': resolve(__dirname, 'src/features/textToFace/fontUrlLoaders.kernel.js'),
    },
  },
  esbuild: {
    keepNames: true,
    supported: {
      'class-static-blocks': false,
    },
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
