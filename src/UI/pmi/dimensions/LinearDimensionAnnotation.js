import * as THREE from 'three';
import { BaseAnnotation } from '../BaseAnnotation.js';
import { addArrowCone, getElementDirection, makeOverlayLine, objectRepresentativePoint, screenSizeWorld } from '../annUtils.js';
import { buildLinearDimensionGeometry, vectorFromAny } from '../../dimensions/dimensionGeometry.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    label: 'ID',
    hint: 'unique identifier for the linear dimension',
  },

  targets: {
    type: 'reference_selection',
    selectionFilter: ['VERTEX', 'EDGE', 'FACE'],
    multiple: true,
    default_value: [],
    label: 'Targets',
    hint: 'Select vertices, edges, or a planar face/linear edge and target',
  },
  planeRefName: {
    type: 'reference_selection',
    selectionFilter: ['FACE', 'PLANE'],
    multiple: false,
    default_value: '',
    label: 'Face/Plane',
    hint: 'Projection plane (optional)',
  },
  alignment: {
    type: 'options',
    default_value: 'view',
    options: ['view', 'XY', 'YZ', 'ZX'],
    label: 'Alignment',
    hint: 'Dimension alignment mode',
  },
  offset: {
    type: 'number',
    default_value: 0,
    label: 'Offset',
    hint: 'Offset distance for the dimension line',
    step: 'any',
  },
  showExt: {
    type: 'boolean',
    default_value: true,
    label: 'Extension Lines',
    hint: 'Draw extension lines from anchors to offset line',
  },
  isReference: {
    type: 'boolean',
    default_value: false,
    label: 'Reference',
    hint: 'Mark as reference dimension (parentheses)',
  },
  decimals: {
    type: 'number',
    default_value: 3,
    defaultResolver: ({ pmimode }) => {
      const dec = Number.isFinite(pmimode?._opts?.dimDecimals)
        ? (pmimode._opts.dimDecimals | 0)
        : undefined;
      if (!Number.isFinite(dec)) return undefined;
      return Math.max(0, Math.min(8, dec));
    },
    label: 'Decimals',
    hint: 'Number of decimal places to display',
    min: 0,
    max: 8,
    step: 1,
  },
};

