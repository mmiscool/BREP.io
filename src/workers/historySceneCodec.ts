// historySceneCodec.ts
// Serializes THREE scene objects produced by feature-history execution into
// structured-clone-safe payloads that can cross a worker message boundary,
// and rehydrates them back into live CAD display objects (Solid, Face, Edge,
// Vertex, AssemblyComponent, ...) on the receiving side.
//
// Solids travel as authoring-state snapshots (the same format used by the
// undo/effect-snapshot machinery) and are rebuilt via visualize(); everything
// else travels as a generic node graph with geometry buffers and material
// descriptors.

import * as THREE from 'three';
import { LineGeometry } from 'three/examples/jsm/Addons.js';
import { Solid } from '../BREP/BetterSolid.js';
import { Face } from '../BREP/Face.js';
import { Edge } from '../BREP/Edge.js';
import { Vertex } from '../BREP/Vertex.js';
import { AssemblyComponent } from '../BREP/AssemblyComponent.js';
import {
  applySolidAuthoringStateSnapshot,
  buildSolidAuthoringStateSnapshot,
} from '../BREP/CppSolidCore.js';
import { CADmaterials } from '../UI/CADmaterials.js';
import { SelectionState } from '../UI/SelectionState.js';

type AnyRecord = Record<string, any>;

const IDENTITY_POSITION = [0, 0, 0];
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const IDENTITY_SCALE = [1, 1, 1];

// ---------------------------------------------------------------------------
// userData sanitization
// ---------------------------------------------------------------------------

