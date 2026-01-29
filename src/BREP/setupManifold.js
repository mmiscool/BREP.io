// setupManifold.js (ESM)
// Universal loader that works in both Node.js and the browser (Vite)

import Module from 'manifold-3d';

const INLINE_WASM_BASE64 =
  typeof __MANIFOLD_WASM_BASE64__ !== 'undefined' && __MANIFOLD_WASM_BASE64__;

const isNode =
  typeof window === 'undefined' ||
  (typeof process !== 'undefined' && process.versions?.node);

const decodeBase64ToUint8Array = (base64) => {
  if (!base64) return null;
  const normalized = base64.includes('base64,')
    ? base64.slice(base64.indexOf('base64,') + 7)
    : base64;

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalized, 'base64'));
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

const initWasm = async (opts) => {
  const wasm = await Module(opts);
  if (typeof wasm.setup === 'function') await wasm.setup();
  return wasm;
};

export const manifold = await (async () => {
  if (INLINE_WASM_BASE64) {
    const wasmBinary = decodeBase64ToUint8Array(INLINE_WASM_BASE64);
    const wasm = await initWasm({ wasmBinary });
    if (!isNode && typeof window !== 'undefined') {
      window.manifold = wasm; // for debugging in browser console
    }
    return wasm;
  }

  if (isNode) {
    // Node.js: no locateFile needed
    return initWasm();
  }

  // Browser (Vite): use ?url to get the WASM asset URL
  const { default: wasmUrl } = await import('manifold-3d/manifold.wasm?url');
  const wasm = await initWasm({
    locateFile: () => wasmUrl,
  });
  if (typeof window !== 'undefined') {
    window.manifold = wasm; // for debugging in browser console
  }
  return wasm;
})();





export const Manifold = manifold.Manifold;
export const CrossSection = manifold.CrossSection;
export const ManifoldMesh = manifold.Mesh;