export class LinearDimensionAnnotation extends BaseAnnotation {
  static entityType = 'linear';
  static type = 'linear';
  static shortName = 'DIM';
  static longName = 'Linear Dimension';
  static title = 'Linear';
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems) {
    const refs = BaseAnnotation._collectSelectionRefs(selectedItems, ['VERTEX', 'EDGE', 'FACE']);
    if (!refs.length) return false;
    return { params: { targets: refs.slice(0, 2) } };
  }

  constructor(opts = {}) {
    super(opts);
  }

  uiFieldsTest(_context) {
    const planeRefName = this.inputParams?.planeRefName;
    const hasPlane = Array.isArray(planeRefName)
      ? planeRefName.length > 0
      : Boolean(String(planeRefName || '').trim());
    return hasPlane ? ['alignment'] : [];
  }

  async run(renderingContext) {
    const { pmimode, group, idx, ctx } = renderingContext;
    const ann = this.inputParams;
    const pts = computeDimPoints(pmimode, ann);
    const measured = (pts && pts.p0 && pts.p1) ? pts.p0.distanceTo(pts.p1) : null;
    const labelInfo = formatLinearLabel(measured, ann);
    ann.value = labelInfo.display;

    if (!pts || !pts.p0 || !pts.p1) return [];

    if (!ann.persistentData || typeof ann.persistentData !== 'object') {
      ann.persistentData = {};
    }
    const persistent = ann.persistentData;

    try {
      const color = 0x10b981;
      const normal = ctx.alignNormal ? ctx.alignNormal(ann?.alignment || 'view', ann) : new THREE.Vector3(0, 0, 1);
      const geometry = buildLinearDimensionGeometry({
        pointA: pts.p0,
        pointB: pts.p1,
        extensionAnchorA: pts.extensionAnchorA,
        extensionAnchorB: pts.extensionAnchorB,
        normal,
        offset: ann?.offset,
        showExtensions: ann?.showExt !== false,
        labelWorld: persistent.labelWorld || ann.labelWorld,
        screenSizeWorld: ctx.screenSizeWorld,
        fallbackScreenSizeWorld: (pixels) => screenSizeWorld(pmimode?.viewer, pixels),
      });
      if (!geometry) return [];

      for (const [start, end] of geometry.segments) {
        group.add(makeOverlayLine(start, end, color));
      }
      for (const arrow of geometry.arrowSpecs) {
        addArrowCone(group, arrow.tip, arrow.direction, arrow.length, arrow.width, color);
      }
      if (geometry.leaderSegment) {
        group.add(makeOverlayLine(geometry.leaderSegment[0], geometry.leaderSegment[1], color));
      }

      const dec = Number.isFinite(ann.decimals) ? ann.decimals : (pmimode?._opts?.dimDecimals | 0);
      const value = pts.p0.distanceTo(pts.p1);
      const displayInfo = formatLinearLabel(value, ann, dec);
      ann.value = displayInfo.display;
      const labelText = ctx.formatReferenceLabel ? ctx.formatReferenceLabel(ann, displayInfo.raw) : displayInfo.display;
      const labelPos = geometry.labelPosition;
      if (labelPos) ctx.updateLabel(idx, labelText, labelPos, ann);
    } catch { /* ignore */ }
    return [];
  }

  static onLabelPointerDown(pmimode, idx, ann, e, ctx) {
    try {
      const v = pmimode.viewer; const cam = v?.camera; if (!cam) return;
      const pts = computeDimPoints(pmimode, ann);
      if (!pts || !pts.p0 || !pts.p1) return;

      const p0 = pts.p0;
      const p1 = pts.p1;
      const normal = ctx.alignNormal ? ctx.alignNormal(ann?.alignment || 'view', ann) : new THREE.Vector3(0, 0, 1);
      const dir = new THREE.Vector3().subVectors(p1, p0).normalize();
      const t = safeDimensionTangent(normal, dir);
      const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, mid);

      LinearDimensionAnnotation.dragLabelOnPlane(pmimode, ctx, {
        makePlane: () => plane,
        onDrag: (hit) => {
          const toMouse = new THREE.Vector3().subVectors(hit, mid);
          const offsetDist = toMouse.dot(t);
          ann.offset = offsetDist;
          const vecOut = [hit.x, hit.y, hit.z];
          LinearDimensionAnnotation.ensurePersistentData(ann);
          ann.persistentData.labelWorld = vecOut;
          ann.labelWorld = vecOut;
          ctx.updateLabel(idx, null, hit, ann);
          pmimode.refreshAnnotationsUI?.();
        },
        onEnd: () => {
          try { if (pmimode?.viewer?.controls) pmimode.viewer.controls.enabled = true; } catch { }
        },
      });
    } catch { /* ignore */ }
  }

}

function formatLinearLabel(measured, ann, overrideDecimals) {
  if (typeof measured !== 'number' || !Number.isFinite(measured)) {
    return { raw: '-', display: '-' };
  }
  const decRaw = overrideDecimals !== undefined ? overrideDecimals : Number(ann?.decimals);
  const decimals = Number.isFinite(decRaw) ? Math.max(0, Math.min(8, decRaw | 0)) : 3;
  const raw = `${measured.toFixed(decimals)}`;
  const display = ann?.isReference ? `(${raw})` : raw;
  return { raw, display };
}

