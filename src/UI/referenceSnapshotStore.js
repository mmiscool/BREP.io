import * as THREE from 'three';
import { SelectionFilter } from './SelectionFilter.js';

export const REFERENCE_SNAPSHOT_STORE_KEY = 'referenceSnapshots';
const DEFAULT_FIELD_KEY = '__default';
const EPS = 1e-12;

export function normalizeReferenceSnapshotFieldKey(raw) {
  const key = String(raw || '').trim();
  return key || DEFAULT_FIELD_KEY;
}

export function normalizeReferenceSnapshotName(obj) {
  if (!obj) return null;
  const raw = obj.name != null ? String(obj.name).trim() : '';
  if (raw) return raw;
  const type = obj.type || 'OBJECT';
  const pos = obj.position || {};
  const x = Number.isFinite(pos.x) ? pos.x : 0;
  const y = Number.isFinite(pos.y) ? pos.y : 0;
  const z = Number.isFinite(pos.z) ? pos.z : 0;
  return `${type}(${x},${y},${z})`;
}

export function getReferenceSnapshotStore(persistentData) {
  const store = persistentData?.[REFERENCE_SNAPSHOT_STORE_KEY];
  return store && typeof store === 'object' ? store : null;
}

export function ensureReferenceSnapshotBucket(persistentData, fieldKey) {
  if (!persistentData || typeof persistentData !== 'object') return null;
  if (!persistentData[REFERENCE_SNAPSHOT_STORE_KEY] || typeof persistentData[REFERENCE_SNAPSHOT_STORE_KEY] !== 'object') {
    persistentData[REFERENCE_SNAPSHOT_STORE_KEY] = {};
  }
  const key = normalizeReferenceSnapshotFieldKey(fieldKey);
  if (!persistentData[REFERENCE_SNAPSHOT_STORE_KEY][key] || typeof persistentData[REFERENCE_SNAPSHOT_STORE_KEY][key] !== 'object') {
    persistentData[REFERENCE_SNAPSHOT_STORE_KEY][key] = {};
  }
  return persistentData[REFERENCE_SNAPSHOT_STORE_KEY][key];
}

export function getReferenceSnapshotBucket(persistentData, fieldKey) {
  const store = getReferenceSnapshotStore(persistentData);
  if (!store) return null;
  const bucket = store[normalizeReferenceSnapshotFieldKey(fieldKey)];
  return bucket && typeof bucket === 'object' ? bucket : null;
}

export function setReferenceSnapshot(persistentData, fieldKey, refName, snapshot) {
  const name = String(refName || '').trim();
  if (!name || !snapshot || typeof snapshot !== 'object') return false;
  const bucket = ensureReferenceSnapshotBucket(persistentData, fieldKey);
  if (!bucket) return false;
  bucket[name] = snapshot;
  return true;
}

export function extractEdgeWorldPositions(obj) {
  if (!obj) return [];
  try { obj.updateMatrixWorld?.(true); } catch { /* ignore */ }
  try {
    if (typeof obj.points === 'function') {
      const pts = obj.points(true);
      if (Array.isArray(pts) && pts.length) {
        const flat = [];
        for (const p of pts) {
          if (!p) continue;
          const x = Number(p.x);
          const y = Number(p.y);
          const z = Number(p.z);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
          flat.push(x, y, z);
        }
        if (flat.length >= 6) return flat;
      }
    }
  } catch { /* ignore */ }

  try {
    const geom = obj.geometry;
    const pos = geom && typeof geom.getAttribute === 'function' ? geom.getAttribute('position') : null;
    if (!pos || pos.itemSize !== 3 || pos.count < 2) return [];
    const tmp = new THREE.Vector3();
    const flat = [];
    for (let i = 0; i < pos.count; i += 1) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      tmp.applyMatrix4(obj.matrixWorld);
      flat.push(tmp.x, tmp.y, tmp.z);
    }
    return flat.length >= 6 ? flat : [];
  } catch { /* ignore */ }
  return [];
}

export function extractFaceEdgePositions(face) {
  if (!face) return [];
  const out = [];
  const addEdge = (edge) => {
    const positions = extractEdgeWorldPositions(edge);
    if (positions && positions.length >= 6) out.push(positions);
  };

  if (Array.isArray(face.edges) && face.edges.length) {
    for (const edge of face.edges) addEdge(edge);
    return out;
  }

  const faceName = face?.name || face?.userData?.faceName || null;
  const parentSolid = face?.parentSolid || face?.userData?.parentSolid || face?.parent || null;
  if (!faceName || !parentSolid || !Array.isArray(parentSolid.children)) return out;

  for (const child of parentSolid.children) {
    if (!child || child.type !== SelectionFilter.EDGE) continue;
    const faceA = child?.userData?.faceA || null;
    const faceB = child?.userData?.faceB || null;
    if (faceA === faceName || faceB === faceName) addEdge(child);
  }
  return out;
}

