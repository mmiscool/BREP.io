import * as THREE from 'three';
import { BaseAnnotation } from '../BaseAnnotation.js';
import { addArrowCone, getElementDirection, makeOverlayLine, objectRepresentativePoint, screenSizeWorld } from '../annUtils.js';
import {
  buildAngleDimensionGeometry,
  dirTo2D as dirTo2DShared,
  intersectLines2D as intersectLines2DShared,
  planeBasis as planeBasisShared,
  resolveAngleOrientation2D as resolveAngleOrientation2DShared,
  to2D as to2DShared,
} from '../../dimensions/dimensionGeometry.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    label: 'ID',
    hint: 'unique identifier for the angle dimension',
  },
  decimals: {
    type: 'number',
    default_value: 1,
    defaultResolver: ({ pmimode }) => {
      const dec = Number.isFinite(pmimode?._opts?.angleDecimals)
        ? (pmimode._opts.angleDecimals | 0)
        : undefined;
      if (!Number.isFinite(dec)) return undefined;
      return Math.max(0, Math.min(3, dec));
    },
    label: 'Decimals',
    hint: 'Number of decimal places to display',
    min: 0,
    max: 3,
    step: 1,
  },
  targets: {
    type: 'reference_selection',
    selectionFilter: ['FACE', 'EDGE'],
    multiple: true,
    default_value: [],
    label: 'Elements',
    hint: 'Select two edges/faces to define the angle',
    minSelections: 2,
    maxSelections: 2,
  },
  planeRefName: {
    type: 'reference_selection',
    selectionFilter: ['FACE', 'PLANE'],
    multiple: false,
    default_value: '',
    label: 'Projection Plane',
    hint: 'Override projection plane (optional)',
  },
  reverseElementOrder: {
    type: 'boolean',
    default_value: false,
    label: 'Reverse Selection Order',
    hint: 'Swap Element A and Element B to flip the measured side',
  },
  isReference: {
    type: 'boolean',
    default_value: false,
    label: 'Reference',
    hint: 'Mark as reference dimension (parentheses)',
  },
  angleType: {
    type: 'options',
    default_value: 'acute',
    options: ['acute', 'obtuse', 'reflex'],
    label: 'Angle Type',
    hint: 'Choose which angle (acute, obtuse, or reflex) to display',
  },
};

export class AngleDimensionAnnotation extends BaseAnnotation {
  static entityType = 'angle';
  static type = 'angle';
  static shortName = 'ANG';
  static longName = 'Angle Dimension';
  static title = 'Angle';
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems) {
    const refs = BaseAnnotation._collectSelectionRefs(selectedItems, ['FACE', 'EDGE']);
    if (refs.length < 2) return false;
    return { params: { targets: refs.slice(0, 2) } };
  }

  constructor(opts = {}) {
    super(opts);
  }

  async run(renderingContext) {
    const { pmimode, group, idx, ctx } = renderingContext;
    const ann = this.inputParams;
    const measured = measureAngleValue(pmimode, ann);
    const labelInfo = formatAngleLabel(measured, ann);
    ann.value = labelInfo.display;

    ensurePersistent(ann);
    try {
      const elements = computeAngleElementsWithGeometry(pmimode, ann, ctx);
      if (!elements || !elements.__2d) return [];

      const color = 0xf59e0b;
      const { N, P, A_d, B_d, V2, basis, sweep = 0, dirSign = 1, bisector = null } = elements.__2d;
      const geometry = buildAngleDimensionGeometry({
        planePoint: P,
        planeNormal: N,
        basis,
        vertex2D: V2,
        directionA2D: A_d,
        directionB2D: B_d,
        sweepRad: sweep,
        sweepDirection: dirSign,
        bisector2D: bisector,
        labelWorld: ann.persistentData?.labelWorld,
        screenSizeWorld: ctx.screenSizeWorld,
        fallbackScreenSizeWorld: (pixels) => screenSizeWorld(pmimode?.viewer, pixels),
      });
      if (!geometry) return [];

      for (let i = 0; i < geometry.arcPoints.length - 1; i += 1) {
        group.add(makeOverlayLine(geometry.arcPoints[i], geometry.arcPoints[i + 1], color));
      }
      for (const [start, end] of geometry.segments) {
        group.add(makeOverlayLine(start, end, color));
      }
      for (const arrow of geometry.arrowSpecs) {
        addArrowCone(group, arrow.tip, arrow.direction, arrow.length, arrow.width, color);
      }

      if (typeof measured === 'number') {
        const info = formatAngleLabel(measured, ann);
        const raw = info.raw;
        ann.value = info.display;
        const txt = ctx.formatReferenceLabel ? ctx.formatReferenceLabel(ann, raw) : info.display;
        const labelPos = geometry.labelPosition;
        if (labelPos) ctx.updateLabel(idx, txt, labelPos, ann);
      }
    } catch { /* ignore rendering errors */ }
    return [];
  }

  static onLabelPointerDown(pmimode, idx, ann, e, ctx) {
    try {
      const elements = computeAngleElementsWithGeometry(pmimode, ann, ctx);
      if (!elements) return;
      const planeInfo = resolveAnglePlane(pmimode, ann, elements, ctx);
      const normal = planeInfo?.n || new THREE.Vector3(0, 0, 1);
      const anchorPoint = planeInfo?.p || new THREE.Vector3();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchorPoint);
      try { pmimode?.showDragPlaneHelper?.(plane); } catch { }

      const onMove = (ev) => {
        const ray = ctx.raycastFromEvent ? ctx.raycastFromEvent(ev) : null;
        if (!ray) return;
        const out = new THREE.Vector3();
        if (ctx.intersectPlane ? ctx.intersectPlane(ray, plane, out) : ray.intersectPlane(plane, out)) {
          ensurePersistent(ann);
          ann.persistentData.labelWorld = [out.x, out.y, out.z];
          ctx.updateLabel(idx, null, out, ann);
          pmimode.refreshAnnotationsUI?.();
        }
      };

      const onUp = (ev) => {
        try {
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onUp, true);
        } catch { }
        try { pmimode?.hideDragPlaneHelper?.(); } catch { }
        try { if (pmimode.viewer?.controls) pmimode.viewer.controls.enabled = true; } catch { }
        try { ev.preventDefault(); ev.stopImmediatePropagation?.(); ev.stopPropagation(); } catch { }
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    } catch { /* ignore */ }
  }

}

