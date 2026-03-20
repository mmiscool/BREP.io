// Public entry point for the BREP kernel package.
// Keep embed boot functions alive here so a single brep-kernel bundle can
// serve both direct API consumers and iframe bootstrap imports.

import { BREP } from './BREP/BREP.js';
import { PartHistory, extractDefaultValues } from './PartHistory.js';
import { AssemblyConstraintHistory } from './assemblyConstraints/AssemblyConstraintHistory.js';
import { AssemblyConstraintRegistry } from './assemblyConstraints/AssemblyConstraintRegistry.js';
import {
  getPackageLicenseInfo,
  getPackageLicenseInfoString,
  getPackageLicenseText,
  getAllLicensesInfoString,
} from './licenseInfo.js';
import { Sketcher2DEmbed, bootSketcher2DFrame } from './UI/sketcher2d/Sketcher2DEmbed.js';
import { sketchToSVG, sketchToSVGPaths, sketchToDXF, sketchTo3DPolylines } from './UI/sketcher2d/sketchToSVG.js';
import { CadEmbed, CADEmbed, bootCadFrame, bootCADFrame } from './UI/cad/CadEmbed.js';

if (typeof globalThis !== 'undefined') {
  globalThis.__BREP_bootCadFrame = bootCadFrame;
  globalThis.__BREP_bootCADFrame = bootCADFrame;
  globalThis.__BREP_bootSketcher2DFrame = bootSketcher2DFrame;
}

export {
  AssemblyConstraintHistory,
  AssemblyConstraintRegistry,
  BREP,
  CADEmbed,
  CadEmbed,
  PartHistory,
  Sketcher2DEmbed,
  bootCADFrame,
  bootCadFrame,
  bootSketcher2DFrame,
  extractDefaultValues,
  getAllLicensesInfoString,
  getPackageLicenseInfo,
  getPackageLicenseInfoString,
  getPackageLicenseText,
  sketchTo3DPolylines,
  sketchToDXF,
  sketchToSVG,
  sketchToSVGPaths,
};
