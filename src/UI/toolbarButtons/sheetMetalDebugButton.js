import { deepClone } from "../../utils/deepClone.js";

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
  const solids = [];
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
  const selected = new Set();
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
    .smdbg-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.62); display: flex; align-items: center; justify-content: center; z-index: 20; }
    .smdbg-modal { background: #0b0e14; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; width: min(860px, calc(100vw - 32px)); height: min(78vh, 780px); box-shadow: 0 10px 40px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 8px; }
    .smdbg-title { font-size: 14px; font-weight: 700; }
    .smdbg-hint { font-size: 12px; color: #9aa0aa; }
    .smdbg-text { flex: 1 1 auto; width: 100%; resize: none; background: #06080c; color: #dbe7ff; border: 1px solid #374151; border-radius: 8px; padding: 10px; font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .smdbg-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .smdbg-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; }
    .smdbg-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
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
  const overlay = document.createElement("div");
  overlay.className = "smdbg-overlay";

  const modal = document.createElement("div");
  modal.className = "smdbg-modal";

  const title = document.createElement("div");
  title.className = "smdbg-title";
  title.textContent = "Sheet Metal Debug JSON";

  const hint = document.createElement("div");
  hint.className = "smdbg-hint";
  hint.textContent = copiedToClipboard
    ? "Copied to clipboard. You can also copy from this textbox."
    : "Clipboard copy was unavailable. Copy the JSON from this textbox.";

  const text = document.createElement("textarea");
  text.className = "smdbg-text";
  text.value = jsonText;
  text.readOnly = true;

  const actions = document.createElement("div");
  actions.className = "smdbg-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "smdbg-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", async () => {
    const ok = await copyTextToClipboard(text.value);
    hint.textContent = ok
      ? "Copied to clipboard."
      : "Clipboard copy failed. Use Ctrl/Cmd+C in the textbox.";
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "smdbg-btn";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => {
    try { document.body.removeChild(overlay); } catch {}
  });

  actions.appendChild(copyBtn);
  actions.appendChild(closeBtn);
  modal.appendChild(title);
  modal.appendChild(hint);
  modal.appendChild(text);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  try {
    text.focus();
    text.select();
  } catch {}
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
          // ignore
        }
        openDebugDialog(jsonText, copied);
      } catch (error) {
        console.error("[SheetMetalDebug] Failed to build debug payload:", error);
        alert("Failed to build sheet metal debug JSON. See console for details.");
      }
    },
  };
}
