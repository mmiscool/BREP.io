import * as THREE from "three";
import { BREP } from "../../../BREP/BREP.js";
import { evaluateSheetMetal } from "../engine/index.js";
import {
  EPS,
  MIN_LEG,
  MIN_THICKNESS,
  POINT_EPS,
  clamp,
  cloneSolidWorldBaked,
  isSolidLikeObject,
  matrixFromAny,
  normalizeSelectionArray,
  toFiniteNumber,
} from "./shared.js";
import {
  applyCutLoopsToFlat,
  computeLoopNormal3,
  dedupeConsecutivePoints2,
  dedupeConsecutivePoints3,
  isSamePoint3,
  normalizeLoop2,
  polygonMostlyInsidePolygon,
  polygonsOverlap2,
  projectLoopToFlatMidplane,
  removeCutoutHolesFromTree,
  signedArea2D,
  unionFilledLoops2,
} from "./cutoutTree.js";
import { collectTreeIds, findEdgeById, pointDistance2, uniqueId } from "./treeCore.js";
import { resolveCarrierFromObject } from "./flanges.js";

function colorFromString(seed, saturation = 0.62, lightness = 0.52) {
  const text = String(seed || "sheet");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  const color = new THREE.Color();
  color.setHSL(hue / 360, saturation, lightness);
  return color.getHex();
}

function resolveProfileFace(selectionValue) {
  const selected = Array.isArray(selectionValue) ? selectionValue[0] : selectionValue;
  if (!selected || typeof selected !== "object") return null;
  if (selected.type === "FACE") return selected;
  if (selected.type === "SKETCH") {
    const kids = Array.isArray(selected.children) ? selected.children : [];
    return kids.find((child) => child && child.type === "FACE") || null;
  }
  if (selected.parent && selected.parent.type === "SKETCH") {
    const kids = Array.isArray(selected.parent.children) ? selected.parent.children : [];
    return kids.find((child) => child && child.type === "FACE") || null;
  }
  return null;
}

function buildCutoutCutterFromProfile(profileSelections, featureID, options = {}) {
  const selections = normalizeSelectionArray(profileSelections);
  const first = selections[0] || null;
  if (!first || typeof first !== "object") {
    return { cutter: null, profileFace: null, sourceType: null, reason: "no_profile_selection" };
  }

  const firstType = String(first.type || "").toUpperCase();
  if (firstType === "SOLID") {
    const profileSolid = resolveCarrierFromObject(first) || (isSolidLikeObject(first) ? first : null);
    if (!profileSolid) {
      return { cutter: null, profileFace: null, sourceType: "solid", reason: "profile_solid_not_found" };
    }
    const cutter = cloneSolidWorldBaked(profileSolid, `${featureID}:CUTTER`);
    if (!cutter) {
      return { cutter: null, profileFace: null, sourceType: "solid", reason: "failed_to_clone_profile_solid" };
    }
    return { cutter, profileFace: null, sourceType: "solid", profileSolid };
  }

  const profileFace = resolveProfileFace(first);
  if (!profileFace) {
    return { cutter: null, profileFace: null, sourceType: "face", reason: "profile_face_not_found" };
  }

  const forwardDistance = Math.max(0, toFiniteNumber(options.forwardDistance, 1));
  const backDistance = Math.max(0, toFiniteNumber(options.backDistance, 0));
  if (!(forwardDistance > EPS) && !(backDistance > EPS)) {
    return { cutter: null, profileFace, sourceType: "face", reason: "zero_cut_depth" };
  }

  const forwardBias = forwardDistance > EPS ? 1e-5 : 0;
  const backBias = backDistance > EPS ? 1e-5 : 0;
  const cutter = new BREP.Sweep({
    face: profileFace,
    distance: forwardDistance + forwardBias,
    distanceBack: backDistance + backBias,
    mode: "translate",
    name: `${featureID}:CUTTER`,
    omitBaseCap: false,
  });

  return {
    cutter,
    profileFace,
    sourceType: "face",
    forwardDistance,
    backDistance,
  };
}

function collectSketchParents(objects) {
  const out = [];
  const seen = new Set();
  for (const obj of normalizeSelectionArray(objects)) {
    let current = obj;
    while (current) {
      if (current.type === "SKETCH") {
        const key = current.uuid || current.id || current.name;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(current);
        }
        break;
      }
      current = current.parent || null;
    }
  }
  return out;
}

function resolveConsumableInputObject(object) {
  let current = object;
  while (current) {
    if (String(current?.type || "").toUpperCase() === "SKETCH") return current;
    current = current.parent || null;
  }

  current = object;
  while (current) {
    if (String(current?.type || "").toUpperCase() === "SOLID") return current;
    current = current.parent || null;
  }

  if (object?.parentSolid && typeof object.parentSolid === "object") return object.parentSolid;
  return null;
}

function collectConsumableInputObjects(objects) {
  const out = [];
  const seen = new Set();
  for (const obj of normalizeSelectionArray(objects)) {
    const consumable = resolveConsumableInputObject(obj);
    if (!consumable) continue;
    const key = consumable.uuid || consumable.id || consumable.name || consumable;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(consumable);
  }
  return out;
}

function readEdgePolyline3D(edgeObj) {
  if (!edgeObj || typeof edgeObj !== "object") return null;

  if (typeof edgeObj.points === "function") {
    try {
      const points = edgeObj.points(true);
      if (Array.isArray(points) && points.length >= 2) {
        const vecs = points
          .map((point) => new THREE.Vector3(toFiniteNumber(point?.x), toFiniteNumber(point?.y), toFiniteNumber(point?.z)))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
        if (vecs.length >= 2) return dedupeConsecutivePoints3(vecs);
      }
    } catch {
      // ignore and try geometry fallback
    }
  }

  try {
    const pos = edgeObj.geometry?.getAttribute?.("position");
    if (pos && pos.itemSize === 3 && pos.count >= 2) {
      const out = [];
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 1) {
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        tmp.applyMatrix4(edgeObj.matrixWorld);
        out.push(tmp.clone());
      }
      const deduped = dedupeConsecutivePoints3(out);
      if (deduped.length >= 2) return deduped;
    }
  } catch {
    // ignore
  }

  return null;
}

