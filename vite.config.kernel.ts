import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import wasm from 'vite-plugin-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifoldJsPath = resolve(__dirname, 'manifold-plus/dist/manifold.js');
const wasmPath = resolve(__dirname, 'manifold-plus/dist/manifold.wasm');
const manifoldJsBase64 = fs.readFileSync(manifoldJsPath, 'base64');
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

function inlineImportedCss(): Plugin {
  const sourceToText = (source: string | Uint8Array) => (
    typeof source === 'string' ? source : Buffer.from(source).toString('utf8')
  );

  const getImportedCssFiles = (chunk: any): string[] => {
    const files = chunk?.viteMetadata?.importedCss;
    if (!files || typeof files[Symbol.iterator] !== 'function') return [];
    return [...files].filter((fileName) => typeof fileName === 'string');
  };

  const styleIdForFiles = (fileNames: string[]) => {
    const key = fileNames.join('__').replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `brep-inline-css-${key || 'bundle'}`;
  };

  const createInjector = (cssText: string, styleId: string) => `
const __brepInlineCss = ${JSON.stringify(cssText)};
(function() {
  if (typeof document === "undefined" || !__brepInlineCss) return;
  if (document.documentElement?.dataset?.brepCadFrame !== "true") return;
  if (document.getElementById(${JSON.stringify(styleId)})) return;
  const target = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
  if (!target) return;
  const style = document.createElement("style");
  style.id = ${JSON.stringify(styleId)};
  style.textContent = __brepInlineCss;
  target.appendChild(style);
})();
`;

  return {
    name: 'inline-imported-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const cssAssets = new Map<string, string>();

      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== 'asset' || !fileName.endsWith('.css')) continue;
        cssAssets.set(fileName, sourceToText(item.source));
      }

      if (cssAssets.size === 0) return;

      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const chunksWithCss = chunks
        .map((chunk) => ({
          chunk,
          cssFiles: getImportedCssFiles(chunk).filter((fileName) => cssAssets.has(fileName)),
        }))
        .filter((entry) => entry.cssFiles.length > 0);

      const inlinedCssFiles = new Set<string>();

      if (chunksWithCss.length > 0) {
        for (const { chunk, cssFiles } of chunksWithCss) {
          const cssText = cssFiles.map((fileName) => cssAssets.get(fileName)).join('\n');
          chunk.code = `${createInjector(cssText, styleIdForFiles(cssFiles))}\n${chunk.code}`;
          cssFiles.forEach((fileName) => inlinedCssFiles.add(fileName));
        }
      } else {
        const cssFiles = [...cssAssets.keys()];
        const cssText = [...cssAssets.values()].join('\n');
        for (const chunk of chunks) {
          if (!chunk.isEntry) continue;
          chunk.code = `${createInjector(cssText, styleIdForFiles(cssFiles))}\n${chunk.code}`;
        }
        cssFiles.forEach((fileName) => inlinedCssFiles.add(fileName));
      }

      for (const fileName of inlinedCssFiles) {
        delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  plugins: [patchManifoldNodeImports(), wasm(), inlineImportedCss()],
  // The feature-history worker (reachable through the embedded viewer) uses
  // module syntax, which needs ES-format worker bundles instead of the
  // default IIFE.
  worker: {
    format: 'es',
    plugins: () => [patchManifoldNodeImports(), wasm()],
  },
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
    cssCodeSplit: true,
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
    __MANIFOLD_JS_BASE64__: JSON.stringify(manifoldJsBase64),
    __MANIFOLD_WASM_BASE64__: JSON.stringify(wasmBase64),
  },
});
