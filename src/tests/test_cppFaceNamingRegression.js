import { fs } from "../fs.proxy.js";
import { CppSolidCore } from "../BREP/CppSolidCore.js";
import { ManifoldMesh, manifoldBuildSource } from "../BREP/setupManifold.js";

const MEDIUM_FILLET_PART_PATH = "src/tests/partFiles/medium_fillets.BREP.json";

function cloneState(state) {
  return {
    numProp: Number(state?.numProp ?? 3),
    vertProperties: Array.from(state?.vertProperties ?? []),
    triVerts: Array.from(state?.triVerts ?? []),
    triIDs: Array.from(state?.triIDs ?? []),
  };
}

function legacyIsCoherentlyOrientedManifold(state) {
  const triVerts = Array.isArray(state?.triVerts) ? state.triVerts : [];
  const vertProperties = Array.isArray(state?.vertProperties) ? state.vertProperties : [];
  const triCount = (triVerts.length / 3) | 0;
  if (triCount === 0) return false;
  const numVerts = (vertProperties.length / 3) | 0;
  const NV = BigInt(numVerts);
  const ukey = (a, b) => {
    const A = BigInt(a);
    const B = BigInt(b);
    return A < B ? A * NV + B : B * NV + A;
  };
  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    const b = t * 3;
    const i0 = triVerts[b + 0];
    const i1 = triVerts[b + 1];
    const i2 = triVerts[b + 2];
    const edges = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];
    for (const [a, b2] of edges) {
      const key = ukey(a, b2);
      let arr = edgeMap.get(key);
      if (!arr) {
        arr = [];
        edgeMap.set(key, arr);
      }
      arr.push({ a, b: b2 });
    }
  }
  for (const arr of edgeMap.values()) {
    if (arr.length !== 2) return false;
    const e0 = arr[0];
    const e1 = arr[1];
    if (!(e0.a === e1.b && e0.b === e1.a)) return false;
  }
  return true;
}

function legacyFixTriangleWindingsByAdjacency(state) {
  if (legacyIsCoherentlyOrientedManifold(state)) return false;
  const triCount = (state.triVerts.length / 3) | 0;
  if (triCount === 0) return false;

  const tris = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    tris[t] = [
      state.triVerts[base + 0],
      state.triVerts[base + 1],
      state.triVerts[base + 2],
    ];
  }

  const undirected = new Map();
  const numVerts = (state.vertProperties.length / 3) | 0;
  const NV = BigInt(numVerts);
  const ukey = (a, b) => {
    const A = BigInt(a);
    const B = BigInt(b);
    return A < B ? A * NV + B : B * NV + A;
  };

  for (let ti = 0; ti < tris.length; ti++) {
    const tri = tris[ti];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = ukey(a, b);
      let arr = undirected.get(key);
      if (!arr) {
        arr = [];
        undirected.set(key, arr);
      }
      arr.push({ tri: ti, a, b });
    }
  }

  const visited = new Array(triCount).fill(false);
  const stack = [];
  let changed = false;

  for (let seed = 0; seed < triCount; seed++) {
    if (visited[seed]) continue;
    visited[seed] = true;
    stack.push(seed);

    while (stack.length) {
      const t = stack.pop();
      const tri = tris[t];
      for (let e = 0; e < 3; e++) {
        const a = tri[e];
        const b = tri[(e + 1) % 3];
        const adj = undirected.get(ukey(a, b));
        if (!adj || adj.length < 2) continue;
        for (const entry of adj) {
          const n = entry.tri;
          if (n === t || visited[n]) continue;
          const nTri = tris[n];
          if (entry.a === a && entry.b === b) {
            [nTri[1], nTri[2]] = [nTri[2], nTri[1]];
            changed = true;
          }
          visited[n] = true;
          stack.push(n);
        }
      }
    }
  }

  state.triVerts = [];
  for (const tri of tris) {
    state.triVerts.push(tri[0], tri[1], tri[2]);
  }
  return changed;
}