function monotonicHull(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const sorted = points
    .map((point) => ({ x: point[0], y: point[1] }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper).map((point) => [point.x, point.y]);
}

function buildProfileFrame(points3D, normalHint = null) {
  if (!Array.isArray(points3D) || points3D.length < 3) return null;
  const origin = points3D[0].clone();

  let xAxis = null;
  for (let i = 1; i < points3D.length; i += 1) {
    const candidate = points3D[i].clone().sub(origin);
    if (candidate.lengthSq() > EPS) {
      xAxis = candidate.normalize();
      break;
    }
  }
  if (!xAxis) return null;

  let normal = null;
  if (normalHint && normalHint.isVector3 && normalHint.lengthSq() > EPS) {
    normal = normalHint.clone().normalize();
  } else {
    for (let i = 1; i < points3D.length - 1; i += 1) {
      const a = points3D[i].clone().sub(origin);
      const b = points3D[i + 1].clone().sub(origin);
      const cross = new THREE.Vector3().crossVectors(a, b);
      if (cross.lengthSq() > EPS) {
        normal = cross.normalize();
        break;
      }
    }
  }
  if (!normal) normal = new THREE.Vector3(0, 0, 1);

  if (Math.abs(normal.dot(xAxis)) > 0.999) {
    const fallback = Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    xAxis = new THREE.Vector3().crossVectors(fallback, normal).normalize();
  }

  let yAxis = new THREE.Vector3().crossVectors(normal, xAxis);
  if (yAxis.lengthSq() <= EPS) {
    yAxis = Math.abs(normal.z) < 0.9
      ? new THREE.Vector3(0, 0, 1).cross(normal)
      : new THREE.Vector3(0, 1, 0).cross(normal);
  }
  yAxis.normalize();
  xAxis = new THREE.Vector3().crossVectors(yAxis, normal).normalize();

  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  matrix.setPosition(origin);

  return { origin, xAxis, yAxis, normal, matrix };
}

function projectPointToFrame(point, frame) {
  const delta = point.clone().sub(frame.origin);
  return [delta.dot(frame.xAxis), delta.dot(frame.yAxis)];
}

function readFaceEdgePolylines(faceObj) {
  const entries = [];
  const edges = Array.isArray(faceObj?.edges) ? faceObj.edges : [];

  for (const edge of edges) {
    const polyline = readEdgePolyline3D(edge);
    if (!polyline || polyline.length < 2) continue;
    entries.push({
      id: edge?.name || edge?.userData?.edgeName || `edge_${entries.length + 1}`,
      edge,
      polyline,
    });
  }

  if (entries.length) return entries;

  const fallbackPoints = [];
  const pos = faceObj?.geometry?.getAttribute?.("position");
  if (pos && pos.itemSize === 3 && pos.count >= 3) {
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(faceObj.matrixWorld);
      fallbackPoints.push(tmp.clone());
    }
  }

  if (fallbackPoints.length < 3) return entries;

  const frame = buildProfileFrame(fallbackPoints, faceObj?.getAverageNormal?.());
  if (!frame) return entries;

  const points2 = dedupeConsecutivePoints2(fallbackPoints.map((point) => projectPointToFrame(point, frame)));
  const hull = monotonicHull(points2);
  if (hull.length < 3) return entries;

  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const p3A = frame.origin
      .clone()
      .addScaledVector(frame.xAxis, a[0])
      .addScaledVector(frame.yAxis, a[1]);
    const p3B = frame.origin
      .clone()
      .addScaledVector(frame.xAxis, b[0])
      .addScaledVector(frame.yAxis, b[1]);
    entries.push({
      id: `edge_${i + 1}`,
      edge: null,
      polyline: [p3A, p3B],
    });
  }

  return entries;
}

function findBestMatchAtPoint(entries, anchorPoint) {
  let best = null;
  for (let i = 0; i < entries.length; i += 1) {
    const candidate = entries[i];
    const start = candidate.polyline[0];
    const end = candidate.polyline[candidate.polyline.length - 1];
    const startDist = start.distanceToSquared(anchorPoint);
    const endDist = end.distanceToSquared(anchorPoint);
    const thresholdSq = POINT_EPS * POINT_EPS;

    if (startDist <= thresholdSq) {
      if (!best || startDist < best.distance) {
        best = { index: i, attachAt: "start", distance: startDist };
      }
    }
    if (endDist <= thresholdSq) {
      if (!best || endDist < best.distance) {
        best = { index: i, attachAt: "end", distance: endDist };
      }
    }
  }
  return best;
}

function orderConnectedEntries(entries) {
  if (!Array.isArray(entries) || entries.length <= 1) return entries || [];

  const remaining = entries.map((entry) => ({
    ...entry,
    polyline: entry.polyline.map((point) => point.clone()),
  }));

  const ordered = [remaining.shift()];
  while (remaining.length) {
    let advanced = false;

    const tail = ordered[ordered.length - 1].polyline[ordered[ordered.length - 1].polyline.length - 1];
    const tailMatch = findBestMatchAtPoint(remaining, tail);
    if (tailMatch) {
      const [picked] = remaining.splice(tailMatch.index, 1);
      if (tailMatch.attachAt === "end") picked.polyline.reverse();
      ordered.push(picked);
      advanced = true;
    }

    if (remaining.length) {
      const head = ordered[0].polyline[0];
      const headMatch = findBestMatchAtPoint(remaining, head);
      if (headMatch) {
        const [picked] = remaining.splice(headMatch.index, 1);
        if (headMatch.attachAt === "start") picked.polyline.reverse();
        ordered.unshift(picked);
        advanced = true;
      }
    }

    if (!advanced) break;
  }

  return ordered;
}

function orderConnectedEntryGroups(entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const remaining = entries.map((entry) => ({
    ...entry,
    polyline: Array.isArray(entry?.polyline) ? entry.polyline.map((point) => point.clone()) : [],
  }));
  const groups = [];

  while (remaining.length) {
    const ordered = [remaining.shift()];
    while (remaining.length) {
      let advanced = false;

      const tail = ordered[ordered.length - 1]?.polyline?.[ordered[ordered.length - 1]?.polyline?.length - 1] || null;
      if (tail) {
        const tailMatch = findBestMatchAtPoint(remaining, tail);
        if (tailMatch) {
          const [picked] = remaining.splice(tailMatch.index, 1);
          if (tailMatch.attachAt === "end") picked.polyline.reverse();
          ordered.push(picked);
          advanced = true;
        }
      }

      if (remaining.length) {
        const head = ordered[0]?.polyline?.[0] || null;
        if (head) {
          const headMatch = findBestMatchAtPoint(remaining, head);
          if (headMatch) {
            const [picked] = remaining.splice(headMatch.index, 1);
            if (headMatch.attachAt === "start") picked.polyline.reverse();
            ordered.unshift(picked);
            advanced = true;
          }
        }
      }

      if (!advanced) break;
    }
    groups.push(ordered);
  }

  return groups;
}