function computeDimPoints(pmimode, ann) {
  const hasTargets = Array.isArray(ann?.targets);
  try {
    const scene = pmimode?.viewer?.partHistory?.scene;
    const targets = normalizeTargetList(hasTargets ? ann.targets : null);
    if (scene && targets.length) {
      const objects = resolveTargetObjects(scene, targets);
      if (objects.length) {
        const vertices = [];
        const edges = [];
        const faces = [];
        for (const obj of objects) {
          const type = typeof obj?.type === 'string' ? obj.type.toUpperCase() : '';
          if (type === 'VERTEX') vertices.push(obj);
          else if (type === 'EDGE') edges.push(obj);
          else if (type === 'FACE' || type === 'PLANE') faces.push(obj);
        }
        const primary = objects[0] || null;
        const hasFaceTarget = faces.length > 0 || objects.some((obj) => isFaceLikeObject(obj));
        const hasEdgeTarget = edges.length > 0 || objects.some((obj) => isEdgeLikeObject(obj));
        if (isFaceLikeObject(primary)) {
          const faceNormalDim = computeFaceNormalDimPoints(pmimode, objects);
          if (faceNormalDim) return faceNormalDim;
        }
        if (isEdgeLikeObject(primary) && objects.length >= 2) {
          const edgeNormalDim = computeEdgeNormalDimPoints(pmimode, objects);
          if (edgeNormalDim) return edgeNormalDim;
        }
        if (hasFaceTarget) {
          const faceNormalDim = computeFaceNormalDimPoints(pmimode, objects);
          if (faceNormalDim) return faceNormalDim;
        }
        if (hasEdgeTarget && objects.length >= 2) {
          const edgeNormalDim = computeEdgeNormalDimPoints(pmimode, objects);
          if (edgeNormalDim) return edgeNormalDim;
        }
        const viewer = pmimode?.viewer;
        if (vertices.length >= 2) {
          const p0 = resolveVertexPoint(viewer, vertices[0]);
          const p1 = resolveVertexPoint(viewer, vertices[1]);
          if (p0 && p1) return { p0, p1 };
        }
        if (vertices.length === 1 && edges.length) {
          const p0 = resolveVertexPoint(viewer, vertices[0]);
          const p1 = p0 ? closestEndpointToPoint(edges, p0) : null;
          if (p0 && p1) return { p0, p1 };
        }
        if (!vertices.length && edges.length) {
          if (edges.length === 1) {
            const ends = edgeEndpointsWorld(edges[0]);
            if (ends) return { p0: ends.a, p1: ends.b };
          } else if (edges.length >= 2) {
            return closestPointsBetweenEdges(edges[0], edges[1]);
          }
        }
      }
      return null;
    }
  } catch { /* ignore */ }
  if (!hasTargets) {
    try {
      const scene = pmimode?.viewer?.partHistory?.scene;
      const aName = ann?.aRefName || null;
      const bName = ann?.bRefName || null;
      if (scene && (aName || bName)) {
        const objA = aName ? scene.getObjectByName(aName) : null;
        const objB = bName ? scene.getObjectByName(bName) : null;
        if (objA && objB) return closestPointsForObjects(objA, objB);
        if (objA && !objB) {
          const pA = objectRepresentativePoint(pmimode.viewer, objA);
          const pB = vectorFromAnnotationPoint(ann.p1);
          if (pA && pB) return { p0: pA, p1: pB };
        }
        if (!objA && objB) {
          const pB = objectRepresentativePoint(pmimode.viewer, objB);
          const pA = vectorFromAnnotationPoint(ann.p0);
          if (pA && pB) return { p0: pA, p1: pB };
        }
      }
    } catch { /* ignore */ }
  }
  return {
    p0: vectorFromAnnotationPoint(ann?.p0) || new THREE.Vector3(0, 0, 0),
    p1: vectorFromAnnotationPoint(ann?.p1) || new THREE.Vector3(0, 0, 0),
  };
}

function computeFaceNormalDimPoints(pmimode, objects) {
  const viewer = pmimode?.viewer;
  const list = Array.isArray(objects) ? objects.filter(Boolean) : [];
  const faceIndex = list.findIndex((obj) => isFaceLikeObject(obj));
  if (faceIndex < 0) return null;
  const baseFace = list[faceIndex];
  const planeInfo = resolvePlanarFacePlane(viewer, baseFace);
  if (!planeInfo) return null;

  const targetObj = list.find((obj, index) => index !== faceIndex && obj);
  if (!targetObj) return null;
  const target = resolveFaceNormalTargetPoint(viewer, targetObj, planeInfo);
  if (!target?.point) return null;

  const signedDistance = target.point.clone().sub(planeInfo.point).dot(planeInfo.normal);
  const foot = target.point.clone().addScaledVector(planeInfo.normal, -signedDistance);
  const targetPoint = foot.clone().addScaledVector(planeInfo.normal, signedDistance);
  const baseAnchor = planeInfo.anchor || planeInfo.point;

  if (foot.distanceToSquared(targetPoint) <= 1e-12) return null;
  return {
    p0: foot,
    p1: targetPoint,
    extensionAnchorA: baseAnchor,
    extensionAnchorB: target.anchor || target.point,
    measurementNormal: planeInfo.normal.clone(),
    measurementMode: 'faceNormal',
  };
}

