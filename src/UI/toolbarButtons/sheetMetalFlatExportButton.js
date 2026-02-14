import {
  buildFlatPatternExportData,
  buildFlatPatternDxf,
  buildFlatPatternSvg,
} from "../../features/sheetMetal/flatPatternExport.js";

function safeName(raw, fallback = "flat_pattern") {
  const text = String(raw || "").trim();
  const base = text.length ? text : fallback;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function downloadFile(filename, content, mime = "application/octet-stream") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    try { document.body.removeChild(anchor); } catch {}
    URL.revokeObjectURL(url);
  }, 0);
}

function ascendSheetMetalSolid(object) {
  let current = object || null;
  while (current) {
    if (current.type === "SOLID" && current.userData?.sheetMetalModel?.tree) return current;
    if (current.parentSolid && current.parentSolid !== current) current = current.parentSolid;
    else current = current.parent || null;
  }
  return null;
}

function collectSheetMetalSolids(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  if (!scene) return [];
  const solids = [];
  scene.traverse((object) => {
    if (!object || object.type !== "SOLID") return;
    if (!object.visible) return;
    if (!object.userData?.sheetMetalModel?.tree) return;
    solids.push(object);
  });
  return solids;
}

function resolveTargetSheetMetalSolid(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  if (!scene) return { solid: null, reason: "no_scene" };
  const all = collectSheetMetalSolids(viewer);
  if (!all.length) return { solid: null, reason: "no_sheet_metal" };

  const selectedSolids = new Set();
  scene.traverse((object) => {
    if (!object?.selected) return;
    const carrier = ascendSheetMetalSolid(object);
    if (carrier) selectedSolids.add(carrier);
  });

  if (selectedSolids.size === 1) return { solid: Array.from(selectedSolids)[0], reason: "selected" };
  if (selectedSolids.size > 1) return { solid: Array.from(selectedSolids)[0], reason: "selected_multiple" };
  if (all.length === 1) return { solid: all[0], reason: "single" };
  return { solid: null, reason: "ambiguous" };
}

function ensureFlatExportDialogStyles() {
  if (document.getElementById("flat-export-dialog-styles")) return;
  const style = document.createElement("style");
  style.id = "flat-export-dialog-styles";
  style.textContent = `
    .flat-exp-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 11; }
    .flat-exp-modal { background: #0b0e14; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 10px; padding: 14px; width: min(420px, calc(100vw - 32px)); box-shadow: 0 10px 40px rgba(0,0,0,.5); }
    .flat-exp-title { margin: 0 0 8px 0; font-size: 14px; font-weight: 700; }
    .flat-exp-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .flat-exp-label { width: 90px; color: #9aa0aa; font-size: 12px; }
    .flat-exp-input, .flat-exp-select { flex: 1 1 auto; padding: 6px 8px; border-radius: 8px; background: #0b0e14; color: #e5e7eb; border: 1px solid #374151; outline: none; font-size: 12px; }
    .flat-exp-input:focus, .flat-exp-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
    .flat-exp-hint { color: #9aa0aa; font-size: 12px; margin-top: 6px; }
    .flat-exp-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .flat-exp-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; }
    .flat-exp-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
  `;
  document.head.appendChild(style);
}

function openFlatExportDialog(viewer) {
  const resolved = resolveTargetSheetMetalSolid(viewer);
  if (!resolved.solid) {
    if (resolved.reason === "ambiguous") {
      alert("Select a sheet metal model first, then run flat pattern export.");
      return;
    }
    alert("No sheet metal model found to export.");
    return;
  }
  const solid = resolved.solid;

  ensureFlatExportDialogStyles();

  const overlay = document.createElement("div");
  overlay.className = "flat-exp-overlay";
  const modal = document.createElement("div");
  modal.className = "flat-exp-modal";

  const title = document.createElement("div");
  title.className = "flat-exp-title";
  title.textContent = "Export Flat Pattern";

  const rowName = document.createElement("div");
  rowName.className = "flat-exp-row";
  const labName = document.createElement("div");
  labName.className = "flat-exp-label";
  labName.textContent = "Filename";
  const inpName = document.createElement("input");
  inpName.className = "flat-exp-input";
  inpName.value = safeName(`${solid.name || "part"}_flat`);
  rowName.appendChild(labName);
  rowName.appendChild(inpName);

  const rowFmt = document.createElement("div");
  rowFmt.className = "flat-exp-row";
  const labFmt = document.createElement("div");
  labFmt.className = "flat-exp-label";
  labFmt.textContent = "Format";
  const selFmt = document.createElement("select");
  selFmt.className = "flat-exp-select";
  const optDxf = document.createElement("option");
  optDxf.value = "dxf";
  optDxf.textContent = "DXF";
  const optSvg = document.createElement("option");
  optSvg.value = "svg";
  optSvg.textContent = "SVG";
  selFmt.appendChild(optDxf);
  selFmt.appendChild(optSvg);
  rowFmt.appendChild(labFmt);
  rowFmt.appendChild(selFmt);

  const hint = document.createElement("div");
  hint.className = "flat-exp-hint";
  hint.textContent = "Cut lines export as red solid lines. Bend centerlines export as blue dashed lines.";

  const buttons = document.createElement("div");
  buttons.className = "flat-exp-buttons";
  const btnCancel = document.createElement("button");
  btnCancel.className = "flat-exp-btn";
  btnCancel.textContent = "Cancel";
  const btnExport = document.createElement("button");
  btnExport.className = "flat-exp-btn";
  btnExport.textContent = "Export";

  const close = () => { try { document.body.removeChild(overlay); } catch {} };
  btnCancel.addEventListener("click", close);

  btnExport.addEventListener("click", () => {
    try {
      const tree = solid?.userData?.sheetMetalModel?.tree;
      if (!tree) {
        alert("Selected object has no sheet metal tree data.");
        return;
      }

      const data = buildFlatPatternExportData(tree);
      if (!Array.isArray(data.cutSegments) || data.cutSegments.length === 0) {
        alert("Flat pattern export failed: no cut boundaries were generated.");
        return;
      }

      const base = safeName(inpName.value || `${solid.name || "part"}_flat`);
      const format = selFmt.value;
      if (format === "svg") {
        const svg = buildFlatPatternSvg(data);
        downloadFile(`${base}.svg`, svg, "image/svg+xml;charset=utf-8");
      } else {
        const dxf = buildFlatPatternDxf(data);
        downloadFile(`${base}.dxf`, dxf, "application/dxf");
      }
      close();
    } catch (error) {
      console.error(error);
      alert("Flat pattern export failed. See console for details.");
    }
  });

  buttons.appendChild(btnCancel);
  buttons.appendChild(btnExport);

  modal.appendChild(title);
  modal.appendChild(rowName);
  modal.appendChild(rowFmt);
  modal.appendChild(hint);
  modal.appendChild(buttons);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  try {
    inpName.focus();
    inpName.select();
  } catch {}
}

export function createSheetMetalFlatExportButton(viewer) {
  return {
    label: "FP",
    title: "Export Flat Pattern (DXF/SVG)",
    onClick: () => openFlatExportDialog(viewer),
  };
}
