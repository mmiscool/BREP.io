import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import wasm from 'vite-plugin-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname; // adjust if your html files live elsewhere

function collectHtmlEntriesFromDir(dirPath: string, keyPrefix: string): Record<string, string> {
  if (!fs.existsSync(dirPath)) return {};
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const stem = entry.name.slice(0, -5).replace(/[^a-zA-Z0-9_]/g, '_');
    out[`${keyPrefix}${stem}`] = resolve(dirPath, entry.name);
  }
  return out;
}

const apiExampleEntries = collectHtmlEntriesFromDir(resolve(root, 'apiExamples'), 'apiExample_');

function resolveKernelManifoldImports(): Plugin {
  return {
    name: 'resolve-kernel-manifold-imports',
    enforce: 'pre',
    resolveId(source, importer) {
      const normalizedImporter = String(importer || '').replaceAll('\\', '/');
      if (!normalizedImporter.includes('/dist-kernel/') || !normalizedImporter.endsWith('.js')) return null;

      if (source.startsWith('../../manifold-plus/dist/manifold.js')) {
        const queryIndex = source.indexOf('?');
        const query = queryIndex >= 0 ? source.slice(queryIndex) : '';
        return `${resolve(root, 'manifold-plus/dist/manifold.js')}${query}`;
      }

      if (source.startsWith('../../manifold-plus/dist/manifold.wasm')) {
        const queryIndex = source.indexOf('?');
        const query = queryIndex >= 0 ? source.slice(queryIndex) : '';
        return `${resolve(root, 'manifold-plus/dist/manifold.wasm')}${query}`;
      }

      return null;
    },
  };
}

const htmlEntries = {
  main: resolve(root, 'index.html'),
  cad: resolve(root, 'cad.html'),
  viewer: resolve(root, 'viewer.html'),
  about: resolve(root, 'about.html'),
  featureDialogs: resolve(root, 'feature-dialog-capture.html'),
  pmiDialogs: resolve(root, 'pmi-dialog-capture.html'),
  assemblyConstraintDialogs: resolve(root, 'assembly-constraint-capture.html'),
  test: resolve(root, 'test.html'),
  ...apiExampleEntries,
};

export default defineConfig(() => {
  const input = { ...htmlEntries };
  return {
    plugins: [resolveKernelManifoldImports(), wasm()],
    // Explicitly set the public directory to ensure generated docs are included
    publicDir: 'public',
    resolve: {
      alias: {
        '#textToFace/fontUrlLoaders': resolve(root, 'src/features/textToFace/fontUrlLoaders.vite.ts'),
      },
    },
    esbuild: {
      keepNames: true,
    },
    // allow the tunneled host to access the dev server
    server: {
      allowedHosts: true as const,
      cors: true,
    },


    build: {
      minify: 'esbuild' as const,
      rollupOptions: {
        input,
      },
      chunkSizeWarningLimit: 20000, // increase chunk size warning limit to 2MB
    },
  };
});
