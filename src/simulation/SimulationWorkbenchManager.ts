import * as THREE from 'three';
import { CombinedTransformControls } from '../UI/controls/CombinedTransformControls.js';

declare global {
  interface Window {
    __BREP_activeXform?: any;
  }
}

const FIXED_METADATA_KEY = 'fixed';
const TRANSFORM_METADATA_KEY = 'simulationTransform';
const SIM_PROXY_PREFIX = '__SIM_PROXY__';
const VHACD_OPTIONS = Object.freeze({
  maxHulls: 256,
  voxelResolution: 1000000,
  maxVerticesPerHull: 64,
  shrinkWrap: false,
  fillMode: 'flood',
  findBestPlane: false,
  minEdgeLength: .1,
  messages: 'none',
});
const DEFAULT_TRANSFORM = Object.freeze({
  position: [0, 0, 0],
  rotationEuler: [0, 0, 0],
});

function cloneVec3(value, fallback = [0, 0, 0]) {
  const src = Array.isArray(value) ? value : fallback;
  return [
    Number.isFinite(Number(src[0])) ? Number(src[0]) : fallback[0],
    Number.isFinite(Number(src[1])) ? Number(src[1]) : fallback[1],
    Number.isFinite(Number(src[2])) ? Number(src[2]) : fallback[2],
  ];
}

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function normalizeOptionalMotionLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.abs(numeric) <= 1e-9 ? null : numeric;
}

function normalizeTransform(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    position: cloneVec3(raw.position, DEFAULT_TRANSFORM.position),
    rotationEuler: cloneVec3(raw.rotationEuler, DEFAULT_TRANSFORM.rotationEuler),
  };
}

function transformIsIdentity(transform) {
  const position = cloneVec3(transform?.position, DEFAULT_TRANSFORM.position);
  const rotationEuler = cloneVec3(transform?.rotationEuler, DEFAULT_TRANSFORM.rotationEuler);
  return position.every((value) => Math.abs(value) <= 1e-9)
    && rotationEuler.every((value) => Math.abs(value) <= 1e-9);
}

function copyLocalPose(object) {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  };
}

function buildLocalMatrix(pose) {
  return new THREE.Matrix4().compose(
    pose.position.clone(),
    pose.quaternion.clone(),
    pose.scale.clone(),
  );
}

function poseToOffset(basePose, currentObject) {
  const baseMatrix = buildLocalMatrix(basePose);
  const currentMatrix = new THREE.Matrix4().compose(
    currentObject.position.clone(),
    currentObject.quaternion.clone(),
    currentObject.scale.clone(),
  );
  const relative = new THREE.Matrix4().copy(baseMatrix).invert().multiply(currentMatrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  relative.decompose(position, quaternion, scale);
  const rotationEuler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: [position.x, position.y, position.z],
    rotationEuler: [rotationEuler.x, rotationEuler.y, rotationEuler.z],
  };
}

function normalizeMeshArrays(mesh) {
  if (!mesh) return null;
  const stride = Math.max(3, Number(mesh.numProp) || 3);
  const sourcePositions = Array.isArray(mesh.vertProperties) ? mesh.vertProperties : Array.from(mesh.vertProperties || []);
  const sourceIndices = Array.isArray(mesh.triVerts) ? mesh.triVerts : Array.from(mesh.triVerts || []);
  if (sourcePositions.length < 9 || sourceIndices.length < 3) return null;
  const positions = new Float64Array((sourcePositions.length / stride) * 3);
  for (let src = 0, dst = 0; src + 2 < sourcePositions.length; src += stride, dst += 3) {
    positions[dst + 0] = Number(sourcePositions[src + 0]) || 0;
    positions[dst + 1] = Number(sourcePositions[src + 1]) || 0;
    positions[dst + 2] = Number(sourcePositions[src + 2]) || 0;
  }
  return {
    positions,
    indices: new Uint32Array(sourceIndices),
  };
}

function buildProxyMaterial(baseColor, index, total) {
  const color = new THREE.Color(baseColor || '#9ca3af');
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const offset = total > 1 ? (index / Math.max(1, total)) * 0.18 : 0;
  color.setHSL((hsl.h + offset) % 1, Math.min(1, Math.max(0.35, hsl.s || 0.55)), Math.min(0.72, Math.max(0.42, hsl.l)));
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    roughness: 0.55,
    metalness: 0.05,
    depthWrite: true,
  });
}

function disposeHierarchy(root) {
  if (!root?.traverse) return;
  root.traverse((node) => {
    if (node?.geometry?.dispose) {
      try { node.geometry.dispose(); } catch { /* ignore */ }
    }
    if (Array.isArray(node?.material)) {
      for (const material of node.material) {
        try { material?.dispose?.(); } catch { /* ignore */ }
      }
    } else {
      try { node?.material?.dispose?.(); } catch { /* ignore */ }
    }
  });
}

export class SimulationWorkbenchManager {
  [key: string]: any;

