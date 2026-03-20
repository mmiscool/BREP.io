import {
  Sketcher2DEmbed as BaseSketcher2DEmbed,
  bootSketcher2DFrame,
} from "./UI/sketcher2d/Sketcher2DEmbed.js";
import {
  sketchToDXF,
  sketchToSVG,
  sketchToSVGPaths,
  sketchTo3DPolylines,
} from "./UI/sketcher2d/sketchToSVG.js";

function withDefaultFrameModuleUrl(options = {}) {
  const next = options && typeof options === "object" ? { ...options } : {};
  if (!next.frameModuleUrl) {
    next.frameModuleUrl = import.meta.url;
  }
  return next;
}

export class Sketcher2DEmbed extends BaseSketcher2DEmbed {
  constructor(options = {}) {
    super(withDefaultFrameModuleUrl(options));
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.__BREP_bootSketcher2DFrame = bootSketcher2DFrame;
}

export {
  bootSketcher2DFrame,
  sketchToDXF,
  sketchToSVG,
  sketchToSVGPaths,
  sketchTo3DPolylines,
};