function buildOutlineFromOrderedEntries(orderedEntries) {
  const points = [];
  for (let i = 0; i < orderedEntries.length; i += 1) {
    const polyline = orderedEntries[i].polyline;
    if (!Array.isArray(polyline) || polyline.length < 2) continue;
    if (i === 0) {
      for (const point of polyline) points.push(point.clone());
    } else {
      for (let j = 1; j < polyline.length; j += 1) points.push(polyline[j].clone());
    }
  }

  const deduped = dedupeConsecutivePoints3(points);
  if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }
  return deduped;
}

function normalizeWorldLoopToFacePlane(loop3, normalHint = null) {
  if (!Array.isArray(loop3) || loop3.length < 3) return [];
  const frame = buildProfileFrame(loop3, normalHint);
  if (!frame) return [];
  const projected2 = normalizeLoop2(loop3.map((point) => projectPointToFrame(point, frame)));
  if (projected2.length < 3) return [];
  const out = projected2.map((point) => frame.origin
    .clone()
    .addScaledVector(frame.xAxis, toFiniteNumber(point?.[0], 0))
    .addScaledVector(frame.yAxis, toFiniteNumber(point?.[1], 0)));
  const deduped = dedupeConsecutivePoints3(out);
  if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }
  return deduped.length >= 3 ? deduped : [];
}

function loopKey3(loop, precision = 5) {
  if (!Array.isArray(loop) || loop.length < 3) return null;
  const fmt = (value) => Number(toFiniteNumber(value, 0)).toFixed(precision);
  const encode = (points) => points.map((point) => (
    `${fmt(point?.x)}|${fmt(point?.y)}|${fmt(point?.z)}`
  )).join(";");
  const forward = encode(loop);
  const reverse = encode(loop.slice().reverse());
  return forward < reverse ? forward : reverse;
}

function buildFlatEdgesFromOutline(outline2, flatId) {
  const edges = [];
  for (let i = 0; i < outline2.length; i += 1) {
    const a = outline2[i];
    const b = outline2[(i + 1) % outline2.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS) continue;
    edges.push({
      id: `${flatId}:e${edges.length + 1}`,
      polyline: [[a[0], a[1]], [b[0], b[1]]],
    });
  }
  return edges;
}

function buildFlatFromFace(faceObj, featureID, label = "Tab") {
  const loops3 = faceOutlineLoops3FromFace(faceObj, featureID);
  if (!loops3.length) return null;

  const normalHint = (typeof faceObj?.getAverageNormal === "function")
    ? faceObj.getAverageNormal()
    : null;
  const frame = buildProfileFrame(loops3[0], normalHint);
  if (!frame) return null;

  const projectedLoops = [];
  for (const loop3 of loops3) {
    const projected = normalizeLoop2(loop3.map((point) => projectPointToFrame(point, frame)));
    if (projected.length < 3) continue;
    projectedLoops.push(projected);
  }
  if (!projectedLoops.length) return null;

  let outerIndex = -1;
  let maxOuterAreaAbs = 0;
  for (let i = 0; i < projectedLoops.length; i += 1) {
    const areaAbs = Math.abs(signedArea2D(projectedLoops[i]));
    if (areaAbs > maxOuterAreaAbs) {
      maxOuterAreaAbs = areaAbs;
      outerIndex = i;
    }
  }
  if (outerIndex < 0) return null;

  let outline2 = projectedLoops[outerIndex];
  if (signedArea2D(outline2) < 0) outline2 = outline2.slice().reverse();

  const flatId = `${featureID}:flat_root`;
  const edges = buildFlatEdgesFromOutline(outline2, flatId);
  if (edges.length < 3) return null;

  const flat = {
    kind: "flat",
    id: flatId,
    label,
    color: colorFromString(flatId),
    outline: outline2,
    edges,
  };

  const holes = [];
  for (let i = 0; i < projectedLoops.length; i += 1) {
    if (i === outerIndex) continue;
    let holeLoop = projectedLoops[i];
    if (holeLoop.length < 3) continue;
    if (!polygonMostlyInsidePolygon(holeLoop, outline2, POINT_EPS * 8)) continue;
    if (signedArea2D(holeLoop) > 0) holeLoop = holeLoop.slice().reverse();
    holes.push({
      id: `${flatId}:hole_${holes.length + 1}`,
      outline: holeLoop.map((point) => [point[0], point[1]]),
    });
  }
  if (holes.length) flat.holes = holes;

  return { flat, frame };
}

function faceOutlineLoops3FromFace(faceObj, _featureID) {
  const normalHint = (typeof faceObj?.getAverageNormal === "function")
    ? faceObj.getAverageNormal()
    : null;

  const loops = [];
  const seen = new Set();
  const pushLoop = (loop3) => {
    const normalized = normalizeWorldLoopToFacePlane(loop3, normalHint);
    if (normalized.length < 3) return;
    const key = loopKey3(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    loops.push(normalized);
  };

  const boundaryLoopsRaw = Array.isArray(faceObj?.userData?.boundaryLoopsWorld)
    ? faceObj.userData.boundaryLoopsWorld
    : [];
  for (const entry of boundaryLoopsRaw) {
    const ptsRaw = Array.isArray(entry?.pts) ? entry.pts : (Array.isArray(entry) ? entry : null);
    if (!Array.isArray(ptsRaw) || ptsRaw.length < 3) continue;
    const world = [];
    for (const point of ptsRaw) {
      if (point?.isVector3) world.push(point.clone());
      else if (Array.isArray(point) && point.length >= 3) {
        world.push(new THREE.Vector3(
          toFiniteNumber(point[0]),
          toFiniteNumber(point[1]),
          toFiniteNumber(point[2]),
        ));
      }
    }
    const deduped = dedupeConsecutivePoints3(world);
    if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) deduped.pop();
    pushLoop(deduped);
  }
  if (loops.length) return loops;

  const edgeEntries = readFaceEdgePolylines(faceObj);
  if (!edgeEntries.length) return loops;
  const groups = orderConnectedEntryGroups(edgeEntries);
  for (const group of groups) {
    if (!Array.isArray(group) || !group.length) continue;
    const start = group[0]?.polyline?.[0] || null;
    const lastPolyline = group[group.length - 1]?.polyline || [];
    const end = lastPolyline[lastPolyline.length - 1] || null;
    if (!start || !end || !isSamePoint3(start, end, POINT_EPS * 8)) continue;
    const outline3 = buildOutlineFromOrderedEntries(group);
    pushLoop(outline3);
  }

  return loops;
}