export function extractFaceCenterNormal(face, edgePositions = null) {
  if (!face) return null;
  try { face.updateMatrixWorld?.(true); } catch { /* ignore */ }

  let centerVec = null;
  try {
    const geom = face.geometry;
    const pos = geom && typeof geom.getAttribute === 'function' ? geom.getAttribute('position') : null;
    if (pos && pos.itemSize === 3 && pos.count > 0) {
      const sum = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 1) {
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(face.matrixWorld);
        sum.add(tmp);
      }
      centerVec = sum.multiplyScalar(1 / pos.count);
    }
  } catch { /* ignore */ }

  const loops = Array.isArray(edgePositions) ? edgePositions : extractFaceEdgePositions(face);
  if (!centerVec && Array.isArray(loops) && loops.length) {
    const pts = [];
    for (const positions of loops) {
      if (!Array.isArray(positions)) continue;
      for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = Number(positions[i]);
        const y = Number(positions[i + 1]);
        const z = Number(positions[i + 2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        pts.push(new THREE.Vector3(x, y, z));
      }
    }
    if (pts.length) {
      centerVec = new THREE.Vector3();
      for (const p of pts) centerVec.add(p);
      centerVec.multiplyScalar(1 / pts.length);
    }
  }

  let normalVec = null;
  try {
    if (typeof face.getAverageNormal === 'function') {
      const n = face.getAverageNormal();
      if (n && n.lengthSq() > EPS) normalVec = n.clone().normalize();
    }
  } catch { /* ignore */ }

  if (!normalVec) {
    try {
      const geom = face.geometry;
      const pos = geom && typeof geom.getAttribute === 'function' ? geom.getAttribute('position') : null;
      const idx = geom && typeof geom.getIndex === 'function' ? geom.getIndex() : null;
      if (pos && pos.itemSize === 3 && pos.count >= 3) {
        const v0 = new THREE.Vector3();
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();
        const accum = new THREE.Vector3();
        const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
        const samples = Math.min(triCount, 60);

        for (let tri = 0; tri < samples; tri += 1) {
          let i0;
          let i1;
          let i2;
          if (idx) {
            const base = tri * 3;
            if (base + 2 >= idx.count) break;
            i0 = idx.getX(base);
            i1 = idx.getX(base + 1);
            i2 = idx.getX(base + 2);
          } else {
            i0 = tri * 3;
            i1 = i0 + 1;
            i2 = i0 + 2;
            if (i2 >= pos.count) break;
          }

          v0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(face.matrixWorld);
          v1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(face.matrixWorld);
          v2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(face.matrixWorld);
          e1.subVectors(v1, v0);
          e2.subVectors(v2, v0);
          const n = new THREE.Vector3().crossVectors(e1, e2);
          if (n.lengthSq() > EPS) accum.add(n);
        }

        if (accum.lengthSq() > EPS) normalVec = accum.normalize();
      }
    } catch { /* ignore */ }
  }

  if (!normalVec && centerVec && Array.isArray(loops) && loops.length) {
    const accum = new THREE.Vector3();
    for (const positions of loops) {
      if (!Array.isArray(positions)) continue;
      const pts = [];
      for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = Number(positions[i]);
        const y = Number(positions[i + 1]);
        const z = Number(positions[i + 2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        pts.push(new THREE.Vector3(x, y, z));
      }
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i].clone().sub(centerVec);
        const b = pts[i + 1].clone().sub(centerVec);
        const cross = new THREE.Vector3().crossVectors(a, b);
        if (cross.lengthSq() > EPS) accum.add(cross);
      }
    }
    if (accum.lengthSq() > EPS) normalVec = accum.normalize();
  }

  if (!centerVec && !normalVec) return null;
  return {
    center: centerVec ? [centerVec.x, centerVec.y, centerVec.z] : null,
    normal: normalVec ? [normalVec.x, normalVec.y, normalVec.z] : null,
  };
}

export function getOwningFeatureIdForSnapshotObject(obj) {
  let cur = obj;
  let guard = 0;
  while (cur && guard < 8) {
    if (cur.owningFeatureID != null) return cur.owningFeatureID;
    cur = cur.parent || null;
    guard += 1;
  }
  return null;
}