  constructor(viewer: any) {
    this.viewer = viewer || null;
    this._active = false;
    this._baseLocalPose = new Map();
    this._runtimeState = new Map();
    this._sourceVisibility = new Map();
    this._decompositionCache = new Map();
    this._proxyGroups = new Map();
    this._transformSession = null;
    this._rapier = null;
    this._rapierLoadPromise = null;
    this._vhacd = null;
    this._vhacdLoadPromise = null;
    this._physicsWorld = null;
    this._bodyState = new Map();
    this._listeners = new Set();
    this._removeStateManagerListener = null;
    this._isPlaying = false;
    this._motionState = new Map();
    this._movedSolidIds = new Set();
    this._raf = 0;
    this._lastStepTime = 0;
    this._scratch = {
      parentInverse: new THREE.Matrix4(),
      parentWorldMatrix: new THREE.Matrix4(),
      localMatrix: new THREE.Matrix4(),
      worldMatrix: new THREE.Matrix4(),
      deltaMatrix: new THREE.Matrix4(),
      worldPosition: new THREE.Vector3(),
      localPosition: new THREE.Vector3(),
      worldQuaternion: new THREE.Quaternion(),
      parentQuaternion: new THREE.Quaternion(),
      parentQuaternionInverse: new THREE.Quaternion(),
      box: new THREE.Box3(),
      center: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      translation: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      radius: new THREE.Vector3(),
    };
    this._bindStateManager();
  }

  dispose() {
    if (typeof this._removeStateManagerListener === 'function') {
      try { this._removeStateManagerListener(); } catch { /* ignore */ }
    }
    this._removeStateManagerListener = null;
    this.setActive(false);
  }

  isActive() {
    return this._active;
  }

  isSimulationWorkbenchActive() {
    return this.viewer?._getActiveWorkbenchId?.() === 'SIMULATION';
  }

  addListener(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => {
      try { this._listeners.delete(listener); } catch { /* ignore */ }
    };
  }

  removeListener(listener) {
    if (typeof listener !== 'function') return;
    try { this._listeners.delete(listener); } catch { /* ignore */ }
  }

  isPlaying() {
    return this._isPlaying;
  }

  setPlaying(playing) {
    const next = !!playing;
    if (next === this._isPlaying) return this._isPlaying;
    this._isPlaying = next;
    if (this._active) {
      if (next) {
        void this._prepareSimulationAssets().then(() => {
          this._ensurePhysicsLoop();
        });
      } else {
        this._stopPhysicsLoop();
      }
    }
    this._emit();
    try { this.viewer?.render?.(); } catch { /* ignore */ }
    return this._isPlaying;
  }

  resetSimulationState() {
    this._stopTransformSession();
    this._stopPhysicsLoop();
    this._destroyPhysicsWorld();
    this._isPlaying = false;
    this._movedSolidIds.clear();
    this._motionState.clear();
    for (const solid of this._listSceneSolids()) {
      this._runtimeState.set(solid.uuid, normalizeTransform(null));
      this.setStoredTransform(solid, null);
    }
    this._restoreBaseLocalPoses();
    for (const solid of this._listSceneSolids()) {
      this._syncProxyGroupTransform(solid);
    }
    if (this._active) {
      this._resetMotionRuntime();
    }
    this._emit();
    try { this.viewer?.render?.(); } catch { /* ignore */ }
  }

  getSolidFixed(solid) {
    if (!solid?.name) return false;
    const own = this.viewer?.partHistory?.metadataManager?.getOwnMetadata?.(solid.name) || {};
    return own[FIXED_METADATA_KEY] === true;
  }

  setSolidFixed(solid, fixed) {
    if (!solid?.name) return false;
    const manager = this.viewer?.partHistory?.metadataManager;
    if (!manager) return false;
    const data = manager.getOwnMetadata(solid.name);
    if (fixed) data[FIXED_METADATA_KEY] = true;
    else delete data[FIXED_METADATA_KEY];
    manager.setMetadataObject(solid.name, data);
    if (this._active && this._physicsWorld) {
      void this._rebuildPhysicsWorld();
    }
    return true;
  }

  getStoredTransform(solid) {
    if (!solid?.name) return normalizeTransform(null);
    const own = this.viewer?.partHistory?.metadataManager?.getOwnMetadata?.(solid.name) || {};
    return normalizeTransform(own[TRANSFORM_METADATA_KEY]);
  }

  setStoredTransform(solid, transform) {
    if (!solid?.name) return false;
    const manager = this.viewer?.partHistory?.metadataManager;
    if (!manager) return false;
    const normalized = normalizeTransform(transform);
    const data = manager.getOwnMetadata(solid.name);
    if (transformIsIdentity(normalized)) delete data[TRANSFORM_METADATA_KEY];
    else data[TRANSFORM_METADATA_KEY] = normalized;
    manager.setMetadataObject(solid.name, data);
    return true;
  }

  setActive(active) {
    const next = !!active;
    if (next === this._active) {
      if (next) {
        this._applyRuntimeTransforms();
      } else {
        this._restoreBaseLocalPoses();
      }
      return;
    }
    this._active = next;
    if (this._active) {
      this._isPlaying = false;
      this._stopPhysicsLoop();
      this._destroyPhysicsWorld();
      this._captureBaseLocalPoses();
      this._captureSourceVisibility();
      this._hydrateRuntimeStateFromMetadata();
      this._resetMotionRuntime();
      this._applyRuntimeTransforms();
      this._setSourceSolidsVisible(true);
      void this._prepareVisualAssets();
      this._emit();
      return;
    }
    this._stopTransformSession();
    this._destroyPhysicsWorld();
    this._stopPhysicsLoop();
    this._clearProxyGroups();
    this._setSourceSolidsVisible(true);
    this._restoreBaseLocalPoses();
    this._runtimeState.clear();
    this._baseLocalPose.clear();
    this._sourceVisibility.clear();
    this._decompositionCache.clear();
    this._motionState.clear();
    this._movedSolidIds.clear();
    this._isPlaying = false;
    this._emit();
  }

