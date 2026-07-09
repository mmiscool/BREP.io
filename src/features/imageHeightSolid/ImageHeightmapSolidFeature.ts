import { BREP } from "../../BREP/BREP.js";
import { ImageEditorUI } from '../imageToFace/imageEditor.js';
const THREE = BREP.THREE;

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "unique identifier for the heightmap solid feature",
  },
  fileToImport: {
    type: "file",
    default_value: "",
    accept: ".png,image/png",
    hint: "Grayscale or RGB PNG heightmap (click to choose a file)",
  },
  editImage: {
    type: "button",
    label: "Edit Image",
    default_value: null,
    hint: "Launch the paint like image editor",
    actionFunction: (ctx: any) => {
      let { fileToImport } = ctx.feature.inputParams;
      if (!fileToImport) {
        try {
          const c = document.createElement('canvas');
          c.width = 300; c.height = 300;
          const ctx2d = c.getContext('2d');
          ctx2d.fillStyle = '#ffffff';
          ctx2d.fillRect(0, 0, c.width, c.height);
          fileToImport = c.toDataURL('image/png');
        } catch (_) { fileToImport = null; }
      }
      const imageEditor = new ImageEditorUI(fileToImport, {
        onSave: (editedImage: any) => {
          try { ctx.feature.inputParams.fileToImport = editedImage; } catch (_) { /* ignore stale feature context */ }
          try { if (ctx.params) ctx.params.fileToImport = editedImage; } catch (_) { /* ignore stale params context */ }
          try {
            if (ctx.partHistory) {
              ctx.partHistory.currentHistoryStepId = ctx.feature.inputParams.featureID;
              if (typeof ctx.partHistory.runHistory === 'function') ctx.partHistory.runHistory();
            }
          } catch (_) { /* ignore preview rebuild failures */ }
        },
        onCancel: () => { /* no-op */ }
      });
      imageEditor.open();
    }
  },
  heightScale: {
    type: "number",
    default_value: 1,
    hint: "World units of elevation per full-intensity pixel (0-255)",
  },
  baseHeight: {
    type: "number",
    default_value: 0,
    hint: "Base plane height used as the minimum elevation",
  },
  invertHeights: {
    type: "boolean",
    default_value: false,
    hint: "Invert grayscale so dark pixels become tall regions",
  },
  pixelScale: {
    type: "number",
    default_value: 1,
    hint: "World units per pixel in X/Y directions",
  },
  center: {
    type: "boolean",
    default_value: true,
    hint: "Center the heightmap around the origin before placement",
  },
  sampleStride: {
    type: "number",
    default_value: 1,
    hint: "Sample every Nth pixel (higher stride reduces triangles)",
  },
  placementPlane: {
    type: "reference_selection",
    selectionFilter: ["PLANE", "FACE"],
    multiple: false,
    default_value: null,
    hint: "Select a plane or face where the heightmap will be placed",
  },
  simplifyTolerance: {
    type: "number",
    default_value: 0,
    hint: "Simplify tolerance (>0 enables Manifold simplify)",
  },
  boolean: {
    type: "boolean_operation",
    default_value: { targets: [], operation: 'NONE' },
    hint: "Optional boolean operation with selected solids"
  }
};

export class ImageHeightmapSolidFeature {
  [key: string]: any;

  static shortName = "HEIGHTMAP";
  static longName = "Image Heightmap Solid";
  static inputParamsSchema = inputParamsSchema;