function computeEdgeNormalDimPoints(pmimode, objects) {
  const viewer = pmimode?.viewer;
  const list = Array.isArray(objects) ? objects.filter(Boolean) : [];
  const edgeIndex = list.findIndex((obj) => isEdgeLikeObject(obj));
  if (edgeIndex < 0 || list.length < 2) return null;
  const baseEdge = resolveLinearEdgeLine(list[edgeIndex]);
  if (!baseEdge) return null;

  const targetObj = list.find((obj, index) => index !== edgeIndex && obj);
  if (!targetObj) return null;
  const target = resolveEdgeNormalTargetPoint(viewer, targetObj, baseEdge);
  if (!target?.point) return null;

  const projection = projectPointOnLine(target.point, baseEdge.point, baseEdge.direction);
  if (!projection) return null;
  const foot = projection;
  const targetPoint = target.point.clone();

  if (foot.distanceToSquared(targetPoint) <= 1e-12) return null;
  return {
    p0: foot,
    p1: targetPoint,
    extensionAnchorA: baseEdge.anchor.clone(),
    extensionAnchorB: target.anchor || target.point,
    measurementMode: 'edgeNormal',
    referenceDirection: baseEdge.direction.clone(),
  };
}

function normalizeTargetList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function resolveTargetObjects(scene, targets) {
  if (!scene || !Array.isArray(targets)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of targets) {
    let obj = null;
    if (entry && typeof entry === 'object') {
      if (entry.isObject3D) obj = entry;
      else if (entry.name) obj = scene.getObjectByName(entry.name);
    } else if (entry != null) {
      const key = String(entry).trim();
      if (key) obj = scene.getObjectByName(key);
    }
    if (!obj) continue;
    const key = obj.uuid || obj.id || obj.name;
    if (key != null) {
      const keyStr = String(key);
      if (seen.has(keyStr)) continue;
      seen.add(keyStr);
    }
    out.push(obj);
  }
  return out;
}

function resolveVertexPoint(viewer, vertex) {
  const rep = objectRepresentativePoint(viewer, vertex);
  if (rep && rep.clone) return rep.clone();
  if (rep && rep.isVector3) return rep.clone();
  if (vertex?.getWorldPosition) return vertex.getWorldPosition(new THREE.Vector3());
  return null;
}

function isFaceLikeObject(obj) {
  if (!obj) return false;
  const runtimeType = String(obj.type || '').toUpperCase();
  const metaType = String(obj.userData?.type || obj.userData?.brepType || '').toUpperCase();
  return runtimeType === 'FACE'
    || runtimeType === 'PLANE'
    || metaType === 'FACE'
    || metaType === 'PLANE';
}

function isEdgeLikeObject(obj) {
  if (!obj) return false;
  const runtimeType = String(obj.type || '').toUpperCase();
  const metaType = String(obj.userData?.type || obj.userData?.brepType || '').toUpperCase();
  return runtimeType === 'EDGE'
    || metaType === 'EDGE'
    || obj.isLine
    || obj.isLine2
    || obj.isLineSegments
    || obj.isLineLoop;
}

function resolvePlanarFacePlane(viewer, faceObj) {
  try {
    if (!isFaceLikeObject(faceObj)) return null;
    const normal = getElementDirection(viewer, faceObj);
    if (!normal || normal.lengthSq() <= 1e-12) return null;
    normal.normalize();
    const anchor = objectRepresentativePoint(viewer, faceObj);
    if (!anchor) return null;

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
    const projectedAnchor = plane.projectPoint(anchor, anchor.clone());
    if (!isPlanarFaceGeometry(faceObj, plane)) return null;

    return {
      point: projectedAnchor,
      normal,
      anchor: projectedAnchor.clone(),
    };
  } catch {
    return null;
  }
}