function collectCutoutProfileLoops(profileSelections, featureID) {
  const selections = normalizeSelectionArray(profileSelections);
  const firstType = String(selections[0]?.type || "").toUpperCase();
  const sourceType = firstType === "SOLID" ? "solid" : "face";
  const faces = [];
  const seenFaceKeys = new Set();
  const pushFace = (faceObj) => {
    if (!faceObj || typeof faceObj !== "object") return;
    const key = faceObj.uuid || faceObj.id || faceObj.name || faceObj;
    if (seenFaceKeys.has(key)) return;
    seenFaceKeys.add(key);
    faces.push(faceObj);
  };

  for (const selection of selections) {
    if (!selection || typeof selection !== "object") continue;
    const type = String(selection.type || "").toUpperCase();
    if (type === "FACE") {
      pushFace(selection);
      continue;
    }
    if (type === "SKETCH") {
      const kids = Array.isArray(selection.children) ? selection.children : [];
      for (const child of kids) {
        if (String(child?.type || "").toUpperCase() === "FACE") pushFace(child);
      }
      continue;
    }
    if (selection?.parent && String(selection.parent.type || "").toUpperCase() === "SKETCH") {
      const kids = Array.isArray(selection.parent.children) ? selection.parent.children : [];
      for (const child of kids) {
        if (String(child?.type || "").toUpperCase() === "FACE") pushFace(child);
      }
    }
  }

  if (!faces.length) {
    const fallbackFace = resolveProfileFace(selections[0] || null);
    if (fallbackFace) pushFace(fallbackFace);
  }

  const loops = [];
  const loopIndexByKey = new Map();
  const pushLoop = (loop, sourceChains = []) => {
    if (!Array.isArray(loop) || loop.length < 3) return;
    const key = loopKey3(loop);
    if (!key) return;

    const chains = [];
    for (let chainIndex = 0; chainIndex < (Array.isArray(sourceChains) ? sourceChains.length : 0); chainIndex += 1) {
      const rawChain = sourceChains[chainIndex];
      const polylineRaw = Array.isArray(rawChain)
        ? rawChain
        : (Array.isArray(rawChain?.polyline) ? rawChain.polyline : []);
      if (polylineRaw.length < 2) continue;
      const chain = dedupeConsecutivePoints3(polylineRaw.map((point) => (
        point?.isVector3
          ? point.clone()
          : new THREE.Vector3(
            toFiniteNumber(point?.[0]),
            toFiniteNumber(point?.[1]),
            toFiniteNumber(point?.[2]),
          )
      )));
      if (chain.length >= 2) {
        chains.push({
          id: rawChain && typeof rawChain === "object" && !Array.isArray(rawChain) && rawChain.id != null
            ? String(rawChain.id)
            : `${featureID}:source:${loops.length + 1}:${chainIndex + 1}`,
          polyline: chain,
        });
      }
    }

    if (loopIndexByKey.has(key)) {
      const idx = loopIndexByKey.get(key);
      const existing = loops[idx];
      const existingHasChains = Array.isArray(existing?.sourceChains) && existing.sourceChains.length > 0;
      if (!existingHasChains && chains.length) {
        loops[idx] = { loop, sourceChains: chains };
      }
      return;
    }

    loopIndexByKey.set(key, loops.length);
    loops.push({ loop, sourceChains: chains });
  };

  for (const face of faces) {
    const normalHint = (typeof face?.getAverageNormal === "function")
      ? face.getAverageNormal()
      : null;

    const entries = readFaceEdgePolylines(face);
    const groups = orderConnectedEntryGroups(entries);
    for (const group of groups) {
      if (!Array.isArray(group) || !group.length) continue;
      const start = group[0]?.polyline?.[0] || null;
      const lastPolyline = group[group.length - 1]?.polyline || [];
      const end = lastPolyline[lastPolyline.length - 1] || null;
      if (!start || !end || !isSamePoint3(start, end, POINT_EPS * 8)) continue;

      const outline3 = buildOutlineFromOrderedEntries(group);
      const normalizedLoop = normalizeWorldLoopToFacePlane(outline3, normalHint);
      if (normalizedLoop.length < 3) continue;

      const sourceChains = [];
      for (const entry of group) {
        const polyline = Array.isArray(entry?.polyline) ? entry.polyline : [];
        if (polyline.length < 2) continue;
        sourceChains.push({
          id: entry?.id != null ? String(entry.id) : `${featureID}:source:${loops.length + 1}:${sourceChains.length + 1}`,
          polyline,
        });
      }
      pushLoop(normalizedLoop, sourceChains);
    }

    const faceLoops = faceOutlineLoops3FromFace(face, featureID);
    for (const loop of faceLoops) {
      pushLoop(loop, []);
    }
  }

  return {
    sourceType,
    faceCount: faces.length,
    loops: loops.map((entry) => ({
      loop: entry.loop,
      sourceChains: entry.sourceChains || [],
    })),
  };
}

