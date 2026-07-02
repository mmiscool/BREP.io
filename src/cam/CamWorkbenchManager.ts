import * as THREE from 'three';
import { markSceneOverlayObject } from '../UI/sceneOverlayUtils.js';
import type { CamToolpathPath, CamToolpathResult } from './camToolpath.js';

type Point3 = [number, number, number];
type CamPreviewVisibilityOptions = {
  stock: boolean;
  toolpath: boolean;
  tool: boolean;
  sweptVolume: boolean;
};

const CAM_PREVIEW_GROUP_NAME = '__BREP_CAM_PREVIEW__';
const DEFAULT_VISIBILITY_OPTIONS: CamPreviewVisibilityOptions = {
  stock: true,
  toolpath: true,
  tool: true,
  sweptVolume: true,
};
const MACHINE_TO_SCENE_MATRIX = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

function toVector(point: Point3 | null | undefined) {
  return new THREE.Vector3(
    Number(point?.[0]) || 0,
    Number(point?.[1]) || 0,
    Number(point?.[2]) || 0,
  );
}

function distance(a: Point3, b: Point3) {
  return Math.hypot(
    (Number(b?.[0]) || 0) - (Number(a?.[0]) || 0),
    (Number(b?.[1]) || 0) - (Number(a?.[1]) || 0),
    (Number(b?.[2]) || 0) - (Number(a?.[2]) || 0),
  );
}

function setVisualKey(object: THREE.Object3D, key: keyof CamPreviewVisibilityOptions) {
  object.userData = object.userData || {};
  object.userData.camVisualKey = key;
  return object;
}

function createToolMesh(toolDiameter: number, toolLength: number) {
  const radius = Math.max(0.05, toolDiameter * 0.5);
  const length = Math.max(radius * 2, toolLength);
  const group = new THREE.Group();
  group.name = 'CAM Toolhead';

  const cutterMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    metalness: 0.35,
    roughness: 0.42,
  });
  const shankMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.25,
    roughness: 0.5,
  });
  const cutter = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), cutterMat);
  cutter.position.z = length * 0.5;
  cutter.rotation.x = Math.PI / 2;
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, length * 0.85, 18), shankMat);
  shank.position.z = length * 1.15;
  shank.rotation.x = Math.PI / 2;
  group.add(cutter);
  group.add(shank);
  return setVisualKey(group, 'tool') as THREE.Group;
}