function isPlanarFaceGeometry(faceObj, plane) {
  try {
    if (String(faceObj?.type || '').toUpperCase() === 'PLANE') return true;
    const geom = faceObj?.geometry;
    const pos = geom?.getAttribute?.('position');
    if (!pos || !Number.isFinite(pos.count) || pos.count < 3) return true;
    faceObj.updateMatrixWorld?.(true);
    const matrix = faceObj.matrixWorld || new THREE.Matrix4();
    const point = new THREE.Vector3();
    const box = new THREE.Box3();
    let maxDist = 0;
    for (let i = 0; i < pos.count; i += 1) {
      point.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix);
      box.expandByPoint(point);
      maxDist = Math.max(maxDist, Math.abs(plane.distanceToPoint(point)));
    }
    const size = box.getSize(new THREE.Vector3());
    const scale = Math.max(size.length(), 1);
    return maxDist <= Math.max(1e-5, scale * 1e-5);
  } catch {
    return true;
  }
}

function resolveFaceNormalTargetPoint(viewer, targetObj, basePlane) {
  if (!targetObj || !basePlane) return null;
  if (isFaceLikeObject(targetObj)) {
    const targetPlane = resolvePlanarFacePlane(viewer, targetObj);
    if (targetPlane) {
      const alignment = Math.abs(targetPlane.normal.dot(basePlane.normal));
      if (alignment > 1 - 1e-5) {
        return { point: targetPlane.point.clone(), anchor: targetPlane.anchor.clone() };
      }
      return { point: targetPlane.point.clone(), anchor: targetPlane.anchor.clone() };
    }
  }
  const type = String(targetObj?.type || '').toUpperCase();
  if (type === 'VERTEX') {
    const point = resolveVertexPoint(viewer, targetObj);
    return point ? { point, anchor: point.clone() } : null;
  }
  if (isEdgeLikeObject(targetObj)) {
    const midpoint = edgeMidpointWorld(targetObj);
    if (midpoint) return { point: midpoint, anchor: midpoint.clone() };
  }
  const point = objectRepresentativePoint(viewer, targetObj);
  return point ? { point: point.clone(), anchor: point.clone() } : null;
}

function resolveEdgeNormalTargetPoint(viewer, targetObj, baseEdge) {
  if (!targetObj || !baseEdge) return null;
  if (isEdgeLikeObject(targetObj)) {
    const targetEdge = resolveLinearEdgeLine(targetObj);
    if (targetEdge) {
      const pair = closestPointsBetweenInfiniteLines(baseEdge.point, baseEdge.direction, targetEdge.point, targetEdge.direction);
      if (pair) {
        return { point: pair.targetPoint, anchor: targetEdge.anchor.clone() };
      }
      const point = targetEdge.anchor.clone();
      return { point, anchor: targetEdge.anchor.clone() };
    }
  }
  if (isFaceLikeObject(targetObj)) {
    const targetPlane = resolvePlanarFacePlane(viewer, targetObj);
    if (targetPlane) return { point: targetPlane.point.clone(), anchor: targetPlane.anchor.clone() };
  }
  const type = String(targetObj?.type || '').toUpperCase();
  if (type === 'VERTEX') {
    const point = resolveVertexPoint(viewer, targetObj);
    return point ? { point, anchor: point.clone() } : null;
  }
  const point = objectRepresentativePoint(viewer, targetObj);
  return point ? { point: point.clone(), anchor: point.clone() } : null;
}

function resolveLinearEdgeLine(edgeObj) {
  const points = edgeWorldPoints(edgeObj);
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0];
  let last = null;
  for (let i = points.length - 1; i >= 1; i -= 1) {
    if (points[i]?.distanceToSquared(first) > 1e-12) {
      last = points[i];
      break;
    }
  }
  if (!last) return null;
  const direction = last.clone().sub(first);
  if (direction.lengthSq() <= 1e-12) return null;
  direction.normalize();
  if (!pointsAreCollinear(points, first, direction)) return null;
  const anchor = averagePoints(points) || first.clone().add(last).multiplyScalar(0.5);
  return {
    point: first.clone(),
    direction,
    anchor,
    points,
  };
}