  toggleSolidTransform(solid) {
    if (!solid || solid.type !== 'SOLID') return;
    if (!this.isSimulationWorkbenchActive()) return;
    const session = this._transformSession;
    if (session && session.solid === solid) {
      const currentMode = (typeof session.controls?.getMode === 'function')
        ? session.controls.getMode()
        : (session.controls?.mode || session.mode || 'translate');
      if (currentMode === 'translate') {
        try { session.controls?.setMode('rotate'); } catch { session.controls.mode = 'rotate'; }
        session.mode = 'rotate';
        try { session.globalState?.updateForCamera?.(); } catch { /* ignore */ }
        try { this.viewer?.render?.(); } catch { /* ignore */ }
        return;
      }
      this._stopTransformSession();
      return;
    }
    this._startTransformSession(solid);
  }

  _captureBaseLocalPoses() {
    for (const solid of this._listSceneSolids()) {
      if (!this._baseLocalPose.has(solid.uuid)) {
        this._baseLocalPose.set(solid.uuid, copyLocalPose(solid));
      }
    }
  }

  _captureSourceVisibility() {
    for (const solid of this._listSceneSolids()) {
      if (!this._sourceVisibility.has(solid.uuid)) {
        this._sourceVisibility.set(solid.uuid, solid.visible !== false);
      }
    }
  }

  _hydrateRuntimeStateFromMetadata() {
    for (const solid of this._listSceneSolids()) {
      this._runtimeState.set(solid.uuid, normalizeTransform(this.getStoredTransform(solid)));
    }
  }

  _restoreBaseLocalPoses() {
    for (const solid of this._listSceneSolids()) {
      const base = this._baseLocalPose.get(solid.uuid);
      if (!base) continue;
      solid.position.copy(base.position);
      solid.quaternion.copy(base.quaternion);
      solid.scale.copy(base.scale);
      solid.updateMatrixWorld?.(true);
    }
    try { this.viewer?.render?.(); } catch { /* ignore */ }
  }

  _applyRuntimeTransforms() {
    this._captureBaseLocalPoses();
    for (const solid of this._listSceneSolids()) {
      this._applyRuntimeTransformToSolid(solid);
    }
    try { this.viewer?.render?.(); } catch { /* ignore */ }
  }

