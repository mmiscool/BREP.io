import * as THREE from 'three';
import { allowSceneOverlayRemoval, markSceneOverlayObject } from '../UI/sceneOverlayUtils.js';
import type {
  CamCutterDefinition,
  CamCutterOrientation,
  CamPoint3,
  CamToolpathProgram,
  CamToolpathSegment,
} from './CamToolpathDefinition.js';

export const CAM_TOOLPATH_SIMULATOR_GROUP_NAME = '__CAM_TOOLPATH_SIMULATOR__';
export const CAM_TOOLPATH_TOOL_HEAD_NAME = '__CAM_TOOLPATH_TOOL_HEAD__';

type AnyRecord = Record<string, any>;

type SimSegment = {
  index: number;
  pathId: string;
  segmentId: string;
  kind: string;
  start: CamPoint3;
  end: CamPoint3;
  length: number;
  startDistance: number;
  endDistance: number;
  cutter: CamCutterDefinition | null;
  orientation: CamCutterOrientation | null;
};

type CamToolpathSimulatorOptions = {
  viewer?: AnyRecord | null;
  scene?: THREE.Scene | null;
  playbackUnitsPerSecond?: number;
  onStateChange?: (state: CamToolpathSimulatorState) => void;
};

export type CamToolpathSimulatorState = {
  hasProgram: boolean;
  playing: boolean;
  progress: number;
  step: number;
  totalSteps: number;
  totalLength: number;
  currentPosition: CamPoint3 | null;
  currentSegment: {
    index: number;
    pathId: string;
    segmentId: string;
    kind: string;
  } | null;
};

