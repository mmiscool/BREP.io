import JSZip from 'jszip';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BREP } from '../../BREP/BREP.js';
import { base64ToUint8Array, getComponentRecord } from '../../services/componentLibrary.js';

const THREE = BREP.THREE;

function handleComponentSelection(ctx, record) {
  if (!ctx || !ctx.feature) return;
  const feature = ctx.feature;
  feature.inputParams = feature.inputParams || {};
  feature.persistentData = feature.persistentData || {};

  if (!record || !record.data3mf) {
    feature.inputParams.componentName = '';
    delete feature.persistentData.componentData;
    return;
  }

  feature.inputParams.componentName = record.name || '';
  feature.persistentData.componentData = {
    name: record.name || '',
    savedAt: record.savedAt || null,
    data3mf: record.data3mf,
    featureInfo: null,
  };
}

const DEFAULT_TRANSFORM = {
  position: [0, 0, 0],
  rotationEuler: [0, 0, 0],
  scale: [1, 1, 1],
};

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for the assembly component feature.',
  },
  componentName: {
    type: 'component_selector',
    label: 'Component',
    buttonLabel: 'Select…',
    hint: 'Pick a saved 3MF component to insert into this assembly.',
    dialogTitle: 'Select Component',
    onSelect: handleComponentSelection,
  },
  isFixed: {
    type: 'boolean',
    default_value: false,
    label: 'Fixed in place',
    hint: 'Lock this component so assembly constraints cannot move it.',
  },
  transform: {
    type: 'transform',
    default_value: DEFAULT_TRANSFORM,
    label: 'Placement',
    hint: 'Use the transform gizmo to position the component.',
  },
};

export class AssemblyComponentFeature {
  static shortName = 'ACOMP';
  static longName = 'Assembly Component';
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    try { console.log('[AssemblyComponentFeature] run: begin', { componentName: this.inputParams?.componentName || null, featureID: this.inputParams?.featureID || null }); } catch { }
    const componentData = await this._resolveComponentData();
    if (!componentData || !componentData.bytes || componentData.bytes.length === 0) {
      const hasSelectionIntent = Boolean((this.inputParams && this.inputParams.componentName) || (this.persistentData && this.persistentData.componentData));
      if (hasSelectionIntent) {
        console.warn('[AssemblyComponentFeature] Component payload missing or failed to load.');
      }
      try { console.warn('[AssemblyComponentFeature] run: abort (no component data)'); } catch { }
      return { added: [], removed: [] };
    }

    try {
      const stats = await this._debugCount3MFTriangles(componentData.bytes);
      if (stats) {
        console.log('[AssemblyComponentFeature] run: 3MF model stats', stats);
      }
    } catch { }

    try {
      console.log('[AssemblyComponentFeature] run: component data', {
        name: componentData.name || '',
        savedAt: componentData.savedAt || null,
        bytes: componentData.bytes?.length || 0,
        hasFeatureInfo: !!componentData.featureInfo,
        hasBrepExtras: !!componentData.featureInfo?.brepExtras,
      });
    } catch { }

    const featureId = this._sanitizeFeatureId(this.inputParams?.featureID);
    const group = await this._loadThreeMF(componentData.bytes);
    if (!group) {
      console.warn('[AssemblyComponentFeature] Failed to parse 3MF component.');
      return { added: [], removed: [] };
    }

    const solids = await this._buildSolidsFromGroup(group, componentData);
    if (!solids.length) {
      console.warn('[AssemblyComponentFeature] No solids recovered from component.');
      try { console.warn('[AssemblyComponentFeature] run: no solids recovered'); } catch { }
      return { added: [], removed: [] };
    }

    //const componentName = this.inputParams.componentName || componentData.name ;
    const componentName = `${this.inputParams.componentName || componentData.name}_${featureId}`;
    const component = new BREP.AssemblyComponent({
      name: componentName,
      fixed: !!this.inputParams.isFixed,
    });


    for (const solid of solids) {
      if (featureId) {
        if (solid?.type === 'SOLID') {
          this._applyFeaturePrefixToSolid(solid, featureId);
        } else {
          this._applyFeaturePrefixToObject3D(solid, featureId);
        }
      }

      try {
        if (typeof solid?.visualize === 'function') {
          solid.visualize();
        }
      } catch { /* ignore */ }

      if (featureId) {
        this._applyFeaturePrefixToObject3D(solid, featureId);
      }

      component.addBody(solid);
    }

    if (featureId) {
      this._applyFeaturePrefixToObject3D(component, featureId);
    }

    const transformMatrix = this._composeTransformMatrix(this.inputParams.transform || DEFAULT_TRANSFORM);
    if (transformMatrix) {
      this._applyMatrixToComponent(component, transformMatrix);
    }

    component.userData = component.userData || {};
    component.userData.componentSource = {
      name: componentData.name || componentName,
      savedAt: componentData.savedAt || null,
    };
    if (componentData.featureInfo) {
      component.userData.featureInfo = componentData.featureInfo;
    }

