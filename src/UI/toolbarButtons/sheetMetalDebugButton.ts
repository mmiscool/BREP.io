import { deepClone } from "../../utils/deepClone.js";
import { FloatingWindow } from "../FloatingWindow.js";

type AnyRecord = Record<string, any>;

declare global {
  interface Window {
    __sheetMetalDebugJson?: string;
  }
}

function safeName(raw, fallback = "sheet_metal") {
  const text = String(raw || "").trim();
  const base = text.length ? text : fallback;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
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
  const solids: AnyRecord[] = [];
  scene.traverse((object) => {
    if (!object || object.type !== "SOLID") return;
    if (!object.userData?.sheetMetalModel?.tree) return;
    solids.push(object);
  });
  return solids;
}

function collectSelectedSheetMetalSolids(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  if (!scene) return [];
  const selected = new Set<AnyRecord>();
  scene.traverse((object) => {
    if (!object?.selected) return;
    const solid = ascendSheetMetalSolid(object);
    if (solid) selected.add(solid);
  });
  return Array.from(selected);
}

function packSheetMetalSolid(solid) {
  if (!solid) return null;
  const model = solid.userData?.sheetMetalModel || {};
  return {
    name: solid.name || null,
    featureID: model.featureID || null,
    rootTransform: Array.isArray(model.rootTransform) ? model.rootTransform.slice() : null,
    showFlatPattern: model.showFlatPattern !== false,
    tree: deepClone(model.tree || null),
  };
}

async function buildFeatureHistorySnapshot(viewer) {
  const partHistory = viewer?.partHistory || null;
  if (!partHistory || typeof partHistory.toJSON !== "function") {
    return {
      featureCount: 0,
      expressions: "",
      features: [],
    };
  }

  try {
    const json = await partHistory.toJSON();
    const parsed = JSON.parse(json || "{}");
    const rawFeatures = Array.isArray(parsed?.features) ? parsed.features : [];
    return {
      featureCount: rawFeatures.length,
      expressions: String(parsed?.expressions || ""),
      features: rawFeatures.map((feature, index) => ({
        index,
        type: feature?.type || null,
        inputParams: deepClone(feature?.inputParams || {}),
        sheetMetalPersistent: deepClone(feature?.persistentData?.sheetMetal || null),
      })),
    };
  } catch (error) {
    return {
      featureCount: 0,
      expressions: "",
      features: [],
      error: String(error?.message || error || "Failed to serialize feature history."),
    };
  }
}

function ensureSheetMetalDebugStyles() {
  if (document.getElementById("sheet-metal-debug-dialog-styles")) return;
  const style = document.createElement("style");
  style.id = "sheet-metal-debug-dialog-styles";
  style.textContent = `
    .smdbg-modal { color: #e5e7eb; padding: 6px; width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; }
    .smdbg-hint { font-size: 12px; color: #9aa0aa; }
    .smdbg-text { flex: 1 1 auto; width: 100%; resize: none; background: #06080c; color: #dbe7ff; border: 1px solid #374151; border-radius: 8px; padding: 10px; font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  `;
  document.head.appendChild(style);
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // continue to fallback
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return !!ok;
  } catch {
    return false;
  }
}

function openDebugDialog(jsonText, copiedToClipboard = false) {
  ensureSheetMetalDebugStyles();

  const pageWidth = Number(window?.innerWidth) || 900;
  const pageHeight = Number(window?.innerHeight) || 760;
  const fw = new FloatingWindow({
    title: "Sheet Metal Debug JSON",
    width: Math.max(520, Math.min(860, pageWidth - 32)),
    height: Math.max(420, Math.min(780, Math.round(pageHeight * 0.78))),
    minWidth: 460,
    minHeight: 320,
    modal: true,
    closeOnBackdrop: true,
    closeOnEscape: true,
    onClose: () => {
      try { fw.destroy(); } catch {
        // best effort
      }
    },
  });

  const modal = document.createElement("div");
  modal.className = "smdbg-modal";

  const hint = document.createElement("div");
  hint.className = "smdbg-hint";
  hint.textContent = copiedToClipboard
    ? "Copied to clipboard. You can also copy from this textbox."
    : "Clipboard copy was unavailable. Copy the JSON from this textbox.";

  const text = document.createElement("textarea");
  text.className = "smdbg-text";
  text.value = jsonText;
  text.readOnly = true;

  const copyBtn = document.createElement("button");
  copyBtn.className = "fw-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", async () => {
    const ok = await copyTextToClipboard(text.value);
    hint.textContent = ok
      ? "Copied to clipboard."
      : "Clipboard copy failed. Use Ctrl/Cmd+C in the textbox.";
  });

  fw.addHeaderAction(copyBtn);
  modal.appendChild(hint);
  modal.appendChild(text);
  fw.content.appendChild(modal);

  try {
    text.focus();
    text.select();
  } catch {
    // best effort
  }
}

async function buildSheetMetalDebugPayload(viewer) {
  const history = await buildFeatureHistorySnapshot(viewer);
  const allSolids = collectSheetMetalSolids(viewer);
  const selected = collectSelectedSheetMetalSolids(viewer);
  const selectedSet = new Set(selected);

  return {
    schema: "brep.sheetMetalDebug.v1",
    generatedAt: new Date().toISOString(),
    history,
    sheetMetal: {
      selectedSolidNames: selected.map((solid) => solid.name || null),
      selectedModels: selected.map(packSheetMetalSolid).filter(Boolean),
      allModelCount: allSolids.length,
      allModels: allSolids.map(packSheetMetalSolid).filter(Boolean),
      unselectedModelCount: allSolids.filter((solid) => !selectedSet.has(solid)).length,
    },
    context: {
      partName: safeName(viewer?.partHistory?.name || viewer?.scene?.name || "part"),
    },
  };
}

export function createSheetMetalDebugButton(viewer) {
  if (!viewer) return null;
  return {
    label: "SMDBG",
    title: "Copy sheet metal debug JSON (history + tree)",
    onClick: async () => {
      try {
        const payload = await buildSheetMetalDebugPayload(viewer);
        const jsonText = JSON.stringify(payload, null, 2);
        const copied = await copyTextToClipboard(jsonText);
        try {
          console.log("[SheetMetalDebug] JSON payload", payload);
          window.__sheetMetalDebugJson = jsonText;
        } catch {
          // best effort
        }
        openDebugDialog(jsonText, copied);
      } catch (error) {
        console.error("[SheetMetalDebug] Failed to build debug payload:", error);
        alert("Failed to build sheet metal debug JSON. See console for details.");
      }
    },
  };
}