  inputParams: any;
  persistentData: any;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory: any) {
    const {
      fileToImport,
      heightScale,
      baseHeight,
      invertHeights,
      pixelScale,
      center,
      sampleStride,
      simplifyTolerance,
    } = this.inputParams;

    const imageData = await decodeToImageData(fileToImport);
    if (!imageData) {
      console.warn('[HEIGHTMAP] No image data decoded');
      return { added: [], removed: [] };
    }

    const width = imageData.width | 0;
    const height = imageData.height | 0;
    if (!(width >= 2 && height >= 2)) {
      console.warn('[HEIGHTMAP] Heightmap requires an image at least 2x2 pixels');
      return { added: [], removed: [] };
    }

    const src = imageData.data;
    const scaleXY = Number.isFinite(Number(pixelScale)) && Number(pixelScale) !== 0 ? Number(pixelScale) : 1;
    const scaleZ = Number.isFinite(Number(heightScale)) ? Number(heightScale) : 1;
    const base = Number.isFinite(Number(baseHeight)) ? Number(baseHeight) : 0;
    const invert = !!invertHeights;
    const centerXY = center !== false;
    const strideRaw = Number(sampleStride);
    const stride = Number.isFinite(strideRaw) && strideRaw >= 1 ? Math.floor(strideRaw) : 1;

    const offsetX = centerXY ? (width - 1) * 0.5 : 0;
    const offsetY = centerXY ? (height - 1) * 0.5 : 0;

    const sampleXs = buildSampleIndices(width, stride);
    const sampleYs = buildSampleIndices(height, stride);
    const gridWidth = sampleXs.length;
    const gridHeight = sampleYs.length;
    if (!(gridWidth >= 2 && gridHeight >= 2)) {
      console.warn('[HEIGHTMAP] Sampling produced insufficient grid resolution');
      return { added: [], removed: [] };
    }
    const gridCount = gridWidth * gridHeight;

    // Precompute world XY per grid column/row and heights per grid cell.
    const pxArr = new Float64Array(gridWidth);
    for (let gx = 0; gx < gridWidth; gx++) pxArr[gx] = (sampleXs[gx] - offsetX) * scaleXY;
    const pyArr = new Float64Array(gridHeight);
    for (let gy = 0; gy < gridHeight; gy++) {
      const sy = sampleYs[gy];
      pyArr[gy] = (centerXY ? (offsetY - sy) : -sy) * scaleXY;
    }

    const heights = new Float64Array(gridCount);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let gy = 0; gy < gridHeight; gy++) {
      const sy = sampleYs[gy];
      const rowBase = gy * gridWidth;
      for (let gx = 0; gx < gridWidth; gx++) {
        const sx = sampleXs[gx];
        const si = (sy * width + sx) * 4;
        const r = src[si] | 0;
        const g = src[si + 1] | 0;
        const b = src[si + 2] | 0;
        const a = src[si + 3] | 0;
        const gray = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        let value = (a >= 16) ? (invert ? (1 - gray) : gray) : 0;
        value = Math.max(0, Math.min(1, value));
        const h = base + value * scaleZ;
        heights[rowBase + gx] = h;
        if (h < minZ) minZ = h;
        if (h > maxZ) maxZ = h;
      }
    }
    if (base < minZ) minZ = base;
    if (base > maxZ) maxZ = base;
    for (let gx = 0; gx < gridWidth; gx++) {
      if (pxArr[gx] < minX) minX = pxArr[gx];
      if (pxArr[gx] > maxX) maxX = pxArr[gx];
    }
    for (let gy = 0; gy < gridHeight; gy++) {
      if (pyArr[gy] < minY) minY = pyArr[gy];
      if (pyArr[gy] > maxY) maxY = pyArr[gy];
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
      console.warn('[HEIGHTMAP] Failed to compute geometry bounds');
      return { added: [], removed: [] };
    }

    if (!((maxZ - minZ) > 1e-9)) {
      console.warn('[HEIGHTMAP] Heightmap has zero thickness; increase heightScale or height variation');
      return { added: [], removed: [] };
    }

    // Relieve zero-thickness pinches: a grid edge whose endpoints both sit
    // exactly on the base plane but whose two flanking triangles both carry
    // material would be shared by four triangles once top vertices merge
    // into their base vertices — a non-manifold line where the solid touches
    // itself. Lift such endpoints a hair off the base so the two regions
    // fuse through a thin wall instead. Lifting can expose new pinches one
    // ring further out, so repeat until stable.
    const pinchLift = base + Math.sign(scaleZ || 1) * Math.max(Math.abs(scaleZ) * 1e-5, 1e-9);
    const liftPinch = (iA, iB, iC1, iC2) => {
      if (heights[iA] === base && heights[iB] === base
        && heights[iC1] !== base && heights[iC2] !== base) {
        heights[iA] = pinchLift;
        heights[iB] = pinchLift;
        return 1;
      }
      return 0;
    };
    for (let pass = 0; pass < gridCount; pass++) {
      let lifted = 0;
      for (let y = 0; y < gridHeight - 1; y++) {
        const row = y * gridWidth;
        for (let x = 0; x < gridWidth - 1; x++) {
          const i00 = row + x;
          const i10 = i00 + 1;
          const i01 = i00 + gridWidth;
          const i11 = i01 + 1;
          lifted += liftPinch(i00, i11, i10, i01);
          if (y > 0) lifted += liftPinch(i00, i10, i11, i00 - gridWidth);
          if (x > 0) lifted += liftPinch(i00, i01, i11, i00 - 1);
        }
      }
      if (!lifted) break;
    }

    const solid = new BREP.Solid();
    const featureName = this.inputParams.featureID || 'HEIGHTMAP_SOLID';
    solid.name = featureName;

    // Bulk mesh construction. The grid structure makes vertex indices
    // deterministic, so we bypass Solid.addTriangle's string-keyed vertex
    // dedup entirely. Bottom vertices occupy indices [0, gridCount); a top
    // vertex gets its own index only where its height differs from the base
    // (matching the exact-coordinate merge addTriangle used to perform).
    const vertProperties = new Array(gridCount * 3 * 2);
    for (let i = 0, gy = 0; gy < gridHeight; gy++) {
      const py = pyArr[gy];
      for (let gx = 0; gx < gridWidth; gx++, i++) {
        const o = i * 3;
        vertProperties[o] = pxArr[gx];
        vertProperties[o + 1] = py;
        vertProperties[o + 2] = base;
      }
    }
    const topIndex = new Int32Array(gridCount);
    let vertCount = gridCount;
    for (let i = 0; i < gridCount; i++) {
      const h = heights[i];
      if (h === base) {
        topIndex[i] = i;
      } else {
        const o = vertCount * 3;
        const bo = i * 3;
        vertProperties[o] = vertProperties[bo];
        vertProperties[o + 1] = vertProperties[bo + 1];
        vertProperties[o + 2] = h;
        topIndex[i] = vertCount++;
      }
    }
    vertProperties.length = vertCount * 3;

    const triVerts = [];
    const triIDs = [];
    // Windings below are exact for the grid layout (x increases with gx,
    // y decreases with gy, heights on one side of the base plane), so no
    // per-triangle orientation heuristic is needed. Triangles that collapse
    // because a top vertex merged into its base vertex share indices and
    // are skipped; no other degenerate triangles can occur on the grid.
    const emit = (id, i0, i1, i2) => {
      if (i0 === i1 || i1 === i2 || i2 === i0) return;
      triVerts.push(i0, i1, i2);
      triIDs.push(id);
    };

    const faceBase = featureName ? `${featureName}` : 'HEIGHTMAP';
    const topID = solid._getOrCreateID(`${faceBase}:TOP`);
    const bottomID = solid._getOrCreateID(`${faceBase}:BOTTOM`);
    const sidePosYID = solid._getOrCreateID(`${faceBase}:SIDE_POS_Y`);
    const sideNegYID = solid._getOrCreateID(`${faceBase}:SIDE_NEG_Y`);
    const sideNegXID = solid._getOrCreateID(`${faceBase}:SIDE_NEG_X`);
    const sidePosXID = solid._getOrCreateID(`${faceBase}:SIDE_POS_X`);

    for (let y = 0; y < gridHeight - 1; y++) {
      const row = y * gridWidth;
      for (let x = 0; x < gridWidth - 1; x++) {
        const i00 = row + x;
        const i10 = i00 + 1;
        const i01 = i00 + gridWidth;
        const i11 = i01 + 1;
        const t00 = topIndex[i00];
        const t10 = topIndex[i10];
        const t01 = topIndex[i01];
        const t11 = topIndex[i11];
        // A triangle whose three corners all sit at the base plane has zero
        // thickness: its top copy would coincide with its bottom copy and
        // create a non-manifold membrane, so both copies are dropped. The
        // surface stays closed because top vertices merge into their base
        // vertices along the boundary of such regions.
        if (!(t00 === i00 && t11 === i11 && t10 === i10)) {
          emit(topID, t00, t11, t10);
          emit(bottomID, i00, i10, i11);
        }
        if (!(t00 === i00 && t01 === i01 && t11 === i11)) {
          emit(topID, t00, t01, t11);
          emit(bottomID, i00, i11, i01);
        }
      }
    }

    // The quad pattern (topA, topB, bottomB) + (topA, bottomB, bottomA)
    // faces +Y on the gy=0 wall and +X on walls swept along increasing gy;
    // the opposite walls take the reversed winding.
    const addSideQuad = (id, iA, iB, flip) => {
      if (flip) {
        emit(id, topIndex[iA], iB, topIndex[iB]);
        emit(id, topIndex[iA], iA, iB);
      } else {
        emit(id, topIndex[iA], topIndex[iB], iB);
        emit(id, topIndex[iA], iB, iA);
      }
    };

    for (let x = 0; x < gridWidth - 1; x++) {
      addSideQuad(sidePosYID, x, x + 1, false);
    }

    for (let x = 0; x < gridWidth - 1; x++) {
      const iA = (gridHeight - 1) * gridWidth + x;
      addSideQuad(sideNegYID, iA, iA + 1, true);
    }

    for (let y = 0; y < gridHeight - 1; y++) {
      addSideQuad(sideNegXID, y * gridWidth, (y + 1) * gridWidth, true);
    }

    for (let y = 0; y < gridHeight - 1; y++) {
      const col = gridWidth - 1;
      addSideQuad(sidePosXID, y * gridWidth + col, (y + 1) * gridWidth + col, false);
    }

    // Heights sit on a single side of the base plane (value ∈ [0,1] times a
    // fixed-sign heightScale), so a negative heightScale inverts the whole
    // solid at once. Detect via signed volume and flip every triangle.
    if (signedVolume(vertProperties, triVerts) < 0) {
      for (let t = 0; t < triVerts.length; t += 3) {
        const tmp = triVerts[t + 1];
        triVerts[t + 1] = triVerts[t + 2];
        triVerts[t + 2] = tmp;
      }
    }

    solid._vertProperties = vertProperties;
    solid._triVerts = triVerts;
    solid._triIDs = triIDs;
    solid._vertKeyToIndex = new Map(); // rebuilt lazily by _getPointIndex if ever needed
    solid._dirty = true;
    solid._faceIndex = null;

    const basis = getPlacementBasis(this.inputParams?.placementPlane, partHistory);
    const origin = new THREE.Vector3().fromArray(basis.origin);
    const xAxis = new THREE.Vector3().fromArray(basis.x);
    const yAxis = new THREE.Vector3().fromArray(basis.y);
    const zAxis = new THREE.Vector3().fromArray(basis.z);
    const placement = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(origin);
    if (!isIdentityMatrix(placement)) solid.bakeTransform(placement);

    solid.userData = solid.userData || {};
    solid.userData.heightmap = {
      width,
      height,
      pixelScale: scaleXY,
      heightScale: scaleZ,
      baseHeight: base,
      invert: invert,
      sampleStride: stride,
      gridWidth,
      gridHeight,
    };
    let finalSolid = solid;
    const tol = Number(simplifyTolerance);
    if (Number.isFinite(tol) && tol > 0) {
      try {
        const simplified = solid.simplify(tol);
        if (simplified && simplified instanceof BREP.Solid) finalSolid = simplified;
      } catch (e) {
        console.warn('[HEIGHTMAP] Simplify failed, using original solid:', e);
      }
    }
    if (finalSolid !== solid) {
      finalSolid.name = featureName;
      finalSolid.userData = { ...solid.userData };
    }
    finalSolid.visualize();

    const effects = await BREP.applyBooleanOperation(partHistory || {}, finalSolid, this.inputParams.boolean, this.inputParams.featureID);
    return effects;
  }
}

