import { buildSheetMetalFlatPatternSolids } from '../../exporters/sheetMetalFlatPattern.js';
import { deepClone } from '../../utils/deepClone.js';

function collectSolids(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  if (!scene) return [];
  const solids = [];
  scene.traverse((o) => {
    if (!o || !o.visible) return;
    if (o.type === 'SOLID' && typeof o.getBoundaryEdgePolylines === 'function') solids.push(o);
  });
  const selected = solids.filter((o) => o.selected === true);
  return selected.length ? selected : solids;
}

function findFlatPatternPlaneFeature(partHistory) {
  const list = Array.isArray(partHistory?.features) ? partHistory.features : [];
  return list.find((f) => f?.type === 'P' && f?.persistentData?.flatPatternPlane) || null;
}

async function ensureFlatPatternPlane(partHistory) {
  if (!partHistory || typeof partHistory.newFeature !== 'function') return null;
  let planeFeature = findFlatPatternPlaneFeature(partHistory);
  if (planeFeature) return planeFeature;
  planeFeature = await partHistory.newFeature('P');
  planeFeature.inputParams.orientation = 'XY';
  planeFeature.persistentData = planeFeature.persistentData || {};
  planeFeature.persistentData.flatPatternPlane = true;
  return planeFeature;
}

function findFlatPatternSketchFeature(partHistory, solidName) {
  if (!solidName) return null;
  const list = Array.isArray(partHistory?.features) ? partHistory.features : [];
  return list.find((f) => f?.type === 'S' && f?.persistentData?.flatPatternSolidName === solidName) || null;
}

export function createFlatPatternButton(viewer) {
  return {
    label: 'FP',
    title: 'Flat Pattern (sketch)',
    onClick: async () => {
      try {
        const partHistory = viewer?.partHistory || null;
        if (!partHistory) {
          alert('Part history is unavailable. Flat pattern requires a history-backed model.');
          return;
        }
        const solids = collectSolids(viewer);
        if (!solids.length) {
          alert('No solids available for flat pattern.');
          return;
        }
        const results = buildSheetMetalFlatPatternSolids(solids, {});
        const planeFeature = await ensureFlatPatternPlane(partHistory);
        const planeId = planeFeature?.inputParams?.featureID || planeFeature?.inputParams?.id || null;
        let updatedCount = 0;
        let lastSketchId = null;
        for (const result of results) {
          if (!result?.sketch?.geometries?.length) continue;
          let sketchFeature = findFlatPatternSketchFeature(partHistory, result.solidName);
          if (!sketchFeature) {
            sketchFeature = await partHistory.newFeature('S');
          }
          sketchFeature.inputParams.sketchPlane = planeId;
          sketchFeature.persistentData = sketchFeature.persistentData || {};
          sketchFeature.persistentData.flatPatternSolidName = result.solidName || null;
          sketchFeature.persistentData.basis = {
            origin: [0, 0, 0],
            x: [1, 0, 0],
            y: [0, 1, 0],
            z: [0, 0, 1],
            refName: planeId || undefined,
          };
          sketchFeature.persistentData.sketch = deepClone(result.sketch);
          sketchFeature.dirty = true;
          sketchFeature.lastRunInputParams = null;
          lastSketchId = sketchFeature.inputParams?.featureID || sketchFeature.inputParams?.id || null;
          updatedCount += 1;
        }
        if (updatedCount === 0) {
          alert('Flat pattern produced no sketch geometry. Check sheet-metal face tagging.');
          return;
        }
        await partHistory.runHistory();
        if (lastSketchId) {
          partHistory.currentHistoryStepId = String(lastSketchId);
        }
      } catch (err) {
        console.error('[FlatPattern] Failed to build sketch', err);
        alert('Flat pattern failed. See console for details.');
      }
    },
  };
}
