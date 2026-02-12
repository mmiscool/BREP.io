import { bootSketcher2DFrame } from "./Sketcher2DFrameApp.js";

export function boot(config = {}) {
  return bootSketcher2DFrame(config);
}

if (typeof window !== "undefined") {
  window.__BREP_bootSketcher2DFrame = boot;
}