  _applyRuntimeTransformToSolid(solid) {
    const base = this._baseLocalPose.get(solid.uuid);
    if (!base) return;
    const runtime = normalizeTransform(this._runtimeState.get(solid.uuid));
    const offsetQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...runtime.rotationEuler, 'XYZ'),
    );
    const nextMatrix = buildLocalMatrix(base).multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...runtime.position),
        offsetQuaternion,
        new THREE.Vector3(1, 1, 1),
      ),
    );
    nextMatrix.decompose(solid.position, solid.quaternion, solid.scale);
    solid.updateMatrixWorld?.(true);
    this._syncProxyGroupTransform(solid);
  }

  _updateRuntimeTransformFromSolid(solid, { persist = false } = {}) {
    const base = this._baseLocalPose.get(solid.uuid);
    if (!base) return;
    const offset = normalizeTransform(poseToOffset(base, solid));
    this._runtimeState.set(solid.uuid, offset);
    if (persist) {
      this.setStoredTransform(solid, offset);
      this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'simulation-transform' });
    }
    this._syncProxyGroupTransform(solid);
  }

  async _prepareSimulationAssets() {
    if (!this._active) return;
    try {
      await Promise.all(this._listSceneSolids().map((solid) => this._ensureDecomposition(solid)));
      this._buildProxyGroups();
      await this._rebuildPhysicsWorld();
    } catch (error) {
      console.warn('[SimulationWorkbench] Failed to prepare simulation assets:', error);
    }
  }

  async _prepareVisualAssets() {
    if (!this._active) return;
    try {
      await Promise.all(this._listSceneSolids().map((solid) => this._ensureDecomposition(solid)));
      this._buildProxyGroups();
    } catch (error) {
      console.warn('[SimulationWorkbench] Failed to prepare simulation visuals:', error);
    }
  }

  async _loadRapier() {
    if (this._rapier) return this._rapier;
    if (!this._rapierLoadPromise) {
      this._rapierLoadPromise = import('@dimforge/rapier3d/rapier.js')
        .then((module) => module?.default || module)
        .then((rapier) => {
          this._rapier = rapier;
          return rapier;
        })
        .catch((error) => {
          this._rapierLoadPromise = null;
          throw error;
        });
    }
    return this._rapierLoadPromise;
  }

  async _loadVhacd() {
    if (this._vhacd) return this._vhacd;
    if (!this._vhacdLoadPromise) {
      this._vhacdLoadPromise = import('vhacd-js/lib/vhacd.js')
        .then((module) => module?.ConvexMeshDecomposition?.create?.())
        .then((instance) => {
          this._vhacd = instance || null;
          return this._vhacd;
        })
        .catch((error) => {
          this._vhacdLoadPromise = null;
          throw error;
        });
    }
    return this._vhacdLoadPromise;
  }

  async _ensureDecomposition(solid) {
    if (!solid?.uuid) return [];
    const cached = this._decompositionCache.get(solid.uuid);
    if (cached) return cached.hulls;
    const rawMesh = this._extractSolidMesh(solid);
    if (!rawMesh) {
      this._decompositionCache.set(solid.uuid, { hulls: [] });
      return [];
    }
    let hulls = [];
    try {
      const vhacd = await this._loadVhacd();
      if (vhacd?.computeConvexHulls) {
        hulls = vhacd.computeConvexHulls(rawMesh, VHACD_OPTIONS) || [];
      }
    } catch (error) {
      console.warn('[SimulationWorkbench] Failed to decompose mesh with vhacd-js:', error);
    }
    if (!Array.isArray(hulls) || hulls.length === 0) {
      hulls = [rawMesh];
    }
    this._decompositionCache.set(solid.uuid, { hulls });
    return hulls;
  }

  _extractSolidMesh(solid) {
    let mesh = null;
    try {
      mesh = solid.getMesh?.();
      return normalizeMeshArrays(mesh);
    } catch {
      return null;
    } finally {
      try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { /* ignore */ }
    }
  }

  _buildProxyGroups() {
    this._clearProxyGroups();
    for (const solid of this._listSceneSolids()) {
      const record = this._decompositionCache.get(solid.uuid);
      const hulls = Array.isArray(record?.hulls) ? record.hulls : [];
      const group = this._createProxyGroup(solid, hulls);
      if (!group) continue;
      this._proxyGroups.set(solid.uuid, group);
      this._syncProxyGroupTransform(solid);
      try { this.viewer?.render?.(); } catch { /* ignore */ }
    }
  }

  _createProxyGroup(solid, hulls) {
    const parent = solid.parent || this.viewer?.scene || null;
    if (!parent?.add || !Array.isArray(hulls) || hulls.length === 0) return null;
    const group = new THREE.Group();
    group.name = `${SIM_PROXY_PREFIX}:${solid.name || solid.uuid || ''}`;
    group.userData.excludeFromFit = false;
    group.userData.simulationProxy = true;
    group.visible = false;
    const metadataColor = this.viewer?.partHistory?.metadataManager?.getMetadata?.(solid.name || '')?.color || null;
    hulls.forEach((hull, index) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(hull.positions || []), 3));
      geometry.setIndex(Array.from(hull.indices || []));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, buildProxyMaterial(metadataColor, index, hulls.length));
      mesh.userData.excludeFromFit = false;
      mesh.userData.simulationProxy = true;
      mesh.userData.sourceSolidUuid = solid.uuid;
      group.add(mesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 20),
        new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 }),
      );
      edges.userData.excludeFromFit = false;
      edges.userData.simulationProxy = true;
      group.add(edges);
    });
    parent.add(group);
    return group;
  }

  _syncProxyGroupTransform(solid) {
    const group = this._proxyGroups.get(solid.uuid);
    if (!group) return;
    group.position.copy(solid.position);
    group.quaternion.copy(solid.quaternion);
    group.scale.copy(solid.scale);
    group.visible = false;
    group.updateMatrixWorld?.(true);
  }

  _clearProxyGroups() {
    for (const group of this._proxyGroups.values()) {
      try { group.parent?.remove?.(group); } catch { /* ignore */ }
      disposeHierarchy(group);
    }
    this._proxyGroups.clear();
  }

  _setSourceSolidsVisible(visible) {
    for (const solid of this._listSceneSolids()) {
      if (visible) {
        solid.visible = this._sourceVisibility.get(solid.uuid) !== false;
      } else {
        solid.visible = false;
      }
    }
    for (const group of this._proxyGroups.values()) {
      group.visible = false;
    }
    try { this.viewer?.render?.(); } catch { /* ignore */ }
  }

  async _rebuildPhysicsWorld() {
    if (!this._active) return;
    const [rapier] = await Promise.all([
      this._loadRapier(),
      Promise.all(this._listSceneSolids().map((solid) => this._ensureDecomposition(solid))),
    ]);
    if (!this._active || !rapier) return;
    this._destroyPhysicsWorld();
    this._bodyState.clear();
    const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    world.maxCcdSubsteps = 2;
    this._physicsWorld = world;
    const selectedSolid = this._transformSession?.solid || null;
    for (const solid of this._listSceneSolids()) {
      const bodyDesc = (selectedSolid && solid === selectedSolid)
        ? rapier.RigidBodyDesc.kinematicPositionBased()
        : (this._isSolidKinematicMotionDriven(solid)
          ? rapier.RigidBodyDesc.kinematicPositionBased()
          : (this.getSolidFixed(solid) ? rapier.RigidBodyDesc.fixed() : rapier.RigidBodyDesc.dynamic()));
      const position = solid.getWorldPosition(new THREE.Vector3());
      const quaternion = solid.getWorldQuaternion(new THREE.Quaternion());
      bodyDesc.setTranslation(position.x, position.y, position.z);
      bodyDesc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
      bodyDesc.setLinearDamping(2.5);
      bodyDesc.setAngularDamping(2.5);
      bodyDesc.setCcdEnabled(true);
      const body = world.createRigidBody(bodyDesc);
      const hulls = this._decompositionCache.get(solid.uuid)?.hulls || [];
      for (const hull of hulls) {
        const collider = this._createColliderForHull(rapier, hull);
        if (!collider) continue;
        collider.setRestitution(0.05);
        collider.setFriction(0.9);
        world.createCollider(collider, body);
      }
      this._bodyState.set(solid.uuid, {
        solid,
        body,
        proxyGroup: this._proxyGroups.get(solid.uuid) || null,
      });
    }
  }

  _destroyPhysicsWorld() {
    try { this._physicsWorld?.free?.(); } catch { /* ignore */ }
    this._physicsWorld = null;
    this._bodyState.clear();
  }

  _createColliderForHull(rapier, hull) {
    const positions = hull?.positions ? new Float32Array(hull.positions) : null;
    const indices = hull?.indices ? new Uint32Array(hull.indices) : null;
    if (!positions || positions.length < 9 || !indices || indices.length < 3) return null;
    const collider = rapier.ColliderDesc.convexMesh(positions, indices);
    if (collider) return collider;
    return rapier.ColliderDesc.convexHull(positions);
  }

  _ensurePhysicsLoop() {
    if (this._raf) return;
    this._lastStepTime = 0;
    const step = (ts) => {
      this._raf = 0;
      if (!this._active) return;
      this._stepPhysics(ts);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopPhysicsLoop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    this._lastStepTime = 0;
  }

  _stepPhysics(timestamp) {
    const world = this._physicsWorld;
    if (!world) return;
    if (!this._isPlaying) {
      this._lastStepTime = timestamp;
      return;
    }
    const dt = this._lastStepTime > 0
      ? Math.min(1 / 20, Math.max(1 / 240, (timestamp - this._lastStepTime) / 1000))
      : 1 / 60;
    this._lastStepTime = timestamp;
    world.timestep = dt;

    const selectedSolid = this._transformSession?.solid || null;
    let changed = false;
    if (this._isPlaying) {
      changed = this._applyMotionStep(dt) || changed;
    }
    if (selectedSolid) {
      const bodyState = this._bodyState.get(selectedSolid.uuid);
      if (bodyState?.body) {
        const worldPosition = selectedSolid.getWorldPosition(new THREE.Vector3());
        const worldQuaternion = selectedSolid.getWorldQuaternion(new THREE.Quaternion());
        bodyState.body.setNextKinematicTranslation(worldPosition);
        bodyState.body.setNextKinematicRotation(worldQuaternion);
      }
    }
    world.step();
    for (const bodyState of this._bodyState.values()) {
      const { solid, body } = bodyState;
      if (!solid || !body) continue;
      if (selectedSolid && solid === selectedSolid) {
        this._syncProxyGroupTransform(solid);
        continue;
      }
      if (this.getSolidFixed(solid)) {
        this._syncProxyGroupTransform(solid);
        continue;
      }
      const translation = body.translation();
      const rotation = body.rotation();
      if (!translation || !rotation) continue;
      this._setSolidWorldPose(solid, translation, rotation);
      this._updateRuntimeTransformFromSolid(solid, { persist: false });
      this._movedSolidIds.add(solid.uuid);
      changed = true;
    }
    if (changed) {
      try { this.viewer?.render?.(); } catch { /* ignore */ }
    }
  }

  _setSolidWorldPose(solid, translation, rotation) {
    const parent = solid.parent || this.viewer?.scene || null;
    const scratch = this._scratch;
    scratch.worldPosition.set(translation.x, translation.y, translation.z);
    scratch.worldQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    if (parent?.isObject3D) {
      parent.updateMatrixWorld?.(true);
      scratch.parentInverse.copy(parent.matrixWorld).invert();
      parent.getWorldQuaternion(scratch.parentQuaternion);
      scratch.parentQuaternionInverse.copy(scratch.parentQuaternion).invert();
      scratch.localPosition.copy(scratch.worldPosition).applyMatrix4(scratch.parentInverse);
      solid.position.copy(scratch.localPosition);
      solid.quaternion.copy(scratch.parentQuaternionInverse.multiply(scratch.worldQuaternion));
    } else {
      solid.position.copy(scratch.worldPosition);
      solid.quaternion.copy(scratch.worldQuaternion);
    }
    solid.updateMatrixWorld?.(true);
    this._syncProxyGroupTransform(solid);
  }

  _startTransformSession(solid) {
    if (!solid || !this._active) return;
    this._stopTransformSession();
    const controls = new CombinedTransformControls(this.viewer.camera, this.viewer.renderer?.domElement);
    try { controls.setMode('translate'); } catch { controls.mode = 'translate'; }
    const target = new THREE.Object3D();
    target.name = `SimulationTransformTarget:${solid.name || solid.uuid || ''}`;
    this.viewer.scene.updateMatrixWorld?.(true);
    solid.updateMatrixWorld?.(true);
    const box = this._scratch.box;
    const center = box.setFromObject(this._proxyGroups.get(solid.uuid) || solid).isEmpty()
      ? solid.getWorldPosition(this._scratch.center)
      : box.getCenter(this._scratch.center);
    const worldPosition = solid.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = solid.getWorldQuaternion(new THREE.Quaternion());
    const offsetLocal = worldPosition.clone().sub(center).applyQuaternion(worldQuaternion.clone().invert());
    target.position.copy(center);
    target.quaternion.copy(worldQuaternion);
    this.viewer.scene.add(target);
    controls.attach(target);
    this.viewer.scene.add(controls);

    const applyToSolid = (persist = false) => {
      const targetWorldPosition = target.getWorldPosition(new THREE.Vector3());
      const targetWorldQuaternion = target.getWorldQuaternion(new THREE.Quaternion());
      const solidWorldPosition = targetWorldPosition.clone().add(offsetLocal.clone().applyQuaternion(targetWorldQuaternion));
      this._setSolidWorldPose(solid, solidWorldPosition, targetWorldQuaternion);
      this._updateRuntimeTransformFromSolid(solid, { persist });
      if (persist) {
        if (this._physicsWorld) {
          void this._rebuildPhysicsWorld();
        }
      }
      try { this.viewer?.render?.(); } catch { /* ignore */ }
    };

    const changeHandler = () => applyToSolid(false);
    const dragHandler = (event) => {
      const dragging = !!event?.value;
      try { if (this.viewer?.controls) this.viewer.controls.enabled = !dragging; } catch { /* ignore */ }
      if (!dragging) applyToSolid(true);
    };
    const objectChangeHandler = () => {
      if (!controls.dragging) applyToSolid(true);
    };
    const updateForCamera = () => {
      try { controls.update?.(); } catch { /* ignore */ }
    };
    const cameraChangeHandler = () => updateForCamera();
    controls.addEventListener('change', changeHandler);
    controls.addEventListener('dragging-changed', dragHandler);
    controls.addEventListener('objectChange', objectChangeHandler);
    try { this.viewer?.controls?.addEventListener?.('change', cameraChangeHandler); } catch { /* ignore */ }

    const globalState = { controls, viewer: this.viewer, target, updateForCamera };
    try { window.__BREP_activeXform = globalState; } catch { /* ignore */ }
    this._transformSession = {
      solid,
      controls,
      target,
      changeHandler,
      dragHandler,
      objectChangeHandler,
      cameraChangeHandler,
      globalState,
      mode: 'translate',
    };
    if (this._physicsWorld) {
      void this._rebuildPhysicsWorld();
    }
    updateForCamera();
    applyToSolid(false);
  }

  _stopTransformSession() {
    const session = this._transformSession;
    if (!session) return;
    try { session.controls?.removeEventListener('change', session.changeHandler); } catch { /* ignore */ }
    try { session.controls?.removeEventListener('dragging-changed', session.dragHandler); } catch { /* ignore */ }
    try { session.controls?.removeEventListener('objectChange', session.objectChangeHandler); } catch { /* ignore */ }
    try { this.viewer?.controls?.removeEventListener?.('change', session.cameraChangeHandler); } catch { /* ignore */ }
    try { session.controls?.detach?.(); } catch { /* ignore */ }
    try { this.viewer?.scene?.remove?.(session.controls); } catch { /* ignore */ }
    try { this.viewer?.scene?.remove?.(session.target); } catch { /* ignore */ }
    try { session.controls?.dispose?.(); } catch { /* ignore */ }
    try {
      if (window.__BREP_activeXform === session.globalState) {
        window.__BREP_activeXform = null;
      }
    } catch { /* ignore */ }
    this._transformSession = null;
    try { if (this.viewer?.controls) this.viewer.controls.enabled = true; } catch { /* ignore */ }
    if (this._physicsWorld) {
      void this._rebuildPhysicsWorld();
    }
    try { this.viewer?.render?.(); } catch { /* ignore */ }
  }

  _listSceneSolids() {
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene || null;
    const solids = [];
    if (!scene?.traverse) return solids;
    scene.traverse((obj) => {
      if (obj?.type === 'SOLID') solids.push(obj);
    });
    return solids;
  }

  _bindStateManager() {
    const manager = this.viewer?.partHistory?.simulationStateManager;
    if (!manager?.addListener) return;
    this._removeStateManagerListener = manager.addListener(() => {
      this._reconcileMotionState();
      if (this._active && this._physicsWorld) {
        void this._rebuildPhysicsWorld();
      }
      this._emit();
    });
  }

  _emit() {
    if (!this._listeners || this._listeners.size === 0) return;
    const payload = {
      active: this._active,
      playing: this._isPlaying,
      manager: this,
    };
    for (const listener of Array.from(this._listeners as Iterable<any>)) {
      try { listener(payload); } catch { /* ignore */ }
    }
  }

  _getMotionEntries() {
    const motions = this.viewer?.partHistory?.simulationStateManager?.getMotions?.();
    return Array.isArray(motions)
      ? motions.map((entry) => (entry?.inputParams && typeof entry.inputParams === 'object') ? entry.inputParams : entry).filter(Boolean)
      : [];
  }

  _resetMotionRuntime() {
    this._motionState.clear();
    for (const motion of this._getMotionEntries()) {
      this._motionState.set(motion.id, { progress: 0, completed: false });
    }
  }

  _reconcileMotionState() {
    const activeIds = new Set();
    for (const motion of this._getMotionEntries()) {
      activeIds.add(motion.id);
      if (!this._motionState.has(motion.id)) {
        this._motionState.set(motion.id, { progress: 0, completed: false });
      }
    }
    for (const id of Array.from(this._motionState.keys())) {
      if (!activeIds.has(id)) this._motionState.delete(id);
    }
  }

  _isSolidMotionDriven(solid) {
    if (!solid || !this._isPlaying) return false;
    const name = normalizeText(solid.name, '');
    if (!name) return false;
    return this._getMotionEntries().some((motion) => normalizeText(this._resolveReferenceName(motion?.solid), '') === name);
  }

  _isSolidKinematicMotionDriven(solid) {
    return !!solid && this.getSolidFixed(solid) && this._isSolidMotionDriven(solid);
  }

  _applyMotionStep(dt) {
    const selectedSolid = this._transformSession?.solid || null;
    const commands = new Map();
    for (const solid of this._listSceneSolids()) {
      if (!this._isSolidMotionDriven(solid)) continue;
      if (selectedSolid && solid === selectedSolid) continue;
      if (this._isSolidKinematicMotionDriven(solid)) continue;
      const body = this._bodyState.get(solid.uuid)?.body;
      if (!body) continue;
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (const motion of this._getMotionEntries()) {
      const solid = this._resolveMotionSolid(motion);
      if (!solid) continue;
      if (selectedSolid && solid === selectedSolid) continue;
      if (motion.type === 'linear') this._applyLinearMotionStep(solid, motion, dt, commands);
      else this._applyRotationMotionStep(solid, motion, dt, commands);
    }
    for (const [solidUuid, command] of commands.entries()) {
      const body = this._bodyState.get(solidUuid)?.body;
      if (!body) continue;
      body.setLinvel(command.linear, true);
      body.setAngvel(command.angular, true);
    }
    return commands.size > 0;
  }

  _resolveMotionSolid(motion) {
    const name = normalizeText(this._resolveReferenceName(motion?.solid), '');
    if (!name) return null;
    const object = this.viewer?.partHistory?.getObjectByName?.(name) || null;
    return object?.type === 'SOLID' ? object : null;
  }

  _resolveMotionAxis(motion) {
    const objectName = normalizeText(this._resolveReferenceName(motion?.axis), '');
    const object = objectName ? this.viewer?.partHistory?.getObjectByName?.(objectName) : null;
    if (!object) return null;
    const live = this._extractAxisPointsFromObject(object);
    if (!live?.start || !live?.end) return null;
    const startVec = new THREE.Vector3(Number(live.start[0]) || 0, Number(live.start[1]) || 0, Number(live.start[2]) || 0);
    const endVec = new THREE.Vector3(Number(live.end[0]) || 0, Number(live.end[1]) || 0, Number(live.end[2]) || 0);
    if (startVec.distanceToSquared(endVec) <= 1e-12) return null;
    return { start: startVec, end: endVec };
  }

  _resolveReferenceName(value) {
    if (Array.isArray(value)) {
      return this._resolveReferenceName(value[0] || null);
    }
    if (value && typeof value === 'object') {
      return normalizeText(value.name || value.objectName || value.label || '', '');
    }
    return normalizeText(value, '');
  }

  _extractAxisPointsFromObject(object) {
    if (!object) return null;
    try {
      if (typeof object.points === 'function') {
        const points = object.points(true);
        if (Array.isArray(points) && points.length >= 2) {
          const first = points[0];
          const last = points[points.length - 1];
          return {
            start: [Number(first?.x) || 0, Number(first?.y) || 0, Number(first?.z) || 0],
            end: [Number(last?.x) || 0, Number(last?.y) || 0, Number(last?.z) || 0],
          };
        }
      }
    } catch { /* ignore */ }
    try {
      object.updateMatrixWorld?.(true);
      const attr = object.geometry?.getAttribute?.('position');
      if (!attr || attr.count < 2) return null;
      const first = new THREE.Vector3(attr.getX(0), attr.getY(0), attr.getZ(0)).applyMatrix4(object.matrixWorld);
      const lastIndex = attr.count - 1;
      const last = new THREE.Vector3(attr.getX(lastIndex), attr.getY(lastIndex), attr.getZ(lastIndex)).applyMatrix4(object.matrixWorld);
      return {
        start: [first.x, first.y, first.z],
        end: [last.x, last.y, last.z],
      };
    } catch {
      return null;
    }
  }

  _getMotionCommand(commands, solid) {
    if (!solid?.uuid) return null;
    let command = commands.get(solid.uuid);
    if (!command) {
      command = {
        linear: { x: 0, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0 },
      };
      commands.set(solid.uuid, command);
    }
    return command;
  }

  _applyRotationMotionStep(solid, motion, dt, commands) {
    const state = this._motionState.get(motion.id) || { progress: 0, completed: false };
    if (state.completed) return false;
    const axis = this._resolveMotionAxis(motion);
    if (!axis) return false;
    const body = this._bodyState.get(solid.uuid)?.body || null;
    if (!body) return false;
    const speedDeg = Number(motion?.speed);
    if (!Number.isFinite(speedDeg) || Math.abs(speedDeg) <= 1e-9) return false;
    let deltaDeg = speedDeg * dt;
    const limitDeg = normalizeOptionalMotionLimit(motion?.angle);
    if (limitDeg != null) {
      const remaining = limitDeg - state.progress;
      if (Math.abs(remaining) <= 1e-9) {
        state.completed = true;
        this._motionState.set(motion.id, state);
        return false;
      }
      if (Math.sign(deltaDeg || 1) !== Math.sign(remaining || 1)) {
        deltaDeg = Math.sign(remaining || 1) * Math.abs(deltaDeg);
      }
      if (Math.abs(deltaDeg) > Math.abs(remaining)) deltaDeg = remaining;
    }
    if (Math.abs(deltaDeg) <= 1e-9) return false;
    if (this._isSolidKinematicMotionDriven(solid)) {
      this._rotateSolidAroundWorldAxis(solid, axis.start, axis.end, THREE.MathUtils.degToRad(deltaDeg));
      const worldPosition = solid.getWorldPosition(new THREE.Vector3());
      const worldQuaternion = solid.getWorldQuaternion(new THREE.Quaternion());
      body.setNextKinematicTranslation(worldPosition);
      body.setNextKinematicRotation(worldQuaternion);
      this._updateRuntimeTransformFromSolid(solid, { persist: false });
      this._movedSolidIds.add(solid.uuid);
      state.progress += deltaDeg;
      if (limitDeg != null && Math.abs(limitDeg - state.progress) <= 1e-9) state.completed = true;
      this._motionState.set(motion.id, state);
      return true;
    }
    const omega = THREE.MathUtils.degToRad(deltaDeg) / Math.max(dt, 1e-9);
    const scratch = this._scratch;
    const command = this._getMotionCommand(commands, solid);
    const translation = body.translation();
    scratch.axis.copy(axis.end).sub(axis.start).normalize().multiplyScalar(omega);
    scratch.radius.set(
      Number(translation?.x) || 0,
      Number(translation?.y) || 0,
      Number(translation?.z) || 0,
    ).sub(axis.start);
    scratch.velocity.copy(scratch.axis).cross(scratch.radius);
    command.angular.x += scratch.axis.x;
    command.angular.y += scratch.axis.y;
    command.angular.z += scratch.axis.z;
    command.linear.x += scratch.velocity.x;
    command.linear.y += scratch.velocity.y;
    command.linear.z += scratch.velocity.z;
    state.progress += deltaDeg;
    if (limitDeg != null && Math.abs(limitDeg - state.progress) <= 1e-9) state.completed = true;
    this._motionState.set(motion.id, state);
    return true;
  }

  _applyLinearMotionStep(solid, motion, dt, commands) {
    const state = this._motionState.get(motion.id) || { progress: 0, completed: false };
    if (state.completed) return false;
    const axis = this._resolveMotionAxis(motion);
    if (!axis) return false;
    const body = this._bodyState.get(solid.uuid)?.body || null;
    if (!body) return false;
    const speed = Number(motion?.speed);
    if (!Number.isFinite(speed) || Math.abs(speed) <= 1e-9) return false;
    let delta = speed * dt;
    const limit = normalizeOptionalMotionLimit(motion?.distance);
    if (limit != null) {
      const remaining = limit - state.progress;
      if (Math.abs(remaining) <= 1e-9) {
        state.completed = true;
        this._motionState.set(motion.id, state);
        return false;
      }
      if (Math.sign(delta || 1) !== Math.sign(remaining || 1)) {
        delta = Math.sign(remaining || 1) * Math.abs(delta);
      }
      if (Math.abs(delta) > Math.abs(remaining)) delta = remaining;
    }
    if (Math.abs(delta) <= 1e-9) return false;
    if (this._isSolidKinematicMotionDriven(solid)) {
      this._translateSolidAlongWorldAxis(solid, axis.start, axis.end, delta);
      const worldPosition = solid.getWorldPosition(new THREE.Vector3());
      const worldQuaternion = solid.getWorldQuaternion(new THREE.Quaternion());
      body.setNextKinematicTranslation(worldPosition);
      body.setNextKinematicRotation(worldQuaternion);
      this._updateRuntimeTransformFromSolid(solid, { persist: false });
      this._movedSolidIds.add(solid.uuid);
      state.progress += delta;
      if (limit != null && Math.abs(limit - state.progress) <= 1e-9) state.completed = true;
      this._motionState.set(motion.id, state);
      return true;
    }
    const velocityScale = delta / Math.max(dt, 1e-9);
    const scratch = this._scratch;
    const command = this._getMotionCommand(commands, solid);
    const translation = body.translation();
    scratch.axis.copy(axis.end).sub(axis.start).normalize();
    scratch.translation.copy(scratch.axis).multiplyScalar(delta);
    body.setTranslation({
      x: (Number(translation?.x) || 0) + scratch.translation.x,
      y: (Number(translation?.y) || 0) + scratch.translation.y,
      z: (Number(translation?.z) || 0) + scratch.translation.z,
    }, true);
    scratch.axis.multiplyScalar(velocityScale);
    command.linear.x += scratch.axis.x;
    command.linear.y += scratch.axis.y;
    command.linear.z += scratch.axis.z;
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    state.progress += delta;
    if (limit != null && Math.abs(limit - state.progress) <= 1e-9) state.completed = true;
    this._motionState.set(motion.id, state);
    return true;
  }

  _rotateSolidAroundWorldAxis(solid, axisStart, axisEnd, angleRad) {
    const parent = solid.parent || this.viewer?.scene || null;
    const scratch = this._scratch;
    scratch.axis.copy(axisEnd).sub(axisStart).normalize();
    scratch.parentWorldMatrix.copy(parent?.matrixWorld || new THREE.Matrix4());
    scratch.parentInverse.copy(scratch.parentWorldMatrix).invert();
    scratch.worldMatrix.copy(solid.matrixWorld);
    scratch.deltaMatrix.makeTranslation(axisStart.x, axisStart.y, axisStart.z);
    scratch.deltaMatrix.multiply(new THREE.Matrix4().makeRotationAxis(scratch.axis, angleRad));
    scratch.deltaMatrix.multiply(new THREE.Matrix4().makeTranslation(-axisStart.x, -axisStart.y, -axisStart.z));
    scratch.worldMatrix.premultiply(scratch.deltaMatrix);
    scratch.localMatrix.copy(scratch.parentInverse).multiply(scratch.worldMatrix);
    scratch.localMatrix.decompose(solid.position, solid.quaternion, solid.scale);
    solid.updateMatrixWorld?.(true);
    this._syncProxyGroupTransform(solid);
  }

  _translateSolidAlongWorldAxis(solid, axisStart, axisEnd, distance) {
    const parent = solid.parent || this.viewer?.scene || null;
    const scratch = this._scratch;
    scratch.axis.copy(axisEnd).sub(axisStart).normalize();
    scratch.translation.copy(scratch.axis).multiplyScalar(distance);
    scratch.parentWorldMatrix.copy(parent?.matrixWorld || new THREE.Matrix4());
    scratch.parentInverse.copy(scratch.parentWorldMatrix).invert();
    scratch.worldMatrix.copy(solid.matrixWorld);
    scratch.deltaMatrix.makeTranslation(scratch.translation.x, scratch.translation.y, scratch.translation.z);
    scratch.worldMatrix.premultiply(scratch.deltaMatrix);
    scratch.localMatrix.copy(scratch.parentInverse).multiply(scratch.worldMatrix);
    scratch.localMatrix.decompose(solid.position, solid.quaternion, solid.scale);
    solid.updateMatrixWorld?.(true);
    this._syncProxyGroupTransform(solid);
  }
}
