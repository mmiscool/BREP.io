import JSZip from "jszip";
import { generate3MF } from "../exporters/threeMF.js";
import {
  buildSheetMetalFlatPatternFiles,
  buildSheetMetalFlatPatternPackageFiles,
} from "../features/sheetMetal/flatPatternFiles.js";
import {
  __test_buildRenderableSheetModelFromTree,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";

function makeTab(featureID, width = 40, height = 24) {
  const flatId = `${featureID}:flat_root`;
  const tree = {
    thickness: 2,
    root: {
      kind: "flat",
      id: flatId,
      label: `${featureID} Root`,
      outline: [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ],
      edges: [
        { id: `${flatId}:e1`, polyline: [[0, 0], [width, 0]] },
        { id: `${flatId}:e2`, polyline: [[width, 0], [width, height]] },
        { id: `${flatId}:e3`, polyline: [[width, height], [0, height]] },
        { id: `${flatId}:e4`, polyline: [[0, height], [0, 0]] },
      ],
    },
  };

  return __test_buildRenderableSheetModelFromTree({
    featureID,
    tree,
    showFlatPattern: false,
  }).root;
}

export async function test_sheetMetal_flat_pattern_files_use_model_and_feature_names() {
  const a = makeTab("SM_A");
  const b = makeTab("SM B");

  const multi = buildSheetMetalFlatPatternFiles([a, b], {
    baseName: "jobs/Panel.3mf",
    format: "dxf",
  });

  if (multi.files.length !== 2) {
    throw new Error(`Expected 2 flat pattern files, got ${multi.files.length}.`);
  }
  const names = multi.files.map((file) => file.filename).sort();
  const expected = ["Panel_SM_A.dxf", "Panel_SM_B.dxf"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected flat pattern names: ${names.join(", ")}`);
  }
  for (const file of multi.files) {
    if (!String(file.content || "").includes("SECTION")) {
      throw new Error(`Expected ${file.filename} to contain DXF section data.`);
    }
  }

  const single = buildSheetMetalFlatPatternFiles([a], {
    baseName: "jobs/Panel.3mf",
    format: "dxf",
  });
  if (single.files.length !== 1 || single.files[0].filename !== "Panel.dxf") {
    throw new Error(`Unexpected single flat pattern name: ${single.files.map((file) => file.filename).join(", ")}`);
  }

  const packageFiles = buildSheetMetalFlatPatternPackageFiles([a, b], {
    baseName: "jobs/Panel.3mf",
  });
  if (!packageFiles.additionalFiles["SheetMetalFlatPatterns/Panel_SM_A.dxf"]) {
    throw new Error("Expected package files to include Panel_SM_A.dxf.");
  }

  const bytes = await generate3MF([], {
    additionalFiles: packageFiles.additionalFiles,
  });
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file("SheetMetalFlatPatterns/Panel_SM_A.dxf")) {
    throw new Error("3MF package is missing Panel_SM_A.dxf.");
  }
  const contentTypes = await zip.file("[Content_Types].xml").async("string");
  if (!contentTypes.includes('Extension="dxf"')) {
    throw new Error("3MF package content types did not declare DXF files.");
  }
  const rels = await zip.file("_rels/.rels").async("string");
  if (!rels.includes("/SheetMetalFlatPatterns/Panel_SM_A.dxf")) {
    throw new Error("3MF package relationships did not include the DXF attachment.");
  }
}