    // Persist canonical payload so reruns do not depend on local storage state.
    this.persistentData.componentData = {
      name: componentData.name || componentName,
      savedAt: componentData.savedAt || null,
      data3mf: componentData.base64,
      featureInfo: componentData.featureInfo || null,
    };

    try { console.log('[AssemblyComponentFeature] run: complete', { componentName, solids: solids.length }); } catch { }
    return { added: [component], removed: [] };
  }

  async _resolveComponentData() {
    const persisted = this.persistentData && this.persistentData.componentData;
    if (persisted && persisted.data3mf) {
      const bytes = base64ToUint8Array(persisted.data3mf);
      let featureInfo = persisted.featureInfo;
      if (!featureInfo || !featureInfo.history || !featureInfo.brepExtras) {
        featureInfo = await this._extractFeatureInfo(bytes);
      }
      if (featureInfo) {
        this.persistentData.componentData.featureInfo = featureInfo;
      }
      try {
        console.log('[AssemblyComponentFeature] _resolveComponentData: using persisted', {
          name: persisted.name || '',
          savedAt: persisted.savedAt || null,
          bytes: bytes?.length || 0,
          hasFeatureInfo: !!featureInfo,
          hasBrepExtras: !!featureInfo?.brepExtras,
        });
      } catch { }
      return {
        name: persisted.name || '',
        savedAt: persisted.savedAt || null,
        base64: persisted.data3mf,
        bytes,
        featureInfo,
      };
    }

    const selectedName = this.inputParams && this.inputParams.componentName;
    if (!selectedName) return null;

    const record = await getComponentRecord(selectedName);
    if (!record || !record.data3mf) return null;

    const bytes = base64ToUint8Array(record.data3mf);
    const featureInfo = await this._extractFeatureInfo(bytes);

    this.persistentData = this.persistentData || {};
    this.persistentData.componentData = {
      name: record.name || selectedName,
      savedAt: record.savedAt || null,
      data3mf: record.data3mf,
      featureInfo,
    };

    try {
      console.log('[AssemblyComponentFeature] _resolveComponentData: loaded from library', {
        name: record.name || selectedName,
        savedAt: record.savedAt || null,
        bytes: bytes?.length || 0,
        hasFeatureInfo: !!featureInfo,
        hasBrepExtras: !!featureInfo?.brepExtras,
      });
    } catch { }

    return {
      name: record.name || selectedName,
      savedAt: record.savedAt || null,
      base64: record.data3mf,
      bytes,
      featureInfo,
    };
  }

  async _loadThreeMF(bytes) {
    try {
      const loader = new ThreeMFLoader();
      const buffer = this._toArrayBuffer(bytes);
      if (!buffer) return null;
      return await loader.parse(buffer);
    } catch (err) {
      console.warn('[AssemblyComponentFeature] ThreeMFLoader.parse failed:', err);
      return null;
    }
  }

  async _debugCount3MFTriangles(bytes) {
    try {
      const buffer = this._toArrayBuffer(bytes);
      if (!buffer) return null;
      const zip = await JSZip.loadAsync(buffer);
      const files = {};
      Object.keys(zip.files || {}).forEach(p => { files[p.toLowerCase()] = p; });
      const modelPath = files['3d/3dmodel.model'] || files['/3d/3dmodel.model'];
      const modelFile = modelPath ? zip.file(modelPath) : null;
      if (!modelFile) return { error: 'model-file-missing' };
      const xml = await modelFile.async('string');
      const triCount = (xml.match(/<triangle\b/gi) || []).length;
      const objCount = (xml.match(/<object\b/gi) || []).length;
      return { objects: objCount, triangles: triCount };
    } catch (err) {
      return { error: err?.message || String(err || 'unknown') };
    }
  }

  async _buildSolidsFromGroup(group, componentData) {
    const solids = [];
    const componentName = this.inputParams.componentName || componentData.name || 'Component';
    const facetInfo = componentData.featureInfo?.facets || null;
    const metadataMap = componentData.featureInfo?.metadata || null;
    const brepExtras = componentData?.featureInfo?.brepExtras || null;

    try {
      console.log('[AssemblyComponentFeature] _buildSolidsFromGroup: start', {
        componentName,
        hasFacetInfo: !!facetInfo,
        hasMetadataMap: !!metadataMap,
        hasBrepExtras: !!brepExtras,
        brepExtrasSolids: brepExtras?.solids ? Object.keys(brepExtras.solids).length : 0,
      });
    } catch { }

    group.updateMatrixWorld(true);

    const meshes = [];
    group.traverse((obj) => {
      const geom = obj && obj.isMesh ? obj.geometry : null;
      if (!geom || !geom.isBufferGeometry) return;
      const posAttr = geom.getAttribute('position');
      if (posAttr && posAttr.count >= 3) meshes.push(obj);
    });

    if (!meshes.length) {
      console.warn(`[AssemblyComponentFeature] Component "${componentName}" contained no mesh primitives.`);
      return await this._rebuildSolidsFromHistory(componentData, componentName);
    }

    const meshGroups = new Map();
    for (const mesh of meshes) {
      const rawName = String(mesh?.name || '').trim();
      const key = rawName.length ? rawName : `__mesh_${meshGroups.size + 1}`;
      let entry = meshGroups.get(key);
      if (!entry) {
        entry = { sourceName: rawName, meshes: [] };
        meshGroups.set(key, entry);
      }
      entry.meshes.push(mesh);
    }

    let index = 0;
    for (const entry of meshGroups.values()) {
      const groupName = entry.sourceName || '';
      const groupMeshes = entry.meshes;
      const solidName = this._resolveSolidName(groupName, componentName, ++index);
      const extrasForSolid = brepExtras && brepExtras.solids ? brepExtras.solids[solidName] : null;
      const faceNameCounts = new Map();
      const built = this._buildSolidFromMeshes(groupMeshes, faceNameCounts, groupName, extrasForSolid);
      const solid = built?.solid || null;
      const colorHints = built?.colorHints || null;
      if (!solid || !solid._triVerts || solid._triVerts.length === 0) {
        const meshName = groupName ? `"${groupName}"` : '(unnamed mesh group)';
        console.warn(`[AssemblyComponentFeature] Failed to recover triangles for ${meshName}; skipping.`);
        index--; // keep numbering tight if conversion failed
        continue;
      }

      solid.name = solidName;

      if (extrasForSolid) {
        try {
          console.log('[AssemblyComponentFeature] _buildSolidsFromGroup: applying brepExtras', {
            solidName,
            triCount: (solid._triVerts?.length || 0) / 3,
            hasTriFaceIds: !!extrasForSolid.triFaceIdsB64 || (Array.isArray(extrasForSolid.triFaceIds) && extrasForSolid.triFaceIds.length > 0),
            triFaceOrder: extrasForSolid.triFaceOrder || null,
            idToFaceCount: extrasForSolid.idToFaceName ? Object.keys(extrasForSolid.idToFaceName).length : 0,
          });
        } catch { }
        this._applyBrepExtrasToSolid(solid, extrasForSolid);
      }

      if (colorHints) {
        this._applyColorHintsToSolid(solid, colorHints);
      }

      const faceMeta = facetInfo && facetInfo[solidName];
      if (faceMeta && typeof solid.setFaceMetadata === 'function') {
        for (const key of Object.keys(faceMeta)) {
          try { solid.setFaceMetadata(key, faceMeta[key]); } catch { /* ignore */ }
        }
      }

      if (metadataMap && metadataMap[solidName]) {
        this._mergeSolidMetadata(solid, metadataMap[solidName]);
      }
      this._applyFaceMetadataFromMap(solid, metadataMap);

      solids.push(solid);
    }

    if (!solids.length && meshes.length) {
      try {
        const worldGeometries = [];
        for (const mesh of meshes) {
          const geom = mesh?.geometry;
          if (!geom || typeof geom.clone !== 'function') continue;
          try { mesh.updateWorldMatrix(true, false); }
          catch { }
          const cloned = geom.clone();
          try { cloned.applyMatrix4(mesh.matrixWorld); }
          catch { /* ignore transform issues */ }
          worldGeometries.push(cloned);
        }
        if (worldGeometries.length) {
          const merged = mergeGeometries(worldGeometries, false);
          if (merged) {
            try {
              const fallbackSolid = new BREP.MeshToBrep(merged, 30, 1e-5);
              const fallbackKey = metadataMap && Object.keys(metadataMap).length === 1
                ? Object.keys(metadataMap)[0]
                : (facetInfo && Object.keys(facetInfo).length === 1 ? Object.keys(facetInfo)[0] : null);
              const solidName = fallbackKey || this._resolveSolidName('', componentName, 1);
              fallbackSolid.name = solidName;
              console.warn(`[AssemblyComponentFeature] Using merged-geometry fallback for component "${componentName}" (mesh count: ${meshes.length}).`);

              if (facetInfo && facetInfo[solidName] && typeof fallbackSolid.setFaceMetadata === 'function') {
                for (const key of Object.keys(facetInfo[solidName])) {
                  try { fallbackSolid.setFaceMetadata(key, facetInfo[solidName][key]); }
                  catch { /* ignore */ }
                }
              }

              if (metadataMap && metadataMap[solidName]) {
                this._mergeSolidMetadata(fallbackSolid, metadataMap[solidName]);
              }
              this._applyFaceMetadataFromMap(fallbackSolid, metadataMap);

              solids.push(fallbackSolid);
            } catch (err) {
              console.warn('[AssemblyComponentFeature] Merged-geometry fallback failed:', err);
            } finally {
              try { merged.dispose(); } catch { }
            }
          }
        }
        for (const g of worldGeometries) {
          try { g.dispose(); } catch { }
        }
      } catch (err) {
        console.warn('[AssemblyComponentFeature] Unable to merge component meshes for fallback:', err);
      }
    }

    if (!solids.length) {
      const historyFallback = await this._rebuildSolidsFromHistory(componentData, componentName);
      if (historyFallback && historyFallback.length) {
        solids.push(...historyFallback);
      }
    }

    try { console.log('[AssemblyComponentFeature] _buildSolidsFromGroup: complete', { componentName, solids: solids.length }); } catch { }
    return solids;
  }

  _getMaterialName(material) {
    if (Array.isArray(material)) {
      for (const entry of material) {
        if (entry && typeof entry.name === 'string' && entry.name.trim().length) return entry.name;
      }
      return '';
    }
    return material && typeof material.name === 'string' ? material.name : '';
  }

  _getMaterialColorHex(material) {
    if (!material) return null;
    const mat = Array.isArray(material)
      ? (material.find((entry) => entry?.color?.isColor) || material[0])
      : material;
    const color = mat?.color;
    if (!color || typeof color.getHexString !== 'function') return null;
    try { return `#${color.getHexString()}`; } catch { return null; }
  }

  _decodeTriFaceIds(extras) {
    if (!extras) return null;
    if (Array.isArray(extras.triFaceIds) && extras.triFaceIds.length) return extras.triFaceIds;
    if (extras.triFaceIdsB64 && typeof extras.triFaceIdsB64 === 'string') {
      try {
        const bytes = base64ToUint8Array(extras.triFaceIdsB64);
        if (!bytes || bytes.length < 4) return null;
        const view = new Uint32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
        return view;
      } catch {
        return null;
      }
    }
    return null;
  }

  _applyBrepExtrasToSolid(solid, extras) {
    if (!solid || !extras) return;

    if (extras.solidMetadata && typeof extras.solidMetadata === 'object') {
      solid.userData = solid.userData || {};
      const existing = solid.userData.metadata && typeof solid.userData.metadata === 'object'
        ? solid.userData.metadata
        : {};
      solid.userData.metadata = { ...existing, ...extras.solidMetadata };
    }

    if (extras.faceMetadata && typeof extras.faceMetadata === 'object') {
      for (const [faceName, meta] of Object.entries(extras.faceMetadata)) {
        if (!faceName || !meta || typeof meta !== 'object') continue;
        try { solid.setFaceMetadata(faceName, meta); } catch { /* ignore */ }
      }
    }

    if (extras.edgeMetadata && typeof extras.edgeMetadata === 'object') {
      const merged = new Map(solid._edgeMetadata instanceof Map ? solid._edgeMetadata : []);
      for (const [edgeName, meta] of Object.entries(extras.edgeMetadata)) {
        if (!edgeName || !meta || typeof meta !== 'object') continue;
        merged.set(edgeName, { ...(merged.get(edgeName) || {}), ...meta });
      }
      solid._edgeMetadata = merged;
    }

    if (Array.isArray(extras.auxEdges) && extras.auxEdges.length) {
      const cleaned = [];
      for (const aux of extras.auxEdges) {
        const pts = Array.isArray(aux?.points)
          ? aux.points.filter((p) => Array.isArray(p) && p.length === 3)
          : [];
        if (pts.length < 2) continue;
        cleaned.push({
          name: aux?.name || 'EDGE',
          points: pts.map((p) => [p[0], p[1], p[2]]),
          closedLoop: !!aux?.closedLoop,
          polylineWorld: !!aux?.polylineWorld,
          materialKey: aux?.materialKey || undefined,
          centerline: !!aux?.centerline,
          faceA: typeof aux?.faceA === 'string' ? aux.faceA : undefined,
          faceB: typeof aux?.faceB === 'string' ? aux.faceB : undefined,
        });
      }
      solid._auxEdges = cleaned;
    }

    // If we have per-triangle face IDs ordered to match 3MF material grouping,
    // reapply them to guarantee face names survive loader reordering.
    try {
      const faceIds = this._decodeTriFaceIds(extras);
      const idToFace = extras.idToFaceName && typeof extras.idToFaceName === 'object'
        ? extras.idToFaceName
        : null;
      const triCount = (Array.isArray(solid._triVerts) ? solid._triVerts.length : 0) / 3;
      const ordered = extras.triFaceOrder === 'material';
      try {
        console.log('[AssemblyComponentFeature] _applyBrepExtrasToSolid: tri mapping', {
          solidName: solid.name || '',
          triCount,
          faceIdsCount: faceIds?.length || 0,
          ordered,
          idToFaceCount: idToFace ? Object.keys(idToFace).length : 0,
        });
      } catch { }
      if (ordered && idToFace && faceIds && faceIds.length === triCount && triCount > 0) {
        solid._triIDs = Array.from(faceIds);
        const idToName = new Map();
        const nameToId = new Map();
        for (const [rawId, rawName] of Object.entries(idToFace)) {
          const idNum = Number(rawId);
          if (!Number.isFinite(idNum)) continue;
          const name = String(rawName || '');
          if (!name) continue;
          idToName.set(idNum, name);
          nameToId.set(name, idNum);
        }
        if (idToName.size) {
          solid._idToFaceName = idToName;
          solid._faceNameToID = nameToId;
        }
        solid._dirty = true;
        solid._faceIndex = null;
        try {
          console.log('[AssemblyComponentFeature] _applyBrepExtrasToSolid: applied tri IDs', {
            solidName: solid.name || '',
            idToFaceCount: idToName.size,
          });
        } catch { }
      }
    } catch { /* ignore reapply failures */ }
  }

  _hasColorEntry(metadata, keys) {
    if (!metadata || typeof metadata !== 'object') return false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;
      const raw = metadata[key];
      if (raw == null) continue;
      if (typeof raw === 'string' && raw.trim() === '') continue;
      return true;
    }
    return false;
  }

  _appendMeshToSolid(solid, mesh, faceNameCounts, options = {}) {
    const geometry = mesh?.geometry;
    const posAttr = geometry?.getAttribute?.('position');
    if (!solid || !geometry || !posAttr || posAttr.count < 3) return null;

    try { mesh.updateWorldMatrix(true, false); }
    catch { /* matrix update best-effort */ }

    const matrixWorld = mesh.matrixWorld;
    const indexAttr = typeof geometry.getIndex === 'function' ? geometry.getIndex() : null;
    const materialName = this._getMaterialName(mesh.material);
    const baseFaceName = this._safeName(materialName || mesh.name || `FACE_${faceNameCounts.size + 1}`);
    const preferExact = Array.isArray(options.triFaceIds) || options.triFaceIds instanceof Uint32Array;
    const idToFaceName = options.idToFaceName || null;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();

    const materialArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const triCount = indexAttr && indexAttr.count >= 3
      ? Math.floor(indexAttr.count / 3)
      : Math.floor(posAttr.count / 3);
    const materialIndexByTri = new Array(triCount).fill(0);
    if (Array.isArray(geometry.groups) && geometry.groups.length) {
      for (const group of geometry.groups) {
        const start = Math.max(0, group?.start || 0);
        const count = Math.max(0, group?.count || 0);
        const matIdx = Number.isFinite(group?.materialIndex) ? group.materialIndex : 0;
        const triStart = Math.floor(start / 3);
        const triEnd = Math.floor((start + count) / 3);
        for (let t = triStart; t < triEnd && t < triCount; t++) materialIndexByTri[t] = matIdx;
      }
    }

    const faceInfosByName = new Map();
    const writeTriangle = (ia, ib, ic, faceName) => {
      if (!Number.isFinite(ia) || !Number.isFinite(ib) || !Number.isFinite(ic)) return;
      if (ia < 0 || ib < 0 || ic < 0) return;
      if (ia >= posAttr.count || ib >= posAttr.count || ic >= posAttr.count) return;
      a.fromBufferAttribute(posAttr, ia).applyMatrix4(matrixWorld);
      b.fromBufferAttribute(posAttr, ib).applyMatrix4(matrixWorld);
      c.fromBufferAttribute(posAttr, ic).applyMatrix4(matrixWorld);
      solid.addTriangle(faceName, [a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]);
    };

    const fallbackFaceNames = new Map();
    const resolveFallbackFaceName = (triIndex) => {
      const matIdx = materialIndexByTri[triIndex] || 0;
      if (!fallbackFaceNames.has(matIdx)) {
        const mat = materialArray && materialArray.length ? materialArray[matIdx] : null;
        const matName = this._getMaterialName(mat);
        const base = this._safeName(matName || baseFaceName);
        const name = faceNameCounts ? this._uniqueName(faceNameCounts, base) : base;
        fallbackFaceNames.set(matIdx, name);
      }
      return fallbackFaceNames.get(matIdx);
    };

    const ids = options.triFaceIds;
    const triOffset = options.triOffset || 0;
    const hasExact = !!(preferExact && idToFaceName && ids && (triOffset + triCount) <= ids.length);
    const resolveFaceName = (triIndex) => {
      if (hasExact) {
        const idx = triIndex + triOffset;
        const fid = ids[idx];
        const raw = idToFaceName[fid] ?? idToFaceName[String(fid)] ?? null;
        if (raw) return String(raw);
        return `FACE_${fid}`;
      }
      return resolveFallbackFaceName(triIndex);
    };

    for (let i = 0; i < triCount; i++) {
      const faceName = resolveFaceName(i);
      if (!faceName) continue;
      if (indexAttr && indexAttr.count >= 3) {
        const base = i * 3;
        writeTriangle(indexAttr.getX(base + 0), indexAttr.getX(base + 1), indexAttr.getX(base + 2), faceName);
      } else {
        const base = i * 3;
        writeTriangle(base + 0, base + 1, base + 2, faceName);
      }
      if (!faceInfosByName.has(faceName)) {
        const mat = materialArray && materialArray.length ? materialArray[materialIndexByTri[i] || 0] : null;
        faceInfosByName.set(faceName, {
          faceName,
          materialName: this._getMaterialName(mat) || materialName,
          colorHex: this._getMaterialColorHex(mat || mesh.material),
        });
      }
    }

    if (solid._triVerts.length === 0) return null;
    return {
      faceInfos: Array.from(faceInfosByName.values()),
      triCount,
    };
  }

  _buildSolidFromMeshes(meshes, faceNameCounts, sourceName, extras = null) {
    if (!Array.isArray(meshes) || meshes.length === 0) return null;
    const solid = new BREP.Solid();
    const faceInfos = [];
    const triFaceIds = this._decodeTriFaceIds(extras);
    const idToFaceName = (extras && extras.idToFaceName && typeof extras.idToFaceName === 'object')
      ? extras.idToFaceName
      : null;
    let triOffset = 0;
    for (const mesh of meshes) {
      const info = this._appendMeshToSolid(solid, mesh, faceNameCounts, {
        triFaceIds,
        triOffset,
        idToFaceName,
      });
      if (info && Array.isArray(info.faceInfos)) {
        faceInfos.push(...info.faceInfos);
      } else if (info) {
        faceInfos.push(info);
      }
      if (info && Number.isFinite(info.triCount)) {
        triOffset += info.triCount;
      }
    }
    if (!solid._triVerts || solid._triVerts.length === 0) return null;
    const colorHints = this._deriveColorHints(faceInfos, sourceName);
    return { solid, colorHints };
  }

  _deriveColorHints(faceInfos, sourceName) {
    const faceColors = new Map();
    let solidColor = null;
    const solidMaterialName = sourceName ? `${sourceName}_SOLID` : '';
    const defaultMaterialName = sourceName ? `${sourceName}_DEFAULT` : '';
    const isDefaultMaterial = (name) => {
      if (!name || typeof name !== 'string') return false;
      if (defaultMaterialName && name === defaultMaterialName) return true;
      return name.endsWith('_DEFAULT');
    };

    if (Array.isArray(faceInfos)) {
      for (const info of faceInfos) {
        const hex = info?.colorHex;
        if (!hex) continue;
        if (isDefaultMaterial(info.materialName)) continue;
        if (solidMaterialName && info.materialName === solidMaterialName && !solidColor) {
          solidColor = hex;
          continue;
        }
        if (info.faceName) faceColors.set(info.faceName, hex);
      }
    }

    if (!solidColor && Array.isArray(faceInfos)) {
      const colored = faceInfos.filter((info) => info?.colorHex);
      if (colored.length === 1) {
        solidColor = colored[0].colorHex;
        if (colored[0].faceName) faceColors.delete(colored[0].faceName);
      }
    }

    return { solidColor, faceColors };
  }

  _applyColorHintsToSolid(solid, colorHints) {
    if (!solid || !colorHints) return;
    const solidKeys = ['solidColor', 'color'];
    const faceKeys = ['faceColor', 'color'];

    if (colorHints.solidColor) {
      solid.userData = solid.userData || {};
      const existing = solid.userData.metadata && typeof solid.userData.metadata === 'object'
        ? solid.userData.metadata
        : {};
      if (!this._hasColorEntry(existing, solidKeys)) {
        solid.userData.metadata = { ...existing, color: colorHints.solidColor };
      }
    }

    if (colorHints.faceColors && typeof solid.setFaceMetadata === 'function') {
      for (const [faceName, hex] of colorHints.faceColors.entries()) {
        const existing = typeof solid.getFaceMetadata === 'function' ? solid.getFaceMetadata(faceName) : null;
        if (this._hasColorEntry(existing, faceKeys)) continue;
        solid.setFaceMetadata(faceName, { color: hex });
      }
    }
  }

  _mergeSolidMetadata(solid, metadata) {
    if (!solid || !metadata || typeof metadata !== 'object') return;
    solid.userData = solid.userData || {};
    const existing = solid.userData.metadata && typeof solid.userData.metadata === 'object'
      ? solid.userData.metadata
      : {};
    solid.userData.metadata = { ...existing, ...metadata };
  }

  _applyFaceMetadataFromMap(solid, metadataMap) {
    if (!solid || !metadataMap || typeof metadataMap !== 'object' || typeof solid.setFaceMetadata !== 'function') return;
    const faceNames = typeof solid.getFaceNames === 'function'
      ? solid.getFaceNames()
      : (solid._faceNameToID instanceof Map ? Array.from(solid._faceNameToID.keys()) : []);
    if (!faceNames || !faceNames.length) return;
    for (const faceName of faceNames) {
      const meta = metadataMap[faceName];
      if (!meta || typeof meta !== 'object') continue;
      try { solid.setFaceMetadata(faceName, meta); } catch { /* ignore */ }
    }
  }

  _buildSolidFromMesh(mesh, faceNameCounts) {
    try {
      const solid = new BREP.Solid();
      const info = this._appendMeshToSolid(solid, mesh, faceNameCounts);
      if (!info || !solid._triVerts || solid._triVerts.length === 0) return null;
      return solid;
    } catch (err) {
      console.warn('[AssemblyComponentFeature] Failed to construct solid from mesh:', err);
      return null;
    }
  }

  _fallbackSolidFromMesh(mesh) {
    try {
      const geometry = mesh?.geometry;
      const posAttr = geometry?.getAttribute?.('position');
      if (!geometry || !posAttr || posAttr.count < 3) return null;
      const cloned = geometry.clone();
      cloned.applyMatrix4(mesh.matrixWorld);
      return new BREP.MeshToBrep(cloned, 30, 1e-5);
    } catch (err) {
      console.warn('[AssemblyComponentFeature] Fallback MeshToBrep conversion failed:', err);
      return null;
    }
  }

  async _rebuildSolidsFromHistory(componentData, componentName) {
    try {
      const featureInfo = componentData?.featureInfo;
      const historyPayload = featureInfo?.history;
      const historyString = typeof historyPayload === 'string'
        ? historyPayload
        : (historyPayload ? JSON.stringify(historyPayload) : (featureInfo?.historyString || featureInfo?.rawJSON || null));
      if (!historyString) return [];

      const { PartHistory } = await import('../../PartHistory.js');
      const sandbox = new PartHistory();
      await sandbox.fromJSON(historyString);
      await sandbox.runHistory();

      const solids = [];
      const nameCounts = new Map();
      const facetInfo = featureInfo?.facets || null;
      const metadataMap = featureInfo?.metadata || null;

      const children = sandbox.scene.children.slice();
      for (const child of children) {
        if (!child || (child.type !== 'SOLID' && child.type !== 'COMPONENT')) continue;
        if (child.__removeFlag) continue;
        try { sandbox.scene.remove(child); } catch { }
        child.parent = null;

        const fallbackBase = child.type === 'COMPONENT' ? `${componentName || 'Component'}_Subassembly${solids.length + 1}` : `${componentName || 'Component'}_Body${solids.length + 1}`;
        const baseName = child.name && child.name.trim().length ? child.name : fallbackBase;
        const finalName = this._uniqueName(nameCounts, this._safeName(baseName));
        child.name = finalName;

        if (child.type !== 'COMPONENT') {
          const faceMeta = facetInfo && facetInfo[finalName];
          if (faceMeta && typeof child.setFaceMetadata === 'function') {
            for (const key of Object.keys(faceMeta)) {
              try { child.setFaceMetadata(key, faceMeta[key]); } catch { }
            }
          }

          if (metadataMap && metadataMap[finalName]) {
            this._mergeSolidMetadata(child, metadataMap[finalName]);
          }
          this._applyFaceMetadataFromMap(child, metadataMap);
        }

        solids.push(child);
      }

      if (solids.length) {
        console.warn(`[AssemblyComponentFeature] Rebuilt component "${componentName}" from feature history (${solids.length} solid${solids.length === 1 ? '' : 's'}).`);
      }

      return solids;
    } catch (err) {
      console.warn('[AssemblyComponentFeature] Failed to rebuild component from feature history:', err);
      return [];
    }
  }

  _composeTransformMatrix(trs) {
    if (!trs) return null;
    try {
      const pos = Array.isArray(trs.position) ? trs.position : [0, 0, 0];
      const rot = Array.isArray(trs.rotationEuler) ? trs.rotationEuler : [0, 0, 0];
      const scl = Array.isArray(trs.scale) ? trs.scale : [1, 1, 1];
      const translation = new THREE.Vector3(pos[0] || 0, pos[1] || 0, pos[2] || 0);
      const rotation = new THREE.Euler(
        THREE.MathUtils.degToRad(rot[0] || 0),
        THREE.MathUtils.degToRad(rot[1] || 0),
        THREE.MathUtils.degToRad(rot[2] || 0),
        'XYZ'
      );
      const scale = new THREE.Vector3(scl[0] || 1, scl[1] || 1, scl[2] || 1);
      const matrix = new THREE.Matrix4();
      matrix.compose(translation, new THREE.Quaternion().setFromEuler(rotation), scale);
      return matrix;
    } catch {
      return null;
    }
  }

  _applyMatrixToComponent(component, matrix) {
    if (!component || !matrix) return;
    try {
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);
      component.position.copy(position);
      component.quaternion.copy(quaternion);
      component.scale.copy(scale);
      component.updateMatrix();
      component.updateMatrixWorld(true);
    } catch {
      /* noop */
    }
  }

  _uniqueName(map, base) {
    const key = base || 'FACE';
    const count = map.get(key) || 0;
    map.set(key, count + 1);
    return count === 0 ? key : `${key}_${count}`;
  }

  _safeName(name) {
    const str = String(name || '').trim();
    return str.length ? str : 'FACE';
  }

  _resolveSolidName(original, componentName, index) {
    const clean = String(original || '').trim();
    if (clean.length) return clean;
    return `${componentName}_Body${index}`;
  }

  _sanitizeFeatureId(rawId) {
    if (typeof rawId !== 'string') return null;
    const trimmed = rawId.trim();
    return trimmed.length ? trimmed : null;
  }

  _withFeaturePrefix(featureId, name, fallback = '') {
    const id = this._sanitizeFeatureId(featureId);
    const base = this._safeName(name || fallback);
    if (!id || base === id) return base;
    const prefix = `${id}_`;
    return base.startsWith(prefix) ? base : `${prefix}${base}`;
  }

  _applyFeaturePrefixToSolid(solid, featureId) {
    const id = this._sanitizeFeatureId(featureId);
    if (!id || !solid) return;

    solid.name = this._withFeaturePrefix(id, solid.name, solid.type || 'SOLID');

    const idToFace = solid._idToFaceName instanceof Map ? solid._idToFaceName : null;
    if (idToFace && idToFace.size) {
      const renamedIdToFace = new Map();
      const renamedFaceToId = new Map();
      for (const [faceId, faceName] of idToFace.entries()) {
        const renamed = this._withFeaturePrefix(id, faceName, `FACE_${faceId}`);
        renamedIdToFace.set(faceId, renamed);
        renamedFaceToId.set(renamed, faceId);
      }
      solid._idToFaceName = renamedIdToFace;
      solid._faceNameToID = renamedFaceToId;
    }

    const faceMetadata = solid._faceMetadata instanceof Map ? solid._faceMetadata : null;
    if (faceMetadata && faceMetadata.size) {
      const renamedMetadata = new Map();
      for (const [faceName, metadata] of faceMetadata.entries()) {
        const renamed = this._withFeaturePrefix(id, faceName, faceName || 'FACE');
        renamedMetadata.set(renamed, metadata);
      }
      solid._faceMetadata = renamedMetadata;
    }

    const edgeMetadata = solid._edgeMetadata instanceof Map ? solid._edgeMetadata : null;
    if (edgeMetadata && edgeMetadata.size) {
      const renamedEdges = new Map();
      for (const [edgeName, metadata] of edgeMetadata.entries()) {
        if (!edgeName || typeof edgeName !== 'string') continue;
        let renamed = edgeName;
        if (edgeName.includes('|')) {
          const parts = edgeName.split('|').map((p) => this._withFeaturePrefix(id, p, p));
          renamed = parts.join('|');
        } else {
          renamed = this._withFeaturePrefix(id, edgeName, edgeName);
        }
        renamedEdges.set(renamed, metadata);
      }
      solid._edgeMetadata = renamedEdges;
    }

    if (Array.isArray(solid._auxEdges) && solid._auxEdges.length) {
      for (const aux of solid._auxEdges) {
        if (!aux) continue;
        aux.name = this._withFeaturePrefix(id, aux.name, 'EDGE');
        if (typeof aux.faceA === 'string') {
          aux.faceA = this._withFeaturePrefix(id, aux.faceA, aux.faceA);
        }
        if (typeof aux.faceB === 'string') {
          aux.faceB = this._withFeaturePrefix(id, aux.faceB, aux.faceB);
        }
      }
    }
  }

  _applyFeaturePrefixToObject3D(object3D, featureId) {
    const id = this._sanitizeFeatureId(featureId);
    if (!id || !object3D) return;

    const renamed = this._withFeaturePrefix(id, object3D.name, object3D.type || 'Object');
    if (renamed !== object3D.name) {
      object3D.name = renamed;
    }

    if (object3D.userData && typeof object3D.userData === 'object') {
      if (typeof object3D.userData.faceName === 'string') {
        object3D.userData.faceName = this._withFeaturePrefix(id, object3D.userData.faceName, object3D.userData.faceName);
      }
      if (typeof object3D.userData.faceA === 'string') {
        object3D.userData.faceA = this._withFeaturePrefix(id, object3D.userData.faceA, object3D.userData.faceA);
      }
      if (typeof object3D.userData.faceB === 'string') {
        object3D.userData.faceB = this._withFeaturePrefix(id, object3D.userData.faceB, object3D.userData.faceB);
      }
    }

    if (Array.isArray(object3D.children) && object3D.children.length) {
      for (const child of object3D.children) {
        this._applyFeaturePrefixToObject3D(child, id);
      }
    }
  }

  async _extractFeatureInfo(bytes) {
    try {
      const buffer = this._toArrayBuffer(bytes);
      if (!buffer) return null;
      const zip = await JSZip.loadAsync(buffer);
      const candidates = ['Metadata/featureHistory.json', 'metadata/featurehistory.json'];
      const extrasCandidates = ['Metadata/brepExtras.json', 'metadata/brepextras.json'];
      let brepExtras = null;
      for (const path of extrasCandidates) {
        const file = zip.file(path);
        if (!file) continue;
        try {
          const text = await file.async('string');
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') brepExtras = parsed;
        } catch { /* ignore extras parse errors */ }
        if (brepExtras) break;
      }
      for (const path of candidates) {
        const file = zip.file(path);
        if (!file) continue;
        const text = await file.async('string');
        try {
          const parsed = JSON.parse(text);
          return {
            metadata: parsed?.metadata || {},
            facets: parsed?.facets || null,
            history: parsed || null,
            historyString: text,
            brepExtras,
          };
        } catch {
          return brepExtras ? { brepExtras } : null;
        }
      }
      if (brepExtras) return { brepExtras };
    } catch (err) {
      console.warn('[AssemblyComponentFeature] Failed to extract feature history from component:', err);
    }
    return null;
  }

  _toArrayBuffer(uint8) {
    if (!(uint8 instanceof Uint8Array)) return null;
    if (uint8.byteOffset === 0 && uint8.byteLength === uint8.buffer.byteLength) {
      return uint8.buffer;
    }
    return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
  }
}