function applyCutoutLoopsToTree({ tree, featureID, profileLoops3 = [], rootMatrix = null }) {
  const summary = {
    requestedLoops: Array.isArray(profileLoops3) ? profileLoops3.length : 0,
    applied: 0,
    skipped: 0,
    assignments: [],
    skippedLoops: [],
  };
  if (!tree?.root || !summary.requestedLoops) return summary;

  let model = null;
  try {
    model = evaluateSheetMetal(tree);
  } catch (error) {
    summary.skipped = summary.requestedLoops;
    summary.skippedLoops.push({
      reason: "evaluate_failed",
      message: String(error?.message || error || "failed to evaluate tree"),
    });
    return summary;
  }

  const root = matrixFromAny(rootMatrix || new THREE.Matrix4().identity());
  const flatPlacements = [];
  for (const placement of model?.flats3D || []) {
    if (!placement?.flat || !placement?.matrix?.isMatrix4) continue;
    const worldMatrix = root.clone().multiply(placement.matrix.clone());
    const inverseWorld = worldMatrix.clone().invert();
    flatPlacements.push({ placement, inverseWorld });
  }
  if (!flatPlacements.length) {
    summary.skipped = summary.requestedLoops;
    summary.skippedLoops.push({ reason: "no_flat_placements" });
    return summary;
  }

  removeCutoutHolesFromTree(tree, featureID);
  const usedIds = collectTreeIds(tree);
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(tree?.thickness, 1)));
  const halfT = thickness * 0.5;
  const planeTol = Math.max(POINT_EPS * 8, Math.max(1e-3, thickness * 0.1));
  const insideTol = Math.max(POINT_EPS * 8, thickness * 0.02);
  const projectionDirTol = Math.max(1e-6, planeTol * 0.05);

  for (let loopIndex = 0; loopIndex < profileLoops3.length; loopIndex += 1) {
    const loopEntry = profileLoops3[loopIndex];
    const worldLoopRaw = Array.isArray(loopEntry)
      ? loopEntry
      : (Array.isArray(loopEntry?.loop) ? loopEntry.loop : null);
    if (!Array.isArray(worldLoopRaw) || worldLoopRaw.length < 3) {
      summary.skipped += 1;
      summary.skippedLoops.push({ loopIndex, reason: "invalid_loop" });
      continue;
    }
    const worldSourceChains = [];
    const rawSourceChains = Array.isArray(loopEntry?.sourceChains) ? loopEntry.sourceChains : [];
    for (let chainIndex = 0; chainIndex < rawSourceChains.length; chainIndex += 1) {
      const rawChain = rawSourceChains[chainIndex];
      const polylineRaw = Array.isArray(rawChain)
        ? rawChain
        : (Array.isArray(rawChain?.polyline) ? rawChain.polyline : []);
      if (polylineRaw.length < 2) continue;
      const chain = dedupeConsecutivePoints3(polylineRaw.map((point) => (
        point?.isVector3
          ? point.clone()
          : new THREE.Vector3(toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1]), toFiniteNumber(point?.[2]))
      )));
      if (chain.length >= 2) {
        worldSourceChains.push({
          id: rawChain && typeof rawChain === "object" && !Array.isArray(rawChain) && rawChain.id != null
            ? String(rawChain.id)
            : `${featureID}:loop:${loopIndex + 1}:source:${chainIndex + 1}`,
          polyline: chain,
        });
      }
    }
    const worldLoop = dedupeConsecutivePoints3(worldLoopRaw.map((point) => (
      point?.isVector3
        ? point.clone()
        : new THREE.Vector3(toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1]), toFiniteNumber(point?.[2]))
    )));
    if (worldLoop.length >= 2 && isSamePoint3(worldLoop[0], worldLoop[worldLoop.length - 1])) worldLoop.pop();
    if (worldLoop.length < 3) {
      summary.skipped += 1;
      summary.skippedLoops.push({ loopIndex, reason: "degenerate_loop" });
      continue;
    }
    const loopNormalWorld = computeLoopNormal3(worldLoop);

    let best = null;
    for (const candidate of flatPlacements) {
      const flat = candidate.placement.flat;
      const outer = normalizeLoop2(flat?.outline);
      if (outer.length < 3) continue;

      const local3 = worldLoop.map((point) => point.clone().applyMatrix4(candidate.inverseWorld));
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      let sumAbsZ = 0;
      for (const point of local3) {
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
        sumAbsZ += Math.abs(point.z);
      }
      const zSpread = maxZ - minZ;
      const avgAbsZ = sumAbsZ / local3.length;

      let localLoop2 = null;
      let holeLoops2 = null;
      let holeLoopSources = null;
      let projectionMode = "coplanar";
      let projectionParam = 0;
      if (zSpread <= planeTol) {
        localLoop2 = normalizeLoop2(local3.map((point) => [point.x, point.y]));
        if (localLoop2.length >= 3) {
          holeLoops2 = [localLoop2];
          if (worldSourceChains.length) {
            const projectedChains = [];
            for (let chainIndex = 0; chainIndex < worldSourceChains.length; chainIndex += 1) {
              const sourceChain = worldSourceChains[chainIndex];
              const chain3 = Array.isArray(sourceChain)
                ? sourceChain
                : (Array.isArray(sourceChain?.polyline) ? sourceChain.polyline : []);
              if (chain3.length < 2) continue;
              const chain2 = dedupeConsecutivePoints2(chain3.map((point) => {
                const localPoint = point.clone().applyMatrix4(candidate.inverseWorld);
                return [localPoint.x, localPoint.y];
              }));
              if (chain2.length >= 2) {
                projectedChains.push({
                  id: sourceChain && typeof sourceChain === "object" && !Array.isArray(sourceChain) && sourceChain.id != null
                    ? String(sourceChain.id)
                    : `${featureID}:projected:${loopIndex + 1}:${chainIndex + 1}`,
                  polyline: chain2.map((point) => [point[0], point[1]]),
                });
              }
            }
            holeLoopSources = [projectedChains];
          } else {
            holeLoopSources = [[]];
          }
        }
      } else {
        const projectedLoopNormal = loopNormalWorld
          ? loopNormalWorld.clone().transformDirection(candidate.inverseWorld).normalize()
          : computeLoopNormal3(local3);
        const topProjected = projectLoopToFlatMidplane(local3, projectedLoopNormal, halfT, projectionDirTol);
        const bottomProjected = projectLoopToFlatMidplane(local3, projectedLoopNormal, -halfT, projectionDirTol);
        if (!topProjected?.loop2?.length || !bottomProjected?.loop2?.length) continue;

        const projectedMidLoops = unionFilledLoops2([
          topProjected.loop2,
          bottomProjected.loop2,
        ]);
        if (!projectedMidLoops.length) continue;
        holeLoops2 = projectedMidLoops;
        localLoop2 = projectedMidLoops[0] || null;
        holeLoopSources = projectedMidLoops.map(() => []);
        projectionMode = "projected_top_bottom";
        projectionParam = (
          toFiniteNumber(topProjected.avgAbsParam, 0)
          + toFiniteNumber(bottomProjected.avgAbsParam, 0)
        ) * 0.5;
      }
      if (!localLoop2 || localLoop2.length < 3 || !Array.isArray(holeLoops2) || !holeLoops2.length) continue;
      const effectiveCutLoops = [];
      const effectiveCutLoopSources = [];
      for (let holeIdx = 0; holeIdx < holeLoops2.length; holeIdx += 1) {
        const holeLoop = holeLoops2[holeIdx];
        const holeSources = Array.isArray(holeLoopSources?.[holeIdx]) ? holeLoopSources[holeIdx] : [];
        if (polygonMostlyInsidePolygon(holeLoop, outer, insideTol)) {
          effectiveCutLoops.push(holeLoop);
          effectiveCutLoopSources.push(holeSources);
          continue;
        }
        if (polygonsOverlap2(holeLoop, outer, insideTol)) {
          effectiveCutLoops.push(holeLoop);
          effectiveCutLoopSources.push(holeSources);
        }
      }
      if (!effectiveCutLoops.length) continue;

      const score = (projectionMode === "coplanar")
        ? (avgAbsZ + (zSpread * 10))
        : (projectionParam * 0.1 + avgAbsZ + (zSpread * 2) + (effectiveCutLoops.length * 0.005));
      if (!best || score < best.score) {
        best = {
          flat,
          localLoop2,
          holeLoops2: effectiveCutLoops,
          holeLoopSources: effectiveCutLoopSources,
          avgAbsZ,
          zSpread,
          projectionMode,
          projectionParam,
          score,
        };
      }
    }

    if (!best) {
      summary.skipped += 1;
      summary.skippedLoops.push({ loopIndex, reason: "no_flat_mapping" });
      continue;
    }

    const holeLoops = Array.isArray(best.holeLoops2) && best.holeLoops2.length
      ? best.holeLoops2
      : [best.localLoop2];
    const holeLoopSources = Array.isArray(best.holeLoopSources) ? best.holeLoopSources : null;
    const cutResult = applyCutLoopsToFlat(best.flat, holeLoops, featureID, usedIds, holeLoopSources);
    if (!cutResult?.applied) {
      summary.skipped += 1;
      summary.skippedLoops.push({
        loopIndex,
        reason: cutResult?.reason || "cut_apply_failed",
      });
      continue;
    }

    summary.applied += 1;
    summary.assignments.push({
      loopIndex,
      flatId: best.flat.id,
      holeIds: Array.isArray(cutResult.createdHoleIds) ? cutResult.createdHoleIds.slice() : [],
      avgAbsZ: best.avgAbsZ,
      zSpread: best.zSpread,
      projectionMode: best.projectionMode,
      projectionParam: best.projectionParam,
      holeCount: Math.max(0, toFiniteNumber(cutResult.holeCount, 0) | 0),
      totalHoleCount: Math.max(0, toFiniteNumber(cutResult.totalHoleCount, 0) | 0),
      createdHoleCount: Array.isArray(cutResult.createdHoleIds) ? cutResult.createdHoleIds.length : 0,
      outerChanged: !!cutResult.outerChanged,
      pointCount: Array.isArray(best.localLoop2) ? best.localLoop2.length : 0,
    });
  }

  return summary;
}