function edgeWorldPoints(edgeObj) {
  if (!edgeObj) return null;
  try { edgeObj.updateMatrixWorld?.(true); } catch { /* ignore */ }
  const matrixWorld = edgeObj.matrixWorld || null;
  const out = [];
  const push = (value, isLocal = false) => {
    const point = vectorFromAny(value);
    if (!point) return;
    if (isLocal && matrixWorld) point.applyMatrix4(matrixWorld);
    const last = out[out.length - 1];
    if (last && last.distanceToSquared(point) <= 1e-14) return;
    out.push(point);
  };

  try {
    if (typeof edgeObj.points === 'function') {
      const pts = edgeObj.points(true);
      if (Array.isArray(pts)) {
        for (const point of pts) push(point, false);
      }
      if (out.length >= 2) return out;
      out.length = 0;
    }
  } catch { /* ignore */ }

  const poly = Array.isArray(edgeObj?.userData?.polylineLocal)
    ? edgeObj.userData.polylineLocal
    : null;
  if (poly) {
    for (const point of poly) push(point, true);
    if (out.length >= 2) return out;
    out.length = 0;
  }

  const startAttr = edgeObj?.geometry?.attributes?.instanceStart;
  const endAttr = edgeObj?.geometry?.attributes?.instanceEnd;
  if (startAttr && endAttr) {
    const count = Math.min(startAttr.count || 0, endAttr.count || 0);
    for (let i = 0; i < count; i += 1) {
      const a = new THREE.Vector3(startAttr.getX(i), startAttr.getY(i), startAttr.getZ(i));
      const b = new THREE.Vector3(endAttr.getX(i), endAttr.getY(i), endAttr.getZ(i));
      if (matrixWorld) {
        a.applyMatrix4(matrixWorld);
        b.applyMatrix4(matrixWorld);
      }
      push(a, false);
      push(b, false);
    }
    if (out.length >= 2) return out;
    out.length = 0;
  }

  const pos = edgeObj?.geometry?.getAttribute?.('position');
  if (pos && pos.itemSize === 3 && pos.count >= 2) {
    for (let i = 0; i < pos.count; i += 1) {
      const point = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (matrixWorld) point.applyMatrix4(matrixWorld);
      push(point, false);
    }
    if (out.length >= 2) return out;
  }

  return null;
}

function pointsAreCollinear(points, origin, direction) {
  if (!Array.isArray(points) || points.length < 2 || !origin || !direction) return false;
  const box = new THREE.Box3();
  for (const point of points) {
    if (point) box.expandByPoint(point);
  }
  const scale = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
  const tolerance = Math.max(1e-6, scale * 1e-5);
  const rel = new THREE.Vector3();
  const parallel = new THREE.Vector3();
  for (const point of points) {
    if (!point) continue;
    rel.copy(point).sub(origin);
    const t = rel.dot(direction);
    parallel.copy(direction).multiplyScalar(t);
    if (rel.sub(parallel).length() > tolerance) return false;
  }
  return true;
}

function averagePoints(points) {
  if (!Array.isArray(points) || !points.length) return null;
  const sum = new THREE.Vector3();
  let count = 0;
  for (const point of points) {
    if (!point) continue;
    sum.add(point);
    count += 1;
  }
  return count ? sum.multiplyScalar(1 / count) : null;
}

function projectPointOnLine(point, linePoint, lineDirection) {
  if (!point || !linePoint || !lineDirection || lineDirection.lengthSq() <= 1e-12) return null;
  const dir = lineDirection.clone().normalize();
  const t = point.clone().sub(linePoint).dot(dir);
  return linePoint.clone().addScaledVector(dir, t);
}

function closestPointsBetweenInfiniteLines(aPoint, aDir, bPoint, bDir) {
  if (!aPoint || !aDir || !bPoint || !bDir) return null;
  const u = aDir.clone();
  const v = bDir.clone();
  if (u.lengthSq() <= 1e-12 || v.lengthSq() <= 1e-12) return null;
  u.normalize();
  v.normalize();
  const w0 = aPoint.clone().sub(bPoint);
  const b = u.dot(v);
  const d = u.dot(w0);
  const e = v.dot(w0);
  const denom = 1 - (b * b);
  if (Math.abs(denom) <= 1e-10) {
    return null;
  }
  const s = ((b * e) - d) / denom;
  const t = (e - (b * d)) / denom;
  return {
    basePoint: aPoint.clone().addScaledVector(u, s),
    targetPoint: bPoint.clone().addScaledVector(v, t),
  };
}

