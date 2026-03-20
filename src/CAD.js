import {
  CadEmbed as BaseCadEmbed,
  bootCadFrame,
  bootCADFrame,
} from "./UI/cad/CadEmbed.js";

function withDefaultFrameModuleUrl(options = {}) {
  const next = options && typeof options === "object" ? { ...options } : {};
  if (!next.frameModuleUrl) {
    next.frameModuleUrl = import.meta.url;
  }
  return next;
}

export class CadEmbed extends BaseCadEmbed {
  constructor(options = {}) {
    super(withDefaultFrameModuleUrl(options));
  }
}

export class CADEmbed extends CadEmbed {}

if (typeof globalThis !== "undefined") {
  globalThis.__BREP_bootCadFrame = bootCadFrame;
  globalThis.__BREP_bootCADFrame = bootCADFrame;
}

export { bootCadFrame, bootCADFrame };
