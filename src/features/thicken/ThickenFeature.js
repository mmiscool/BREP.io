import {
  groupConnectedFacesBySharedEdges,
  thickenFacesToSolid,
} from '../../BREP/faceThicken.js';
import { resolveSelectionObject } from '../selectionUtils.js';

const SELECTED_PATCH_ADJACENT_NORMAL_DOT_THRESHOLD = 0.7;

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Optional identifier for the thicken feature.',
  },
  face: {
    type: 'reference_selection',
    label: 'Faces',
    selectionFilter: ['FACE'],
    multiple: true,
    default_value: [],
    hint: 'Select one or more open face meshes to thicken into individual solids.',
  },
  distance: {
    type: 'number',
    default_value: 1,
    hint: 'Signed thickness to apply along the face normals.',
  },
};

function sanitizeToken(value, fallback = 'FACE') {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed
    .replace(/[:[\]]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    || fallback;
}

function getFaceName(entry) {
  const raw = entry?.userData?.faceName ?? entry?.faceName ?? entry?.name ?? null;
  if (raw == null) return null;
  const name = String(raw).trim();
  return name || null;
}

function getFaceSelectionKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const faceName = getFaceName(entry);
  const owner = entry?.parentSolid || entry?.parent || null;
  const ownerKey = owner?.uuid || owner?.id || owner?.name || '';
  if (faceName) return `${ownerKey}::${faceName}`;
  return entry?.uuid || entry?.id || null;
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
    const key = getFaceSelectionKey(face);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    faces.push(face);
  }
  return faces;
}

function resolveFeatureId(inputParams, fallback) {
  const raw = inputParams?.featureID ?? inputParams?.featureId ?? inputParams?.id ?? fallback;
  return String(raw || fallback).trim() || fallback;
}

export class ThickenFeature {
  static shortName = 'THK';
  static longName = 'Thicken';
  static inputParamsSchema = inputParamsSchema;

  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const faces = [];
    const seen = new Set();
    for (const item of items) {
      if (String(item?.type || '').toUpperCase() !== 'FACE') continue;
      const key = getFaceSelectionKey(item) || getFaceName(item) || null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      faces.push(item);
    }
    if (!faces.length) return false;
    return { params: { face: faces } };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const featureId = resolveFeatureId(this.inputParams, ThickenFeature.shortName);
    const faceSelections = collectFaceSelections(this.inputParams.face, partHistory);
    if (!faceSelections.length) {
      console.warn('[ThickenFeature] No valid face selections resolved.');
      return { added: [], removed: [] };
    }

    const distance = Number(this.inputParams.distance);
    if (!Number.isFinite(distance) || distance === 0) {
      console.warn('[ThickenFeature] Distance must be a non-zero finite number.');
      return { added: [], removed: [] };
    }

    const added = [];
    const results = [];
    const failures = [];
    const faceGroups = groupConnectedFacesBySharedEdges(faceSelections, {
      minSharedNormalDot: SELECTED_PATCH_ADJACENT_NORMAL_DOT_THRESHOLD,
      minPlanarRatio: 0.98,
    });
    const selectedFaceNames = faceSelections.map((face, faceIndex) => getFaceName(face) || `FACE_${faceIndex + 1}`);
    const width = Math.max(2, String(faceGroups.length).length);

    for (let index = 0; index < faceGroups.length; index += 1) {
      const groupFaces = faceGroups[index];
      const primaryFace = groupFaces[0] || null;
      const groupFaceNames = groupFaces.map((face, faceIndex) => getFaceName(face) || `FACE_${faceIndex + 1}`);
      const sourceFaceName = groupFaceNames[0] || `FACE_${index + 1}`;
      const sourceObjectName = groupFaceNames.join(', ');
      const resultName = faceGroups.length === 1
        ? featureId
        : `${featureId}_${String(index + 1).padStart(width, '0')}_${sanitizeToken(sourceFaceName, `FACE_${index + 1}`)}`;

      let result = null;
      try {
        const thickenOptions = {
          featureId,
          name: resultName,
        };
        if (selectedFaceNames.length > 1) {
          thickenOptions.adjacentNormalFaceNames = selectedFaceNames;
          thickenOptions.smoothAdjacentNormalDotThreshold = SELECTED_PATCH_ADJACENT_NORMAL_DOT_THRESHOLD;
          thickenOptions.sharedBoundaryNormalMode = 'equal';
        }
        result = groupFaces.length > 1
          ? thickenFacesToSolid(groupFaces, distance, thickenOptions)
          : primaryFace.thicken(distance, thickenOptions);
      } catch (error) {
        failures.push({
          selectionIndex: index,
          sourceFaceName,
          sourceObjectName,
          sourceFaceNames: groupFaceNames,
          error: error?.message || String(error),
        });
        console.error(`[ThickenFeature] Failed to thicken face group "${sourceObjectName}".`, error);
        continue;
      }

      const diagnostics = result?.__thickenDiagnostics || null;
      results.push({
        selectionIndex: index,
        resultName,
        sourceFaceName,
        sourceFaceNames: groupFaceNames,
        sourceObjectName,
        diagnostics,
      });

      try { result.name = resultName; } catch { /* ignore */ }
      try {
        result.userData = {
          ...(result.userData || {}),
          thickenFeature: {
            featureId,
            resultName,
            sourceFaceName,
            sourceFaceNames: groupFaceNames,
            distance,
            selectionIndex: index,
          },
        };
      } catch { /* ignore */ }
      added.push(result);
    }

    if (!added.length) {
      console.warn('[ThickenFeature] Failed to produce any thickened solids.');
      return { added: [], removed: [] };
    }

    const primary = results[0] || null;
    this.persistentData = {
      sourceFaceName: primary?.sourceFaceName || '',
      sourceObjectName: primary?.sourceObjectName || '',
      sourceFaceNames: results.flatMap((entry) => entry.sourceFaceNames || [entry.sourceFaceName]),
      sourceObjectNames: results.map((entry) => entry.sourceObjectName),
      distance,
      diagnostics: results.length === 1
        ? (primary?.diagnostics || null)
        : results.map((entry) => ({
          selectionIndex: entry.selectionIndex,
          resultName: entry.resultName,
          sourceFaceName: entry.sourceFaceName,
          sourceFaceNames: entry.sourceFaceNames || [entry.sourceFaceName],
          diagnostics: entry.diagnostics || null,
        })),
      results,
      failures,
    };

    return { added, removed: [] };
  }
}
