import { BREP } from "../../BREP/BREP.js";

export function cloneProfileGroups(faceObj) {
  const groups = Array.isArray(faceObj?.userData?.profileGroups)
    ? faceObj.userData.profileGroups
    : null;
  if (!groups || groups.length === 0) return null;

  const clonePoint = (pt, dims) => {
    if (!Array.isArray(pt)) return null;
    const out = [];
    for (let i = 0; i < dims; i++) {
      const val = Number(pt[i]);
      if (!Number.isFinite(val)) return null;
      out.push(val);
    }
    return out;
  };

  const clonePointList = (list, dims) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const pt of list) {
      const next = clonePoint(pt, dims);
      if (next) out.push(next);
    }
    return out;
  };

  const cloneNestedList = (list, dims) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const entry of list) {
      const next = clonePointList(entry, dims);
      if (next.length) out.push(next);
    }
    return out;
  };

  const out = [];
  for (const group of groups) {
    const contour2D = clonePointList(group?.contour2D, 2);
    const holes2D = cloneNestedList(group?.holes2D, 2);
    const contourW = clonePointList(group?.contourW, 3);
    const holesW = cloneNestedList(group?.holesW, 3);
    if (contour2D.length < 3 || contourW.length !== contour2D.length) continue;
    out.push({ contour2D, holes2D, contourW, holesW });
  }

  return out.length ? out : null;
}

export function collectProfileEdges(faceObj) {
  const edges = Array.isArray(faceObj?.edges) ? faceObj.edges : null;
  if (!edges || edges.length === 0) return null;
  const out = [];
  const THREE = BREP.THREE;
  for (const edge of edges) {
    const name = typeof edge?.name === "string" ? edge.name : null;
    const polyline = Array.isArray(edge?.userData?.polylineLocal)
      ? edge.userData.polylineLocal
      : null;
    if (!name || !polyline || polyline.length < 2) continue;
    const pts = [];
    const isWorld = edge?.userData?.polylineWorld === true;
    for (const pt of polyline) {
      if (!Array.isArray(pt) || pt.length < 3) continue;
      let x = Number(pt[0]);
      let y = Number(pt[1]);
      let z = Number(pt[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!isWorld && edge?.matrixWorld) {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(edge.matrixWorld);
        x = v.x;
        y = v.y;
        z = v.z;
      }
      pts.push([x, y, z]);
    }
    if (pts.length < 2) continue;
    out.push({
      name,
      polyline: pts,
      polylineWorld: true,
    });
  }
  return out.length ? out : null;
}

export function buildFaceFromProfileGroups(profileGroups, profileName, profileEdges) {
  const groups = normalizeProfileGroups(profileGroups);
  if (!groups.length) return null;
  const THREE = BREP.THREE;
  const triPositions = [];
  const boundaryLoopsWorld = [];
  const sanitizedGroups = [];

  for (const group of groups) {
    const contour2D = group.contour2D;
    const holes2D = group.holes2D;
    const contourW = group.contourW;
    const holesW = group.holesW;
    if (contour2D.length < 3 || contourW.length !== contour2D.length) continue;

    const contourV2 = contour2D.map((p) => new THREE.Vector2(p[0], p[1]));
    const holesV2 = holes2D.map((hole) => hole.map((p) => new THREE.Vector2(p[0], p[1])));
    const tris = THREE.ShapeUtils.triangulateShape(contourV2, holesV2);
    const allW = contourW.concat(...holesW);
    for (const tri of tris) {
      const a = allW[tri[0]];
      const b = allW[tri[1]];
      const c = allW[tri[2]];
      if (!a || !b || !c) continue;
      triPositions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    }

    boundaryLoopsWorld.push({ pts: contourW.map((pt) => pt.slice()), isHole: false });
    for (const hole of holesW) {
      boundaryLoopsWorld.push({ pts: hole.map((pt) => pt.slice()), isHole: true });
    }
    sanitizedGroups.push({
      contour2D: contour2D.map((pt) => pt.slice()),
      holes2D: holes2D.map((hole) => hole.map((pt) => pt.slice())),
      contourW: contourW.map((pt) => pt.slice()),
      holesW: holesW.map((hole) => hole.map((pt) => pt.slice())),
    });
  }

  if (!triPositions.length) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(triPositions, 3));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();

  const face = new BREP.Face(geom);
  face.name = (typeof profileName === "string" && profileName.trim()) ? profileName.trim() : "PROFILE";
  face.userData = face.userData || {};
  face.userData.faceName = face.name;
  face.userData.boundaryLoopsWorld = boundaryLoopsWorld;
  face.userData.profileGroups = sanitizedGroups;
  const edges = buildProfileEdges(profileEdges);
  if (edges.length) face.edges = edges;
  return face;
}

function normalizeProfileGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const toPoint = (pt, dims) => {
    if (!Array.isArray(pt) || pt.length < dims) return null;
    const vals = [];
    for (let i = 0; i < dims; i++) {
      const n = Number(pt[i]);
      if (!Number.isFinite(n)) return null;
      vals.push(n);
    }
    return vals;
  };
  const toPointList = (list, dims) => {
    if (!Array.isArray(list)) return [];
    const arr = [];
    for (const pt of list) {
      const next = toPoint(pt, dims);
      if (next) arr.push(next);
    }
    return arr;
  };
  const toNestedList = (list, dims) => {
    if (!Array.isArray(list)) return [];
    const arr = [];
    for (const entry of list) {
      const next = toPointList(entry, dims);
      if (next.length) arr.push(next);
    }
    return arr;
  };
  for (const group of raw) {
    if (!group) continue;
    const contour2D = toPointList(group.contour2D, 2);
    const holes2D = toNestedList(group.holes2D, 2);
    const contourW = toPointList(group.contourW, 3);
    const holesW = toNestedList(group.holesW, 3);
    if (contour2D.length < 3 || contourW.length !== contour2D.length) continue;
    out.push({ contour2D, holes2D, contourW, holesW });
  }
  return out;
}

function buildProfileEdges(edgeDefs) {
  if (!Array.isArray(edgeDefs)) return [];
  const edges = [];
  for (const def of edgeDefs) {
    const name = typeof def?.name === "string" ? def.name : null;
    const polyline = Array.isArray(def?.polyline) ? def.polyline : null;
    if (!name || !polyline || polyline.length < 2) continue;
    const pts = [];
    for (const pt of polyline) {
      if (!Array.isArray(pt) || pt.length < 3) continue;
      const x = Number(pt[0]);
      const y = Number(pt[1]);
      const z = Number(pt[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      pts.push([x, y, z]);
    }
    if (pts.length < 2) continue;
    edges.push({
      name,
      userData: {
        polylineLocal: pts,
        polylineWorld: true,
      },
    });
  }
  return edges;
}