function isPlainObject(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sanitizeUserDataForTransfer(value: any, seen: WeakSet<object> = new WeakSet(), depth = 0): any {
  if (value == null) return value;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t !== 'object') return undefined; // functions, symbols
  if (depth > 24) return undefined;
  if (seen.has(value)) return undefined;

  // Live scene/render resources never cross the boundary.
  if (value.isObject3D || value.isMaterial || value.isTexture || value.isBufferGeometry) return undefined;

  if (ArrayBuffer.isView(value)) {
    try { return (value as any).slice(); } catch { return undefined; }
  }
  if (value instanceof ArrayBuffer) {
    try { return value.slice(0); } catch { return undefined; }
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) {
        const cleaned = sanitizeUserDataForTransfer(item, seen, depth + 1);
        out.push(cleaned === undefined ? null : cleaned);
      }
      return out;
    }
    if (!isPlainObject(value)) return undefined; // class instances (Maps, Sets, custom)
    const out: AnyRecord = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = sanitizeUserDataForTransfer(item, seen, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

// ---------------------------------------------------------------------------
// Material handling
// ---------------------------------------------------------------------------

function sharedMaterialKey(material: any): string | null {
  if (!material) return null;
  try {
    for (const [groupName, group] of Object.entries(CADmaterials as AnyRecord)) {
      if (!group || typeof group !== 'object') continue;
      for (const [variantName, mat] of Object.entries(group as AnyRecord)) {
        if (mat === material) return `${groupName}.${variantName}`;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function resolveSharedMaterial(key: string | null): any {
  if (!key) return null;
  try {
    const [groupName, variantName] = String(key).split('.');
    return (CADmaterials as AnyRecord)?.[groupName]?.[variantName] || null;
  } catch { return null; }
}

const MATERIAL_SCALAR_PROPS = [
  'opacity', 'transparent', 'side', 'depthTest', 'depthWrite', 'wireframe',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'flatShading',
  'metalness', 'roughness', 'linewidth', 'worldUnits', 'dashed', 'size',
  'sizeAttenuation', 'vertexColors', 'toneMapped', 'fog', 'alphaTest',
];

function describeMaterial(material: any): AnyRecord | null {
  if (!material) return null;
  if (Array.isArray(material)) {
    const first = material.find(Boolean);
    return describeMaterial(first);
  }
  const shared = sharedMaterialKey(material);
  if (shared) return { shared };
  const desc: AnyRecord = { kind: String(material.type || 'MeshStandardMaterial') };
  try { if (material.color?.isColor) desc.color = `#${material.color.getHexString()}`; } catch { /* ignore */ }
  for (const prop of MATERIAL_SCALAR_PROPS) {
    const value = material[prop];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' || typeof value === 'boolean') desc[prop] = value;
  }
  return desc;
}

function buildMaterialFromDescriptor(desc: AnyRecord | null, fallbackKind: string): any {
  if (desc?.shared) {
    const shared = resolveSharedMaterial(desc.shared);
    if (shared) return shared;
  }
  const kind = String(desc?.kind || fallbackKind);
  let material: any;
  switch (kind) {
    case 'MeshBasicMaterial': material = new THREE.MeshBasicMaterial(); break;
    case 'MeshLambertMaterial': material = new THREE.MeshLambertMaterial(); break;
    case 'MeshPhongMaterial': material = new THREE.MeshPhongMaterial(); break;
    case 'MeshNormalMaterial': material = new THREE.MeshNormalMaterial(); break;
    case 'LineBasicMaterial': material = new THREE.LineBasicMaterial(); break;
    case 'LineDashedMaterial': material = new THREE.LineDashedMaterial(); break;
    case 'PointsMaterial': material = new THREE.PointsMaterial(); break;
    case 'MeshStandardMaterial':
    default:
      if (kind.startsWith('Line')) material = new THREE.LineBasicMaterial();
      else if (kind === 'PointsMaterial') material = new THREE.PointsMaterial();
      else material = new THREE.MeshStandardMaterial();
      break;
  }
  if (!desc) return material;
  try { if (desc.color && material.color?.isColor) material.color.set(desc.color); } catch { /* ignore */ }
  for (const prop of MATERIAL_SCALAR_PROPS) {
    if (desc[prop] === undefined) continue;
    if (prop in material) {
      try { material[prop] = desc[prop]; } catch { /* ignore */ }
    }
  }
  material.needsUpdate = true;
  return material;
}

// Detect a per-object base-material override (e.g. sketch profile faces clone
// the FACE base material and tweak side/polygonOffset).
function describeBaseMaterialOverride(obj: any): AnyRecord | null {
  const base = obj?.userData?.__baseMaterial;
  if (!base || !base.isMaterial) return null;
  if (sharedMaterialKey(base)) return null; // shared base -> class default is fine
  return describeMaterial(base);
}

// ---------------------------------------------------------------------------
// Geometry handling
// ---------------------------------------------------------------------------

function serializeBufferGeometry(geometry: any): AnyRecord | null {
  if (!geometry || !geometry.isBufferGeometry) return null;
  const out: AnyRecord = { attributes: {}, index: null, groups: [] };
  try {
    for (const [name, attr] of Object.entries(geometry.attributes || {}) as [string, any][]) {
      if (!attr) continue;
      if (attr.isInterleavedBufferAttribute) {
        // De-interleave into a flat array.
        const count = attr.count;
        const itemSize = attr.itemSize;
        const array = new Float32Array(count * itemSize);
        for (let i = 0; i < count; i++) {
          for (let c = 0; c < itemSize; c++) {
            array[i * itemSize + c] = attr.getComponent ? attr.getComponent(i, c) : attr[`get${'XYZW'[c]}`](i);
          }
        }
        out.attributes[name] = { array, itemSize, normalized: !!attr.normalized };
        continue;
      }
      if (!attr.array) continue;
      out.attributes[name] = {
        array: attr.array.slice(),
        itemSize: attr.itemSize,
        normalized: !!attr.normalized,
      };
    }
    if (geometry.index?.array) out.index = { array: geometry.index.array.slice() };
    if (Array.isArray(geometry.groups) && geometry.groups.length) {
      out.groups = geometry.groups.map((g: any) => ({
        start: g.start, count: g.count, materialIndex: g.materialIndex || 0,
      }));
    }
  } catch {
    return null;
  }
  return out;
}

function rehydrateBufferGeometry(data: AnyRecord | null): THREE.BufferGeometry | null {
  if (!data || !data.attributes) return null;
  const geometry = new THREE.BufferGeometry();
  try {
    for (const [name, attr] of Object.entries(data.attributes) as [string, any][]) {
      if (!attr?.array) continue;
      const array = ArrayBuffer.isView(attr.array) ? attr.array : new Float32Array(attr.array);
      geometry.setAttribute(name, new THREE.BufferAttribute(array as any, attr.itemSize || 3, !!attr.normalized));
    }
    if (data.index?.array) {
      const arr = ArrayBuffer.isView(data.index.array) ? data.index.array : new Uint32Array(data.index.array);
      geometry.setIndex(new THREE.BufferAttribute(arr as any, 1));
    }
    for (const g of Array.isArray(data.groups) ? data.groups : []) {
      geometry.addGroup(g.start, g.count, g.materialIndex || 0);
    }
    geometry.computeBoundingSphere();
  } catch {
    return null;
  }
  return geometry;
}

function extractLinePositions(obj: any): number[] | null {
  const poly = obj?.userData?.polylineLocal;
  if (Array.isArray(poly) && poly.length >= 2) {
    const flat: number[] = [];
    for (const p of poly) {
      if (!Array.isArray(p) || p.length < 3) continue;
      flat.push(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0);
    }
    if (flat.length >= 6) return flat;
  }
  // Fallback: reconstruct from fat-line instance buffers.
  const start = obj?.geometry?.attributes?.instanceStart;
  const end = obj?.geometry?.attributes?.instanceEnd;
  if (start && end && start.count > 0) {
    const flat: number[] = [];
    for (let i = 0; i < start.count; i++) {
      flat.push(start.getX(i), start.getY(i), start.getZ(i));
    }
    flat.push(end.getX(start.count - 1), end.getY(start.count - 1), end.getZ(start.count - 1));
    return flat;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

function isSerializableSolid(obj: any): boolean {
  if (!obj) return false;
  if (String(obj.type || '').toUpperCase() !== 'SOLID') return false;
  const hasArrays = (v: any) => Array.isArray(v) || ArrayBuffer.isView(v);
  return hasArrays(obj._vertProperties) && hasArrays(obj._triVerts) && hasArrays(obj._triIDs);
}

function classifyObject(obj: any): string | null {
  if (!obj || obj.isLight || obj.isCamera || obj.isTransformGizmo || obj.isSprite) return null;
  const t = String(obj.type || '').toUpperCase();
  if (isSerializableSolid(obj)) return 'SOLID';
  if (obj.isAssemblyComponent || t === 'COMPONENT') return 'COMPONENT';
  if (t === 'VERTEX') return 'VERTEX';
  if ((obj.isLine2 || obj.isLineSegments2) && t === 'EDGE') return 'EDGE';
  if (obj.isLine2 || obj.isLineSegments2) return 'FATLINE';
  if (obj.isMesh && t === 'FACE') return 'FACE';
  if (obj.isMesh) return 'MESH';
  if (obj.isLineSegments) return 'LINESEGMENTS';
  if (obj.isLineLoop) return 'LINELOOP';
  if (obj.isLine) return 'LINE';
  if (obj.isPoints) return 'POINTS';
  return 'GROUP';
}

function serializeTransform(obj: any): AnyRecord | null {
  try {
    const p = obj.position, q = obj.quaternion, s = obj.scale;
    const position = [p.x, p.y, p.z];
    const quaternion = [q.x, q.y, q.z, q.w];
    const scale = [s.x, s.y, s.z];
    const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
    if (same(position, IDENTITY_POSITION) && same(quaternion, IDENTITY_QUATERNION) && same(scale, IDENTITY_SCALE)) {
      return null;
    }
    return { position, quaternion, scale };
  } catch {
    return null;
  }
}

function applyTransform(obj: any, transform: AnyRecord | null) {
  if (!transform) return;
  try {
    if (Array.isArray(transform.position)) obj.position.fromArray(transform.position);
    if (Array.isArray(transform.quaternion)) obj.quaternion.fromArray(transform.quaternion);
    if (Array.isArray(transform.scale)) obj.scale.fromArray(transform.scale);
    obj.updateMatrix();
    obj.updateMatrixWorld(true);
  } catch { /* ignore */ }
}

function finiteOrNull(value: any): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeSceneObject(obj: any): AnyRecord | null {
  const cls = classifyObject(obj);
  if (!cls) return null;

  const node: AnyRecord = {
    cls,
    type: obj.type != null ? String(obj.type) : '',
    name: obj.name != null ? String(obj.name) : '',
    visible: obj.visible !== false,
    renderOrder: Number.isFinite(Number(obj.renderOrder)) ? Number(obj.renderOrder) : 0,
    owningFeatureID: obj.owningFeatureID != null ? String(obj.owningFeatureID) : null,
    timestamp: finiteOrNull(obj.timestamp ?? obj.userData?.timestamp),
    userData: sanitizeUserDataForTransfer(obj.userData || {}) || {},
    transform: serializeTransform(obj),
  };

  switch (cls) {
    case 'SOLID': {
      try {
        node.solid = buildSolidAuthoringStateSnapshot(obj);
      } catch {
        return null;
      }
      // Children are regenerated by visualize(); do not serialize them.
      return node;
    }
    case 'COMPONENT': {
      node.fixed = !!obj.fixed;
      break;
    }
    case 'VERTEX': {
      // Vertex rebuilds its own point marker; only the position matters.
      node.transform = serializeTransform(obj) || {
        position: [obj.position?.x || 0, obj.position?.y || 0, obj.position?.z || 0],
        quaternion: IDENTITY_QUATERNION.slice(),
        scale: IDENTITY_SCALE.slice(),
      };
      return node;
    }
    case 'EDGE':
    case 'FATLINE': {
      const positions = extractLinePositions(obj);
      if (!positions) return null;
      node.linePositions = new Float32Array(positions);
      node.closedLoop = !!obj.closedLoop;
      node.materialOverride = describeBaseMaterialOverride(obj);
      if (Array.isArray(obj.faces) && obj.faces.length) {
        node.faceNames = obj.faces.map((f: any) => String(f?.name || '')).filter(Boolean);
      }
      return node;
    }
    case 'FACE':
    case 'MESH': {
      node.geometry = serializeBufferGeometry(obj.geometry);
      if (!node.geometry) return null;
      if (cls === 'FACE') {
        node.materialOverride = describeBaseMaterialOverride(obj);
        if (Array.isArray(obj.edges) && obj.edges.length) {
          node.edgeNames = obj.edges.map((e: any) => String(e?.name || '')).filter(Boolean);
        }
      } else {
        node.material = describeMaterial(obj.material);
      }
      break;
    }
    case 'LINE':
    case 'LINELOOP':
    case 'LINESEGMENTS':
    case 'POINTS': {
      node.geometry = serializeBufferGeometry(obj.geometry);
      if (!node.geometry) return null;
      node.material = describeMaterial(obj.material);
      break;
    }
    case 'GROUP':
    default:
      break;
  }

  const children = [];
  for (const child of Array.isArray(obj.children) ? obj.children : []) {
    const serialized = serializeSceneObject(child);
    if (serialized) children.push(serialized);
  }
  if (children.length) node.children = children;
  return node;
}

export function serializeSceneObjects(objects: any[]): AnyRecord[] {
  const out = [];
  for (const obj of Array.isArray(objects) ? objects : []) {
    const node = serializeSceneObject(obj);
    if (node) out.push(node);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rehydration
// ---------------------------------------------------------------------------

function applyCommonNodeState(obj: any, node: AnyRecord) {
  try { if (node.name) obj.name = node.name; } catch { /* ignore */ }
  try { if (node.type) obj.type = node.type; } catch { /* ignore */ }
  try { obj.visible = node.visible !== false; } catch { /* ignore */ }
  try { obj.renderOrder = Number(node.renderOrder) || 0; } catch { /* ignore */ }
  try { if (node.owningFeatureID != null) obj.owningFeatureID = String(node.owningFeatureID); } catch { /* ignore */ }
  if (node.userData && typeof node.userData === 'object') {
    try { obj.userData = { ...(obj.userData || {}), ...node.userData }; } catch { /* ignore */ }
  }
  const timestamp = finiteOrNull(node.timestamp);
  if (timestamp != null) {
    try { obj.timestamp = timestamp; } catch { /* ignore */ }
  }
  applyTransform(obj, node.transform || null);
}

function applyMaterialOverride(obj: any, descriptor: AnyRecord | null, fallbackKind: string) {
  if (!descriptor) return;
  try {
    const material = buildMaterialFromDescriptor(descriptor, fallbackKind);
    if (material) SelectionState.setBaseMaterial(obj, material);
  } catch { /* ignore */ }
}

async function rehydrateSolid(node: AnyRecord): Promise<any | null> {
  try {
    const solid: any = new Solid();
    applySolidAuthoringStateSnapshot(solid, node.solid);
    applyCommonNodeState(solid, node);
    try { await solid.visualize(); } catch { /* keep un-visualized solid rather than dropping it */ }
    return solid;
  } catch {
    return null;
  }
}

function rehydrateEdge(node: AnyRecord): any | null {
  try {
    const flat = ArrayBuffer.isView(node.linePositions)
      ? Array.from(node.linePositions as unknown as ArrayLike<number>)
      : Array.isArray(node.linePositions) ? node.linePositions : null;
    if (!flat || flat.length < 6) return null;
    const geometry = new LineGeometry();
    geometry.setPositions(flat);
    const edge: any = new Edge(geometry);
    edge.closedLoop = !!node.closedLoop;
    applyCommonNodeState(edge, node);
    applyMaterialOverride(edge, node.materialOverride || null, 'LineBasicMaterial');
    return edge;
  } catch {
    return null;
  }
}

async function rehydrateNode(node: AnyRecord, registry: AnyRecord[]): Promise<any | null> {
  if (!node || typeof node !== 'object') return null;
  let obj: any = null;
  let rebuildChildren = true;

  switch (node.cls) {
    case 'SOLID': {
      obj = await rehydrateSolid(node);
      rebuildChildren = false;
      break;
    }
    case 'COMPONENT': {
      obj = new AssemblyComponent({ name: node.name || 'Component', fixed: !!node.fixed });
      applyCommonNodeState(obj, node);
      break;
    }
    case 'VERTEX': {
      const p = node.transform?.position || [0, 0, 0];
      obj = new Vertex([p[0] || 0, p[1] || 0, p[2] || 0], { name: node.name || undefined });
      applyCommonNodeState(obj, node);
      rebuildChildren = false;
      break;
    }
    case 'EDGE':
    case 'FATLINE': {
      obj = rehydrateEdge(node);
      rebuildChildren = false;
      break;
    }
    case 'FACE': {
      const geometry = rehydrateBufferGeometry(node.geometry);
      if (!geometry) return null;
      obj = new Face(geometry);
      applyCommonNodeState(obj, node);
      applyMaterialOverride(obj, node.materialOverride || null, 'MeshStandardMaterial');
      break;
    }
    case 'MESH': {
      const geometry = rehydrateBufferGeometry(node.geometry);
      if (!geometry) return null;
      const isPlane = String(node.type || '').toUpperCase() === 'PLANE';
      const material = node.material
        ? buildMaterialFromDescriptor(node.material, 'MeshStandardMaterial')
        : (isPlane ? (CADmaterials as AnyRecord)?.PLANE?.BASE : new THREE.MeshStandardMaterial());
      obj = new THREE.Mesh(geometry, material);
      applyCommonNodeState(obj, node);
      if (isPlane) { try { SelectionState.attach(obj); } catch { /* ignore */ } }
      break;
    }
    case 'LINE':
    case 'LINELOOP':
    case 'LINESEGMENTS': {
      const geometry = rehydrateBufferGeometry(node.geometry);
      if (!geometry) return null;
      const material = buildMaterialFromDescriptor(node.material || null, 'LineBasicMaterial');
      obj = node.cls === 'LINESEGMENTS'
        ? new THREE.LineSegments(geometry, material)
        : node.cls === 'LINELOOP'
          ? new THREE.LineLoop(geometry, material)
          : new THREE.Line(geometry, material);
      applyCommonNodeState(obj, node);
      break;
    }
    case 'POINTS': {
      const geometry = rehydrateBufferGeometry(node.geometry);
      if (!geometry) return null;
      const material = buildMaterialFromDescriptor(node.material || null, 'PointsMaterial');
      obj = new THREE.Points(geometry, material);
      applyCommonNodeState(obj, node);
      break;
    }
    case 'GROUP':
    default: {
      obj = new THREE.Group();
      applyCommonNodeState(obj, node);
      break;
    }
  }

  if (!obj) return null;
  registry.push({ node, obj });

  if (rebuildChildren && Array.isArray(node.children)) {
    for (const childNode of node.children) {
      const child = await rehydrateNode(childNode, registry);
      if (child) obj.add(child);
    }
  }
  return obj;
}

// Relink Face.edges / Edge.faces references by name within a rehydrated root.
function relinkTopology(registry: AnyRecord[]) {
  const edgesByName = new Map<string, any>();
  const facesByName = new Map<string, any>();
  for (const { node, obj } of registry) {
    if (node.cls === 'EDGE' || node.cls === 'FATLINE') {
      if (obj.name) edgesByName.set(String(obj.name), obj);
    } else if (node.cls === 'FACE') {
      if (obj.name) facesByName.set(String(obj.name), obj);
    }
  }
  for (const { node, obj } of registry) {
    if (node.cls === 'FACE' && Array.isArray(node.edgeNames)) {
      obj.edges = node.edgeNames.map((name: string) => edgesByName.get(name)).filter(Boolean);
    } else if ((node.cls === 'EDGE' || node.cls === 'FATLINE') && Array.isArray(node.faceNames)) {
      obj.faces = node.faceNames.map((name: string) => facesByName.get(name)).filter(Boolean);
    }
  }
}

export async function rehydrateSceneObject(node: AnyRecord): Promise<any | null> {
  const registry: AnyRecord[] = [];
  const obj = await rehydrateNode(node, registry);
  if (obj) relinkTopology(registry);
  return obj;
}

export async function rehydrateSceneObjects(nodes: AnyRecord[]): Promise<any[]> {
  const out = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const obj = await rehydrateSceneObject(node);
    if (obj) out.push(obj);
  }
  return out;
}

// Collect transferable ArrayBuffers from serialized nodes so postMessage can
// move geometry instead of copying it.
export function collectTransferables(nodes: AnyRecord[], out: ArrayBuffer[] = [], seen: Set<ArrayBuffer> = new Set()): ArrayBuffer[] {
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (ArrayBuffer.isView(value)) {
      const buffer = (value as any).buffer;
      if (buffer instanceof ArrayBuffer && !seen.has(buffer)) {
        seen.add(buffer);
        out.push(buffer);
      }
      return;
    }
    if (value instanceof ArrayBuffer) {
      if (!seen.has(value)) { seen.add(value); out.push(value); }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  };
  for (const node of Array.isArray(nodes) ? nodes : []) visit(node);
  return out;
}