function buildPathPolylineFromSelections(pathSelections) {
  const collected = [];

  for (const selection of normalizeSelectionArray(pathSelections)) {
    if (!selection || typeof selection !== "object") continue;

    if (selection.type === "EDGE") {
      const points = readEdgePolyline3D(selection);
      if (points && points.length >= 2) {
        collected.push({ id: selection.name || `edge_${collected.length + 1}`, polyline: points });
      }
      continue;
    }

    if (selection.type === "SKETCH") {
      const kids = Array.isArray(selection.children) ? selection.children : [];
      for (const child of kids) {
        if (!child || child.type !== "EDGE") continue;
        const points = readEdgePolyline3D(child);
        if (points && points.length >= 2) {
          collected.push({ id: child.name || `edge_${collected.length + 1}`, polyline: points });
        }
      }
      continue;
    }

    if (selection.type === "FACE") {
      const entries = readFaceEdgePolylines(selection);
      for (const entry of entries) {
        collected.push({ id: entry.id || `edge_${collected.length + 1}`, polyline: entry.polyline.map((p) => p.clone()) });
      }
    }
  }

  if (!collected.length) return null;

  const ordered = orderConnectedEntries(collected);
  if (!ordered.length || ordered.length !== collected.length) return null;
  const points = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const polyline = ordered[i].polyline;
    if (!Array.isArray(polyline) || polyline.length < 2) continue;

    if (i > 0) {
      const prevLast = points[points.length - 1];
      const currentFirst = polyline[0];
      if (!prevLast || !isSamePoint3(prevLast, currentFirst)) {
        return null;
      }
    }

    if (i === 0) {
      for (const point of polyline) points.push(point.clone());
    } else {
      for (let j = 1; j < polyline.length; j += 1) points.push(polyline[j].clone());
    }
  }

  const deduped = dedupeConsecutivePoints3(points);
  if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }

  return deduped.length >= 2 ? deduped : null;
}

function choosePerpendicularNormal(xAxis) {
  const candidates = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  ];

  for (const seed of candidates) {
    const projected = seed.clone().sub(xAxis.clone().multiplyScalar(seed.dot(xAxis)));
    if (projected.lengthSq() > EPS * EPS) return projected.normalize();
  }
  return null;
}

function buildContourPathFrame(path3, reverseSheetSide = false) {
  if (!Array.isArray(path3) || path3.length < 2) return null;
  const origin = path3[0].clone();

  let xAxis = null;
  for (let i = 1; i < path3.length; i += 1) {
    const delta = path3[i].clone().sub(origin);
    if (delta.lengthSq() > EPS * EPS) {
      xAxis = delta.normalize();
      break;
    }
  }
  if (!xAxis) return null;

  let planeNormal = null;
  for (let i = 0; i < path3.length - 2; i += 1) {
    const a = path3[i + 1].clone().sub(path3[i]);
    const b = path3[i + 2].clone().sub(path3[i + 1]);
    if (a.lengthSq() <= EPS * EPS || b.lengthSq() <= EPS * EPS) continue;
    const cross = new THREE.Vector3().crossVectors(a, b);
    if (cross.lengthSq() > EPS * EPS) {
      planeNormal = cross.normalize();
      break;
    }
  }
  if (!planeNormal) {
    planeNormal = choosePerpendicularNormal(xAxis);
  }
  if (!planeNormal) return null;

  const extensionDir = reverseSheetSide ? planeNormal.clone().multiplyScalar(-1) : planeNormal.clone();
  let zAxis = new THREE.Vector3().crossVectors(xAxis, extensionDir);
  if (zAxis.lengthSq() <= EPS * EPS) return null;
  zAxis.normalize();

  let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  if (yAxis.lengthSq() <= EPS * EPS) return null;
  yAxis.normalize();

  if (yAxis.dot(extensionDir) < 0) {
    yAxis.multiplyScalar(-1);
    zAxis.multiplyScalar(-1);
  }

  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  matrix.setPosition(origin);
  return { origin, xAxis, yAxis, zAxis, matrix };
}