function legacyPrepareManifoldMesh(snapshot) {
  const state = cloneState(snapshot);
  legacyFixTriangleWindingsByAdjacency(state);

  const vp = state.vertProperties;
  let signedVolume = 0;
  for (let t = 0; t < state.triVerts.length; t += 3) {
    const i0 = state.triVerts[t];
    const i1 = state.triVerts[t + 1];
    const i2 = state.triVerts[t + 2];
    const x0 = vp[i0 * 3];
    const y0 = vp[i0 * 3 + 1];
    const z0 = vp[i0 * 3 + 2];
    const x1 = vp[i1 * 3];
    const y1 = vp[i1 * 3 + 1];
    const z1 = vp[i1 * 3 + 2];
    const x2 = vp[i2 * 3];
    const y2 = vp[i2 * 3 + 1];
    const z2 = vp[i2 * 3 + 2];
    signedVolume += x0 * (y1 * z2 - z1 * y2)
      - y0 * (x1 * z2 - z1 * x2)
      + z0 * (x1 * y2 - y1 * x2);
  }
  if (signedVolume < 0) {
    for (let t = 0; t < state.triVerts.length; t += 3) {
      const temp = state.triVerts[t + 1];
      state.triVerts[t + 1] = state.triVerts[t + 2];
      state.triVerts[t + 2] = temp;
    }
  }

  const mesh = new ManifoldMesh({
    numProp: state.numProp,
    vertProperties: new Float32Array(state.vertProperties),
    triVerts: new Uint32Array(state.triVerts),
    faceID: new Uint32Array(state.triIDs),
  });

  try {
    mesh.merge();
    return {
      numProp: Number(mesh.numProp ?? state.numProp ?? 3),
      vertProperties: Array.from(mesh.vertProperties ?? []),
      triVerts: Array.from(mesh.triVerts ?? []),
      faceID: Array.from(mesh.faceID ?? []),
      mergeFromVert: Array.from(mesh.mergeFromVert ?? []),
      mergeToVert: Array.from(mesh.mergeToVert ?? []),
      vertexCount: ((mesh.vertProperties?.length || 0) / (mesh.numProp || 3)) | 0,
      triangleCount: ((mesh.triVerts?.length || 0) / 3) | 0,
    };
  } finally {
    try { mesh?.delete?.(); } catch { }
  }
}

function assertExactArray(name, actual, expected) {
  if (actual.length !== expected.length) {
    throw new Error(`[cpp face naming regression] ${name} length mismatch: expected ${expected.length}, received ${actual.length}.`);
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`[cpp face naming regression] ${name} mismatch at index ${i}: expected ${expected[i]}, received ${actual[i]}.`);
    }
  }
}

function assertNoFallbackFaceNames(faceNames) {
  const fallback = faceNames.filter((name) => /^FACE(?:_\d+)?$/.test(name));
  if (fallback.length > 0) {
    throw new Error(`[cpp face naming regression] Found fallback face names: ${fallback.join(", ")}`);
  }
}

function getSolidByName(partHistory, name) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  return solids.find((solid) => String(solid?.name || "") === String(name)) || null;
}

export async function test_cppNative_prepareManifoldMesh_matches_legacy_js_reference() {
  if (manifoldBuildSource !== "local") return;

  const snapshot = {
    numProp: 3,
    vertProperties: [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
      1, 0, 0,
    ],
    triVerts: [
      0, 1, 2,
      0, 4, 3,
      1, 2, 3,
      2, 0, 3,
    ],
    triIDs: [31, 32, 33, 34],
  };

  const legacyPrepared = legacyPrepareManifoldMesh(snapshot);
  const core = new CppSolidCore();
  try {
    core.setAuthoringState({
      ...snapshot,
      faceNameToID: [
        ["F0", 31],
        ["F1", 32],
        ["F2", 33],
        ["F3", 34],
      ],
      idToFaceName: [
        [31, "F0"],
        [32, "F1"],
        [33, "F2"],
        [34, "F3"],
      ],
      faceMetadataJson: [],
      edgeMetadataJson: [],
    });

    const nativePrepared = core.prepareManifoldMesh();
    assertExactArray("vertProperties", nativePrepared.vertProperties, legacyPrepared.vertProperties);
    assertExactArray("triVerts", nativePrepared.triVerts, legacyPrepared.triVerts);
    assertExactArray("faceID", nativePrepared.faceID, legacyPrepared.faceID);
    assertExactArray("mergeFromVert", nativePrepared.mergeFromVert, legacyPrepared.mergeFromVert);
    assertExactArray("mergeToVert", nativePrepared.mergeToVert, legacyPrepared.mergeToVert);
    if (nativePrepared.vertexCount !== legacyPrepared.vertexCount) {
      throw new Error(`[cpp face naming regression] vertexCount mismatch: expected ${legacyPrepared.vertexCount}, received ${nativePrepared.vertexCount}.`);
    }
    if (nativePrepared.triangleCount !== legacyPrepared.triangleCount) {
      throw new Error(`[cpp face naming regression] triangleCount mismatch: expected ${legacyPrepared.triangleCount}, received ${nativePrepared.triangleCount}.`);
    }
  } finally {
    core.dispose();
  }
}

export async function test_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const content = await fs.promises.readFile(MEDIUM_FILLET_PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  return partHistory;
}