async function decodeToImageData(raw) {
  try {
    if (!raw) return null;
    if (raw instanceof ImageData) return raw;
    if (raw instanceof ArrayBuffer) {
      try {
        const blob = new Blob([raw], { type: 'image/png' });
        const img = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        try { img.close && img.close(); } catch { /* ignore ImageBitmap cleanup failures */ }
        return id;
      } catch { /* return null when ArrayBuffer image decoding fails */ }
      return null;
    }
    if (typeof raw === 'string') {
      if (raw.startsWith('data:')) {
        const img = await createImageBitmap(await (await fetch(raw)).blob());
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        try { img.close && img.close(); } catch { /* ignore ImageBitmap cleanup failures */ }
        return id;
      }
      try {
        const b64 = raw;
        const binaryStr = (typeof atob === 'function') ? atob(b64) : (typeof globalThis.Buffer !== 'undefined' ? globalThis.Buffer.from(b64, 'base64').toString('binary') : '');
        const len = binaryStr.length | 0;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i) & 0xff;
        const blob = new Blob([bytes], { type: 'image/png' });
        const img = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        try { img.close && img.close(); } catch { /* ignore ImageBitmap cleanup failures */ }
        return id;
      } catch { /* return null when base64 image decoding fails */ }
      return null;
    }
  } catch (e) {
    console.warn('[HEIGHTMAP] Failed to decode input as image data', e);
  }
  return null;
}

