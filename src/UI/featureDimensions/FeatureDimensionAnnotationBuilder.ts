import * as THREE from 'three';
import { getElementDirection, screenSizeWorld } from '../pmi/annUtils.js';
import { resolveSelectionObject } from '../assembly/constraintSelectionUtils.js';
import { extractWorldPoint } from '../assembly/constraintPointUtils.js';
import { computeFaceNormal, computeFaceOrigin } from '../faceUtils.js';
import { buildPortDefinitionFromInputs } from '../../features/port/portUtils.js';
import { buildFeatureDimensionAnnotations } from './FeatureDimensionRegistry.js';
import {
  collectFeatureDimensionReferenceNames,
  getFeatureDimensionObjectTypeTag,
  resolveFeatureDimensionEffectReferenceObject,
  resolvePortExtensionAnnotationGeometry,
} from './featureDimensionUtils.js';
import { resolveReferenceSnapshotFromNames } from '../referenceSnapshotStore.js';

const EPS = 1e-9;
type AnyRecord = Record<string | symbol, any>;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function composeTransformMatrix(transform = null) {
  const posRaw = Array.isArray(transform?.position) ? transform.position : [0, 0, 0];
  const rotRaw = Array.isArray(transform?.rotationEuler) ? transform.rotationEuler : [0, 0, 0];
  const scaleRaw = Array.isArray(transform?.scale) ? transform.scale : [1, 1, 1];

  const position = new THREE.Vector3(
    toFiniteNumber(posRaw[0], 0),
    toFiniteNumber(posRaw[1], 0),
    toFiniteNumber(posRaw[2], 0),
  );
  const rotation = new THREE.Euler(
    THREE.MathUtils.degToRad(toFiniteNumber(rotRaw[0], 0)),
    THREE.MathUtils.degToRad(toFiniteNumber(rotRaw[1], 0)),
    THREE.MathUtils.degToRad(toFiniteNumber(rotRaw[2], 0)),
    'XYZ',
  );
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  const scale = new THREE.Vector3(
    toFiniteNumber(scaleRaw[0], 1),
    toFiniteNumber(scaleRaw[1], 1),
    toFiniteNumber(scaleRaw[2], 1),
  );

  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function applyPointMatrix(matrix, x, y, z) {
  return new THREE.Vector3(x, y, z).applyMatrix4(matrix);
}

function clampNumber(value, { min = -Infinity, max = Infinity } = {}) {
  const numeric = toFiniteNumber(value, 0);
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function closestPointOnLine(point, linePoint, lineDir) {
  const dir = lineDir.clone().normalize();
  const t = point.clone().sub(linePoint).dot(dir);
  return linePoint.clone().addScaledVector(dir, t);
}

export class FeatureDimensionAnnotationBuilder {
  viewer: AnyRecord | null;
  active: AnyRecord | null;
  createLinearAnnotation: ((spec: AnyRecord) => unknown) | null;
  createAngleAnnotation: ((spec: AnyRecord) => unknown) | null;

  constructor({
    viewer = null,
    active = null,
    createLinearAnnotation = null,
    createAngleAnnotation = null,
  } = {}) {
    this.viewer = viewer || null;
    this.active = active || null;
    this.createLinearAnnotation = typeof createLinearAnnotation === 'function' ? createLinearAnnotation : null;
    this.createAngleAnnotation = typeof createAngleAnnotation === 'function' ? createAngleAnnotation : null;
  }

  build(active = null) {
    this.active = active || this.active;
    const params = this.active?.entry?.inputParams || {};
    const matrix = composeTransformMatrix(params.transform);

    return buildFeatureDimensionAnnotations({
      viewer: this.viewer,
      entry: this.active?.entry || null,
      entryId: this.active?.entryId || null,
      featureClass: this.active?.featureClass || null,
      featureKey: this.active?.featureKey || '',
      params,
      matrix,
      builder: this,
    });
  }

  buildCubeAnnotations(params, matrix, entryId) {
    const sx = this.resolveNumericInputParam(params, 'sizeX', 0);
    const sy = this.resolveNumericInputParam(params, 'sizeY', 0);
    const sz = this.resolveNumericInputParam(params, 'sizeZ', 0);

    const p0 = applyPointMatrix(matrix, 0, 0, 0);
    const px = applyPointMatrix(matrix, sx, 0, 0);
    const py = applyPointMatrix(matrix, 0, sy, 0);
    const pz = applyPointMatrix(matrix, 0, 0, sz);

    return [
      this.#linear({ entryId, fieldKey: 'sizeX', pointA: p0, pointB: px, value: sx, labelPrefix: 'X' }),
      this.#linear({ entryId, fieldKey: 'sizeY', pointA: p0, pointB: py, value: sy, labelPrefix: 'Y' }),
      this.#linear({ entryId, fieldKey: 'sizeZ', pointA: p0, pointB: pz, value: sz, labelPrefix: 'Z' }),
    ].filter(Boolean);
  }

  buildCylinderAnnotations(params, matrix, entryId) {
    const radius = this.resolveNumericInputParam(params, 'radius', 0);
    const height = this.resolveNumericInputParam(params, 'height', 0);

    const base = applyPointMatrix(matrix, 0, 0, 0);
    const top = applyPointMatrix(matrix, 0, height, 0);
    const radial = applyPointMatrix(matrix, radius, 0, 0);

    return [
      this.#linear({ entryId, fieldKey: 'radius', pointA: base, pointB: radial, value: radius, labelPrefix: 'R' }),
      this.#linear({ entryId, fieldKey: 'height', pointA: base, pointB: top, value: height, labelPrefix: 'H' }),
    ].filter(Boolean);
  }

  buildConeAnnotations(params, matrix, entryId) {
    const radiusTop = this.resolveNumericInputParam(params, 'radiusTop', 0);
    const radiusBottom = this.resolveNumericInputParam(params, 'radiusBottom', 0);
    const height = this.resolveNumericInputParam(params, 'height', 0);

    const baseCenter = applyPointMatrix(matrix, 0, 0, 0);
    const topCenter = applyPointMatrix(matrix, 0, height, 0);
    const baseRadiusPoint = applyPointMatrix(matrix, radiusBottom, 0, 0);
    const topRadiusPoint = applyPointMatrix(matrix, radiusTop, height, 0);

    return [
      this.#linear({ entryId, fieldKey: 'radiusBottom', pointA: baseCenter, pointB: baseRadiusPoint, value: radiusBottom, labelPrefix: 'Rb' }),
      this.#linear({ entryId, fieldKey: 'radiusTop', pointA: topCenter, pointB: topRadiusPoint, value: radiusTop, labelPrefix: 'Rt' }),
      this.#linear({ entryId, fieldKey: 'height', pointA: baseCenter, pointB: topCenter, value: height, labelPrefix: 'H' }),
    ].filter(Boolean);
  }

  buildSphereAnnotations(params, matrix, entryId) {
    const radius = this.resolveNumericInputParam(params, 'radius', 0);
    const center = applyPointMatrix(matrix, 0, 0, 0);
    const radiusPoint = applyPointMatrix(matrix, radius, 0, 0);

    return [
      this.#linear({ entryId, fieldKey: 'radius', pointA: center, pointB: radiusPoint, value: radius, labelPrefix: 'R' }),
    ].filter(Boolean);
  }

  buildPyramidAnnotations(params, matrix, entryId) {
    const side = this.resolveNumericInputParam(params, 'baseSideLength', 0);
    const height = this.resolveNumericInputParam(params, 'height', 0);
    const halfSide = side * 0.5;
    const baseY = -height * 0.5;
    const apexY = height * 0.5;

    const baseStart = applyPointMatrix(matrix, -halfSide, baseY, -halfSide);
    const baseEnd = applyPointMatrix(matrix, halfSide, baseY, -halfSide);
    const baseCenter = applyPointMatrix(matrix, 0, baseY, 0);
    const apex = applyPointMatrix(matrix, 0, apexY, 0);

    return [
      this.#linear({ entryId, fieldKey: 'baseSideLength', pointA: baseStart, pointB: baseEnd, value: side, labelPrefix: 'Side' }),
      this.#linear({ entryId, fieldKey: 'height', pointA: baseCenter, pointB: apex, value: height, labelPrefix: 'H' }),
    ].filter(Boolean);
  }

  buildTorusAnnotations(params, matrix, entryId) {
    const majorRadius = this.resolveNumericInputParam(params, 'majorRadius', 0);
    const tubeRadius = this.resolveNumericInputParam(params, 'tubeRadius', 0);
    const arc = clampNumber(this.resolveNumericInputParam(params, 'arc', 0), { min: -360, max: 360 });

    const center = applyPointMatrix(matrix, 0, 0, 0);
    const majorPoint = applyPointMatrix(matrix, majorRadius, 0, 0);
    const tubePoint = applyPointMatrix(matrix, majorRadius + tubeRadius, 0, 0);

    const axisPoint = center.clone();
    const axisDir = applyPointMatrix(matrix, 0, 1, 0).sub(center).normalize();
    let startDirection = majorPoint.clone().sub(center);
    if (startDirection.lengthSq() <= EPS) {
      startDirection = this.#arbitraryPerpendicular(axisDir);
    }

    const annotations = [
      this.#linear({ entryId, fieldKey: 'majorRadius', pointA: center, pointB: majorPoint, value: majorRadius, labelPrefix: 'R' }),
      this.#linear({ entryId, fieldKey: 'tubeRadius', pointA: majorPoint, pointB: tubePoint, value: tubeRadius, labelPrefix: 'r' }),
      this.#angle({
        entryId,
        fieldKey: 'arc',
        vertex: axisPoint,
        planeNormal: axisDir,
        startDirection,
        valueDeg: arc,
        labelPrefix: 'Arc',
        min: -360,
        max: 360,
      }),
    ];

    return annotations.filter(Boolean);
  }

  buildExtrudeAnnotations(params, entryId) {
    const profileGeometry = this.#resolveProfileReferenceGeometry(params.profile);
    if (!profileGeometry) return [];

    const center = profileGeometry.center.clone();
    const normal = profileGeometry.normal.clone().normalize();

    const distance = this.resolveNumericInputParam(params, 'distance', 0);
    const distanceBack = this.resolveNumericInputParam(params, 'distanceBack', 0);

    const forward = center.clone().addScaledVector(normal, distance);
    const backward = center.clone().addScaledVector(normal, -distanceBack);

    return [
      this.#linear({ entryId, fieldKey: 'distance', pointA: center, pointB: forward, value: distance, labelPrefix: 'D' }),
      this.#linear({ entryId, fieldKey: 'distanceBack', pointA: center, pointB: backward, value: distanceBack, labelPrefix: 'Db' }),
    ].filter(Boolean);
  }

  buildRevolveAnnotations(params, entryId) {
    const axisLine = this.#resolveAxisLine(params.axis, 'axis');
    if (!axisLine) return [];

    const profileGeometry = this.#resolveProfileReferenceGeometry(params.profile);
    if (!profileGeometry) return [];
    const profileCenter = profileGeometry.center.clone();
    const revolveAxis = this.#resolveRevolveAxisDirection(
      axisLine.direction,
      profileCenter,
      profileGeometry.normal,
      axisLine.point,
    );

    const vertex = closestPointOnLine(profileCenter, axisLine.point, revolveAxis);
    let startDirection = profileCenter.clone().sub(vertex);
    startDirection.addScaledVector(revolveAxis, -startDirection.dot(revolveAxis));
    if (startDirection.lengthSq() <= EPS) {
      startDirection = this.#arbitraryPerpendicular(revolveAxis);
    }

    const angle = clampNumber(this.resolveNumericInputParam(params, 'angle', 0), { min: -360, max: 360 });

    return [
      this.#angle({
        entryId,
        fieldKey: 'angle',
        vertex,
        // Revolve uses a negative sweep for positive angles, so invert annotation axis.
        planeNormal: revolveAxis.clone().negate(),
        startDirection,
        valueDeg: angle,
        labelPrefix: 'A',
        min: -360,
        max: 360,
      }),
    ].filter(Boolean);
  }

  buildPortAnnotations(params, entryId, entry = null) {
    const portDefinition = this.#resolvePortDefinitionFromParams(params, entry);
    if (!portDefinition) return [];

    const minVisibleLength = Math.max(0.25, screenSizeWorld(this.viewer, 36));
    const geometry = resolvePortExtensionAnnotationGeometry(portDefinition, minVisibleLength);
    if (!geometry) return [];

    return [
      this.#linear({
        entryId,
        fieldKey: 'extension',
        pointA: geometry.pointA,
        pointB: geometry.pointB,
        value: geometry.value,
        labelPrefix: 'Ext',
        min: 0,
        dragPlaneValue: geometry.dragPlaneValue,
      }),
    ].filter(Boolean);
  }

  resolveNumericInputParam(params, fieldKey, fallback = 0) {
    const fallbackNumber = Number(fallback);
    const fallbackValue = Number.isFinite(fallbackNumber) ? fallbackNumber : fallback;

    if (!params || typeof params !== 'object' || !fieldKey) return fallbackValue;

    const exprMap = (params.__expr && typeof params.__expr === 'object' && !Array.isArray(params.__expr))
      ? params.__expr
      : null;
    if (exprMap && Object.prototype.hasOwnProperty.call(exprMap, fieldKey)) {
      const evaluatedExpr = this.#evaluateExpressionAsNumber(exprMap[fieldKey]);
      if (Number.isFinite(evaluatedExpr)) return evaluatedExpr;
    }

    const raw = params[fieldKey];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;

    if (typeof raw === 'string') {
      const evaluatedRawExpr = this.#evaluateExpressionAsNumber(raw);
      if (Number.isFinite(evaluatedRawExpr)) return evaluatedRawExpr;
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric;

    return fallbackValue;
  }

  #linear(spec) {
    return this.createLinearAnnotation ? this.createLinearAnnotation(spec) : null;
  }

  #angle(spec) {
    return this.createAngleAnnotation ? this.createAngleAnnotation(spec) : null;
  }

  #evaluateExpressionAsNumber(exprText) {
    const raw = exprText == null ? '' : String(exprText);
    if (!raw.trim()) return null;

    let result = null;
    try {
      const partHistory = this.viewer?.partHistory || null;
      if (partHistory && typeof partHistory.evaluateExpression === 'function') {
        result = partHistory.evaluateExpression(raw);
      }
    } catch {
      result = null;
    }

    if (typeof result === 'number' && Number.isFinite(result)) return result;

    const numericFromResult = Number(result);
    if (Number.isFinite(numericFromResult)) return numericFromResult;

    const numericFromRaw = Number(raw);
    return Number.isFinite(numericFromRaw) ? numericFromRaw : null;
  }

  #resolveProfileObject(profileSelection) {
    const scene = this.viewer?.scene || null;
    const profileObject = resolveSelectionObject(scene, profileSelection)
      || resolveFeatureDimensionEffectReferenceObject(this.active?.entry, profileSelection, new Set(['FACE', 'SKETCH', 'PLANE']))
      || null;
    if (!profileObject) return null;

    const objectType = getFeatureDimensionObjectTypeTag(profileObject);
    const shouldSearchChildren = objectType === 'SKETCH'
      || (!profileObject?.geometry && Array.isArray(profileObject?.children));
    if (!shouldSearchChildren) return profileObject;

    const faceChild = profileObject.children?.find?.((child) => getFeatureDimensionObjectTypeTag(child) === 'FACE')
      || profileObject.children?.find?.((child) => child?.userData?.faceName);
    return faceChild || profileObject;
  }

  #resolveProfileReferenceGeometry(profileSelection) {
    let center = null;
    let normal = null;

    // Prefer stored pre-boolean reference snapshots. Boolean outputs can
    // replace scene topology and move the original driving reference.
    const snapshot = this.#resolveReferenceSnapshot('profile', profileSelection, new Set(['FACE', 'PLANE']));
    const snapshotGeom = this.#geometryFromFaceSnapshot(snapshot);
    if (snapshotGeom) {
      center = snapshotGeom.center;
      normal = snapshotGeom.normal;
    }

    if (!center || !normal) {
      const profileObject = this.#resolveProfileObject(profileSelection);
      if (profileObject) {
        center = center
          || this.#computeFaceAverageCenterWorld(profileObject)
          || computeFaceOrigin(profileObject)
          || extractWorldPoint(profileObject)
          || null;
        normal = normal || computeFaceNormal(profileObject) || getElementDirection(null, profileObject) || null;
        if (normal?.lengthSq?.() <= EPS) normal = null;
      }
    }

    if (!center || !normal || normal.lengthSq() <= EPS) return null;
    return {
      center: center.clone(),
      normal: normal.clone().normalize(),
    };
  }

  #resolveRevolveAxisDirection(axisDirection, profileCenter, profileNormal, axisPoint) {
    const axis = axisDirection?.clone?.();
    if (!axis || axis.lengthSq() <= EPS) return new THREE.Vector3(0, 1, 0);
    axis.normalize();

    const center = profileCenter?.clone?.();
    const normal = profileNormal?.clone?.();
    const pointOnAxis = axisPoint?.clone?.() || new THREE.Vector3();
    if (!center || !normal || normal.lengthSq() <= EPS) return axis;
    normal.normalize();

    const radial = center.clone().sub(pointOnAxis);
    const projLen = radial.dot(axis);
    radial.sub(axis.clone().multiplyScalar(projLen));
    if (radial.lengthSq() <= EPS) return axis;

    const orientVec = new THREE.Vector3().crossVectors(axis, radial);
    const orient = orientVec.dot(normal);
    if (orient < 0) axis.negate();
    return axis;
  }

  #resolveAxisLine(axisSelection, fieldKey = 'axis') {
    const axisSnapshot = this.#resolveReferenceSnapshot(fieldKey, axisSelection, new Set(['EDGE']));
    const axisFromSnapshot = this.#axisLineFromEdgeSnapshot(axisSnapshot);
    if (axisFromSnapshot) return axisFromSnapshot;

    const scene = this.viewer?.scene || null;
    const axisObject = resolveSelectionObject(scene, axisSelection) || null;
    const axisType = getFeatureDimensionObjectTypeTag(axisObject);

    let points = null;
    try {
      if (axisType === 'EDGE' && typeof axisObject?.points === 'function') {
        points = axisObject.points(true);
      }
    } catch { /* ignore */ }

    if (Array.isArray(points) && points.length >= 2) {
      const first = points[0];
      const last = points[points.length - 1];
      if (first && last) {
        const pointA = new THREE.Vector3(toFiniteNumber(first.x, 0), toFiniteNumber(first.y, 0), toFiniteNumber(first.z, 0));
        const pointB = new THREE.Vector3(toFiniteNumber(last.x, 0), toFiniteNumber(last.y, 0), toFiniteNumber(last.z, 0));
        const direction = pointB.clone().sub(pointA);
        if (direction.lengthSq() > EPS) {
          return { point: pointA.clone().add(pointB).multiplyScalar(0.5), direction: direction.normalize() };
        }
      }
    }

    if (axisObject) {
      const origin = extractWorldPoint(axisObject);
      const direction = getElementDirection(null, axisObject);
      if (origin && direction && direction.lengthSq() > EPS) {
        return { point: origin.clone(), direction: direction.clone().normalize() };
      }
    }

    const consumedAxisObject = resolveFeatureDimensionEffectReferenceObject(this.active?.entry, axisSelection, new Set(['EDGE']));
    if (consumedAxisObject) {
      let consumedPoints = null;
      try {
        if (typeof consumedAxisObject?.points === 'function') consumedPoints = consumedAxisObject.points(true);
      } catch { /* ignore */ }
      if (Array.isArray(consumedPoints) && consumedPoints.length >= 2) {
        const first = consumedPoints[0];
        const last = consumedPoints[consumedPoints.length - 1];
        const pointA = new THREE.Vector3(toFiniteNumber(first?.x, 0), toFiniteNumber(first?.y, 0), toFiniteNumber(first?.z, 0));
        const pointB = new THREE.Vector3(toFiniteNumber(last?.x, 0), toFiniteNumber(last?.y, 0), toFiniteNumber(last?.z, 0));
        const direction = pointB.clone().sub(pointA);
        if (direction.lengthSq() > EPS) return { point: pointA.clone().add(pointB).multiplyScalar(0.5), direction: direction.normalize() };
      }

      const origin = extractWorldPoint(consumedAxisObject);
      const direction = getElementDirection(null, consumedAxisObject);
      if (origin && direction && direction.lengthSq() > EPS) {
        return { point: origin.clone(), direction: direction.clone().normalize() };
      }
    }

    return null;
  }

  #resolvePortDefinitionFromParams(params = {}, entry = null) {
    const sourceParams: AnyRecord = params && typeof params === 'object' ? params as AnyRecord : {};
    const scene = this.viewer?.scene || null;
    const resolveSelectionValue = (value) => {
      if (Array.isArray(value)) return value.map((item) => resolveSelectionValue(item));
      return resolveSelectionObject(scene, value) || value;
    };

    try {
      const resolvedParams = {
        ...sourceParams,
        transform: (sourceParams.transform && typeof sourceParams.transform === 'object')
          ? {
            ...sourceParams.transform,
            reference: resolveSelectionValue(sourceParams.transform.reference),
          }
          : sourceParams.transform,
        anchor: resolveSelectionValue(sourceParams.anchor),
        directionRef: resolveSelectionValue(sourceParams.directionRef),
      };
      const featureId = String(
        sourceParams?.featureID
        || sourceParams?.id
        || entry?.persistentData?.port?.featureId
        || entry?.type
        || 'Port',
      ).trim() || 'Port';
      const definition = buildPortDefinitionFromInputs({
        featureId,
        inputParams: resolvedParams,
        referenceSource: this.viewer || scene || null,
      });
      if (definition?.point && definition?.direction) return definition;
    } catch { /* ignore and fall back to runtime snapshot */ }

    const runtimePort = entry?.persistentData?.port;
    if (!runtimePort || typeof runtimePort !== 'object') return null;
    return runtimePort;
  }

  #resolveReferenceSnapshot(fieldKey, selection = null, allowedTypes = null) {
    const names = collectFeatureDimensionReferenceNames(selection);
    return resolveReferenceSnapshotFromNames(this.active?.entry?.persistentData, fieldKey, names, allowedTypes);
  }

  #pointsFromFlatPositionArray(positions) {
    if (!Array.isArray(positions) || positions.length < 3) return [];
    const out = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = Number(positions[i]);
      const y = Number(positions[i + 1]);
      const z = Number(positions[i + 2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      out.push(new THREE.Vector3(x, y, z));
    }
    return out;
  }

  #computeFaceAverageCenterWorld(object) {
    if (!object) return null;
    try { object.updateMatrixWorld?.(true); } catch { /* ignore */ }

    const avgFromGeometry = () => {
      const geom = object?.geometry;
      const posAttr = geom?.getAttribute?.('position');
      if (!posAttr || posAttr.itemSize !== 3 || posAttr.count <= 0) return null;

      const sum = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i += 1) {
        tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(object.matrixWorld);
        sum.add(tmp);
      }
      return sum.multiplyScalar(1 / posAttr.count);
    };

    const avgFromBoundaryLoops = () => {
      const loops = Array.isArray(object?.userData?.boundaryLoopsWorld) ? object.userData.boundaryLoopsWorld : null;
      if (!loops || !loops.length) return null;
      const allPoints = [];
      for (const loop of loops) {
        const pts = Array.isArray(loop?.pts) ? loop.pts : (Array.isArray(loop) ? loop : null);
        if (!pts) continue;
        for (const pt of pts) {
          if (!Array.isArray(pt) || pt.length < 3) continue;
          const x = Number(pt[0]);
          const y = Number(pt[1]);
          const z = Number(pt[2]);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
          allPoints.push(new THREE.Vector3(x, y, z));
        }
      }
      if (!allPoints.length) return null;
      const center = new THREE.Vector3();
      for (const pt of allPoints) center.add(pt);
      return center.multiplyScalar(1 / allPoints.length);
    };

    const avgFromEdges = () => {
      const edges = Array.isArray(object?.edges) ? object.edges : [];
      if (!edges.length) return null;
      const points = [];
      for (const edge of edges) {
        try {
          if (typeof edge?.points !== 'function') continue;
          const edgePoints = edge.points(true);
          if (!Array.isArray(edgePoints) || !edgePoints.length) continue;
          for (const p of edgePoints) {
            const x = Number(p?.x);
            const y = Number(p?.y);
            const z = Number(p?.z);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
            points.push(new THREE.Vector3(x, y, z));
          }
        } catch { /* ignore */ }
      }
      if (!points.length) return null;
      const center = new THREE.Vector3();
      for (const pt of points) center.add(pt);
      return center.multiplyScalar(1 / points.length);
    };

    return avgFromGeometry()
      || avgFromBoundaryLoops()
      || avgFromEdges()
      || null;
  }

  #geometryFromFaceSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.edgePositions)) return null;

    const allPoints = [];
    const normalAccumulator = new THREE.Vector3();
    const centerFromSnapshot = this.#pointsFromFlatPositionArray(snapshot?.center);
    const normalFromSnapshot = this.#pointsFromFlatPositionArray(snapshot?.normal);

    for (const edge of snapshot.edgePositions) {
      const points = this.#pointsFromFlatPositionArray(edge);
      if (!points.length) continue;
      allPoints.push(...points);
    }
    if (allPoints.length < 3) return null;

    const center = centerFromSnapshot.length
      ? centerFromSnapshot[0].clone()
      : (() => {
        const avg = new THREE.Vector3();
        for (const point of allPoints) avg.add(point);
        return avg.multiplyScalar(1 / allPoints.length);
      })();

    if (normalFromSnapshot.length && normalFromSnapshot[0].lengthSq() > EPS) {
      return {
        center,
        normal: normalFromSnapshot[0].clone().normalize(),
      };
    }

    for (const edge of snapshot.edgePositions) {
      const points = this.#pointsFromFlatPositionArray(edge);
      if (points.length < 2) continue;
      for (let i = 0; i < points.length - 1; i += 1) {
        const v0 = points[i].clone().sub(center);
        const v1 = points[i + 1].clone().sub(center);
        const cross = new THREE.Vector3().crossVectors(v0, v1);
        if (cross.lengthSq() > EPS) normalAccumulator.add(cross);
      }
    }

    if (normalAccumulator.lengthSq() <= EPS) {
      for (let i = 0; i < allPoints.length - 2; i += 1) {
        const a = allPoints[i];
        const b = allPoints[i + 1];
        const c = allPoints[i + 2];
        const cross = new THREE.Vector3()
          .subVectors(b, a)
          .cross(new THREE.Vector3().subVectors(c, a));
        if (cross.lengthSq() > EPS) {
          normalAccumulator.copy(cross);
          break;
        }
      }
    }

    if (normalAccumulator.lengthSq() <= EPS) return null;
    return {
      center,
      normal: normalAccumulator.normalize(),
    };
  }

  #axisLineFromEdgeSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.positions)) return null;
    const points = this.#pointsFromFlatPositionArray(snapshot.positions);
    if (points.length < 2) return null;

    let first = points[0];
    let last = points[points.length - 1];
    if (first.distanceToSquared(last) <= EPS) {
      let bestDistSq = 0;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const distSq = points[i].distanceToSquared(points[j]);
          if (distSq > bestDistSq) {
            bestDistSq = distSq;
            first = points[i];
            last = points[j];
          }
        }
      }
      if (bestDistSq <= EPS) return null;
    }

    const direction = last.clone().sub(first);
    if (direction.lengthSq() <= EPS) return null;

    return {
      point: first.clone().add(last).multiplyScalar(0.5),
      direction: direction.normalize(),
    };
  }

  #arbitraryPerpendicular(direction) {
    if (!direction || direction.lengthSq() <= EPS) return new THREE.Vector3(0, 0, 1);
    const axis = Math.abs(direction.dot(new THREE.Vector3(0, 0, 1))) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    const perpendicular = new THREE.Vector3().crossVectors(direction, axis);
    if (perpendicular.lengthSq() <= EPS) {
      perpendicular.crossVectors(direction, new THREE.Vector3(1, 0, 0));
    }
    return perpendicular.lengthSq() <= EPS ? new THREE.Vector3(1, 0, 0) : perpendicular.normalize();
  }
}
