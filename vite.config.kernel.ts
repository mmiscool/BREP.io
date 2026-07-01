import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import wasm from 'vite-plugin-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, 'manifold-plus/dist/manifold.wasm');
const wasmBase64 = fs.readFileSync(wasmPath, 'base64');

function patchManifoldNodeImports(): Plugin {
  return {
    name: 'patch-manifold-node-imports',
    transform(code, id) {
      const normalizedId = id.replaceAll('\\', '/');
      const isLocalModule = normalizedId.includes('/manifold-plus/dist/manifold.js');
      if (!isLocalModule) return null;

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
  plugins: [patchManifoldNodeImports(), wasm()],
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
    alias: {
      '#textToFace/fontUrlLoaders': resolve(__dirname, 'src/features/textToFace/fontUrlLoaders.kernel.ts'),
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
      entry: {
        'brep-kernel': resolve(__dirname, 'src/index.ts'),
        CAD: resolve(__dirname, 'src/CAD.ts'),
        Sketcher2D: resolve(__dirname, 'src/Sketcher2D.ts'),
        Sketcher2DUtils: resolve(__dirname, 'src/Sketcher2DUtils.ts'),
        SketchSolver2D: resolve(__dirname, 'src/SketchSolver2D.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
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
        manualChunks: undefined,
      },
    },
  },
  define: {
    __MANIFOLD_WASM_BASE64__: JSON.stringify(wasmBase64),
  },
});
