// vite.config.js (ESM)
import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname; // adjust if your html files live elsewhere

function collectHtmlEntriesFromDir(dirPath, keyPrefix) {
  if (!fs.existsSync(dirPath)) return {};
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const out = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const stem = entry.name.slice(0, -5).replace(/[^a-zA-Z0-9_]/g, '_');
    out[`${keyPrefix}${stem}`] = resolve(dirPath, entry.name);
  }
  return out;
}

const apiExampleEntries = collectHtmlEntriesFromDir(resolve(root, 'apiExamples'), 'apiExample_');

const htmlEntries = {
  main: resolve(root, 'index.html'),
  cad: resolve(root, 'cad.html'),
  about: resolve(root, 'about.html'),
  featureDialogs: resolve(root, 'feature-dialog-capture.html'),
  pmiDialogs: resolve(root, 'pmi-dialog-capture.html'),
  assemblyConstraintDialogs: resolve(root, 'assembly-constraint-capture.html'),
  mouse: resolve(root, 'mouse.html'),
  test: resolve(root, 'test.html'),
  ...apiExampleEntries,
};

export default defineConfig(() => {
  const input = { ...htmlEntries };
  return {
    // Explicitly set the public directory to ensure generated docs are included
    publicDir: 'public',
    resolve: {
      alias: {
        '#textToFace/fontUrlLoaders': resolve(root, 'src/features/textToFace/fontUrlLoaders.vite.js'),
      },
    },
    esbuild: {
      keepNames: true,
    },
    // allow the tunneled host to access the dev server
    server: {
      allowedHosts: true,
      cors: true,
    },


    build: {
      minify: 'esbuild',
      terserOptions: {
        keep_fnames: true,
      },
      rollupOptions: {
        input,
      },
    },
  };
});
