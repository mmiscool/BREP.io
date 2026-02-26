import * as THREE from 'three';
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three/examples/jsm/Addons.js';
import { LabelOverlay } from '../pmi/LabelOverlay.js';
import { addArrowCone, getElementDirection, makeOverlaySphere, screenSizeWorld } from '../pmi/annUtils.js';
import {
  buildAngleDimensionGeometry,
  buildLinearDimensionGeometry,
  dirTo2D,
  planeBasis,
} from '../dimensions/dimensionGeometry.js';
import { resolveSelectionObject } from '../assembly/constraintSelectionUtils.js';
import { extractWorldPoint } from '../assembly/constraintPointUtils.js';
import { computeFaceNormal, computeFaceOrigin } from '../faceUtils.js';

const FEATURE_LINE_COLOR = '#bfbfbf';
const DRAGGABLE_TIP_COLOR = '#f2c14e';
const STATIONARY_TIP_COLOR = '#f29e4c';
const LINEAR_DRAG_SNAP_STEP = 0.1;
const ANGLE_DRAG_SNAP_STEP = 1;
const GIZMO_SIZE_MULTIPLIER = 2;
const GIZMO_ROD_RADIUS = 0.03;
const GIZMO_ARROW_RADIUS = 0.12;
const GIZMO_ARROW_LENGTH = 0.4;
const GIZMO_DOT_RADIUS = 0.12;
const EPS = 1e-9;
const LABEL_ARROW_CLEARANCE_PX = 12;
const LABEL_ARROW_AVOID_MAX_PUSH_PX = 120;
const LABEL_ARROW_AVOID_MAX_ITERS = 300;
const FEATURE_ANGLE_RADIUS_PX = 120;
const FEATURE_ANGLE_MIN_RADIUS_PX = 100;
const DRAG_FIELD_CHANGE_THROTTLE_MS = 60;

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  const abs = Math.abs(numeric);
  const precision = abs >= 100 ? 1 : (abs >= 10 ? 2 : 3);
  const rounded = Number(numeric.toFixed(precision));
  return String(rounded);
}

function normalizeFeatureType(raw) {
  if (!raw) return '';
  return String(raw).trim().toUpperCase();
}