export async function afterRun_fillet_face_names_and_merge_metadata_survive_native_manifold_rebuild(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const solid = getSolidByName(partHistory, "E2");
  if (!solid || typeof solid.getFaceNames !== "function" || typeof solid.getFaceMetadata !== "function") {
    throw new Error("[cpp face naming regression] Failed to resolve post-fillet solid E2.");
  }

  const faceNames = (solid.getFaceNames() || [])
    .map((name) => String(name || "").trim())
    .filter((name) => name.length > 0);
  if (faceNames.length === 0) {
    throw new Error("[cpp face naming regression] Fillet result has no face names.");
  }

  const forbiddenPatterns = [
    /(?:^|_)FACE_A(?:$|_)/,
    /(?:^|_)FACE_B(?:$|_)/,
    /(?:^|_)WEDGE_A(?:$|_)/,
    /(?:^|_)WEDGE_B(?:$|_)/,
    /(?:^|_)SIDE_A(?:$|_)/,
    /(?:^|_)SIDE_B(?:$|_)/,
  ];
  const leakedMergeCandidates = faceNames.filter((name) => forbiddenPatterns.some((pattern) => pattern.test(name)));
  if (leakedMergeCandidates.length > 0) {
    throw new Error(`[cpp face naming regression] Found unmerged intermediate fillet face names: ${leakedMergeCandidates.join(", ")}`);
  }

  const sideWallFaces = [];
  const cornerBridgeFaces = [];
  for (const faceName of faceNames) {
    const metadata = solid.getFaceMetadata(faceName) || {};
    if (metadata?.filletSideWall) {
      sideWallFaces.push({ faceName, metadata });
    }
    if (faceName.startsWith("F3_CORNER_")) {
      cornerBridgeFaces.push({ faceName, metadata });
    }
  }

  const filletOwnedNames = faceNames.filter((faceName) => faceName.startsWith("F3_"));
  assertNoFallbackFaceNames(filletOwnedNames);

  if (sideWallFaces.length < 6) {
    throw new Error(`[cpp face naming regression] Expected merged fillet side-wall faces, found ${sideWallFaces.length}.`);
  }

  const sideWallEdges = new Set();
  for (const { faceName, metadata } of sideWallFaces) {
    const isRoundFaceName = faceName.endsWith("_TUBE_Outer");
    const isMergedSideWallName = faceName.includes("_FILLET_SIDEWALL_");
    if (!isRoundFaceName && !isMergedSideWallName) {
      throw new Error(`[cpp face naming regression] Fillet side-wall face "${faceName}" should keep a descriptive round-face or merged-sidewall name.`);
    }
    if (metadata.filletMergedSideWall !== true) {
      throw new Error(`[cpp face naming regression] Fillet side-wall face "${faceName}" is missing filletMergedSideWall metadata.`);
    }
    if (typeof metadata.filletSideWallEdge !== "string" || metadata.filletSideWallEdge.trim().length === 0) {
      throw new Error(`[cpp face naming regression] Fillet side-wall face "${faceName}" is missing filletSideWallEdge metadata.`);
    }
    if (isRoundFaceName && metadata.filletRoundFace && metadata.filletRoundFace !== faceName) {
      throw new Error(`[cpp face naming regression] Fillet side-wall face "${faceName}" has mismatched filletRoundFace metadata "${metadata.filletRoundFace}".`);
    }
    if (isMergedSideWallName) {
      const roundFaceName = String(metadata.filletRoundFace || "");
      if (!roundFaceName.endsWith("_TUBE_Outer")) {
        throw new Error(`[cpp face naming regression] Merged side-wall face "${faceName}" should retain its source round-face metadata.`);
      }
    }
    const tris = solid.getFace(faceName);
    if (!Array.isArray(tris) || tris.length === 0) {
      throw new Error(`[cpp face naming regression] Fillet side-wall face "${faceName}" has no readable triangles.`);
    }
    sideWallEdges.add(metadata.filletSideWallEdge);
  }

  if (sideWallEdges.size !== sideWallFaces.length) {
    throw new Error(`[cpp face naming regression] Expected one merged side-wall face per filleted edge, found ${sideWallFaces.length} faces for ${sideWallEdges.size} edges.`);
  }

  if (cornerBridgeFaces.length < 4) {
    throw new Error(`[cpp face naming regression] Expected corner-bridge faces to survive boolean reconstruction, found ${cornerBridgeFaces.length}.`);
  }
  for (const { faceName, metadata } of cornerBridgeFaces) {
    if (metadata?.sourceFeatureId !== "F3") {
      throw new Error(`[cpp face naming regression] Corner bridge face "${faceName}" lost sourceFeatureId metadata.`);
    }
    const tris = solid.getFace(faceName);
    if (!Array.isArray(tris) || tris.length === 0) {
      throw new Error(`[cpp face naming regression] Corner bridge face "${faceName}" has no readable triangles.`);
    }
  }
}