function finiteNumber(value: any, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function machinePointToSceneVector(point: CamPoint3): THREE.Vector3 {
  return new THREE.Vector3(
    finiteNumber(point?.[0], 0),
    finiteNumber(point?.[2], 0),
    finiteNumber(point?.[1], 0),
  );
}

function machineVectorToSceneVector(point: CamPoint3): THREE.Vector3 {
  const out = machinePointToSceneVector(point);
  if (out.lengthSq() <= 1e-12) out.set(0, -1, 0);
  return out.normalize();
}

function pointDistance(a: CamPoint3, b: CamPoint3) {
  return Math.hypot(
    finiteNumber(b?.[0], 0) - finiteNumber(a?.[0], 0),
    finiteNumber(b?.[1], 0) - finiteNumber(a?.[1], 0),
    finiteNumber(b?.[2], 0) - finiteNumber(a?.[2], 0),
  );
}

function interpolatePoint(a: CamPoint3, b: CamPoint3, t: number): CamPoint3 {
  const u = clamp01(t);
  return [
    finiteNumber(a?.[0], 0) + (finiteNumber(b?.[0], 0) - finiteNumber(a?.[0], 0)) * u,
    finiteNumber(a?.[1], 0) + (finiteNumber(b?.[1], 0) - finiteNumber(a?.[1], 0)) * u,
    finiteNumber(a?.[2], 0) + (finiteNumber(b?.[2], 0) - finiteNumber(a?.[2], 0)) * u,
  ];
}

function segmentCutter(path: AnyRecord, segment: CamToolpathSegment): CamCutterDefinition | null {
  return (segment?.cutter || path?.cutter || null) as CamCutterDefinition | null;
}

function segmentOrientation(path: AnyRecord, segment: CamToolpathSegment): CamCutterOrientation | null {
  return (segment?.orientation || path?.defaultOrientation || null) as CamCutterOrientation | null;
}

export function flattenCamToolpathProgram(program: CamToolpathProgram | null | undefined): SimSegment[] {
  const out: SimSegment[] = [];
  let distance = 0;
  for (const path of Array.isArray(program?.paths) ? program.paths : []) {
    const points = Array.isArray(path?.points) ? path.points : [];
    for (const segment of Array.isArray(path?.segments) ? path.segments : []) {
      const start = points[segment.startIndex]?.position;
      const end = points[segment.endIndex]?.position;
      if (!Array.isArray(start) || !Array.isArray(end)) continue;
      const length = pointDistance(start, end);
      if (!(length > 1e-9)) continue;
      out.push({
        index: out.length,
        pathId: String(path.id || ''),
        segmentId: String(segment.id || ''),
        kind: String(segment.kind || 'cut'),
        start,
        end,
        length,
        startDistance: distance,
        endDistance: distance + length,
        cutter: segmentCutter(path, segment),
        orientation: segmentOrientation(path, segment),
      });
      distance += length;
    }
  }
  return out;
}

function disposeObjectTree(object: any) {
  if (!object) return;
  const children = Array.isArray(object.children) ? object.children.slice() : [];
  for (const child of children) disposeObjectTree(child);
  try { object.parent?.remove?.(object); } catch { /* ignore scene detach failures */ }
  try { object.geometry?.dispose?.(); } catch { /* ignore geometry cleanup failures */ }
  const material = object.material;
  if (Array.isArray(material)) {
    for (const entry of material) {
      try { entry?.dispose?.(); } catch { /* ignore material cleanup failures */ }
    }
  } else {
    try { material?.dispose?.(); } catch { /* ignore material cleanup failures */ }
  }
}

export function clearCamToolpathSimulatorOverlay(scene: THREE.Scene | null | undefined) {
  const existing = scene?.getObjectByName?.(CAM_TOOLPATH_SIMULATOR_GROUP_NAME);
  if (!existing) return false;
  allowSceneOverlayRemoval(existing as any, { deep: true });
  disposeObjectTree(existing);
  return true;
}

function makeBallNoseProfileGeometry(radius: number) {
  const positions: number[] = [];
  const appendSegment = (a: THREE.Vector3, b: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const appendPolyline = (points: THREE.Vector3[], closed = false) => {
    for (let index = 0; index + 1 < points.length; index += 1) appendSegment(points[index], points[index + 1]);
    if (closed && points.length > 1) appendSegment(points[points.length - 1], points[0]);
  };
  const steps = 48;
  const xMeridian: THREE.Vector3[] = [];
  const zMeridian: THREE.Vector3[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = Math.PI + ((Math.PI * step) / steps);
    const radial = radius * Math.cos(angle);
    const y = radius + (radius * Math.sin(angle));
    xMeridian.push(new THREE.Vector3(radial, y, 0));
    zMeridian.push(new THREE.Vector3(0, y, radial));
  }
  appendPolyline(xMeridian);
  appendPolyline(zMeridian);

  for (const y of [radius, radius * 0.5]) {
    const dy = y - radius;
    const ringRadius = Math.sqrt(Math.max(0, (radius * radius) - (dy * dy)));
    const ring: THREE.Vector3[] = [];
    for (let step = 0; step < steps; step += 1) {
      const angle = (Math.PI * 2 * step) / steps;
      ring.push(new THREE.Vector3(ringRadius * Math.cos(angle), y, ringRadius * Math.sin(angle)));
    }
    appendPolyline(ring, true);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class CamToolpathSimulator {
  viewer: AnyRecord | null;
  scene: THREE.Scene | null;
  playbackUnitsPerSecond: number;
  onStateChange: ((state: CamToolpathSimulatorState) => void) | null;
  group: THREE.Group | null = null;
  toolHead: THREE.Group | null = null;
  fullLine: THREE.LineSegments | null = null;
  traveledLine: THREE.LineSegments | null = null;
  traveledPositions: Float32Array | null = null;
  fullPositions: Float32Array | null = null;
  segments: SimSegment[] = [];
  totalLength = 0;
  distance = 0;
  progress = 0;
  playing = false;
  _raf: number | null = null;
  _lastFrameMs = 0;
  _toolCutterKey = '';
  _currentPosition: CamPoint3 | null = null;

  constructor(options: CamToolpathSimulatorOptions = {}) {
    this.viewer = options.viewer || null;
    this.scene = options.scene || options.viewer?.partHistory?.scene || options.viewer?.scene || null;
    this.playbackUnitsPerSecond = Math.max(1, finiteNumber(options.playbackUnitsPerSecond, 60));
    this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
  }

  setProgram(program: CamToolpathProgram | null | undefined) {
    this.pause();
    this._clearOverlay();
    this.segments = flattenCamToolpathProgram(program);
    this.totalLength = this.segments.length ? this.segments[this.segments.length - 1].endDistance : 0;
    this.distance = 0;
    this.progress = 0;
    this._currentPosition = this.segments[0]?.start || null;
    if (this.segments.length && this.scene) this._buildOverlay();
    this._applyDistance(0);
    this._notify();
    this._requestRender();
  }

  clear() {
    this.pause();
    this._clearOverlay();
    this.segments = [];
    this.totalLength = 0;
    this.distance = 0;
    this.progress = 0;
    this._currentPosition = null;
    this._notify();
    this._requestRender();
  }

  dispose() {
    this.clear();
    this.onStateChange = null;
    this.viewer = null;
    this.scene = null;
  }

  play() {
    if (!this.segments.length) return;
    if (this.progress >= 1) this.setProgress(0);
    if (this.playing) return;
    this.playing = true;
    this._lastFrameMs = 0;
    this._notify();
    this._scheduleFrame();
  }

  pause() {
    if (this._raf != null && typeof cancelAnimationFrame === 'function') {
      try { cancelAnimationFrame(this._raf); } catch { /* ignore RAF cleanup failures */ }
    }
    this._raf = null;
    if (!this.playing) return;
    this.playing = false;
    this._notify();
  }

  stop() {
    this.pause();
    this.setProgress(0);
  }

  setProgress(progress: number) {
    const next = clamp01(progress);
    this.progress = next;
    this.distance = this.totalLength * next;
    this._applyDistance(this.distance);
    this._notify();
    this._requestRender();
  }

  getState(): CamToolpathSimulatorState {
    const index = this._segmentIndexForDistance(this.distance);
    const segment = index >= 0 ? this.segments[index] : null;
    return {
      hasProgram: this.segments.length > 0,
      playing: this.playing,
      progress: this.progress,
      step: this.segments.length ? Math.min(this.segments.length, index + 1) : 0,
      totalSteps: this.segments.length,
      totalLength: this.totalLength,
      currentPosition: this._currentPosition ? [...this._currentPosition] as CamPoint3 : null,
      currentSegment: segment ? {
        index: segment.index,
        pathId: segment.pathId,
        segmentId: segment.segmentId,
        kind: segment.kind,
      } : null,
    };
  }

  _scheduleFrame() {
    if (!this.playing || this._raf != null || typeof requestAnimationFrame !== 'function') return;
    this._raf = requestAnimationFrame((time) => this._tick(time));
  }

  _tick(time: number) {
    this._raf = null;
    if (!this.playing) return;
    const last = this._lastFrameMs || time;
    this._lastFrameMs = time;
    const deltaSeconds = Math.min(0.1, Math.max(0, (time - last) / 1000));
    const nextDistance = this.distance + this.playbackUnitsPerSecond * deltaSeconds;
    if (nextDistance >= this.totalLength) {
      this.distance = this.totalLength;
      this.progress = this.totalLength > 0 ? 1 : 0;
      this._applyDistance(this.distance);
      this.playing = false;
      this._notify();
      this._requestRender();
      return;
    }
    this.distance = nextDistance;
    this.progress = this.totalLength > 0 ? clamp01(this.distance / this.totalLength) : 0;
    this._applyDistance(this.distance);
    this._notify();
    this._requestRender();
    this._scheduleFrame();
  }

  _buildOverlay() {
    if (!this.scene) return;
    clearCamToolpathSimulatorOverlay(this.scene);
    const group = new THREE.Group();
    group.name = CAM_TOOLPATH_SIMULATOR_GROUP_NAME;
    group.renderOrder = 6000;
    group.userData = {
      isCamToolpathSimulator: true,
    };

    const fullPositions = new Float32Array(this.segments.length * 2 * 3);
    this.segments.forEach((segment, index) => {
      const start = machinePointToSceneVector(segment.start);
      const end = machinePointToSceneVector(segment.end);
      const base = index * 6;
      fullPositions[base] = start.x;
      fullPositions[base + 1] = start.y;
      fullPositions[base + 2] = start.z;
      fullPositions[base + 3] = end.x;
      fullPositions[base + 4] = end.y;
      fullPositions[base + 5] = end.z;
    });
    this.fullPositions = fullPositions;
    this.traveledPositions = new Float32Array(fullPositions);

    const fullGeometry = new THREE.BufferGeometry();
    fullGeometry.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));
    const fullMaterial = new THREE.LineBasicMaterial({
      color: 0x00d5ff,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false,
    });
    this.fullLine = new THREE.LineSegments(fullGeometry, fullMaterial);
    this.fullLine.name = '__CAM_TOOLPATH_FULL_LINE__';
    this.fullLine.renderOrder = 6001;
    group.add(this.fullLine);

    const traveledGeometry = new THREE.BufferGeometry();
    traveledGeometry.setAttribute('position', new THREE.BufferAttribute(this.traveledPositions, 3));
    traveledGeometry.setDrawRange(0, 0);
    const traveledMaterial = new THREE.LineBasicMaterial({
      color: 0xffd34d,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    });
    this.traveledLine = new THREE.LineSegments(traveledGeometry, traveledMaterial);
    this.traveledLine.name = '__CAM_TOOLPATH_TRAVELED_LINE__';
    this.traveledLine.renderOrder = 6002;
    group.add(this.traveledLine);

    this.toolHead = new THREE.Group();
    this.toolHead.name = CAM_TOOLPATH_TOOL_HEAD_NAME;
    this.toolHead.renderOrder = 6003;
    group.add(this.toolHead);

    markSceneOverlayObject(group as any, {
      preserve: true,
      excludeFromFit: true,
      overlayType: 'cam-toolpath-simulator',
      deep: true,
    });
    this.scene.add(group);
    this.group = group;
  }

  _clearOverlay() {
    if (this.scene) clearCamToolpathSimulatorOverlay(this.scene);
    this.group = null;
    this.toolHead = null;
    this.fullLine = null;
    this.traveledLine = null;
    this.traveledPositions = null;
    this.fullPositions = null;
    this._toolCutterKey = '';
  }

  _applyDistance(distance: number) {
    if (!this.segments.length) return;
    const index = this._segmentIndexForDistance(distance);
    const segment = this.segments[index] || this.segments[0];
    const localDistance = Math.max(0, Math.min(segment.length, distance - segment.startDistance));
    const point = interpolatePoint(segment.start, segment.end, segment.length > 0 ? localDistance / segment.length : 0);
    this._currentPosition = point;
    this._updateTraveledLine(index, point);
    this._updateToolHead(segment, point);
  }

  _segmentIndexForDistance(distance: number) {
    if (!this.segments.length) return -1;
    if (distance <= 0) return 0;
    if (distance >= this.totalLength) return this.segments.length - 1;
    let low = 0;
    let high = this.segments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const segment = this.segments[mid];
      if (distance < segment.startDistance) high = mid - 1;
      else if (distance > segment.endDistance) low = mid + 1;
      else return mid;
    }
    return Math.max(0, Math.min(this.segments.length - 1, low));
  }

  _updateTraveledLine(segmentIndex: number, currentPoint: CamPoint3) {
    if (!this.traveledLine || !this.traveledPositions || !this.fullPositions || segmentIndex < 0) return;
    const base = segmentIndex * 6;
    this.traveledPositions[base] = this.fullPositions[base];
    this.traveledPositions[base + 1] = this.fullPositions[base + 1];
    this.traveledPositions[base + 2] = this.fullPositions[base + 2];
    const scenePoint = machinePointToSceneVector(currentPoint);
    this.traveledPositions[base + 3] = scenePoint.x;
    this.traveledPositions[base + 4] = scenePoint.y;
    this.traveledPositions[base + 5] = scenePoint.z;
    const positionAttr = this.traveledLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttr.needsUpdate = true;
    this.traveledLine.geometry.setDrawRange(0, Math.min(this.traveledPositions.length / 3, (segmentIndex + 1) * 2));
  }

  _updateToolHead(segment: SimSegment, point: CamPoint3) {
    if (!this.toolHead) return;
    const cutter = segment.cutter || null;
    this._ensureToolGeometry(cutter);
    this.toolHead.position.copy(machinePointToSceneVector(point));
    const axis = machineVectorToSceneVector((segment.orientation?.toolAxis || [0, 0, -1]) as CamPoint3);
    const shankDirection = axis.clone().multiplyScalar(-1).normalize();
    if (shankDirection.lengthSq() <= 1e-12) shankDirection.set(0, 1, 0);
    this.toolHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shankDirection);
  }

  _ensureToolGeometry(cutter: CamCutterDefinition | null) {
    const diameter = Math.max(0.05, finiteNumber(cutter?.diameter, 1));
    const radius = Math.max(0.025, finiteNumber(cutter?.radius, diameter * 0.5));
    const length = Math.max(diameter * 2, finiteNumber(cutter?.cuttingLength ?? cutter?.overallLength, diameter * 6));
    const kind = String(cutter?.kind || 'flat-endmill');
    const key = `${kind}:${radius}:${length}`;
    if (key === this._toolCutterKey && this.toolHead?.children.length) return;
    if (!this.toolHead) return;
    for (const child of this.toolHead.children.slice()) disposeObjectTree(child);
    this._toolCutterKey = key;

    const toolMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const tipMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fc5e8,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    let bodyGeometry: THREE.BufferGeometry;
    let tipGeometry: THREE.BufferGeometry;
    if (kind === 'v-bit') {
      bodyGeometry = new THREE.ConeGeometry(radius, length, 32, 1);
      bodyGeometry.rotateX(Math.PI);
      bodyGeometry.translate(0, length * 0.5, 0);
      tipGeometry = new THREE.SphereGeometry(Math.max(radius * 0.38, 0.04), 16, 8);
    } else if (kind === 'ball-endmill') {
      const bodyLength = Math.max(radius, length - radius);
      bodyGeometry = new THREE.CylinderGeometry(radius, radius, bodyLength, 32, 1, true);
      bodyGeometry.translate(0, radius + (bodyLength * 0.5), 0);
      tipGeometry = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      tipGeometry.translate(0, radius, 0);
    } else {
      bodyGeometry = new THREE.CylinderGeometry(radius, radius, length, 32, 1);
      bodyGeometry.translate(0, length * 0.5, 0);
      tipGeometry = new THREE.SphereGeometry(Math.max(radius * 0.38, 0.04), 16, 8);
    }
    const body = new THREE.Mesh(bodyGeometry, toolMaterial);
    body.name = '__CAM_TOOLPATH_TOOL_BODY__';
    body.renderOrder = 6004;
    this.toolHead.add(body);

    const tip = new THREE.Mesh(tipGeometry, tipMaterial);
    tip.name = '__CAM_TOOLPATH_TOOL_TIP__';
    tip.renderOrder = 6005;
    this.toolHead.add(tip);

    if (kind === 'ball-endmill') {
      const tipOutline = new THREE.LineSegments(
        new THREE.WireframeGeometry(tipGeometry),
        new THREE.LineBasicMaterial({
          color: 0x2b6f88,
          transparent: true,
          opacity: 0.55,
          depthTest: false,
          depthWrite: false,
        }),
      );
      tipOutline.name = '__CAM_TOOLPATH_TOOL_TIP_OUTLINE__';
      tipOutline.renderOrder = 6006;
      this.toolHead.add(tipOutline);

      const tipProfile = new THREE.LineSegments(
        makeBallNoseProfileGeometry(radius),
        new THREE.LineBasicMaterial({
          color: 0xe8f7ff,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          depthWrite: false,
        }),
      );
      tipProfile.name = '__CAM_TOOLPATH_TOOL_TIP_PROFILE__';
      tipProfile.renderOrder = 6007;
      this.toolHead.add(tipProfile);
    }

    markSceneOverlayObject(this.toolHead as any, {
      preserve: true,
      excludeFromFit: true,
      overlayType: 'cam-toolpath-simulator',
      deep: true,
    });
  }

  _requestRender() {
    try { this.viewer?.render?.(); } catch { /* ignore viewer render failures */ }
  }

  _notify() {
    try { this.onStateChange?.(this.getState()); } catch { /* ignore simulator UI callbacks */ }
  }
}
