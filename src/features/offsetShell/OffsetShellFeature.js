import { resolveSelectionObject } from '../selectionUtils.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Optional identifier used when naming the generated solid and faces',
  },
  distance: {
    type: 'number',
    default_value: 1,
    hint: 'Signed shell distance; thickening is applied in the opposite direction.',
  },
  faces: {
    type: 'reference_selection',
    selectionFilter: ['FACE'],
    multiple: true,
    default_value: [],
    hint: 'Pick one or more faces to exclude while shelling the solid.',
  },
  replaceOriginalSolid: {
    type: 'boolean',
    label: 'REPLACE ORIGINAL SOLID',
    default_value: true,
    hint: 'When enabled, remove the source solid and leave only the shell result in the scene.',
  },
};

function getFaceName(entry) {
  const raw = entry?.userData?.faceName ?? entry?.faceName ?? entry?.name ?? null;
  if (raw == null) return null;
  const name = String(raw).trim();
  return name || null;
}

function resolveFaceSelection(selection, partHistory) {
  const resolved = resolveSelectionObject(selection, partHistory);
  if (resolved?.type === 'FACE') return resolved;
  if (resolved?.type === 'SKETCH') {
    return (Array.isArray(resolved.children) ? resolved.children : [])
      .find((child) => child?.type === 'FACE') || null;
  }
  return null;
}

function collectFaceSelections(selection, partHistory) {
  const list = Array.isArray(selection) ? selection : [selection];
  const faces = [];
  const seen = new Set();
  for (const candidate of list) {
    if (!candidate) continue;
    const face = resolveFaceSelection(candidate, partHistory);
    if (!face || String(face?.type || '').toUpperCase() !== 'FACE') continue;
    const key = `${face?.parentSolid?.uuid || face?.parent?.uuid || ''}::${getFaceName(face) || face?.uuid || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(face);
  }
  return faces;
}

export class OffsetShellFeature {
  static shortName = 'O.S';
  static longName = 'Offset Shell';
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const faceEntries = collectFaceSelections(this.inputParams.faces, partHistory);
    if (!faceEntries.length) {
      console.warn('[OffsetShellFeature] No faces selected.');
      return { added: [], removed: [] };
    }

    const solids = new Set();
    for (const entry of faceEntries) {
      if (!entry || entry.type !== 'FACE') continue;
      const solid = entry.parentSolid || (entry.parent && entry.parent.type === 'SOLID' ? entry.parent : null);
      if (solid) solids.add(solid);
    }

    if (!solids.size) {
      console.warn('[OffsetShellFeature] Selected faces are not attached to a solid.');
      return { added: [], removed: [] };
    }
    if (solids.size > 1) {
      console.warn('[OffsetShellFeature] Faces from multiple solids selected; aborting offset shell.');
      return { added: [], removed: [] };
    }

    const targetSolid = solids.values().next().value;
    if (!targetSolid || typeof targetSolid.offsetShell !== 'function') {
      console.warn('[OffsetShellFeature] Target solid does not support offsetShell().');
      return { added: [], removed: [] };
    }

    const dist = Number(this.inputParams.distance);
    if (!Number.isFinite(dist) || dist === 0) {
      console.warn('[OffsetShellFeature] Distance must be a non-zero finite number.');
      return { added: [], removed: [] };
    }

    const fallbackId = OffsetShellFeature.shortName || OffsetShellFeature.longName || 'OffsetShell';
    const featureId = (this.inputParams.featureID || fallbackId).trim();
    const newSolidName = `${targetSolid.name || 'Solid'}_${featureId}`;

    let resultSolid = null;
    try {
      resultSolid = targetSolid.offsetShell(faceEntries, dist, {
        featureId,
        newSolidName,
      });
    } catch (err) {
      console.error('[OffsetShellFeature] Solid.offsetShell failed:', err);
      return { added: [], removed: [] };
    }

    if (!resultSolid) {
      console.warn('[OffsetShellFeature] offsetShell returned no result.');
      return { added: [], removed: [] };
    }

    try { resultSolid.name = newSolidName; } catch {}
    try { resultSolid.visualize(); } catch {}

    this.persistentData = {
      sourceSolidName: String(targetSolid?.name || ''),
      selectedFaceNames: faceEntries.map((entry) => getFaceName(entry)).filter(Boolean),
      distance: dist,
      diagnostics: resultSolid?.__offsetDiagnostics || null,
    };

    const replaceOriginalSolid = this.inputParams.replaceOriginalSolid !== false;
    return {
      added: [resultSolid],
      removed: replaceOriginalSolid ? [targetSolid] : [],
    };
  }
}
