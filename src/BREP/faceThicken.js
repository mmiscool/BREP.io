import { Solid } from './BetterSolid.js';
import {
  hasOccShape,
  makeExtrusion,
  makeFacePrismFromOccSolid,
  setOccState,
} from './OpenCascadeKernel.js';

const EPS = 1e-9;

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

function getFaceLabel(face) {
  const raw = face?.userData?.faceName ?? face?.faceName ?? face?.name ?? null;
  if (raw == null) return null;
  const label = String(raw).trim();
  return label || null;
}

function getParentOccSolid(face) {
  const solid = face?.parentSolid || (String(face?.parent?.type || '').toUpperCase() === 'SOLID' ? face.parent : null);
  return hasOccShape(solid) ? solid : null;
}

function cloneBoundaryLoopsWorld(face) {
  const loops = Array.isArray(face?.userData?.boundaryLoopsWorld) && face.userData.boundaryLoopsWorld.length
    ? face.userData.boundaryLoopsWorld
    : null;
  if (!loops) return null;
  return loops
    .map((loop) => ({
      pts: (Array.isArray(loop?.pts) ? loop.pts : loop)
        .filter((point) => Array.isArray(point) && point.length >= 3)
        .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]),
      isHole: !!loop?.isHole,
      segmentIds: [],
    }))
    .filter((loop) => loop.pts.length >= 3);
}

function cloneSketchEdgeInputsWorld(face, sourceFaceName, loops) {
  const inputs = Array.isArray(face?.userData?.sketchEdgeInputsWorld)
    ? face.userData.sketchEdgeInputsWorld
    : null;
  if (inputs && inputs.length) {
    return inputs
      .map((edge, index) => ({
        ...edge,
        name: edge?.name || `${sourceFaceName}_E${index}_SW`,
        polyline: (Array.isArray(edge?.polyline) ? edge.polyline : [])
          .filter((point) => Array.isArray(point) && point.length >= 3)
          .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]),
        bezierPoles: Array.isArray(edge?.bezierPoles) ? edge.bezierPoles.map((point) => point.slice()) : edge?.bezierPoles,
        circleCenter: Array.isArray(edge?.circleCenter) ? edge.circleCenter.slice() : edge?.circleCenter,
        arcCenter: Array.isArray(edge?.arcCenter) ? edge.arcCenter.slice() : edge?.arcCenter,
      }))
      .filter((edge) => Array.isArray(edge.polyline) && edge.polyline.length >= 2);
  }

  const edgeInputs = [];
  for (let loopIndex = 0; loopIndex < (loops || []).length; loopIndex += 1) {
    const pts = loops[loopIndex]?.pts || [];
    for (let edgeIndex = 0; edgeIndex < pts.length; edgeIndex += 1) {
      const label = loopIndex === 0
        ? `${sourceFaceName}_E${edgeIndex}_SW`
        : `${sourceFaceName}_L${loopIndex}_E${edgeIndex}_SW`;
      edgeInputs.push({
        name: label,
        polyline: [pts[edgeIndex], pts[(edgeIndex + 1) % pts.length]],
        metadataJson: JSON.stringify({
          faceType: 'SIDEWALL',
          type: 'sidewall',
          sourceFaceName,
          loopIndex,
          edgeIndex,
        }),
      });
    }
  }
  return edgeInputs;
}

function averageLoopNormal(loops) {
  const outer = (loops || []).find((loop) => !loop.isHole) || loops?.[0] || null;
  const pts = outer?.pts || [];
  if (pts.length < 3) return [0, 0, 1];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  return len > 1e-12 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
}

function projectedSignedArea(pts, normal) {
  const ax = Math.abs(normal?.[0] || 0);
  const ay = Math.abs(normal?.[1] || 0);
  const az = Math.abs(normal?.[2] || 0);
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if (az >= ax && az >= ay) area += p[0] * q[1] - q[0] * p[1];
    else if (ay >= ax && ay >= az) area += p[0] * q[2] - q[0] * p[2];
    else area += p[1] * q[2] - q[1] * p[2];
  }
  return area * 0.5;
}

function orientHoleLoopsForOccFaceBuilder(loops, normal) {
  const outer = (loops || []).find((loop) => !loop.isHole) || loops?.[0] || null;
  const outerSign = Math.sign(projectedSignedArea(outer?.pts || [], normal) || 1) || 1;
  return (loops || []).map((loop) => {
    const pts = Array.isArray(loop?.pts) ? loop.pts.slice() : [];
    if (loop.isHole && Math.sign(projectedSignedArea(pts, normal) || 0) !== outerSign) pts.reverse();
    return { ...loop, pts };
  });
}