function edgeMidpointWorld(edge) {
  const ends = edgeEndpointsWorld(edge);
  if (ends?.a && ends?.b) {
    return new THREE.Vector3().addVectors(ends.a, ends.b).multiplyScalar(0.5);
  }
  return null;
}

function safeDimensionTangent(normal, dir) {
  const n = normal?.clone?.() || new THREE.Vector3(0, 0, 1);
  if (!n.lengthSq()) n.set(0, 0, 1);
  n.normalize();
  const d = dir?.clone?.() || new THREE.Vector3(1, 0, 0);
  if (!d.lengthSq()) d.set(1, 0, 0);
  d.normalize();
  const t = new THREE.Vector3().crossVectors(n, d);
  if (t.lengthSq() > 1e-12) return t.normalize();
  const fallbackAxis = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  t.crossVectors(d, fallbackAxis);
  if (t.lengthSq() > 1e-12) return t.normalize();
  return new THREE.Vector3(1, 0, 0);
}

function closestEndpointToPoint(edges, point) {
  if (!Array.isArray(edges) || !point) return null;
  let best = null;
  let bestD2 = Infinity;
  for (const edge of edges) {
    const ends = edgeEndpointsWorld(edge);
    if (ends) {
      const d2a = ends.a.distanceToSquared(point);
      if (d2a < bestD2) { bestD2 = d2a; best = ends.a; }
      const d2b = ends.b.distanceToSquared(point);
      if (d2b < bestD2) { bestD2 = d2b; best = ends.b; }
      continue;
    }
    const fallback = closestPointOnEdgeToPoint(edge, point);
    if (fallback) {
      const d2 = fallback.distanceToSquared(point);
      if (d2 < bestD2) { bestD2 = d2; best = fallback; }
    }
  }
  return best ? best.clone() : null;
}

function edgeEndpointsWorld(edge) {
  if (!edge) return null;
  try { edge.updateMatrixWorld?.(true); } catch { /* ignore */ }
  try {
    if (typeof edge.points === 'function') {
      const pts = edge.points(true);
      if (Array.isArray(pts) && pts.length >= 2) {
        const a = arrayToVector(pts[0]);
        const b = arrayToVector(pts[pts.length - 1]);
        if (a && b) return { a, b };
      }
    }
  } catch { /* ignore */ }
  const poly = Array.isArray(edge?.userData?.polylineLocal)
    ? edge.userData.polylineLocal
    : null;
  if (poly && poly.length >= 2) {
    const a = arrayToVector(poly[0]);
    const b = arrayToVector(poly[poly.length - 1]);
    if (a && b) {
      if (edge.matrixWorld) {
        a.applyMatrix4(edge.matrixWorld);
        b.applyMatrix4(edge.matrixWorld);
      }
      return { a, b };
    }
  }
  const startAttr = edge?.geometry?.attributes?.instanceStart;
  const endAttr = edge?.geometry?.attributes?.instanceEnd;
  if (startAttr && endAttr && startAttr.count >= 1) {
    const a = new THREE.Vector3(startAttr.getX(0), startAttr.getY(0), startAttr.getZ(0));
    const b = new THREE.Vector3(endAttr.getX(0), endAttr.getY(0), endAttr.getZ(0));
    if (edge.matrixWorld) {
      a.applyMatrix4(edge.matrixWorld);
      b.applyMatrix4(edge.matrixWorld);
    }
    return { a, b };
  }
  const pos = edge?.geometry?.getAttribute?.('position');
  if (pos && pos.itemSize === 3 && pos.count >= 2) {
    const a = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
    const b = new THREE.Vector3(pos.getX(pos.count - 1), pos.getY(pos.count - 1), pos.getZ(pos.count - 1));
    if (edge.matrixWorld) {
      a.applyMatrix4(edge.matrixWorld);
      b.applyMatrix4(edge.matrixWorld);
    }
    return { a, b };
  }
  return null;
}