function projectPointToContourAxes(point, frame) {
  const delta = point.clone().sub(frame.origin);
  return [delta.dot(frame.xAxis), delta.dot(frame.zAxis)];
}

function simplifyContourPath2(path2) {
  const deduped = dedupeConsecutivePoints2(path2 || []);
  if (deduped.length < 2) return deduped;

  const compact = [deduped[0]];
  for (let i = 1; i < deduped.length; i += 1) {
    const point = deduped[i];
    const prev = compact[compact.length - 1];
    if (pointDistance2(point, prev) > POINT_EPS) compact.push(point);
  }
  if (compact.length < 3) return compact;

  const merged = [compact[0]];
  for (let i = 1; i < compact.length - 1; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = compact[i];
    const next = compact[i + 1];

    const v1x = curr[0] - prev[0];
    const v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (!(l1 > POINT_EPS) || !(l2 > POINT_EPS)) continue;

    const cross = (v1x * v2y - v1y * v2x) / (l1 * l2);
    const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
    if (Math.abs(cross) <= 1e-6 && dot > 0.9999) continue;
    merged.push(curr);
  }
  merged.push(compact[compact.length - 1]);
  return merged;
}

function signedTurnRadians2(dirA, dirB) {
  const ax = toFiniteNumber(dirA?.[0]);
  const ay = toFiniteNumber(dirA?.[1]);
  const bx = toFiniteNumber(dirB?.[0]);
  const by = toFiniteNumber(dirB?.[1]);
  return Math.atan2((ax * by) - (ay * bx), (ax * bx) + (ay * by));
}

function buildContourSegments(path2) {
  const out = [];
  if (!Array.isArray(path2) || path2.length < 2) return out;

  for (let i = 0; i < path2.length - 1; i += 1) {
    const a = path2[i];
    const b = path2[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!(length > POINT_EPS)) continue;
    out.push({
      index: out.length,
      start: [a[0], a[1]],
      end: [b[0], b[1]],
      length,
      dir: [dx / length, dy / length],
    });
  }
  return out;
}

function intersectLines2(pointA, dirA, pointB, dirB) {
  const ax = toFiniteNumber(pointA?.[0]);
  const ay = toFiniteNumber(pointA?.[1]);
  const adx = toFiniteNumber(dirA?.[0]);
  const ady = toFiniteNumber(dirA?.[1]);
  const bx = toFiniteNumber(pointB?.[0]);
  const by = toFiniteNumber(pointB?.[1]);
  const bdx = toFiniteNumber(dirB?.[0]);
  const bdy = toFiniteNumber(dirB?.[1]);

  const det = (adx * bdy) - (ady * bdx);
  if (Math.abs(det) <= EPS) return null;

  const qpx = bx - ax;
  const qpy = by - ay;
  const t = ((qpx * bdy) - (qpy * bdx)) / det;
  return [ax + adx * t, ay + ady * t];
}

function offsetOpenContourPath2(path2, offsetDistance) {
  if (!Array.isArray(path2) || path2.length < 2) return null;
  const baseSegments = buildContourSegments(path2);
  if (baseSegments.length !== path2.length - 1) return null;

  const lines = [];
  for (const segment of baseSegments) {
    const nx = -segment.dir[1];
    const ny = segment.dir[0];
    const ox = nx * offsetDistance;
    const oy = ny * offsetDistance;
    lines.push({
      dir: [segment.dir[0], segment.dir[1]],
      start: [segment.start[0] + ox, segment.start[1] + oy],
      end: [segment.end[0] + ox, segment.end[1] + oy],
    });
  }
  if (!lines.length) return null;

  const out = new Array(path2.length);
  out[0] = [lines[0].start[0], lines[0].start[1]];
  out[path2.length - 1] = [lines[lines.length - 1].end[0], lines[lines.length - 1].end[1]];

  for (let i = 1; i < path2.length - 1; i += 1) {
    const prev = lines[i - 1];
    const next = lines[i];
    const hit = intersectLines2(prev.start, prev.dir, next.start, next.dir);
    if (Array.isArray(hit)) {
      out[i] = [hit[0], hit[1]];
      continue;
    }
    out[i] = [
      (toFiniteNumber(prev.end[0]) + toFiniteNumber(next.start[0])) * 0.5,
      (toFiniteNumber(prev.end[1]) + toFiniteNumber(next.start[1])) * 0.5,
    ];
  }

  return dedupeConsecutivePoints2(out);
}

function preferredContourOffsetSide(path2) {
  const segments = buildContourSegments(path2);
  if (segments.length < 2) return 1;
  let turnSum = 0;
  for (let i = 0; i < segments.length - 1; i += 1) {
    turnSum += signedTurnRadians2(segments[i].dir, segments[i + 1].dir);
  }
  if (Math.abs(turnSum) <= 1e-7) return 1;
  return turnSum > 0 ? 1 : -1;
}

function computeContourCornerTrimData(segments, midRadius) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const safeMidRadius = Math.max(MIN_LEG, Math.abs(toFiniteNumber(midRadius, MIN_LEG)));
  const startTrim = new Array(segments.length).fill(0);
  const endTrim = new Array(segments.length).fill(0);
  const joints = [];

  for (let i = 0; i < segments.length - 1; i += 1) {
    const turnRad = signedTurnRadians2(segments[i].dir, segments[i + 1].dir);
    const absTurn = Math.abs(turnRad);
    if (absTurn <= 1e-8) {
      joints.push({ index: i, turnRad: 0, angleDeg: 1e-4, setback: 0 });
      continue;
    }

    const tanHalf = Math.tan(absTurn * 0.5);
    if (!Number.isFinite(tanHalf)) return null;
    const setback = Math.max(0, safeMidRadius * Math.abs(tanHalf));
    endTrim[i] += setback;
    startTrim[i + 1] += setback;

    let angleDeg = -THREE.MathUtils.radToDeg(turnRad);
    if (Math.abs(angleDeg) < 1e-4) angleDeg = angleDeg >= 0 ? 1e-4 : -1e-4;
    joints.push({ index: i, turnRad, angleDeg, setback });
  }

  const segmentFlatLengths = segments.map((segment, idx) => (
    toFiniteNumber(segment.length, 0) - startTrim[idx] - endTrim[idx]
  ));
  if (segmentFlatLengths.some((length) => !(length > MIN_LEG))) return null;

  return { startTrim, endTrim, segmentFlatLengths, joints };
}