function applySourceFaceMetadataToThickenResult(result, face, sourceFaceName) {
  let sourceMetadata = null;
  try {
    sourceMetadata = typeof face?.getMetadata === 'function' ? (face.getMetadata() || null) : null;
  } catch {
    sourceMetadata = null;
  }
  if (!sourceMetadata || typeof result?.setFaceMetadata !== 'function') return;
  const sourceFeatureId = face?.owningFeatureID ?? face?.parentSolid?.owningFeatureID ?? sourceMetadata?.sourceFeatureId ?? null;
  try {
    result.setFaceMetadata(`${sourceFaceName}_START`, {
      ...sourceMetadata,
      type: 'start_cap',
      sourceFaceName,
      sourceFeatureId,
    });
    result.setFaceMetadata(`${sourceFaceName}_END`, {
      ...sourceMetadata,
      type: 'end_cap',
      sourceFaceName,
      sourceFeatureId,
    });
  } catch {
    /* ignore metadata propagation errors */
  }
}

function makeLoopPrismThicken(face, distance, options = {}) {
  const dist = Number(distance);
  if (!Number.isFinite(dist) || Math.abs(dist) <= EPS) {
    throw new Error('Face.thicken() requires a non-zero finite distance.');
  }
  const boundaryLoops = cloneBoundaryLoopsWorld(face);
  if (!boundaryLoops?.length) return null;
  const featureId = sanitizeToken(options.featureId || options.name || face?.name || 'THICKEN', 'THICKEN');
  const sourceFaceName = String(options.sourceFaceName || getFaceLabel(face) || featureId).trim() || featureId;
  const solidName = String(options.name || featureId).trim() || featureId;
  const normal = averageLoopNormal(boundaryLoops);
  const orientedLoops = orientHoleLoopsForOccFaceBuilder(boundaryLoops, normal);
  const edgeInputs = cloneSketchEdgeInputsWorld(face, sourceFaceName, orientedLoops);
  const occState = makeExtrusion({
    boundaryLoops: orientedLoops,
    edgeInputs,
    faceName: sourceFaceName,
    name: '',
    direction: [normal[0] * dist, normal[1] * dist, normal[2] * dist],
    normal,
  });

  const result = new Solid();
  result.name = solidName;
  setOccState(result, occState);
  applySourceFaceMetadataToThickenResult(result, face, sourceFaceName);
  result.__thickenMethod = 'occ_prism';
  result.__thickenClassificationMethod = 'occ_face_classifier';
  result.__thickenDiagnostics = {
    boundaryLoopCount: boundaryLoops.length,
    sourceFaceCount: 1,
    sourceFaceNames: [sourceFaceName],
    sourceFaceName,
    distance: dist,
    classificationMethod: 'occ_face_classifier',
    buildMethod: result.__thickenMethod,
    constructionMethod: 'BRepPrimAPI_MakePrism',
    kernel: 'opencascade',
  };
  return result;
}

function makeSelectedOccFacePrismThicken(face, distance, options = {}) {
  const parentSolid = getParentOccSolid(face);
  const faceName = getFaceLabel(face);
  if (!parentSolid || !faceName) return null;
  const dist = Number(distance);
  if (!Number.isFinite(dist) || Math.abs(dist) <= EPS) {
    throw new Error('Face.thicken() requires a non-zero finite distance.');
  }
  const featureId = sanitizeToken(options.featureId || options.name || faceName || 'THICKEN', 'THICKEN');
  const sourceFaceName = String(options.sourceFaceName || faceName || featureId).trim() || featureId;
  const solidName = String(options.name || featureId).trim() || featureId;
  const occState = makeFacePrismFromOccSolid(parentSolid, faceName, {
    distance: dist,
    sourceFaceName,
    featureID: featureId,
  });
  if (!occState) return null;

  const result = new Solid();
  result.name = solidName;
  setOccState(result, occState);
  applySourceFaceMetadataToThickenResult(result, face, sourceFaceName);
  result.__thickenMethod = 'occ_prism';
  result.__thickenClassificationMethod = 'occ_face_classifier';
  result.__thickenDiagnostics = {
    boundaryLoopCount: 0,
    sourceFaceCount: 1,
    sourceFaceNames: [sourceFaceName],
    sourceFaceName,
    distance: dist,
    classificationMethod: 'occ_face_classifier',
    buildMethod: result.__thickenMethod,
    constructionMethod: 'BRepPrimAPI_MakePrism',
    kernel: 'opencascade',
  };
  return result;
}

export function thickenFaceToSolid(face, distance, options = {}) {
  const occSolid = makeSelectedOccFacePrismThicken(face, distance, options)
    || makeLoopPrismThicken(face, distance, options);
  if (occSolid) return occSolid;
  throw new Error('Face.thicken() requires an OpenCascade BREP face or authored boundary loops.');
}

export function thickenFacesToSolid() {
  throw new Error('Face.thicken() only supports one OpenCascade BREP face at a time.');
}