function createFlatEndmillSweepGeometry(a: THREE.Vector3, b: THREE.Vector3, radius: number, toolLength: number) {
  const r = Math.max(0.0001, Number(radius) || 0);
  const height = Math.max(r * 2, Math.max(0.0001, Number(toolLength) || 0));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const xyLength = Math.hypot(dx, dy);
  const bottomZ = Math.min(a.z, b.z);
  const topZ = Math.max(a.z, b.z) + height;
  const radialSegments = 16;
  const boundary: Array<{ x: number; y: number }> = [];

  if (xyLength <= 1e-7) {
    for (let i = 0; i < radialSegments; i += 1) {
      const angle = (Math.PI * 2 * i) / radialSegments;
      boundary.push({ x: a.x + Math.cos(angle) * r, y: a.y + Math.sin(angle) * r });
    }
  } else {
    const ux = dx / xyLength;
    const uy = dy / xyLength;
    const leftAngle = Math.atan2(uy, ux) + Math.PI / 2;
    const rightAngle = Math.atan2(uy, ux) - Math.PI / 2;
    const capSteps = Math.max(4, radialSegments / 2);
    boundary.push({ x: a.x + Math.cos(leftAngle) * r, y: a.y + Math.sin(leftAngle) * r });
    for (let i = 0; i <= capSteps; i += 1) {
      const angle = leftAngle + ((rightAngle - leftAngle) * i) / capSteps;
      boundary.push({ x: b.x + Math.cos(angle) * r, y: b.y + Math.sin(angle) * r });
    }
    boundary.push({ x: a.x + Math.cos(rightAngle) * r, y: a.y + Math.sin(rightAngle) * r });
    for (let i = 0; i <= capSteps; i += 1) {
      const angle = rightAngle - (Math.PI * i) / capSteps;
      boundary.push({ x: a.x + Math.cos(angle) * r, y: a.y + Math.sin(angle) * r });
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const appendVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const bottom: number[] = [];
  const top: number[] = [];
  for (const point of boundary) {
    bottom.push(appendVertex(point.x, point.y, bottomZ));
    top.push(appendVertex(point.x, point.y, topZ));
  }
  const centerX = boundary.reduce((sum, point) => sum + point.x, 0) / Math.max(1, boundary.length);
  const centerY = boundary.reduce((sum, point) => sum + point.y, 0) / Math.max(1, boundary.length);
  const bottomCenter = appendVertex(centerX, centerY, bottomZ);
  const topCenter = appendVertex(centerX, centerY, topZ);
  for (let i = 0; i < boundary.length; i += 1) {
    const next = (i + 1) % boundary.length;
    indices.push(bottom[i], bottom[next], top[next], bottom[i], top[next], top[i]);
    indices.push(bottomCenter, bottom[next], bottom[i]);
    indices.push(topCenter, top[i], top[next]);
  }
  return createIndexedGeometry(positions, indices);
}

function createIndexedGeometry(positions: number[], indices: number[]) {
  if (!Array.isArray(positions) || positions.length < 9) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (Array.isArray(indices) && indices.length >= 3) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildCutPathSamples(paths: CamToolpathPath[]) {
  const samples: Array<{ point: Point3; distance: number; feedRate: number }> = [];
  let total = 0;
  for (const path of paths || []) {
    const points = Array.isArray(path.points) ? path.points : [];
    for (let i = 0; i < points.length; i += 1) {
      if (i > 0) total += distance(points[i - 1], points[i]);
      samples.push({ point: points[i], distance: total, feedRate: Number(path.feedRate) || 800 });
    }
  }
  return { samples, totalDistance: total };
}

function buildMotionSamples(plan: CamToolpathResult) {
  const motionSegments = Array.isArray(plan.simulation?.motionSegments)
    ? plan.simulation.motionSegments
    : [];
  const rapidRate = Number(plan.machine?.defaultRapidRate) || 2500;
  const samples: Array<{ point: Point3; distance: number; feedRate: number }> = [];
  let total = 0;
  const appendSample = (point: Point3, feedRate: number) => {
    const last = samples[samples.length - 1]?.point || null;
    if (last && distance(last, point) <= 1e-7) return;
    samples.push({ point, distance: total, feedRate });
  };
  if (motionSegments.length) {
    for (const segment of motionSegments) {
      const start = segment.start;
      const end = segment.end;
      if (!start || !end) continue;
      const kind = String(segment.kind || 'cut');
      const feedRate = kind === 'rapid' || kind === 'retract'
        ? rapidRate
        : kind === 'plunge'
        ? Number(plan.paths?.[0]?.plungeRate) || 200
        : Number(plan.paths?.[0]?.feedRate) || 800;
      appendSample(start, feedRate);
      total += distance(start, end);
      appendSample(end, feedRate);
    }
    return { samples, totalDistance: total };
  }

  const polyline = Array.isArray(plan.simulation?.motionPolyline)
    ? plan.simulation.motionPolyline
    : [];
  if (polyline.length) {
    for (let i = 0; i < polyline.length; i += 1) {
      const point = polyline[i];
      if (i > 0) total += distance(polyline[i - 1], point);
      samples.push({ point, distance: total, feedRate: rapidRate });
    }
    return { samples, totalDistance: total };
  }
  return buildCutPathSamples(plan.paths || []);
}

function interpolateSamples(samples: Array<{ point: Point3; distance: number }>, targetDistance: number) {
  if (!samples.length) return null;
  if (targetDistance <= 0) return samples[0].point;
  const last = samples[samples.length - 1];
  if (targetDistance >= last.distance) return last.point;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    if (targetDistance > next.distance) continue;
    const span = Math.max(1e-7, next.distance - prev.distance);
    const t = (targetDistance - prev.distance) / span;
    return [
      prev.point[0] + (next.point[0] - prev.point[0]) * t,
      prev.point[1] + (next.point[1] - prev.point[1]) * t,
      prev.point[2] + (next.point[2] - prev.point[2]) * t,
    ] as Point3;
  }
  return last.point;
}

export class CamWorkbenchManager {
  viewer: any;
  group: THREE.Group | null;
  tool: THREE.Group | null;
  active: boolean;
  playing: boolean;
  _samples: Array<{ point: Point3; distance: number; feedRate: number }>;
  _totalDistance: number;
  _playDistance: number;
  _lastTick: number;
  _raf: number | null;
  _visibilityOptions: CamPreviewVisibilityOptions;
  _sampleIndex: number;
  _simulationListeners: Set<(state: Record<string, any>) => void>;

  constructor(viewer: any) {
    this.viewer = viewer || null;
    this.group = null;
    this.tool = null;
    this.active = false;
    this.playing = false;
    this._samples = [];
    this._totalDistance = 0;
    this._playDistance = 0;
    this._lastTick = 0;
    this._raf = null;
    this._visibilityOptions = { ...DEFAULT_VISIBILITY_OPTIONS };
    this._sampleIndex = 0;
    this._simulationListeners = new Set();
  }

  setActive(active: boolean) {
    this.active = !!active;
    if (this.group) this.group.visible = this.active;
    if (!this.active) this.setPlaying(false);
  }

  isPlaying() {
    return this.playing;
  }

  getVisualizationOptions() {
    return { ...this._visibilityOptions };
  }

  setVisualizationOptions(options: Partial<CamPreviewVisibilityOptions> = {}) {
    this._visibilityOptions = {
      ...this._visibilityOptions,
      ...Object.fromEntries(
        Object.entries(options).filter(([key]) => key in DEFAULT_VISIBILITY_OPTIONS)
          .map(([key, value]) => [key, value !== false]),
      ),
    } as CamPreviewVisibilityOptions;
    this.#applyVisibilityOptions();
    this.#updateSweptVolumeVisibility(this._playDistance);
    try { this.viewer?.render?.(); } catch { /* ignore render errors */ }
  }

  addSimulationListener(listener: (state: Record<string, any>) => void) {
    if (typeof listener !== 'function') return () => undefined;
    this._simulationListeners.add(listener);
    return () => {
      try { this._simulationListeners.delete(listener); } catch { /* ignore listener cleanup */ }
    };
  }

  getSimulationState() {
    return {
      index: this._sampleIndex,
      count: this._samples.length,
      distance: this._playDistance,
      totalDistance: this._totalDistance,
      playing: this.playing,
    };
  }

  setSimulationFrameIndex(index: number) {
    if (!this._samples.length) return;
    const nextIndex = Math.max(0, Math.min(this._samples.length - 1, Math.round(Number(index) || 0)));
    this._sampleIndex = nextIndex;
    this.setSimulationDistance(Number(this._samples[nextIndex]?.distance) || 0, { snapToNearestSample: false });
  }

  preview(plan: CamToolpathResult | null) {
    this.clearPreview();
    if (!plan || !Array.isArray(plan.paths) || !plan.paths.length) return null;
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene || null;
    if (!scene) return null;

    const group = new THREE.Group();
    group.name = CAM_PREVIEW_GROUP_NAME;
    group.visible = this.active !== false;
    group.matrixAutoUpdate = false;
    group.matrix.copy(MACHINE_TO_SCENE_MATRIX);
    markSceneOverlayObject(group, { overlayType: 'camPreview', deep: true });

    this.#addStockBox(group, plan);
    this.#addToolpathPolyline(group, plan);
    this.#addToolpathLines(group, plan.paths);
    this.#addSweptCutterHulls(group, plan);

    this.tool = createToolMesh(plan.toolDiameter || 3.175, plan.toolLength || 25);
    markSceneOverlayObject(this.tool, { overlayType: 'camToolhead', deep: true });
    group.add(this.tool);

    const { samples, totalDistance } = buildMotionSamples(plan);
    this._samples = samples;
    this._totalDistance = totalDistance;
    this._playDistance = 0;
    this._sampleIndex = 0;
    scene.add(group);
    this.group = group;
    this.#positionTool(samples[0]?.point || null);
    this.#applyVisibilityOptions();
    this.#updateSweptVolumeVisibility(0);
    this.#notifySimulationChange();
    try { this.viewer?.render?.(); } catch { /* ignore render errors */ }
    return group;
  }

  clearPreview() {
    this.setPlaying(false);
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene || null;
    const existing = this.group || scene?.getObjectByName?.(CAM_PREVIEW_GROUP_NAME) || null;
    if (existing?.parent) {
      try { existing.parent.remove(existing); } catch { /* ignore */ }
    }
    this.group = null;
    this.tool = null;
    this._samples = [];
    this._totalDistance = 0;
    this._playDistance = 0;
    this._sampleIndex = 0;
    this.#notifySimulationChange();
    try { this.viewer?.render?.(); } catch { /* ignore render errors */ }
  }

  reset() {
    this.setSimulationDistance(0);
  }

  setSimulationDistance(distanceLimit: number, options: { snapToNearestSample?: boolean } = {}) {
    this._playDistance = Math.max(0, Math.min(this._totalDistance, Number(distanceLimit) || 0));
    this._sampleIndex = options.snapToNearestSample === false
      ? this._sampleIndex
      : this.#nearestSampleIndex(this._playDistance);
    this.#positionTool(interpolateSamples(this._samples, this._playDistance) || this._samples[0]?.point || null);
    this.#updateSweptVolumeVisibility(this._playDistance);
    this.#notifySimulationChange();
    try { this.viewer?.render?.(); } catch { /* ignore */ }
  }

  setPlaying(playing: boolean) {
    const next = !!playing && this._samples.length > 1 && this._totalDistance > 0;
    if (this.playing === next) return;
    this.playing = next;
    if (this.playing) {
      this._lastTick = performance.now();
      this.#scheduleTick();
    } else if (this._raf != null) {
      try { cancelAnimationFrame(this._raf); } catch { /* ignore */ }
      this._raf = null;
    }
    this.#notifySimulationChange();
  }

  togglePlaying() {
    this.setPlaying(!this.playing);
  }

  #scheduleTick() {
    if (!this.playing || this._raf != null) return;
    this._raf = requestAnimationFrame((now) => {
      this._raf = null;
      this.#tick(now);
    });
  }

  #tick(now: number) {
    if (!this.playing) return;
    const dt = Math.max(0, Math.min(0.1, (now - this._lastTick) / 1000));
    this._lastTick = now;
    const feed = this.#feedAtDistance(this._playDistance);
    const previewSpeed = Math.max(1, feed / 60);
    this._playDistance += previewSpeed * dt;
    if (this._playDistance >= this._totalDistance) {
      this._playDistance = this._totalDistance;
      this.setPlaying(false);
    }
    const current = interpolateSamples(this._samples, this._playDistance);
    this._sampleIndex = this.#nearestSampleIndex(this._playDistance);
    this.#positionTool(current || this._samples[0]?.point || null);
    this.#updateSweptVolumeVisibility(this._playDistance);
    this.#notifySimulationChange();
    try { this.viewer?.render?.(); } catch { /* ignore */ }
    this.#scheduleTick();
  }

  #nearestSampleIndex(distanceLimit: number) {
    if (!this._samples.length) return 0;
    const target = Number(distanceLimit) || 0;
    let bestIndex = 0;
    let bestDelta = Infinity;
    for (let index = 0; index < this._samples.length; index += 1) {
      const delta = Math.abs((Number(this._samples[index]?.distance) || 0) - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  #notifySimulationChange() {
    if (!this._simulationListeners?.size) return;
    const state = this.getSimulationState();
    for (const listener of Array.from(this._simulationListeners)) {
      try { listener(state); } catch { /* keep other listeners running */ }
    }
  }

  #feedAtDistance(target: number) {
    for (let i = 1; i < this._samples.length; i += 1) {
      if (target <= this._samples[i].distance) return Number(this._samples[i].feedRate) || 800;
    }
    return Number(this._samples[this._samples.length - 1]?.feedRate) || 800;
  }

  #positionTool(point: Point3 | null) {
    if (!point || !this.tool) return;
    this.tool.position.set(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
  }

  #applyVisibilityOptions() {
    const group = this.group;
    if (!group) return;
    const options = this._visibilityOptions;
    group.traverse((object: any) => {
      const key = object?.userData?.camVisualKey;
      if (!key || !(key in options)) return;
      object.visible = options[key as keyof CamPreviewVisibilityOptions] !== false;
    });
  }

  #updateSweptVolumeVisibility(distanceLimit: number) {
    const group = this.group;
    if (!group) return;
    const enabled = this._visibilityOptions.sweptVolume !== false;
    const limit = Math.max(0, Number(distanceLimit) || 0);
    group.traverse((object: any) => {
      if (object?.userData?.camCutEndDistance == null) return;
      object.visible = enabled && Number(object.userData.camCutEndDistance) <= limit + 1e-6;
    });
  }

  #addStockBox(group: THREE.Group, plan: CamToolpathResult) {
    if (!plan.bounds) return;
    const min = toVector(plan.bounds.min);
    const max = toVector(plan.bounds.max);
    const size = max.clone().sub(min);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return;
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const material = new THREE.MeshBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    const stock = new THREE.Mesh(geometry, material);
    stock.name = 'CAM Stock';
    setVisualKey(stock, 'stock');
    stock.position.copy(min).add(max).multiplyScalar(0.5);
    markSceneOverlayObject(stock, { overlayType: 'camStock' });
    group.add(stock);
  }

  #addToolpathLines(group: THREE.Group, paths: CamToolpathPath[]) {
    const material = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 });
    for (const path of paths) {
      const points = (path.points || []).map(toVector);
      if (points.length < 2) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, material);
      line.name = `CAM Path ${path.id}`;
      setVisualKey(line, 'toolpath');
      markSceneOverlayObject(line, { overlayType: 'camToolpath' });
      group.add(line);
    }
  }

  #addToolpathPolyline(group: THREE.Group, plan: CamToolpathResult) {
    const polyline = Array.isArray(plan.simulation?.motionPolyline)
      ? plan.simulation.motionPolyline
      : [];
    const points = polyline.map(toVector).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const line = new THREE.Line(geometry, material);
    line.name = 'CAM Toolpath Polyline';
    setVisualKey(line, 'toolpath');
    line.renderOrder = 20;
    markSceneOverlayObject(line, { overlayType: 'camToolpathPolyline' });
    group.add(line);
  }

  #addSweptCutterHulls(group: THREE.Group, plan: CamToolpathResult) {
    const radius = Math.max(0.05, (Number(plan.toolDiameter) || 3.175) * 0.5);
    const toolLength = Math.max(radius * 2, Number(plan.toolLength) || 25);
    const material = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hullGroup = new THREE.Group();
    hullGroup.name = 'CAM Swept Cutter Hulls';
    setVisualKey(hullGroup, 'sweptVolume');
    const maxSegments = 240;
    const planHulls = Array.isArray(plan.simulation?.sweptHulls)
      ? plan.simulation.sweptHulls
      : [];
    const planSegments = Array.isArray(plan.simulation?.sweptSegments)
      ? plan.simulation.sweptSegments
      : [];
    const cutMotionDistances: Array<{ startDistance: number; endDistance: number }> = [];
    let motionCursor = 0;
    for (const segment of plan.simulation?.motionSegments || []) {
      const start = segment.start;
      const end = segment.end;
      if (!start || !end) continue;
      const length = distance(start, end);
      const startDistance = motionCursor;
      const endDistance = motionCursor + length;
      if ((segment.kind === 'cut' || segment.kind === 'plunge') && length > 1e-7) {
        cutMotionDistances.push({ startDistance, endDistance });
      }
      motionCursor = endDistance;
    }
    const allSegments: Array<{
      start: THREE.Vector3;
      end: THREE.Vector3;
      radius: number;
      toolLength: number;
      positions?: number[];
      indices?: number[];
      startDistance?: number;
      endDistance?: number;
    }> = planHulls.length
      ? planHulls.map((hull, index) => ({
        start: toVector(hull.start),
        end: toVector(hull.end),
        radius: Math.max(0.05, Number(hull.radius) || radius),
        toolLength: Math.max(radius * 2, Number(hull.toolLength) || toolLength),
        positions: Array.isArray(hull.positions) ? hull.positions : undefined,
        indices: Array.isArray(hull.indices) ? hull.indices : undefined,
        startDistance: cutMotionDistances[index]?.startDistance,
        endDistance: cutMotionDistances[index]?.endDistance,
      }))
      : planSegments.length
      ? planSegments.map((segment, index) => ({
        start: toVector(segment.start),
        end: toVector(segment.end),
        radius: Math.max(0.05, Number(segment.radius) || radius),
        toolLength,
        startDistance: cutMotionDistances[index]?.startDistance,
        endDistance: cutMotionDistances[index]?.endDistance,
      }))
      : (plan.paths || []).flatMap((path) => {
        const out: Array<{ start: THREE.Vector3; end: THREE.Vector3; radius: number; toolLength: number }> = [];
        for (let i = 1; i < path.points.length; i += 1) {
          out.push({
            start: toVector(path.points[i - 1]),
            end: toVector(path.points[i]),
            radius,
            toolLength,
          });
        }
        return out;
      });
    const stride = Math.max(1, Math.ceil(allSegments.length / maxSegments));
    for (let i = 0; i < allSegments.length; i += stride) {
      const segment = allSegments[i];
      const geometry = segment.positions?.length
        ? createIndexedGeometry(segment.positions, segment.indices || [])
        : createFlatEndmillSweepGeometry(segment.start, segment.end, segment.radius, segment.toolLength);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      if (!mesh) continue;
      mesh.name = 'CAM swept cutter segment';
      setVisualKey(mesh, 'sweptVolume');
      if (Number.isFinite(segment.endDistance)) {
        mesh.userData.camCutStartDistance = Number(segment.startDistance) || 0;
        mesh.userData.camCutEndDistance = Number(segment.endDistance) || 0;
      }
      markSceneOverlayObject(mesh, { overlayType: 'camSweptCutter' });
      hullGroup.add(mesh);
    }
    if (hullGroup.children.length) group.add(hullGroup);
  }
}