function buildContourMidplanePathData(path2Sketch, thickness, midRadius) {
  const halfThickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(thickness, MIN_THICKNESS))) * 0.5;
  const preferredSide = preferredContourOffsetSide(path2Sketch);
  const candidates = [preferredSide, -preferredSide];
  let preferredCandidate = null;
  let fallbackCandidate = null;

  for (const side of candidates) {
    const offsetPath = offsetOpenContourPath2(path2Sketch, halfThickness * side);
    if (!Array.isArray(offsetPath) || offsetPath.length < 2) continue;

    const segments = buildContourSegments(offsetPath);
    if (!segments.length) continue;

    const trimData = computeContourCornerTrimData(segments, midRadius);
    if (!trimData) continue;
    const minFlatLength = Math.min(...trimData.segmentFlatLengths);
    const candidate = {
      side,
      path2Midplane: offsetPath,
      segments,
      trimData,
      minFlatLength,
    };

    if (side === preferredSide) {
      preferredCandidate = candidate;
      continue;
    }
    if (!fallbackCandidate || candidate.minFlatLength > fallbackCandidate.minFlatLength) {
      fallbackCandidate = candidate;
    }
  }

  return preferredCandidate || fallbackCandidate;
}

function makeContourSegmentFlat(featureID, segmentIndex, length, height, usedIds, isRoot = false) {
  const safeLength = Math.max(MIN_LEG, toFiniteNumber(length, MIN_LEG));
  const safeHeight = Math.max(MIN_LEG, toFiniteNumber(height, MIN_LEG));
  const baseFlatId = isRoot ? `${featureID}:flat_root` : `${featureID}:flat_${segmentIndex + 1}`;
  const flatId = uniqueId(baseFlatId, usedIds);

  const topEdgeId = uniqueId(`${flatId}:top`, usedIds);
  const endEdgeId = uniqueId(`${flatId}:end`, usedIds);
  const bottomEdgeId = uniqueId(`${flatId}:bottom`, usedIds);
  const startEdgeId = uniqueId(`${flatId}:start`, usedIds);

  const flat = {
    kind: "flat",
    id: flatId,
    label: `Contour Segment ${segmentIndex + 1}`,
    color: colorFromString(`${featureID}:${flatId}`),
    outline: [
      [0, 0],
      [safeLength, 0],
      [safeLength, safeHeight],
      [0, safeHeight],
    ],
    edges: [
      { id: topEdgeId, polyline: [[0, 0], [safeLength, 0]] },
      { id: endEdgeId, polyline: [[safeLength, 0], [safeLength, safeHeight]] },
      { id: bottomEdgeId, polyline: [[safeLength, safeHeight], [0, safeHeight]] },
      { id: startEdgeId, isAttachEdge: !isRoot, polyline: [[0, 0], [0, safeHeight]] },
    ],
  };

  return { flat, flatId, startEdgeId, endEdgeId, topEdgeId, bottomEdgeId };
}

function buildContourFlangeFromPath(pathSelections, featureID, options = {}) {
  const path3 = buildPathPolylineFromSelections(pathSelections);
  if (!path3 || path3.length < 2) return null;

  const reverseSheetSide = !!options.reverseSheetSide;
  const frame = buildContourPathFrame(path3, reverseSheetSide);
  if (!frame) return null;

  const height = Math.max(MIN_LEG, Math.abs(toFiniteNumber(options.distance, 0)));
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(options.thickness, 1)));
  const insideRadius = Math.max(0, toFiniteNumber(options.bendRadius, thickness * 0.5));
  const midRadius = Math.max(MIN_LEG, insideRadius + thickness * 0.5);
  const kFactor = clamp(toFiniteNumber(options.kFactor, 0.5), 0, 1);

  const path2SketchRaw = path3.map((point) => projectPointToContourAxes(point, frame));
  const path2Sketch = simplifyContourPath2(path2SketchRaw);
  if (path2Sketch.length < 2) return null;

  const midplaneData = buildContourMidplanePathData(path2Sketch, thickness, midRadius);
  if (!midplaneData) return null;

  const path2 = midplaneData.path2Midplane;
  const trimData = midplaneData.trimData;
  const segments = midplaneData.segments.map((segment, idx) => ({
    ...segment,
    trimStart: trimData.startTrim[idx],
    trimEnd: trimData.endTrim[idx],
    flatLength: trimData.segmentFlatLengths[idx],
  }));
  if (!segments.length) return null;

  const usedIds = new Set();
  const first = makeContourSegmentFlat(featureID, 0, segments[0].flatLength, height, usedIds, true);
  let current = first;
  const bendSummary = [];

  for (let i = 0; i < segments.length - 1; i += 1) {
    const parentSeg = segments[i];
    const childSeg = segments[i + 1];
    const child = makeContourSegmentFlat(featureID, i + 1, childSeg.flatLength, height, usedIds, false);
    const joint = trimData.joints[i] || {};
    const angleDeg = toFiniteNumber(joint.angleDeg, -THREE.MathUtils.radToDeg(signedTurnRadians2(parentSeg.dir, childSeg.dir)));

    const bendId = uniqueId(`${featureID}:bend_${i + 1}`, usedIds);
    const endEdge = findEdgeById(current.flat, current.endEdgeId);
    if (!endEdge) return null;

    endEdge.bend = {
      kind: "bend",
      id: bendId,
      color: colorFromString(bendId, 0.7, 0.5),
      angleDeg,
      midRadius,
      kFactor,
      children: [{
        flat: child.flat,
        attachEdgeId: child.startEdgeId,
        reverseEdge: false,
      }],
    };

    bendSummary.push({
      bendId,
      fromFlatId: current.flatId,
      toFlatId: child.flatId,
      angleDeg,
      turnDeg: THREE.MathUtils.radToDeg(signedTurnRadians2(parentSeg.dir, childSeg.dir)),
      setback: Math.max(0, toFiniteNumber(joint.setback, 0)),
    });
    current = child;
  }

  const tree = {
    thickness,
    root: first.flat,
  };

  return {
    tree,
    frame,
    path2,
    path2Sketch,
    segments,
    bends: bendSummary,
    height,
    insideRadius,
    midRadius,
    kFactor,
  };
}

export {
  applyCutoutLoopsToTree,
  buildContourFlangeFromPath,
  buildCutoutCutterFromProfile,
  buildFlatFromFace,
  collectConsumableInputObjects,
  collectCutoutProfileLoops,
  collectSketchParents,
  colorFromString,
  resolveProfileFace,
};
