const isNode =
  typeof window === "undefined" ||
  !!globalThis?.process?.versions?.node;

const loadOpenCascade = async () => {
  if (isNode) {
    const [{ createRequire }, { dirname, resolve }, { fileURLToPath }, { readFile }] = await Promise.all([
      import("node:module"),
      import("node:path"),
      import("node:url"),
      import("node:fs/promises"),
    ]);
    const here = dirname(fileURLToPath(import.meta.url));
    const occDistDir = resolve(here, "../../vendor/opencascade.js/dist");
    globalThis.__BREP_OCC_REQUIRE = createRequire(import.meta.url);
    globalThis.__BREP_OCC_DIRNAME = `${occDistDir}/`;
    const { default: opencascadeFactory } = await import("../../vendor/opencascade.js/dist/opencascade.wasm.js");
    const wasmBinary = await readFile(resolve(occDistDir, "opencascade.wasm.wasm"));
    return new opencascadeFactory({ wasmBinary });
  }

  const { default: opencascadeFactory } = await import("../../vendor/opencascade.js/dist/opencascade.wasm.js");
  const { default: wasmUrl } = await import("../../vendor/opencascade.js/dist/opencascade.wasm.wasm?url");
  return new opencascadeFactory({
    locateFile(path) {
      return path.endsWith(".wasm") ? wasmUrl : path;
    },
  });
};

export const OpenCascade = await loadOpenCascade();
export const openCascadeKernelName = "OpenCASCADE";