function signedVolume(vp, tv) {
  let vol = 0;
  for (let t = 0; t < tv.length; t += 3) {
    const o0 = tv[t] * 3, o1 = tv[t + 1] * 3, o2 = tv[t + 2] * 3;
    const ax = vp[o0], ay = vp[o0 + 1], az = vp[o0 + 2];
    const bx = vp[o1], by = vp[o1 + 1], bz = vp[o1 + 2];
    const cx = vp[o2], cy = vp[o2 + 1], cz = vp[o2 + 2];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return vol / 6;
}

function isIdentityMatrix(m) {
  const e = m.elements;
  for (let i = 0; i < 16; i++) {
    if (e[i] !== (i % 5 === 0 ? 1 : 0)) return false;
  }
  return true;
}

function buildSampleIndices(count, stride) {
  const out = [];
  if (count <= 0) return out;
  for (let i = 0; i < count; i += stride) out.push(i);
  const last = count - 1;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function getPlacementBasis(ref, partHistory) {
  const x = new THREE.Vector3(1, 0, 0);
  const y = new THREE.Vector3(0, 1, 0);
  const z = new THREE.Vector3(0, 0, 1);
  const origin = new THREE.Vector3(0, 0, 0);

  let refObj = null;
  try {
    if (Array.isArray(ref)) refObj = ref[0] || null;
    else if (ref && typeof ref === 'object') refObj = ref;
    else if (ref) refObj = partHistory?.scene?.getObjectByName(ref);
  } catch { /* ignore invalid placement references */ }

  if (refObj) {
    try { refObj.updateWorldMatrix(true, true); } catch { /* ignore non-Object3D placement references */ }
    try {
      const g = refObj.geometry;
      if (g) {
        const bs = g.boundingSphere || (g.computeBoundingSphere(), g.boundingSphere);
        if (bs) origin.copy(refObj.localToWorld(bs.center.clone()));
        else origin.copy(refObj.getWorldPosition(new THREE.Vector3()));
      } else origin.copy(refObj.getWorldPosition(new THREE.Vector3()));
    } catch { origin.copy(refObj.getWorldPosition(new THREE.Vector3())); }

    let n = null;
    try {
      if (refObj.type === 'FACE' && typeof refObj.getAverageNormal === 'function') {
        n = refObj.getAverageNormal().clone();
      } else {
        n = new THREE.Vector3(0, 0, 1).applyQuaternion(refObj.getWorldQuaternion(new THREE.Quaternion()));
      }
    } catch { n = null; }
    if (!n || n.lengthSq() < 1e-16) n = new THREE.Vector3(0, 0, 1);
    n.normalize();

    const worldX = new THREE.Vector3(1, 0, 0).applyQuaternion(refObj.getWorldQuaternion(new THREE.Quaternion()));
    const worldY = new THREE.Vector3().crossVectors(n, worldX);
    if (worldY.lengthSq() < 1e-20) {
      worldX.set(1, 0, 0);
      worldY.set(0, 1, 0);
    } else {
      worldY.normalize();
      worldX.crossVectors(worldY, n).normalize();
    }
    x.copy(worldX);
    y.copy(worldY);
    z.copy(n);
  }

  return {
    origin: [origin.x, origin.y, origin.z],
    x: [x.x, x.y, x.z],
    y: [y.x, y.y, y.z],
    z: [z.x, z.y, z.z],
  };
}