function closestPointsForObjects(objA, objB) {
  if (objA?.type === 'VERTEX' && objB?.type === 'VERTEX') {
    return { p0: objA.getWorldPosition(new THREE.Vector3()), p1: objB.getWorldPosition(new THREE.Vector3()) };
  }
  if (objA?.type === 'EDGE' && objB?.type === 'VERTEX') {
    const v = objB.getWorldPosition(new THREE.Vector3());
    const p = closestPointOnEdgeToPoint(objA, v);
    return { p0: p, p1: v };
  }
  if (objA?.type === 'VERTEX' && objB?.type === 'EDGE') {
    const v = objA.getWorldPosition(new THREE.Vector3());
    const p = closestPointOnEdgeToPoint(objB, v);
    return { p0: v, p1: p };
  }
  if (objA?.type === 'EDGE' && objB?.type === 'EDGE') {
    return closestPointsBetweenEdges(objA, objB);
  }
  return {
    p0: objectRepresentativePoint(null, objA) || new THREE.Vector3(),
    p1: objectRepresentativePoint(null, objB) || new THREE.Vector3(),
  };
}

function closestPointOnEdgeToPoint(edge, point) {
  try {
    const pts = edge.points(true);
    if (!pts || pts.length < 2) return edge.getWorldPosition(new THREE.Vector3());
    const p = point.clone();
    let best = { d2: Infinity, q: null };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < pts.length - 1; i++) {
      a.set(pts[i].x, pts[i].y, pts[i].z);
      b.set(pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      const q = closestPointOnSegment(a, b, p);
      const d2 = q.distanceToSquared(p);
      if (d2 < best.d2) best = { d2, q };
    }
    return best.q || edge.getWorldPosition(new THREE.Vector3());
  } catch { return edge.getWorldPosition(new THREE.Vector3()); }
}

function closestPointsBetweenEdges(e1, e2) {
  try {
    const pts1 = e1.points(true);
    const pts2 = e2.points(true);
    if (!pts1 || pts1.length < 2 || !pts2 || pts2.length < 2) {
      return {
        p0: objectRepresentativePoint(null, e1) || new THREE.Vector3(),
        p1: objectRepresentativePoint(null, e2) || new THREE.Vector3(),
      };
    }
    const a0 = new THREE.Vector3();
    const a1 = new THREE.Vector3();
    const b0 = new THREE.Vector3();
    const b1 = new THREE.Vector3();
    let best = { d2: Infinity, p: null, q: null };
    for (let i = 0; i < pts1.length - 1; i++) {
      a0.set(pts1[i].x, pts1[i].y, pts1[i].z);
      a1.set(pts1[i + 1].x, pts1[i + 1].y, pts1[i + 1].z);
      for (let j = 0; j < pts2.length - 1; j++) {
        b0.set(pts2[j].x, pts2[j].y, pts2[j].z);
        b1.set(pts2[j + 1].x, pts2[j + 1].y, pts2[j + 1].z);
        const { p, q } = closestPointsOnSegments(a0, a1, b0, b1);
        const d2 = p.distanceToSquared(q);
        if (d2 < best.d2) best = { d2, p, q };
      }
    }
    return {
      p0: best.p || objectRepresentativePoint(null, e1) || new THREE.Vector3(),
      p1: best.q || objectRepresentativePoint(null, e2) || new THREE.Vector3(),
    };
  } catch {
    return {
      p0: objectRepresentativePoint(null, e1) || new THREE.Vector3(),
      p1: objectRepresentativePoint(null, e2) || new THREE.Vector3(),
    };
  }
}

function closestPointOnSegment(a, b, p) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, ab.dot(p.clone().sub(a)) / (ab.lengthSq() || 1)));
  return a.clone().addScaledVector(ab, t);
}

function closestPointsOnSegments(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s;
  let t;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const cp1 = p1.clone().addScaledVector(d1, s);
  const cp2 = p2.clone().addScaledVector(d2, t);
  return { p: cp1, q: cp2 };
}

function arrayToVector(value) {
  return vectorFromAny(value);
}

function vectorFromAnnotationPoint(point) {
  if (!point) return null;
  if (point instanceof THREE.Vector3) return point.clone();
  if (Array.isArray(point)) return new THREE.Vector3(point[0] || 0, point[1] || 0, point[2] || 0);
  if (typeof point === 'object') return new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);
  return null;
}

export const __testOnlyLinearDimensionInternals = {
  computeDimPoints,
  computeEdgeNormalDimPoints,
  computeFaceNormalDimPoints,
  resolvePlanarFacePlane,
};