function ensurePersistent(ann) {
  if (!ann.persistentData || typeof ann.persistentData !== 'object') {
    ann.persistentData = {};
  }
}

function normalizeTargetNames(value) {
  const list = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    let name = '';
    if (entry && typeof entry === 'object') {
      if (typeof entry.name === 'string') name = entry.name;
      else if (entry.id != null) name = String(entry.id);
    } else if (entry != null) {
      name = String(entry);
    }
    name = name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function resolveElementRefNames(ann) {
  const hasTargets = Array.isArray(ann?.targets);
  const targets = normalizeTargetNames(hasTargets ? ann.targets : null);
  let elementARefName = '';
  let elementBRefName = '';
  if (targets.length) {
    elementARefName = targets[0] || '';
    elementBRefName = targets[1] || '';
  } else if (!hasTargets) {
    elementARefName = ann?.elementARefName || '';
    elementBRefName = ann?.elementBRefName || '';
  }
  if (ann?.reverseElementOrder) {
    return {
      elementARefName: elementBRefName,
      elementBRefName: elementARefName,
    };
  }
  return { elementARefName, elementBRefName };
}

function resolveAngleType(ann) {
  const raw = ann?.angleType;
  if (raw === 'acute' || raw === 'obtuse' || raw === 'reflex') return raw;
  if (ann?.useReflexAngle) return 'reflex';
  return 'acute';
}

function isAngleTypeExplicit(ann) {
  if (!ann || typeof ann !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(ann, 'angleType')) return false;
  return ann.angleType === 'acute' || ann.angleType === 'obtuse' || ann.angleType === 'reflex';
}

function formatAngleLabel(measured, ann) {
  if (typeof measured !== 'number' || !Number.isFinite(measured)) {
    return { raw: '-', display: '-' };
  }
  const decRaw = Number(ann?.decimals);
  const decimals = Number.isFinite(decRaw) ? Math.max(0, Math.min(3, decRaw | 0)) : 1;
  const raw = `${measured.toFixed(decimals)}°`;
  const display = ann?.isReference ? `(${raw})` : raw;
  return { raw, display };
}

function measureAngleValue(pmimode, ann) {
  try {
    const elements = computeAngleElements(pmimode, ann);
    const plane = resolveAnglePlane(pmimode, ann, elements);
    if (!plane) return null;
    const { elementARefName, elementBRefName } = resolveElementRefNames(ann);
    const lineA = lineInPlaneForElement(pmimode, elementARefName, plane.n, plane.p);
    const lineB = lineInPlaneForElement(pmimode, elementBRefName, plane.n, plane.p);
    if (!lineA || !lineB) return null;
    const basis = planeBasisShared(plane.n, lineA.d);
    const dA2 = dirTo2DShared(lineA.d, basis).normalize();
    const dB2 = dirTo2DShared(lineB.d, basis).normalize();
    const type = resolveAngleType(ann);
    const typeExplicit = isAngleTypeExplicit(ann) || Boolean(ann?.useReflexAngle);
    const orientation = resolveAngleOrientation2DShared(dA2, dB2, type, typeExplicit);
    if (!orientation) return null;
    const angle = THREE.MathUtils.radToDeg(orientation.angleRad);
    return angle;
  } catch {
    return null;
  }
}

function computeAngleElements(pmimode, ann) {
  try {
    const scene = pmimode?.viewer?.partHistory?.scene;
    if (!scene) return null;
    const { elementARefName, elementBRefName } = resolveElementRefNames(ann);
    const objA = elementARefName ? scene.getObjectByName(elementARefName) : null;
    const objB = elementBRefName ? scene.getObjectByName(elementBRefName) : null;
    if (!objA || !objB) return null;
    const dirA = getElementDirection(pmimode.viewer, objA);
    const dirB = getElementDirection(pmimode.viewer, objB);
    const pointA = objectRepresentativePoint(pmimode.viewer, objA);
    const pointB = objectRepresentativePoint(pmimode.viewer, objB);
    let plane = null;
    if (ann.planeRefName) {
      const planeObj = scene.getObjectByName(ann.planeRefName);
      if (planeObj) plane = getElementDirection(pmimode.viewer, planeObj);
    }
    return { dirA, dirB, pointA, pointB, plane };
  } catch {
    return null;
  }
}

function computeAngleElementsWithGeometry(pmimode, ann, ctx) {
  try {
    const elements = computeAngleElements(pmimode, ann);
    if (!elements || !elements.dirA || !elements.dirB) return null;
    const plane = resolveAnglePlane(pmimode, ann, elements, ctx);
    if (!plane) return null;
    const { elementARefName, elementBRefName } = resolveElementRefNames(ann);
    const lineA = lineInPlaneForElement(pmimode, elementARefName, plane.n, plane.p);
    const lineB = lineInPlaneForElement(pmimode, elementBRefName, plane.n, plane.p);
    if (!lineA || !lineB) return null;
    const basis = planeBasisShared(plane.n, lineA.d);
    const A_p = to2DShared(lineA.p, plane.p, basis);
    const B_p = to2DShared(lineB.p, plane.p, basis);
    let A_d = dirTo2DShared(lineA.d, basis).normalize();
    let B_d = dirTo2DShared(lineB.d, basis).normalize();
    if (ann?.reverseElementOrder) {
      A_d = A_d.multiplyScalar(-1);
      B_d = B_d.multiplyScalar(-1);
    }
    const angleType = resolveAngleType(ann);
    const angleExplicit = isAngleTypeExplicit(ann) || Boolean(ann?.useReflexAngle);
    const orientation = resolveAngleOrientation2DShared(A_d, B_d, angleType, angleExplicit);
    if (!orientation) return null;
    const A_ray = orientation.start.clone();
    const B_ray = orientation.end.clone();
    let V2 = intersectLines2DShared(A_p, A_ray, B_p, B_ray);
    if (V2) {
      // Guard against numerically unstable/interpreted lines that intersect far
      // away from the selected geometry. In that case, anchor between elements.
      const base = Math.max(1e-6, A_p.distanceTo(B_p));
      const maxDist = Math.max(V2.distanceTo(A_p), V2.distanceTo(B_p));
      if (maxDist > base * 8) V2 = null;
    }
    if (!V2) V2 = new THREE.Vector2().addVectors(A_p, B_p).multiplyScalar(0.5);
    return {
      ...elements,
      __2d: {
        N: plane.n,
        P: plane.p,
        basis,
        A_p,
        B_p,
        A_d: A_ray,
        B_d: B_ray,
        V2,
        sweep: orientation.sweep,
        dirSign: orientation.dirSign,
        angleRad: orientation.angleRad,
        angleType: orientation.angleType,
        bisector: orientation.bisector,
      },
    };
  } catch {
    return null;
  }
}

function resolveAnglePlane(pmimode, ann, elements, ctx) {
  try {
    if (ann?.planeRefName) {
      const planeObj = pmimode.viewer?.partHistory?.scene?.getObjectByName(ann.planeRefName);
      if (planeObj) {
        const n = getElementDirection(pmimode.viewer, planeObj) || new THREE.Vector3(0, 0, 1);
        if (n.lengthSq() > 1e-12) {
          const p = objectRepresentativePoint(pmimode.viewer, planeObj) || new THREE.Vector3();
          return { n: n.clone().normalize(), p };
        }
      }
    }
    if (elements?.dirA && elements?.dirB) {
      const cross = new THREE.Vector3().crossVectors(elements.dirA, elements.dirB);
      if (cross.lengthSq() > 1e-12) {
        const p = (elements.pointA && elements.pointB)
          ? new THREE.Vector3().addVectors(elements.pointA, elements.pointB).multiplyScalar(0.5)
          : (elements.pointA || elements.pointB || new THREE.Vector3());
        return { n: cross.normalize(), p };
      }
    }
    const fallbackNormal = ctx?.alignNormal ? ctx.alignNormal('view', ann) : null;
    const n2 = fallbackNormal || elements?.plane || new THREE.Vector3(0, 0, 1);
    const p2 = (elements?.pointA && elements?.pointB)
      ? new THREE.Vector3().addVectors(elements.pointA, elements.pointB).multiplyScalar(0.5)
      : (elements?.pointA || elements?.pointB || new THREE.Vector3());
    return { n: n2.clone().normalize(), p: p2 };
  } catch {
    return { n: new THREE.Vector3(0, 0, 1), p: new THREE.Vector3() };
  }
}

function lineInPlaneForElement(pmimode, refName, planeNormal, planePoint) {
  try {
    if (!refName) return null;
    const scene = pmimode?.viewer?.partHistory?.scene;
    if (!scene) return null;
    const obj = scene.getObjectByName(refName);
    if (!obj) return null;

    const N = (planeNormal && planeNormal.lengthSq() > 1e-12)
      ? planeNormal.clone().normalize()
      : new THREE.Vector3(0, 0, 1);
    const basePoint = objectRepresentativePoint(pmimode.viewer, obj) || planePoint || new THREE.Vector3();
    const planeAnchor = planePoint || basePoint;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(N, planeAnchor);

    const elementDir = getElementDirection(pmimode.viewer, obj);
    const worldDir = elementDir ? elementDir.clone().normalize() : null;

    const userData = obj?.userData || {};
    const runtimeType = String(obj?.type || '').toUpperCase();
    const metaType = String(userData.type || userData.brepType || '').toUpperCase();
    const isRuntimeBrepType = runtimeType === 'FACE' || runtimeType === 'EDGE' || runtimeType === 'PLANE';
    const isFaceLike = runtimeType === 'FACE'
      || runtimeType === 'PLANE'
      || (!isRuntimeBrepType && (metaType === 'FACE' || metaType === 'PLANE'));
    const isEdgeLike = runtimeType === 'EDGE'
      || (!isFaceLike && (
        metaType === 'EDGE'
        || obj?.isLine
        || obj?.isLine2
        || obj?.isLineSegments
        || obj?.isLineLoop
      ));

    if (isEdgeLike) {
      const edgeLine = edgeLineInPlane(obj, plane, planeAnchor);
      if (edgeLine) return edgeLine;
    }

    if (isFaceLike && worldDir && worldDir.lengthSq() > 1e-12) {
      const faceNormal = worldDir.clone().normalize();
      const direction = new THREE.Vector3().crossVectors(faceNormal, N);
      const denom = direction.lengthSq();
      if (denom > 1e-12) {
        const d1 = faceNormal.dot(basePoint);
        const d2 = N.dot(planeAnchor);
        const termA = new THREE.Vector3().crossVectors(N, direction).multiplyScalar(d1);
        const termB = new THREE.Vector3().crossVectors(direction, faceNormal).multiplyScalar(d2);
        const pointOnIntersection = termA.add(termB).divideScalar(denom);
        return { p: plane.projectPoint(pointOnIntersection, pointOnIntersection.clone()), d: direction.normalize() };
      }
    }

    let planePointOnLine = basePoint.clone();
    if (worldDir && worldDir.lengthSq() > 1e-12) {
      const denom = worldDir.dot(N);
      if (Math.abs(denom) > 1e-9) {
        const target = planeAnchor.clone();
        const t = target.clone().sub(basePoint).dot(N) / denom;
        planePointOnLine = basePoint.clone().addScaledVector(worldDir, t);
      }
    }
    const projectedPoint = plane.projectPoint(planePointOnLine, planePointOnLine.clone());

    let projectedDir = worldDir ? worldDir.clone().projectOnPlane(N) : null;
    if (!projectedDir || projectedDir.lengthSq() < 1e-12) {
      const basis = planeBasisShared(N);
      projectedDir = basis.U.clone();
    }
    projectedDir.normalize();
    return { p: projectedPoint, d: projectedDir };
  } catch {
    return null;
  }
}

function edgeLineInPlane(edgeObj, plane, planeAnchor) {
  const points = getEdgeWorldPoints(edgeObj);
  if (!Array.isArray(points) || points.length < 2) return null;

  const projected = [];
  for (const p of points) {
    if (!p) continue;
    projected.push(plane.projectPoint(p, p.clone()));
  }
  if (projected.length < 2) return null;

  let iBest = 0;
  let jBest = 1;
  let bestD2 = 0;
  for (let i = 0; i < projected.length; i++) {
    for (let j = i + 1; j < projected.length; j++) {
      const d2 = projected[i].distanceToSquared(projected[j]);
      if (d2 > bestD2) {
        bestD2 = d2;
        iBest = i;
        jBest = j;
      }
    }
  }
  if (bestD2 <= 1e-12) return null;

  const direction = projected[jBest].clone().sub(projected[iBest]).normalize();
  let anchor = projected[iBest].clone();
  if (planeAnchor) {
    let bestAnchorD2 = anchor.distanceToSquared(planeAnchor);
    for (let i = 0; i < projected.length; i++) {
      const d2 = projected[i].distanceToSquared(planeAnchor);
      if (d2 < bestAnchorD2) {
        bestAnchorD2 = d2;
        anchor = projected[i].clone();
      }
    }
  }

  return { p: anchor, d: direction };
}

function getEdgeWorldPoints(edgeObj) {
  if (!edgeObj) return null;
  try { edgeObj.updateMatrixWorld?.(true); } catch { /* ignore */ }
  const matrixWorld = edgeObj.matrixWorld || null;

  const unique = [];
  const pushUnique = (point) => {
    const v = pointFromAny(point);
    if (!v) return;
    const last = unique[unique.length - 1];
    if (last && last.distanceToSquared(v) <= 1e-14) return;
    unique.push(v);
  };

  try {
    if (typeof edgeObj.points === 'function') {
      const pts = edgeObj.points(true);
      if (Array.isArray(pts)) {
        for (const p of pts) pushUnique(p);
      }
      if (unique.length >= 2) return unique;
      unique.length = 0;
    }
  } catch { /* ignore */ }

  const poly = Array.isArray(edgeObj?.userData?.polylineLocal) ? edgeObj.userData.polylineLocal : null;
  if (poly) {
    for (const p of poly) {
      const v = pointFromAny(p);
      if (!v) continue;
      if (matrixWorld) v.applyMatrix4(matrixWorld);
      pushUnique(v);
    }
    if (unique.length >= 2) return unique;
    unique.length = 0;
  }

  const startAttr = edgeObj?.geometry?.attributes?.instanceStart;
  const endAttr = edgeObj?.geometry?.attributes?.instanceEnd;
  if (startAttr && endAttr) {
    const count = Math.min(startAttr.count || 0, endAttr.count || 0);
    for (let i = 0; i < count; i++) {
      const a = new THREE.Vector3(startAttr.getX(i), startAttr.getY(i), startAttr.getZ(i));
      const b = new THREE.Vector3(endAttr.getX(i), endAttr.getY(i), endAttr.getZ(i));
      if (matrixWorld) {
        a.applyMatrix4(matrixWorld);
        b.applyMatrix4(matrixWorld);
      }
      pushUnique(a);
      pushUnique(b);
    }
    if (unique.length >= 2) return unique;
    unique.length = 0;
  }

  const pos = edgeObj?.geometry?.getAttribute?.('position');
  if (pos && pos.itemSize === 3 && pos.count >= 2) {
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (matrixWorld) v.applyMatrix4(matrixWorld);
      pushUnique(v);
    }
    if (unique.length >= 2) return unique;
  }

  return null;
}

function pointFromAny(value) {
  if (!value) return null;
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(value[0] || 0, value[1] || 0, value[2] || 0);
  }
  if (typeof value === 'object') {
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return new THREE.Vector3(x, y, z);
    }
  }
  return null;
}
