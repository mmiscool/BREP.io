// setupManifold.js (ESM)
// Universal loader that works in both Node.js and the browser (Vite)
import {
  MANIFOLD_RUNTIME_SOURCE,
} from "../generated/manifoldSource.js";

declare const __MANIFOLD_WASM_BASE64__: string | undefined;

const COMPILED_INLINE_WASM_BASE64 =
  typeof __MANIFOLD_WASM_BASE64__ !== 'undefined'
    ? __MANIFOLD_WASM_BASE64__
    : '';
const INLINE_WASM_BASE64 =
  COMPILED_INLINE_WASM_BASE64
  || (typeof globalThis !== 'undefined'
    && typeof (globalThis as any).__MANIFOLD_WASM_BASE64__ !== 'undefined'
    && (globalThis as any).__MANIFOLD_WASM_BASE64__);

const isNode =
  typeof window === 'undefined' ||
  !!globalThis?.process?.versions?.node;

const patchFileURLToPathForDataUrl = async () => {
  if (!isNode) return;
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const urlMod = require('node:url');
    if (urlMod.__brepFileUrlPatched) return;
    const original = urlMod.fileURLToPath;
    urlMod.fileURLToPath = (value) => {
      try {
        return original(value);
      } catch (err) {
        const href = typeof value === 'string' ? value : value?.href;
        if (href && (href.startsWith('data:') || href.startsWith('blob:'))) {
          return globalThis.process.cwd();
        }
        throw err;
      }
    };
    urlMod.__brepFileUrlPatched = true;
  } catch {
    // ignore; Node-only patch
  }
};

const loadModule = async () => {
  if (isNode) {
    await patchFileURLToPathForDataUrl();
    const mod = await import('../../manifold-plus/dist/manifold.js');
    return mod?.default ?? mod;
  }

  const browserModulePath = '../../manifold-plus/dist/manifold.js?embindfix=2';
  const mod = await import(browserModulePath);
  return mod?.default ?? mod;
};

const decodeBase64ToUint8Array = (base64) => {
  if (!base64) return null;
  const normalized = base64.includes('base64,')
    ? base64.slice(base64.indexOf('base64,') + 7)
    : base64;

  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(normalized, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error('No base64 decoder available for manifold wasm');
};

const initWasm = async (opts: any = undefined) => {
  const Module = await loadModule();
  const wasm = await Module(opts);
  if (typeof wasm.setup === 'function') await wasm.setup();
  return wasm;
};

export const manifold = await (async () => {
  if (INLINE_WASM_BASE64) {
    const wasmBinary = decodeBase64ToUint8Array(INLINE_WASM_BASE64);
    const wasm = await initWasm({ wasmBinary });
    if (!isNode && typeof window !== 'undefined') {
      (window as any).manifold = wasm; // for debugging in browser console
    }
    return wasm;
  }

  if (isNode) {
    // Node.js: no locateFile needed
    return initWasm();
  }

  // Browser (Vite): use ?url to get the WASM asset URL
  const { default: wasmUrl } = await import('../../manifold-plus/dist/manifold.wasm?url');
  const wasm = await initWasm({
    locateFile: () => wasmUrl,
  });
  if (typeof window !== 'undefined') {
    (window as any).manifold = wasm; // for debugging in browser console
  }
  return wasm;
})();





export const Manifold = manifold.Manifold;
export const ManifoldMesh = manifold.Mesh;
export const manifoldBuildSource = MANIFOLD_RUNTIME_SOURCE;
export const manifoldHasCustomExtensions = typeof manifold.sum === 'function';
export const manifoldPlusSum = (a, b) => {
  if (typeof manifold.sum !== 'function') {
    throw new Error('Custom manifold extensions are only available when using the local manifold build.');
  }
  return manifold.sum(a, b);
};