export function buildReferenceSnapshot(obj, options = {}) {
  if (!obj || typeof obj !== 'object') return null;
  const objType = String(obj.type || '').toUpperCase();
  const sourceUuid = options.sourceUuid !== undefined ? options.sourceUuid : (obj.uuid || null);
  const sourceFeatureId = options.sourceFeatureId !== undefined
    ? options.sourceFeatureId
    : getOwningFeatureIdForSnapshotObject(obj);
  const sourceTimestamp = options.sourceTimestamp !== undefined
    ? options.sourceTimestamp
    : (obj.timestamp ?? obj.userData?.timestamp ?? null);

  if (objType === SelectionFilter.EDGE || objType === 'EDGE') {
    const positions = extractEdgeWorldPositions(obj);
    if (positions && positions.length >= 6) return { type: 'EDGE', positions, sourceUuid, sourceFeatureId, sourceTimestamp };
    return null;
  }

  if (objType === SelectionFilter.FACE || objType === 'FACE' || objType === SelectionFilter.PLANE || objType === 'PLANE') {
    const edgePositions = extractFaceEdgePositions(obj);
    if (!edgePositions || !edgePositions.length) return null;
    const snapType = (objType === SelectionFilter.PLANE || objType === 'PLANE') ? 'PLANE' : 'FACE';
    const faceGeom = extractFaceCenterNormal(obj, edgePositions);
    return {
      type: snapType,
      edgePositions,
      center: Array.isArray(faceGeom?.center) ? faceGeom.center : null,
      normal: Array.isArray(faceGeom?.normal) ? faceGeom.normal : null,
      sourceUuid,
      sourceFeatureId,
      sourceTimestamp,
    };
  }

  if (objType === SelectionFilter.VERTEX || objType === 'VERTEX') {
    const pos = new THREE.Vector3();
    try {
      if (typeof obj.getWorldPosition === 'function') obj.getWorldPosition(pos);
      else pos.set(obj.position?.x || 0, obj.position?.y || 0, obj.position?.z || 0);
    } catch { /* ignore */ }
    return { type: 'VERTEX', position: [pos.x, pos.y, pos.z], sourceUuid, sourceFeatureId, sourceTimestamp };
  }

  return null;
}

export function isReferenceSnapshotUsable(snapshot) {
  const type = String(snapshot?.type || '').toUpperCase();
  if (type === 'EDGE') return Array.isArray(snapshot.positions) && snapshot.positions.length >= 6;
  if (type === 'VERTEX') return Array.isArray(snapshot.position) && snapshot.position.length >= 3;
  if (type === 'FACE' || type === 'PLANE') return Array.isArray(snapshot.edgePositions) && snapshot.edgePositions.length > 0;
  return false;
}

function normalizeAllowedTypes(allowedTypes = null) {
  if (allowedTypes instanceof Set) return allowedTypes;
  if (Array.isArray(allowedTypes)) return new Set(allowedTypes.map((type) => String(type).toUpperCase()));
  return null;
}

export function resolveReferenceSnapshotFromNames(persistentData, fieldKey, names = [], allowedTypes = null) {
  const bucket = getReferenceSnapshotBucket(persistentData, fieldKey);
  if (!bucket) return null;
  const typeSet = normalizeAllowedTypes(allowedTypes);
  const acceptsType = (snapshot) => {
    if (!(typeSet instanceof Set) || typeSet.size === 0) return true;
    return typeSet.has(String(snapshot?.type || '').toUpperCase());
  };

  for (const rawName of Array.isArray(names) ? names : []) {
    const name = String(rawName || '').trim();
    if (!name || !Object.prototype.hasOwnProperty.call(bucket, name)) continue;
    const snapshot = bucket[name];
    if (isReferenceSnapshotUsable(snapshot) && acceptsType(snapshot)) return snapshot;
  }

  for (const key of Object.keys(bucket)) {
    const snapshot = bucket[key];
    if (isReferenceSnapshotUsable(snapshot) && acceptsType(snapshot)) return snapshot;
  }
  return null;
}

export function captureReferenceSelectionSnapshots({ stores = [], schema = null, resolvedParams = null } = {}) {
  if (!schema || !resolvedParams) return 0;
  const targets = Array.isArray(stores)
    ? stores.filter((store) => store && typeof store === 'object')
    : [];
  if (!targets.length) return 0;

  let captured = 0;
  for (const key in schema) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) continue;
    const def = schema[key];
    if (!def || def.type !== 'reference_selection') continue;
    const selected = Array.isArray(resolvedParams[key]) ? resolvedParams[key] : [];
    if (!selected.length) continue;

    for (const obj of selected) {
      const refName = normalizeReferenceSnapshotName(obj);
      if (!refName) continue;
      const snapshot = buildReferenceSnapshot(obj);
      if (!snapshot) continue;
      for (const store of targets) {
        if (setReferenceSnapshot(store, key, refName, snapshot)) captured += 1;
      }
    }
  }
  return captured;
}
