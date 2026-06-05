import {
  buildSheetMetalFlatPatternFiles,
  collectSheetMetalSolidsFromViewer,
  resolveViewerFlatPatternBaseName,
} from "../../features/sheetMetal/flatPatternFiles.js";

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
  const solids = collectSheetMetalSolidsFromViewer(viewer);
  if (!solids.length) {
    alert("No sheet metal model found to export.");
    return;
  }

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
  inpName.value = resolveViewerFlatPatternBaseName(viewer, solids[0]?.name || "part");
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
  hint.textContent = solids.length > 1
    ? `Exports ${solids.length} visible sheet metal flat patterns. File names use the current model name plus the sheet metal feature name.`
    : "Cut lines export as black solid lines. Bend UP lines export as blue dashed lines, bend DOWN lines as magenta dashed lines, with UP/DOWN angle labels.";

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
      const format = selFmt.value;
      const result = buildSheetMetalFlatPatternFiles(solids, {
        baseName: inpName.value || resolveViewerFlatPatternBaseName(viewer, solids[0]?.name || "part"),
        format,
      });
      if (!result.files.length) {
        alert("Flat pattern export failed: no cut boundaries were generated.");
        return;
      }
      for (const file of result.files) {
        downloadFile(file.filename, file.content, file.mime);
      }
      close();
      if (result.skipped.length) {
        alert(`Exported ${result.files.length} flat pattern file(s). Skipped ${result.skipped.length}.`);
      }
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