function roleForArrowIndex(index, total) {
  if (total <= 1) return 'end';
  if (index === 0) return 'start';
  if (index === total - 1) return 'end';
  return `mid-${index}`;
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

function snapToIncrement(value, increment) {
  const numeric = Number(value);
  const step = Number(increment);
  if (!Number.isFinite(numeric) || !Number.isFinite(step) || step <= EPS) return numeric;
  return Math.round(numeric / step) * step;
}

function closestPointOnLine(point, linePoint, lineDir) {
  const dir = lineDir.clone().normalize();
  const t = point.clone().sub(linePoint).dot(dir);
  return linePoint.clone().addScaledVector(dir, t);
}

export class FeatureDimensionOverlay {
  constructor({ viewer = null, onFieldChange = null, onFieldFocus = null } = {}) {
    this.viewer = viewer || null;
    this.onFieldChange = typeof onFieldChange === 'function' ? onFieldChange : null;
    this.onFieldFocus = typeof onFieldFocus === 'function' ? onFieldFocus : null;

    this._lineMap = new Map();
    this._arrowGroupMap = new Map();
    this._labelRecords = new Map();
    this._arrowPickMeshes = [];

    this._active = null;
    this._dragState = null;
    this._raycaster = new THREE.Raycaster();
    this._lastFieldChangeDispatchAt = 0;
    this._pendingFieldChangePayload = null;
    this._throttledFieldChangeTimer = null;

    this._onControlsChange = () => this.refresh();
    this._onWindowResize = () => this.refresh();
    this._onCanvasPointerDown = (ev) => this.#handleCanvasPointerDown(ev);
    this._onGlobalPointerMove = (ev) => this.#handleGlobalPointerMove(ev);
    this._onGlobalPointerUp = (ev) => this.#handleGlobalPointerUp(ev);

    this._group = null;
    if (this.viewer?.scene) {
      this._group = new THREE.Group();
      this._group.name = 'feature-dimension-overlays';
      this._group.userData.excludeFromFit = true;
      try { this.viewer.scene.add(this._group); } catch { this._group = null; }
    }

    this._labelOverlay = new LabelOverlay(
      this.viewer,
      null,
      null,
      (idx, ann, ev) => { try { this.#handleLabelClick(idx, ann, ev); } catch { } },
      null,
    );
    try { this._labelOverlay?.setVisible?.(false); } catch { }

    try { this.viewer?.controls?.addEventListener?.('change', this._onControlsChange); } catch { }
    try { window.addEventListener('resize', this._onWindowResize); } catch { }
    try { this.viewer?.renderer?.domElement?.addEventListener?.('pointerdown', this._onCanvasPointerDown, true); } catch { }
  }

  dispose() {
    this.clearActive();
    try { this.viewer?.controls?.removeEventListener?.('change', this._onControlsChange); } catch { }
    try { window.removeEventListener('resize', this._onWindowResize); } catch { }
    try { this.viewer?.renderer?.domElement?.removeEventListener?.('pointerdown', this._onCanvasPointerDown, true); } catch { }
    this.#endDragSession();
    this.#cancelQueuedFieldChange();

    try { this._labelOverlay?.dispose?.(); } catch { }
    this._labelOverlay = null;

    if (this._group && this.viewer?.scene) {
      try { this.viewer.scene.remove(this._group); } catch { }
    }
    this._group = null;
  }

  clearActive() {
    this._active = null;
    this._labelRecords.clear();
    this._arrowPickMeshes = [];
    this.#cancelQueuedFieldChange();
    this.#clearVisuals();
    try { this._labelOverlay?.clear?.(); } catch { }
    try { this._labelOverlay?.setVisible?.(false); } catch { }
    this.#requestRender();
  }

  isDragging() {
    return !!this._dragState;
  }

  setActive({ entryId = null, entry = null, featureClass = null, form = null } = {}) {
    const normalizedId = entryId != null ? String(entryId) : null;
    const key = this.#featureKey(entry, featureClass);
    if (!normalizedId || !entry || !featureClass || !form || !this.#isSupportedFeatureKey(key)) {
      this.clearActive();
      return;
    }

    this._active = {
      entryId: normalizedId,
      entry,
      featureClass,
      form,
      featureKey: key,
    };

    try { this._labelOverlay?.setVisible?.(true); } catch { }
  }

  refresh() {
    if (!this._active) {
      this.clearActive();
      return;
    }

    if (!this._group || !this.viewer?.scene) {
      this.clearActive();
      return;
    }

    if (!this._group.parent) {
      try { this.viewer.scene.add(this._group); } catch { }
    }

    const annotations = this.#buildAnnotations(this._active);
    if (!Array.isArray(annotations) || !annotations.length) {
      this._labelRecords.clear();
      this._arrowPickMeshes = [];
      this.#clearVisuals();
      try { this._labelOverlay?.clear?.(); } catch { }
      this.#requestRender();
      return;
    }

    this._labelRecords.clear();
    this._arrowPickMeshes = [];
    try { this._labelOverlay?.clear?.(); } catch { }

    const activeIds = new Set();

    for (const ann of annotations) {
      if (!ann || !ann.id) continue;
      activeIds.add(ann.id);

      const segments = Array.isArray(ann.segments) ? ann.segments : [];
      const arrowSpecs = Array.isArray(ann.arrowSpecs) ? ann.arrowSpecs : [];

      if (segments.length || arrowSpecs.length) {
        this.#upsertVisual(ann, FEATURE_LINE_COLOR);
      } else {
        this.#removeVisual(ann.id);
      }

      if (!ann.labelPosition) continue;

      const labelData = {
        id: ann.id,
        fieldKey: ann.fieldKey,
        entryId: this._active.entryId,
      };

      let labelPosition = ann.labelPosition.clone();
      try { this._labelOverlay?.updateLabel?.(ann.id, ann.text, labelPosition, labelData); } catch { }
      const labelEl = this._labelOverlay?.getElement?.(ann.id) || null;
      if (labelEl) {
        try {
          labelEl.classList.add('constraint-label', 'feature-dim-label');
          labelEl.dataset.featureDimId = ann.id;
          labelEl.style.borderColor = DRAGGABLE_TIP_COLOR;
          labelEl.style.color = DRAGGABLE_TIP_COLOR;
        } catch { }
      }

      if (labelEl) {
        labelPosition = this.#resolveLabelPositionAvoidingArrowHeads(
          ann,
          labelData,
          labelPosition,
          labelEl,
        );
      }

      this._labelRecords.set(ann.id, {
        annotation: ann,
        text: ann.text,
        position: labelPosition.clone(),
        data: labelData,
      });
    }

    this.#removeUnusedVisuals(activeIds);
    this.#requestRender();
  }

  #featureKey(entry, featureClass) {
    const shortName = normalizeFeatureType(featureClass?.shortName);
    if (shortName) return shortName;
    return normalizeFeatureType(entry?.type);
  }

  #isSupportedFeatureKey(key) {
    return key === 'P.CU'
      || key === 'P.CY'
      || key === 'P.CO'
      || key === 'P.S'
      || key === 'P.PY'
      || key === 'P.T'
      || key === 'E'
      || key === 'R';
  }

  #buildAnnotations(active) {
    const params = active?.entry?.inputParams || {};
    const matrix = composeTransformMatrix(params.transform);

    switch (active.featureKey) {
      case 'P.CU': return this.#buildCubeAnnotations(params, matrix, active.entryId);
      case 'P.CY': return this.#buildCylinderAnnotations(params, matrix, active.entryId);
      case 'P.CO': return this.#buildConeAnnotations(params, matrix, active.entryId);
      case 'P.S': return this.#buildSphereAnnotations(params, matrix, active.entryId);
      case 'P.PY': return this.#buildPyramidAnnotations(params, matrix, active.entryId);
      case 'P.T': return this.#buildTorusAnnotations(params, matrix, active.entryId);
      case 'E': return this.#buildExtrudeAnnotations(params, active.entryId);
      case 'R': return this.#buildRevolveAnnotations(params, active.entryId);
      default: return [];
    }
  }

  #buildCubeAnnotations(params, matrix, entryId) {
    const sx = this.#resolveNumericInputParam(params, 'sizeX', 0);
    const sy = this.#resolveNumericInputParam(params, 'sizeY', 0);
    const sz = this.#resolveNumericInputParam(params, 'sizeZ', 0);

    const p0 = applyPointMatrix(matrix, 0, 0, 0);
    const px = applyPointMatrix(matrix, sx, 0, 0);
    const py = applyPointMatrix(matrix, 0, sy, 0);
    const pz = applyPointMatrix(matrix, 0, 0, sz);

    return [
      this.#createLinearAnnotation({ entryId, fieldKey: 'sizeX', pointA: p0, pointB: px, value: sx, labelPrefix: 'X' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'sizeY', pointA: p0, pointB: py, value: sy, labelPrefix: 'Y' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'sizeZ', pointA: p0, pointB: pz, value: sz, labelPrefix: 'Z' }),
    ].filter(Boolean);
  }

  #buildCylinderAnnotations(params, matrix, entryId) {
    const radius = this.#resolveNumericInputParam(params, 'radius', 0);
    const height = this.#resolveNumericInputParam(params, 'height', 0);

    const base = applyPointMatrix(matrix, 0, 0, 0);
    const top = applyPointMatrix(matrix, 0, height, 0);
    const radial = applyPointMatrix(matrix, radius, 0, 0);

    return [
      this.#createLinearAnnotation({ entryId, fieldKey: 'radius', pointA: base, pointB: radial, value: radius, labelPrefix: 'R' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'height', pointA: base, pointB: top, value: height, labelPrefix: 'H' }),
    ].filter(Boolean);
  }

  #buildConeAnnotations(params, matrix, entryId) {
    const radiusTop = this.#resolveNumericInputParam(params, 'radiusTop', 0);
    const radiusBottom = this.#resolveNumericInputParam(params, 'radiusBottom', 0);
    const height = this.#resolveNumericInputParam(params, 'height', 0);

    const baseCenter = applyPointMatrix(matrix, 0, 0, 0);
    const topCenter = applyPointMatrix(matrix, 0, height, 0);
    const baseRadiusPoint = applyPointMatrix(matrix, radiusBottom, 0, 0);
    const topRadiusPoint = applyPointMatrix(matrix, radiusTop, height, 0);

    return [
      this.#createLinearAnnotation({ entryId, fieldKey: 'radiusBottom', pointA: baseCenter, pointB: baseRadiusPoint, value: radiusBottom, labelPrefix: 'Rb' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'radiusTop', pointA: topCenter, pointB: topRadiusPoint, value: radiusTop, labelPrefix: 'Rt' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'height', pointA: baseCenter, pointB: topCenter, value: height, labelPrefix: 'H' }),
    ].filter(Boolean);
  }

  #buildSphereAnnotations(params, matrix, entryId) {
    const radius = this.#resolveNumericInputParam(params, 'radius', 0);
    const center = applyPointMatrix(matrix, 0, 0, 0);
    const radiusPoint = applyPointMatrix(matrix, radius, 0, 0);

    return [
      this.#createLinearAnnotation({ entryId, fieldKey: 'radius', pointA: center, pointB: radiusPoint, value: radius, labelPrefix: 'R' }),
    ].filter(Boolean);
  }

  #buildPyramidAnnotations(params, matrix, entryId) {
    const side = this.#resolveNumericInputParam(params, 'baseSideLength', 0);
    const height = this.#resolveNumericInputParam(params, 'height', 0);
    const halfSide = side * 0.5;
    const baseY = -height * 0.5;
    const apexY = height * 0.5;

    const baseStart = applyPointMatrix(matrix, -halfSide, baseY, -halfSide);
    const baseEnd = applyPointMatrix(matrix, halfSide, baseY, -halfSide);
    const baseCenter = applyPointMatrix(matrix, 0, baseY, 0);
    const apex = applyPointMatrix(matrix, 0, apexY, 0);

    return [
      this.#createLinearAnnotation({ entryId, fieldKey: 'baseSideLength', pointA: baseStart, pointB: baseEnd, value: side, labelPrefix: 'Side' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'height', pointA: baseCenter, pointB: apex, value: height, labelPrefix: 'H' }),
    ].filter(Boolean);
  }

  #buildTorusAnnotations(params, matrix, entryId) {
    const majorRadius = this.#resolveNumericInputParam(params, 'majorRadius', 0);
    const tubeRadius = this.#resolveNumericInputParam(params, 'tubeRadius', 0);
    const arc = clampNumber(this.#resolveNumericInputParam(params, 'arc', 0), { min: -360, max: 360 });

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
      this.#createLinearAnnotation({ entryId, fieldKey: 'majorRadius', pointA: center, pointB: majorPoint, value: majorRadius, labelPrefix: 'R' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'tubeRadius', pointA: majorPoint, pointB: tubePoint, value: tubeRadius, labelPrefix: 'r' }),
      this.#createAngleAnnotation({
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

  #buildExtrudeAnnotations(params, entryId) {
    const profileGeometry = this.#resolveProfileReferenceGeometry(params.profile);
    if (!profileGeometry) return [];

    const center = profileGeometry.center.clone();
    const normal = profileGeometry.normal.clone().normalize();

    const distance = this.#resolveNumericInputParam(params, 'distance', 0);
    const distanceBack = this.#resolveNumericInputParam(params, 'distanceBack', 0);

    const forward = center.clone().addScaledVector(normal, distance);
    const backward = center.clone().addScaledVector(normal, -distanceBack);

    return [
      this.#createLinearAnnotation({ entryId, fieldKey: 'distance', pointA: center, pointB: forward, value: distance, labelPrefix: 'D' }),
      this.#createLinearAnnotation({ entryId, fieldKey: 'distanceBack', pointA: center, pointB: backward, value: distanceBack, labelPrefix: 'Db' }),
    ].filter(Boolean);
  }

  #buildRevolveAnnotations(params, entryId) {
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

    const angle = clampNumber(this.#resolveNumericInputParam(params, 'angle', 0), { min: -360, max: 360 });

    return [
      this.#createAngleAnnotation({
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

  #resolveProfileObject(profileSelection) {
    const scene = this.viewer?.scene || null;
    const profileObject = resolveSelectionObject(scene, profileSelection) || null;
    if (!profileObject) return null;

    const objectType = this.#objectTypeTag(profileObject);
    const shouldSearchChildren = objectType === 'SKETCH'
      || (!profileObject?.geometry && Array.isArray(profileObject?.children));
    if (!shouldSearchChildren) return profileObject;

    const faceChild = profileObject.children?.find?.((child) => this.#objectTypeTag(child) === 'FACE')
      || profileObject.children?.find?.((child) => child?.userData?.faceName);
    return faceChild || profileObject;
  }

  #resolveProfileReferenceGeometry(profileSelection) {
    let center = null;
    let normal = null;

    // Prefer stored pre-boolean reference snapshots. For features like Revolve,
    // scene objects may be replaced by boolean outputs, which can shift the
    // resolved face center/normal away from the original driving reference.
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
    // Snapshot-first for stability when booleans replace edge topology in-scene.
    const axisSnapshot = this.#resolveReferenceSnapshot(fieldKey, axisSelection, new Set(['EDGE']));
    const axisFromSnapshot = this.#axisLineFromEdgeSnapshot(axisSnapshot);
    if (axisFromSnapshot) return axisFromSnapshot;

    const scene = this.viewer?.scene || null;
    const axisObject = resolveSelectionObject(scene, axisSelection) || null;
    const axisType = this.#objectTypeTag(axisObject);

    let points = null;
    try {
      if (axisType === 'EDGE' && typeof axisObject?.points === 'function') {
        points = axisObject.points(true);
      }
    } catch { }

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

    return null;
  }

  #objectTypeTag(object) {
    if (!object) return '';
    const rawType = object?.userData?.type || object?.userData?.brepType || object?.type || '';
    return String(rawType).toUpperCase();
  }

  #collectSelectionReferenceNames(selection) {
    const out = [];
    const addName = (candidate) => {
      if (candidate == null) return;
      const name = String(candidate).trim();
      if (!name) return;
      if (!out.includes(name)) out.push(name);
    };

    const consume = (value) => {
      if (value == null) return;
      if (Array.isArray(value)) {
        for (const item of value) consume(item);
        return;
      }
      if (typeof value === 'string') {
        addName(value);
        return;
      }
      if (typeof value === 'object') {
        if (value.isObject3D) addName(value.name);
        addName(value.name);
        addName(value.selectionName);
        addName(value.id);
        addName(value.faceName);
        addName(value.edgeName);
        if (value.reference != null) consume(value.reference);
        if (value.target != null) consume(value.target);
      }
    };

    consume(selection);
    return out;
  }

  #resolveReferenceSnapshot(fieldKey, selection = null, allowedTypes = null) {
    const snapshots = this._active?.entry?.persistentData?.__refPreviewSnapshots;
    const bucket = snapshots && typeof snapshots === 'object' ? snapshots[fieldKey] : null;
    if (!bucket || typeof bucket !== 'object') return null;

    const acceptsType = (typeRaw) => {
      if (!(allowedTypes instanceof Set) || allowedTypes.size === 0) return true;
      const type = String(typeRaw || '').toUpperCase();
      return allowedTypes.has(type);
    };

    const names = this.#collectSelectionReferenceNames(selection);
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(bucket, name)) continue;
      const snapshot = bucket[name];
      if (snapshot && acceptsType(snapshot.type)) return snapshot;
    }

    for (const key of Object.keys(bucket)) {
      const snapshot = bucket[key];
      if (snapshot && acceptsType(snapshot.type)) return snapshot;
    }

    return null;
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

  #createLinearAnnotation({
    entryId,
    fieldKey,
    pointA,
    pointB,
    value,
    labelPrefix = '',
    min = null,
    max = null,
  }) {
    if (!pointA || !pointB) return null;
    const direction = pointB.clone().sub(pointA);
    if (direction.lengthSq() <= EPS) return null;
    const rawDirection = direction.clone().normalize();

    const geometry = buildLinearDimensionGeometry({
      pointA,
      pointB,
      normal: this.#viewerViewNormal(),
      // Feature-edit dimensions should sit on the true measured line (no free-floating offset).
      offset: 0,
      showExtensions: false,
      screenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
      fallbackScreenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
    });
    if (!geometry) return null;

    const annotationId = `${entryId}:${fieldKey}`;
    const annotationValue = toFiniteNumber(value, 0);
    // Keep drag direction stable across sign changes:
    // pointB already includes value sign, so if value < 0 the raw direction flips.
    // Normalize back to the feature's positive axis so re-grabs don't invert drag.
    const dragSign = annotationValue < 0 ? -1 : 1;
    const dragDirection = rawDirection.clone().multiplyScalar(dragSign);
    const text = `${labelPrefix ? `${labelPrefix} ` : ''}${formatNumber(annotationValue)}`;
    const arrowSpecs = Array.isArray(geometry.arrowSpecs) ? geometry.arrowSpecs : [];
    const draggableRoles = new Set(['end']);
    const segments = this.#trimLinearSegmentsForConeTips(
      Array.isArray(geometry.segments) ? geometry.segments : [],
      arrowSpecs,
      draggableRoles,
    );

    return {
      id: annotationId,
      entryId,
      fieldKey,
      text,
      value: annotationValue,
      segments,
      arrowSpecs,
      labelPosition: geometry.labelPosition?.clone?.() || null,
      draggableRoles,
      drag: {
        kind: 'linear',
        anchor: pointA.clone(),
        direction: dragDirection,
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
      },
    };
  }

  #cloneValidSegments(segments) {
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => (Array.isArray(segment) && segment.length >= 2 ? [segment[0]?.clone?.(), segment[1]?.clone?.()] : null))
      .filter((segment) => segment?.[0] && segment?.[1]);
  }

  #arrowTrimDistanceAtTip(tip) {
    if (!tip) return 0;
    const dims = this.#gizmoHandleDimensionsAt(tip);
    const trimDistance = Number(dims?.arrowLength) || 0;
    return trimDistance > EPS ? trimDistance : 0;
  }

  #trimLinearSegmentsForConeTips(segments, arrowSpecs, draggableRoles) {
    const sourceSegments = Array.isArray(segments) ? segments : [];
    if (!sourceSegments.length) return [];
    const specs = Array.isArray(arrowSpecs) ? arrowSpecs : [];
    if (!specs.length || !(draggableRoles instanceof Set) || draggableRoles.size === 0) {
      return this.#cloneValidSegments(sourceSegments);
    }

    const trims = [];
    for (let i = 0; i < specs.length; i += 1) {
      const role = roleForArrowIndex(i, specs.length);
      if (!draggableRoles.has(role)) continue;
      const tip = specs[i]?.tip?.clone?.();
      if (!tip) continue;
      const trimDistance = this.#arrowTrimDistanceAtTip(tip);
      if (!trimDistance) continue;
      trims.push({
        tip,
        trimDistance,
        toleranceSq: Math.max(1e-10, trimDistance * trimDistance * 1e-4),
      });
    }
    if (!trims.length) {
      return this.#cloneValidSegments(sourceSegments);
    }

    const out = [];
    for (const segment of sourceSegments) {
      if (!Array.isArray(segment) || segment.length < 2) continue;
      let start = segment[0]?.clone?.();
      let end = segment[1]?.clone?.();
      if (!start || !end) continue;

      for (const trim of trims) {
        const startAtTip = start.distanceToSquared(trim.tip) <= trim.toleranceSq;
        const endAtTip = end.distanceToSquared(trim.tip) <= trim.toleranceSq;
        if (!startAtTip && !endAtTip) continue;

        const segVec = end.clone().sub(start);
        const segLen = segVec.length();
        if (!(segLen > EPS)) break;
        const cut = Math.min(trim.trimDistance, segLen - EPS);
        if (!(cut > EPS)) continue;
        segVec.multiplyScalar(1 / segLen);

        if (endAtTip) {
          end = end.clone().addScaledVector(segVec, -cut);
        } else if (startAtTip) {
          start = start.clone().addScaledVector(segVec, cut);
        }
      }

      if (start.distanceToSquared(end) <= EPS * EPS) continue;
      out.push([start, end]);
    }
    return out;
  }

  #createAngleAnnotation({
    entryId,
    fieldKey,
    vertex,
    planeNormal,
    startDirection,
    valueDeg,
    labelPrefix = '',
    min = -360,
    max = 360,
  }) {
    if (!vertex || !planeNormal || !startDirection) return null;

    const normal = planeNormal.clone();
    if (normal.lengthSq() <= EPS) return null;
    normal.normalize();

    let startDir = startDirection.clone();
    startDir.addScaledVector(normal, -startDir.dot(normal));
    if (startDir.lengthSq() <= EPS) return null;
    startDir.normalize();

    const safeValue = clampNumber(valueDeg, {
      min: Number.isFinite(min) ? min : -Infinity,
      max: Number.isFinite(max) ? max : Infinity,
    });
    const signedGeometryDeg = THREE.MathUtils.clamp(safeValue, -359.9, 359.9);
    const geometrySweepDeg = Math.abs(signedGeometryDeg);
    const geometrySweepSign = signedGeometryDeg < 0 ? -1 : 1;
    const signedSweepRad = THREE.MathUtils.degToRad(geometrySweepDeg * geometrySweepSign);

    const endDir = startDir.clone().applyAxisAngle(normal, signedSweepRad);
    const basis = planeBasis(normal, startDir);

    let dirA2D = dirTo2D(startDir, basis);
    let dirB2D = dirTo2D(endDir, basis);
    if (dirA2D.lengthSq() <= EPS || dirB2D.lengthSq() <= EPS) return null;
    dirA2D.normalize();
    dirB2D.normalize();

    let bisector2D = dirTo2D(
      startDir.clone().applyAxisAngle(normal, signedSweepRad * 0.5),
      basis,
    );
    if (bisector2D.lengthSq() <= EPS) {
      bisector2D = new THREE.Vector2(-dirA2D.y, dirA2D.x).multiplyScalar(geometrySweepSign);
    }
    bisector2D.normalize();

    const geometry = buildAngleDimensionGeometry({
      planePoint: vertex,
      planeNormal: normal,
      basis,
      vertex2D: new THREE.Vector2(0, 0),
      directionA2D: dirA2D,
      directionB2D: dirB2D,
      sweepRad: THREE.MathUtils.degToRad(geometrySweepDeg),
      sweepDirection: geometrySweepSign,
      bisector2D,
      defaultRadiusPixels: FEATURE_ANGLE_RADIUS_PX,
      minRadiusPixels: FEATURE_ANGLE_MIN_RADIUS_PX,
      screenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
      fallbackScreenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
    });
    if (!geometry) return null;

    const segments = [];
    const arcPoints = Array.isArray(geometry.arcPoints) ? geometry.arcPoints : [];
    const arcPointsForSegments = this.#trimAngleArcPointsForConeTip(arcPoints);
    for (let i = 0; i < arcPointsForSegments.length - 1; i += 1) {
      const p0 = arcPointsForSegments[i];
      const p1 = arcPointsForSegments[i + 1];
      if (!p0 || !p1) continue;
      segments.push([p0, p1]);
    }

    const annotationId = `${entryId}:${fieldKey}`;
    const text = `${labelPrefix ? `${labelPrefix} ` : ''}${formatNumber(safeValue)}°`;

    return {
      id: annotationId,
      entryId,
      fieldKey,
      text,
      value: safeValue,
      segments,
      arrowSpecs: Array.isArray(geometry.arrowSpecs) ? geometry.arrowSpecs : [],
      labelPosition: geometry.labelPosition?.clone?.() || null,
      // Angle value changes are driven from the moving arc end.
      draggableRoles: new Set(['end']),
      drag: {
        kind: 'angle',
        vertex: vertex.clone(),
        axis: normal.clone(),
        startDirection: startDir.clone(),
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
      },
    };
  }

  #trimAngleArcPointsForConeTip(arcPoints) {
    if (!Array.isArray(arcPoints) || arcPoints.length < 2) return [];
    const out = arcPoints.map((pt) => pt?.clone?.()).filter(Boolean);
    if (out.length < 2) return [];

    const tip = out[out.length - 1];
    if (!tip) return out;
    const trimDistance = this.#arrowTrimDistanceAtTip(tip);
    if (!trimDistance) return out;

    let remaining = trimDistance;
    let idx = out.length - 1;
    while (idx > 0 && remaining > EPS) {
      const a = out[idx - 1];
      const b = out[idx];
      if (!a || !b) {
        out.splice(idx, 1);
        idx -= 1;
        continue;
      }
      const segLen = a.distanceTo(b);
      if (!(segLen > EPS)) {
        out.splice(idx, 1);
        idx -= 1;
        continue;
      }
      if (remaining >= (segLen - EPS)) {
        out.splice(idx, 1);
        remaining -= segLen;
        idx -= 1;
        continue;
      }

      const t = (segLen - remaining) / segLen;
      out[idx] = a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));
      remaining = 0;
      break;
    }

    return out.length >= 2 ? out : [];
  }

  #handleLabelClick(idx, ann, ev) {
    void ann;
    if (!idx || !this._active) return;
    const id = String(idx);
    const record = this._labelRecords.get(id);
    if (!record) return;

    try {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      ev?.stopImmediatePropagation?.();
    } catch { }

    if (this.onFieldFocus) {
      this.onFieldFocus({
        entryId: this._active.entryId,
        fieldKey: record.annotation.fieldKey,
      });
    }
  }

  #handleCanvasPointerDown(event) {
    if (!this._active || !event || event.button !== 0) return;
    if (!Array.isArray(this._arrowPickMeshes) || this._arrowPickMeshes.length === 0) return;

    const hit = this.#pickArrow(event);
    if (!hit) return;

    const meta = this.#arrowMetaFromHit(hit.object);
    if (!meta) return;

    const record = this._labelRecords.get(meta.annotationId);
    const annotation = record?.annotation;
    if (!annotation || !annotation.drag) return;
    if (annotation.draggableRoles instanceof Set && !annotation.draggableRoles.has(meta.role)) return;

    const dragState = this.#createDragState(annotation, event);
    if (!dragState) return;

    try {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    } catch { }

    this._dragState = dragState;
    const controls = this.viewer?.controls || null;
    this._dragState.controls = controls;
    this._dragState.prevControlsEnabled = controls ? controls.enabled !== false : false;
    try { if (controls) controls.enabled = false; } catch { }
    this.#refreshViewerHover(event);

    try { window.addEventListener('pointermove', this._onGlobalPointerMove, true); } catch { }
    try { window.addEventListener('pointerup', this._onGlobalPointerUp, true); } catch { }
  }

  #handleGlobalPointerMove(event) {
    const state = this._dragState;
    if (!state) return;

    const hit = this.#intersectPointerWithPlane(event, state.plane);
    if (!hit) return;

    if (state.kind === 'linear') {
      let next = state.startValue + hit.clone().sub(state.startPoint).dot(state.direction);
      next = snapToIncrement(next, LINEAR_DRAG_SNAP_STEP);
      if (Number.isFinite(state.min)) next = Math.max(state.min, next);
      if (Number.isFinite(state.max)) next = Math.min(state.max, next);
      if (!Number.isFinite(next)) return;
      this.#applyDraggedValue(state.annotation, next, false);
      return;
    }

    if (state.kind === 'angle') {
      const vec = hit.clone().sub(state.vertex);
      vec.addScaledVector(state.axis, -vec.dot(state.axis));
      if (vec.lengthSq() <= EPS) return;
      vec.normalize();

      const cross = new THREE.Vector3().crossVectors(state.startDirection, vec);
      const sinVal = cross.dot(state.axis);
      const cosVal = THREE.MathUtils.clamp(state.startDirection.dot(vec), -1, 1);
      const rawDeg = THREE.MathUtils.radToDeg(Math.atan2(sinVal, cosVal));
      const unwrapReference = Number.isFinite(state.lastValue) ? state.lastValue : state.startValue;
      let next = this.#unwrapAngleDegrees(rawDeg, unwrapReference);
      next = snapToIncrement(next, ANGLE_DRAG_SNAP_STEP);
      if (Number.isFinite(state.min)) next = Math.max(state.min, next);
      if (Number.isFinite(state.max)) next = Math.min(state.max, next);
      if (!Number.isFinite(next)) return;
      state.lastValue = next;
      this.#applyDraggedValue(state.annotation, next, false);
    }
  }

  #handleGlobalPointerUp(event) {
    const state = this._dragState;
    if (!state) return;

    this.#endDragSession();
    this.#refreshViewerHover(event);
    const annotation = state.annotation;
    if (!annotation || !this._active) return;

    const currentValue = this.#resolveNumericInputParam(
      this._active.entry?.inputParams,
      annotation.fieldKey,
      annotation.value,
    );
    this.#emitFieldChange({
      entryId: this._active.entryId,
      fieldKey: annotation.fieldKey,
      value: currentValue,
      commit: true,
    });

    try {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
    } catch { }
  }

  #endDragSession() {
    const state = this._dragState;
    if (!state) return;

    try { window.removeEventListener('pointermove', this._onGlobalPointerMove, true); } catch { }
    try { window.removeEventListener('pointerup', this._onGlobalPointerUp, true); } catch { }

    try { if (state.controls) state.controls.enabled = state.prevControlsEnabled; } catch { }
    this._dragState = null;
  }

  #applyDraggedValue(annotation, value, commit) {
    if (!annotation || !this._active) return;
    if (!Number.isFinite(value)) return;

    const rounded = Number(value.toFixed(6));
    const current = this.#resolveNumericInputParam(
      this._active.entry?.inputParams,
      annotation.fieldKey,
      Number.NaN,
    );
    if (Number.isFinite(current) && Math.abs(current - rounded) <= 1e-6 && !commit) return;

    const params = this._active.entry?.inputParams;
    if (!params || typeof params !== 'object') return;

    params[annotation.fieldKey] = rounded;
    const exprMap = (params.__expr && typeof params.__expr === 'object') ? params.__expr : null;
    if (exprMap && Object.prototype.hasOwnProperty.call(exprMap, annotation.fieldKey)) {
      try { delete exprMap[annotation.fieldKey]; } catch { }
    }

    try { this._active.form?.refreshFromParams?.(); } catch { }

    this.#emitFieldChange({
      entryId: this._active.entryId,
      fieldKey: annotation.fieldKey,
      value: rounded,
      commit: Boolean(commit),
    });

    this.refresh();
  }

  #emitFieldChange(payload = {}) {
    if (!this.onFieldChange) return;
    const commit = !!payload?.commit;
    if (commit) {
      this.#cancelQueuedFieldChange();
      this._lastFieldChangeDispatchAt = nowMs();
      try { this.onFieldChange(payload); } catch { /* ignore */ }
      return;
    }

    const now = nowMs();
    const elapsed = now - this._lastFieldChangeDispatchAt;
    if (!this._throttledFieldChangeTimer && elapsed >= DRAG_FIELD_CHANGE_THROTTLE_MS) {
      this._lastFieldChangeDispatchAt = now;
      try { this.onFieldChange(payload); } catch { /* ignore */ }
      return;
    }

    this._pendingFieldChangePayload = payload;
    if (this._throttledFieldChangeTimer) return;

    const wait = Math.max(0, DRAG_FIELD_CHANGE_THROTTLE_MS - Math.max(0, elapsed));
    this._throttledFieldChangeTimer = setTimeout(() => {
      this._throttledFieldChangeTimer = null;
      const nextPayload = this._pendingFieldChangePayload;
      this._pendingFieldChangePayload = null;
      if (!nextPayload) return;
      this._lastFieldChangeDispatchAt = nowMs();
      try { this.onFieldChange(nextPayload); } catch { /* ignore */ }
    }, wait);
  }

  #cancelQueuedFieldChange() {
    if (this._throttledFieldChangeTimer) {
      try { clearTimeout(this._throttledFieldChangeTimer); } catch { /* ignore */ }
    }
    this._throttledFieldChangeTimer = null;
    this._pendingFieldChangePayload = null;
  }

  #createDragState(annotation, pointerDownEvent = null) {
    if (!annotation?.drag) return null;

    if (annotation.drag.kind === 'linear') {
      const anchor = annotation.drag.anchor?.clone?.();
      const direction = annotation.drag.direction?.clone?.();
      if (!anchor || !direction || direction.lengthSq() <= EPS) return null;
      direction.normalize();

      const cameraDir = this.#viewerViewNormal();
      let planeNormal = cameraDir?.clone?.() || null;
      if (!planeNormal || planeNormal.lengthSq() <= EPS) planeNormal = this.#arbitraryPerpendicular(direction);
      if (planeNormal.lengthSq() <= EPS) return null;
      planeNormal.normalize();

      const value = this.#resolveNumericInputParam(
        this._active?.entry?.inputParams,
        annotation.fieldKey,
        annotation.value,
      );
      const planePoint = anchor.clone().addScaledVector(direction, value);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
      const startPoint = this.#intersectPointerWithPlane(pointerDownEvent, plane);
      if (!startPoint) return null;

      return {
        kind: 'linear',
        annotation,
        plane,
        startPoint,
        startValue: value,
        anchor,
        direction,
        min: annotation.drag.min,
        max: annotation.drag.max,
      };
    }

    if (annotation.drag.kind === 'angle') {
      const vertex = annotation.drag.vertex?.clone?.();
      const axis = annotation.drag.axis?.clone?.();
      const startDirection = annotation.drag.startDirection?.clone?.();
      if (!vertex || !axis || !startDirection) return null;
      if (axis.lengthSq() <= EPS || startDirection.lengthSq() <= EPS) return null;
      axis.normalize();
      startDirection.normalize();
      const startValue = this.#resolveNumericInputParam(
        this._active?.entry?.inputParams,
        annotation.fieldKey,
        annotation.value,
      );

      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, vertex);
      return {
        kind: 'angle',
        annotation,
        plane,
        vertex,
        axis,
        startDirection,
        startValue,
        lastValue: startValue,
        min: annotation.drag.min,
        max: annotation.drag.max,
      };
    }

    return null;
  }

  #upsertVisual(annotation, color = FEATURE_LINE_COLOR) {
    const segments = Array.isArray(annotation?.segments) ? annotation.segments : [];
    const arrows = Array.isArray(annotation?.arrowSpecs) ? annotation.arrowSpecs : [];

    if (segments.length > 0) this.#upsertLines(annotation.id, segments, color);
    else this.#removeLine(annotation.id);

    this.#upsertArrows(annotation, arrows);
  }

  #upsertLines(annotationId, segments, color = FEATURE_LINE_COLOR) {
    if (!this._group || !Array.isArray(segments) || segments.length === 0) return;
    if (!this._group.parent) {
      try { this.viewer?.scene?.add(this._group); } catch { }
    }
    const lineWidthPx = this.#resolveGizmoLineWidthPx(segments);

    let line = this._lineMap.get(annotationId);
    if (line && !line.isLineSegments2) {
      this.#removeLine(annotationId);
      line = null;
    }

    if (!line) {
      const geometry = new LineSegmentsGeometry();
      const material = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: lineWidthPx,
        transparent: true,
        opacity: 0.95,
        dashed: false,
        worldUnits: false,
        depthTest: false,
        depthWrite: false,
      });
      try {
        const rect = this.viewer?.renderer?.domElement?.getBoundingClientRect?.();
        if (rect?.width > 0 && rect?.height > 0) material.resolution.set(rect.width, rect.height);
      } catch { /* ignore */ }
      line = new LineSegments2(geometry, material);
      line.name = `feature-dimension-line-${annotationId}`;
      line.renderOrder = 9999;
      line.userData.excludeFromFit = true;
      try { this._group.add(line); } catch { }
      this._lineMap.set(annotationId, line);
    } else if (line.material) {
      try { line.material.color?.set?.(color); } catch { }
      try { line.material.linewidth = lineWidthPx; } catch { /* ignore */ }
      try {
        const rect = this.viewer?.renderer?.domElement?.getBoundingClientRect?.();
        if (rect?.width > 0 && rect?.height > 0) line.material.resolution?.set?.(rect.width, rect.height);
      } catch { /* ignore */ }
      try { line.material.needsUpdate = true; } catch { }
    }

    const flatPositions = [];
    for (const [start, end] of segments) {
      if (!start || !end) continue;
      flatPositions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }

    if (flatPositions.length < 6) {
      this.#removeLine(annotationId);
      return;
    }
    try {
      line.geometry?.dispose?.();
      line.geometry = new LineSegmentsGeometry();
      line.geometry.setPositions(flatPositions);
      line.computeLineDistances?.();
      line.geometry.computeBoundingSphere?.();
    } catch {
      this.#removeLine(annotationId);
      return;
    }
  }

  #upsertArrows(annotation, specs) {
    const annotationId = annotation?.id;
    if (!annotationId) return;

    if (!Array.isArray(specs) || specs.length === 0) {
      this.#removeArrows(annotationId);
      return;
    }

    if (!this._group?.parent) {
      try { this.viewer?.scene?.add?.(this._group); } catch { }
    }

    let group = this._arrowGroupMap.get(annotationId);
    if (!group) {
      group = new THREE.Group();
      group.name = `feature-dimension-arrows-${annotationId}`;
      group.renderOrder = 9996;
      group.userData.excludeFromFit = true;
      try { this._group?.add(group); } catch { }
      this._arrowGroupMap.set(annotationId, group);
    }

    const children = Array.from(group.children || []);
    for (const child of children) {
      try { group.remove(child); } catch { }
      try { child.geometry?.dispose?.(); } catch { }
      try { child.material?.dispose?.(); } catch { }
    }

    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      const tip = spec?.tip;
      if (!tip) continue;
      const role = roleForArrowIndex(i, specs.length);
      const isDraggable = annotation?.draggableRoles instanceof Set
        ? annotation.draggableRoles.has(role)
        : true;
      const arrowColor = isDraggable ? DRAGGABLE_TIP_COLOR : STATIONARY_TIP_COLOR;
      const handleDims = this.#gizmoHandleDimensionsAt(tip);

      const arrowLength = handleDims.arrowLength;
      const arrowWidth = handleDims.arrowRadius;
      const direction = this.#resolveArrowDirection(annotation, spec, arrowLength);
      if (!direction) continue;
      spec.direction = direction.clone();

      const meta = {
        annotationId,
        fieldKey: annotation.fieldKey,
        role,
        draggable: isDraggable,
      };
      if (isDraggable) {
        const mesh = addArrowCone(group, tip, direction, arrowLength, arrowWidth, arrowColor);
        if (!mesh) continue;
        mesh.name = `feature-dimension-arrow-${annotationId}-${i}`;
        mesh.userData.excludeFromFit = true;
        mesh.userData.featureDimension = meta;
        this._arrowPickMeshes.push(mesh);
      } else {
        const sphereRadius = handleDims.sphereRadius;
        const sphere = makeOverlaySphere(sphereRadius, STATIONARY_TIP_COLOR);
        if (!sphere) continue;
        sphere.name = `feature-dimension-arrow-sphere-${annotationId}-${i}`;
        sphere.position.copy(tip);
        sphere.renderOrder = 9996;
        sphere.userData.excludeFromFit = true;
        sphere.userData.featureDimension = meta;
        try { group.add(sphere); } catch { /* ignore */ }
        continue;
      }

      // Use a larger transparent hit volume to make tip dragging easier.
      const pickRadius = Math.max(handleDims.arrowRadius * 1.8, handleDims.sphereRadius * 1.8);
      const pickGeometry = new THREE.SphereGeometry(pickRadius, 10, 10);
      const pickMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const pickMesh = new THREE.Mesh(pickGeometry, pickMaterial);
      pickMesh.name = `feature-dimension-arrow-pick-${annotationId}-${i}`;
      pickMesh.position.copy(tip);
      pickMesh.renderOrder = 9997;
      pickMesh.userData.excludeFromFit = true;
      pickMesh.userData.featureDimension = meta;
      try { group.add(pickMesh); } catch { /* ignore */ }
      this._arrowPickMeshes.push(pickMesh);
    }

    if (!group.children.length) {
      this.#removeArrows(annotationId);
    }
  }

  #resolveArrowDirection(annotation, spec, arrowLength) {
    const rawDirection = spec?.direction?.clone?.();
    if (!rawDirection || rawDirection.lengthSq() <= EPS) return null;
    rawDirection.normalize();

    // Angle arrowheads should visually "sit on" the arc:
    // keep the tip fixed, move the cone base back along the arc by arrow length,
    // then use that chord direction for the cone axis.
    if (annotation?.drag?.kind !== 'angle') return rawDirection;
    const tip = spec?.tip?.clone?.();
    const vertex = annotation?.drag?.vertex?.clone?.();
    const axis = annotation?.drag?.axis?.clone?.();
    if (!tip || !vertex || !axis || axis.lengthSq() <= EPS) return rawDirection;
    axis.normalize();

    const radiusDir = tip.sub(vertex);
    radiusDir.addScaledVector(axis, -radiusDir.dot(axis));
    const radius = radiusDir.length();
    if (!(radius > EPS)) return rawDirection;
    radiusDir.multiplyScalar(1 / radius);

    let tangent = new THREE.Vector3().crossVectors(axis, radiusDir);
    if (tangent.lengthSq() <= EPS) return rawDirection;
    tangent.normalize();

    let alongSign = Math.sign(rawDirection.dot(tangent));
    if (!Number.isFinite(alongSign) || alongSign === 0) alongSign = 1;

    const safeArrowLength = Number(arrowLength);
    if (!(Number.isFinite(safeArrowLength) && safeArrowLength > EPS)) {
      return tangent.multiplyScalar(alongSign);
    }

    const delta = Math.max(1e-4, Math.min(safeArrowLength / radius, Math.PI * 0.5));
    const baseRadiusDir = radiusDir.clone().applyAxisAngle(axis, -alongSign * delta);
    const chordDirection = radiusDir.clone().sub(baseRadiusDir);
    if (chordDirection.lengthSq() <= EPS) {
      return tangent.multiplyScalar(alongSign);
    }
    return chordDirection.normalize();
  }

  #removeVisual(annotationId) {
    this.#removeLine(annotationId);
    this.#removeArrows(annotationId);
  }

  #removeLine(annotationId) {
    const line = this._lineMap.get(annotationId);
    if (!line) return;
    try { line.parent?.remove?.(line); } catch { }
    try { line.geometry?.dispose?.(); } catch { }
    try { line.material?.dispose?.(); } catch { }
    this._lineMap.delete(annotationId);
  }

  #removeArrows(annotationId) {
    const group = this._arrowGroupMap.get(annotationId);
    if (!group) return;

    const children = Array.from(group.children || []);
    for (const child of children) {
      try { group.remove(child); } catch { }
      try { child.geometry?.dispose?.(); } catch { }
      try { child.material?.dispose?.(); } catch { }
    }

    try { group.parent?.remove?.(group); } catch { }
    this._arrowGroupMap.delete(annotationId);

    this._arrowPickMeshes = this._arrowPickMeshes.filter((mesh) => {
      const meta = mesh?.userData?.featureDimension;
      return meta?.annotationId !== annotationId;
    });
  }

  #removeUnusedVisuals(activeIds) {
    for (const annotationId of Array.from(this._lineMap.keys())) {
      if (!activeIds.has(annotationId)) this.#removeLine(annotationId);
    }
    for (const annotationId of Array.from(this._arrowGroupMap.keys())) {
      if (!activeIds.has(annotationId)) this.#removeArrows(annotationId);
    }
  }

  #clearVisuals() {
    for (const annotationId of Array.from(this._lineMap.keys())) {
      this.#removeLine(annotationId);
    }
    for (const annotationId of Array.from(this._arrowGroupMap.keys())) {
      this.#removeArrows(annotationId);
    }
    this._arrowPickMeshes = [];
  }

  #pickArrow(event) {
    const ray = this.#rayFromPointerEvent(event);
    if (!ray) return null;
    const hits = this._raycaster.intersectObjects(this._arrowPickMeshes, true);
    if (!Array.isArray(hits) || hits.length === 0) return null;
    return hits[0] || null;
  }

  #arrowMetaFromHit(object) {
    let current = object;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const meta = current.userData?.featureDimension;
      if (meta && meta.annotationId) return meta;
      current = current.parent;
    }
    return null;
  }

  #intersectPointerWithPlane(event, plane) {
    const ray = this.#rayFromPointerEvent(event);
    if (!ray || !plane) return null;
    const hit = new THREE.Vector3();
    return ray.intersectPlane(plane, hit) ? hit : null;
  }

  #rayFromPointerEvent(event) {
    const camera = this.viewer?.camera || null;
    const domElement = this.viewer?.renderer?.domElement || null;
    if (!camera || !domElement || !event) return null;

    const rect = domElement.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    this._raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    try {
      const ray = this._raycaster.ray;
      if (camera.isOrthographicCamera) {
        ray.origin.add(ray.direction.clone().multiplyScalar(-1000));
      } else if (camera.isPerspectiveCamera) {
        ray.origin.copy(camera.position);
      }
    } catch { }
    return this._raycaster.ray;
  }

  #viewerViewNormal() {
    const camera = this.viewer?.camera || null;
    if (camera && typeof camera.getWorldDirection === 'function') {
      try {
        const dir = camera.getWorldDirection(new THREE.Vector3());
        if (dir.lengthSq() > EPS) return dir.normalize();
      } catch { }
    }
    return new THREE.Vector3(0, 0, 1);
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

  #resolveNumericInputParam(params, fieldKey, fallback = 0) {
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

  #resolveGizmoLineWidthPx(segments = []) {
    let referencePoint = null;
    for (const segment of segments) {
      if (!Array.isArray(segment) || segment.length < 2) continue;
      const start = segment[0];
      const end = segment[1];
      if (!start || !end) continue;
      referencePoint = start.clone().add(end).multiplyScalar(0.5);
      break;
    }
    const dims = this.#gizmoHandleDimensionsAt(referencePoint);
    return this.#worldLengthToPixels(dims.lineRadius * 2, referencePoint);
  }

  #gizmoHandleDimensionsAt(worldPoint = null) {
    const scale = this.#gizmoScaleAt(worldPoint);
    return {
      lineRadius: GIZMO_ROD_RADIUS * scale,
      arrowRadius: GIZMO_ARROW_RADIUS * scale,
      arrowLength: GIZMO_ARROW_LENGTH * scale,
      sphereRadius: GIZMO_DOT_RADIUS * scale,
    };
  }

  #gizmoScaleAt(worldPoint = null) {
    const camera = this.viewer?.camera || null;
    if (!camera) return 1;
    if (camera.isOrthographicCamera) {
      const zoom = Math.max(1e-6, Number(camera.zoom) || 1);
      return GIZMO_SIZE_MULTIPLIER / zoom;
    }
    if (camera.isPerspectiveCamera) {
      const cameraPos = camera.getWorldPosition(new THREE.Vector3());
      let target = worldPoint?.clone?.() || null;
      if (!target) {
        const cameraDir = camera.getWorldDirection(new THREE.Vector3());
        target = cameraPos.clone().addScaledVector(cameraDir, 1);
      }
      const distance = Math.max(cameraPos.distanceTo(target), 1e-4);
      const fovFactor = Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) * 0.5) * 2.0;
      return (distance * fovFactor / 10) * GIZMO_SIZE_MULTIPLIER;
    }
    return 1;
  }

  #worldLengthToPixels(worldLength, worldPoint = null) {
    const length = Number(worldLength);
    if (!Number.isFinite(length) || length <= 0) return 1;

    const camera = this.viewer?.camera || null;
    const rect = this.viewer?.renderer?.domElement?.getBoundingClientRect?.();
    const viewportHeight = Math.max(1, Number(rect?.height) || 1);
    if (!camera) return Math.max(1, length * 100);

    if (camera.isOrthographicCamera) {
      const zoom = Math.max(1e-6, Number(camera.zoom) || 1);
      const span = Math.abs((camera.top - camera.bottom) / zoom);
      const worldPerPixel = span / viewportHeight;
      return Math.max(1, length / Math.max(worldPerPixel, EPS));
    }

    if (camera.isPerspectiveCamera) {
      const cameraPos = camera.getWorldPosition(new THREE.Vector3());
      const cameraDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
      const point = worldPoint?.clone?.() || cameraPos.clone().addScaledVector(cameraDir, 1);
      let depth = point.clone().sub(cameraPos).dot(cameraDir);
      if (!Number.isFinite(depth) || depth <= 1e-6) depth = cameraPos.distanceTo(point);
      depth = Math.max(depth, 1e-6);
      const fovRad = THREE.MathUtils.degToRad(camera.fov || 50);
      const worldPerPixel = (2 * Math.tan(fovRad * 0.5) * depth) / viewportHeight;
      return Math.max(1, length / Math.max(worldPerPixel, EPS));
    }

    return Math.max(1, length * 100);
  }

  #resolveLabelPositionAvoidingArrowHeads(annotation, labelData, initialPosition, labelEl) {
    if (!annotation || !labelData || !initialPosition || !labelEl) return initialPosition;
    const arrowSpecs = Array.isArray(annotation?.arrowSpecs) ? annotation.arrowSpecs : [];
    if (!arrowSpecs.length) return initialPosition;

    let position = initialPosition.clone();
    let currentLabelEl = labelEl;

    for (let i = 0; i < LABEL_ARROW_AVOID_MAX_ITERS; i += 1) {
      const push = this.#computeArrowLabelPushPixels(annotation, currentLabelEl);
      if (!push) break;

      const worldDelta = this.#screenDeltaToWorld(position, push.dx, push.dy);
      if (!worldDelta || worldDelta.lengthSq() <= EPS) break;
      position = position.clone().add(worldDelta);

      try { this._labelOverlay?.updateLabel?.(annotation.id, annotation.text, position.clone(), labelData); } catch { break; }
      currentLabelEl = this._labelOverlay?.getElement?.(annotation.id) || currentLabelEl;
    }

    return position;
  }

  #computeArrowLabelPushPixels(annotation, labelEl) {
    if (!annotation || !labelEl) return null;
    const arrowSpecs = Array.isArray(annotation?.arrowSpecs) ? annotation.arrowSpecs : [];
    if (!arrowSpecs.length) return null;

    const rect = labelEl.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    const centerX = rect.left + (rect.width * 0.5);
    const centerY = rect.top + (rect.height * 0.5);
    const labelRadiusPx = Math.hypot(rect.width * 0.5, rect.height * 0.5);

    let sumDx = 0;
    let sumDy = 0;
    let overlapCount = 0;
    let maxPenetration = 0;

    for (const spec of arrowSpecs) {
      const shape = this.#arrowScreenShape(spec);
      if (!shape) continue;
      const nearest = this.#nearestPointOnSegment2D(
        centerX,
        centerY,
        shape.tipX,
        shape.tipY,
        shape.baseX,
        shape.baseY,
      );
      if (!nearest) continue;

      const avoidRadius = labelRadiusPx + shape.bodyRadiusPx + LABEL_ARROW_CLEARANCE_PX;
      const offsetX = centerX - nearest.x;
      const offsetY = centerY - nearest.y;
      const distanceToAxis = Math.hypot(offsetX, offsetY);
      const penetration = avoidRadius - distanceToAxis;
      if (!(penetration > 0)) continue;

      overlapCount += 1;
      maxPenetration = Math.max(maxPenetration, penetration);

      let pushX = offsetX;
      let pushY = offsetY;
      let pushLen = Math.hypot(pushX, pushY);
      if (pushLen <= 1e-4) {
        pushX = centerX - shape.tipX;
        pushY = centerY - shape.tipY;
        pushLen = Math.hypot(pushX, pushY);
      }
      if (pushLen <= 1e-4) {
        pushX = 0;
        pushY = -1;
        pushLen = 1;
      }

      const weight = penetration + 1.5;
      sumDx += (pushX / pushLen) * weight;
      sumDy += (pushY / pushLen) * weight;
    }

    if (!overlapCount) return null;

    let pushLen = Math.hypot(sumDx, sumDy);
    if (pushLen <= 1e-4) {
      return { dx: 0, dy: -Math.max(4, maxPenetration + LABEL_ARROW_CLEARANCE_PX) };
    }

    if (pushLen > LABEL_ARROW_AVOID_MAX_PUSH_PX) {
      const scale = LABEL_ARROW_AVOID_MAX_PUSH_PX / pushLen;
      sumDx *= scale;
      sumDy *= scale;
      pushLen *= scale;
    }

    if (pushLen <= 1e-4) return null;
    return { dx: sumDx, dy: sumDy };
  }

  #arrowScreenShape(spec) {
    const tip = spec?.tip;
    const direction = spec?.direction;
    if (!tip?.clone || !direction?.clone) return null;

    const dirNorm = direction.clone();
    if (dirNorm.lengthSq() <= EPS) return null;
    dirNorm.normalize();

    const handleDims = this.#gizmoHandleDimensionsAt(tip);
    const arrowLengthWorld = Math.max(0, Number(handleDims?.arrowLength) || 0);
    const arrowRadiusWorld = Math.max(0, Number(handleDims?.arrowRadius) || 0);
    if (!(arrowLengthWorld > 0)) return null;

    const tipScreen = this.#worldToScreenPoint(tip);
    if (!tipScreen) return null;

    const baseWorld = tip.clone().addScaledVector(dirNorm, -arrowLengthWorld);
    let baseScreen = this.#worldToScreenPoint(baseWorld);
    const arrowLengthPx = this.#worldLengthToPixels(arrowLengthWorld, tip);
    if (!baseScreen) {
      const aheadWorld = tip.clone().add(dirNorm);
      const aheadScreen = this.#worldToScreenPoint(aheadWorld);
      if (!aheadScreen) return null;
      let dirX = aheadScreen.x - tipScreen.x;
      let dirY = aheadScreen.y - tipScreen.y;
      const dirLen = Math.hypot(dirX, dirY);
      if (dirLen <= 1e-4) return null;
      dirX /= dirLen;
      dirY /= dirLen;
      baseScreen = {
        x: tipScreen.x - (dirX * arrowLengthPx),
        y: tipScreen.y - (dirY * arrowLengthPx),
      };
    }

    const bodyRadiusPx = Math.max(5, this.#worldLengthToPixels(arrowRadiusWorld, tip));
    return {
      tipX: tipScreen.x,
      tipY: tipScreen.y,
      baseX: baseScreen.x,
      baseY: baseScreen.y,
      bodyRadiusPx,
    };
  }

  #nearestPointOnSegment2D(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const abLenSq = (abx * abx) + (aby * aby);
    if (!(abLenSq > 1e-8)) return { x: ax, y: ay, t: 0 };

    const apx = px - ax;
    const apy = py - ay;
    let t = ((apx * abx) + (apy * aby)) / abLenSq;
    if (!Number.isFinite(t)) t = 0;
    t = Math.max(0, Math.min(1, t));
    return {
      x: ax + (abx * t),
      y: ay + (aby * t),
      t,
    };
  }

  #worldToScreenPoint(worldPoint) {
    const camera = this.viewer?.camera || null;
    const domElement = this.viewer?.renderer?.domElement || null;
    if (!camera || !domElement || !worldPoint?.clone) return null;

    const rect = domElement.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    const projected = worldPoint.clone().project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
      return null;
    }
    if (projected.z < -1.5 || projected.z > 1.5) return null;

    return {
      x: rect.left + ((projected.x * 0.5 + 0.5) * rect.width),
      y: rect.top + ((-projected.y * 0.5 + 0.5) * rect.height),
      z: projected.z,
    };
  }

  #screenDeltaToWorld(worldPoint, dxPx, dyPx) {
    const camera = this.viewer?.camera || null;
    const domElement = this.viewer?.renderer?.domElement || null;
    const dx = Number(dxPx);
    const dy = Number(dyPx);
    if (!camera || !domElement || !worldPoint?.clone || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;

    const rect = domElement.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    const baseNdc = worldPoint.clone().project(camera);
    if (!Number.isFinite(baseNdc.x) || !Number.isFinite(baseNdc.y) || !Number.isFinite(baseNdc.z)) return null;

    const shiftedNdc = new THREE.Vector3(
      baseNdc.x + ((dx / rect.width) * 2),
      baseNdc.y - ((dy / rect.height) * 2),
      baseNdc.z,
    );

    const baseWorld = new THREE.Vector3(baseNdc.x, baseNdc.y, baseNdc.z).unproject(camera);
    const shiftedWorld = shiftedNdc.unproject(camera);
    if (!baseWorld || !shiftedWorld) return null;
    return shiftedWorld.sub(baseWorld);
  }

  #unwrapAngleDegrees(rawDeg, referenceDeg = 0) {
    const raw = Number(rawDeg);
    const reference = Number(referenceDeg);
    if (!Number.isFinite(raw)) return raw;
    if (!Number.isFinite(reference)) return raw;

    const candidates = [raw, raw + 360, raw - 360];
    let best = candidates[0];
    let bestDelta = Math.abs(best - reference);
    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const delta = Math.abs(candidate - reference);
      if (delta < bestDelta) {
        best = candidate;
        bestDelta = delta;
      }
    }
    return best;
  }

  #refreshViewerHover(event = null) {
    const viewer = this.viewer || null;
    if (!viewer || typeof viewer._updateHover !== 'function') return;
    const nextEvent = event || viewer._lastPointerEvent || null;
    if (!nextEvent) return;
    try { viewer._lastPointerEvent = nextEvent; } catch { }
    try { viewer._updateHover(nextEvent); } catch { }
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

  #requestRender() {
    try { this.viewer?.render?.(); } catch { }
  }
}
