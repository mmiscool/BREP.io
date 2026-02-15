import { __test_applyFlangesToTree } from "../features/sheetMetal/sheetMetalEngineBridge.js";
import { sheetMetalNonManifoldSmF18Fixture } from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findFlatById(flat, id) {
  if (!flat) return null;
  if (String(flat.id) === String(id)) return flat;
  const edges = Array.isArray(flat.edges) ? flat.edges : [];
  for (const edge of edges) {
    const bend = edge?.bend;
    const children = Array.isArray(bend?.children) ? bend.children : [];
    for (const child of children) {
      const found = findFlatById(child?.flat, id);
      if (found) return found;
    }
  }
  return null;
}

function findEdgeById(flat, edgeId) {
  const edges = Array.isArray(flat?.edges) ? flat.edges : [];
  return edges.find((edge) => String(edge?.id) === String(edgeId)) || null;
}

function polylineLength2(polyline) {
  const points = Array.isArray(polyline) ? polyline : [];
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.hypot((b[0] - a[0]), (b[1] - a[1]));
  }
  return length;
}

function buildPreF18TreeWithMultiPointCutoutEdge() {
  const tree = clone(sheetMetalNonManifoldSmF18Fixture.tree);
  const flangeParent = findFlatById(tree.root, "SM.F13:flat");
  if (!flangeParent) throw new Error("Fixture flat SM.F13:flat not found.");
  const edge = findEdgeById(flangeParent, "SM.F13:flat:edge");
  if (!edge) throw new Error("Fixture edge SM.F13:flat:edge not found.");
  delete edge.bend;

  if (Array.isArray(edge.polyline) && edge.polyline.length === 2) {
    const outline = Array.isArray(flangeParent.outline) ? flangeParent.outline : [];
    const start = edge.polyline[0];
    const end = edge.polyline[1];
    const segLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (segLen > 1e-8) {
      let bestPoint = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const point of outline) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (segLen * segLen);
        if (!(t > 1e-6 && t < 1 - 1e-6)) continue;
        const proj = [start[0] + dx * t, start[1] + dy * t];
        const dist = Math.hypot(point[0] - proj[0], point[1] - proj[1]);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestPoint = [point[0], point[1]];
        }
      }
      if (bestPoint && bestDistance < 1e-3) {
        edge.polyline = [start, bestPoint, end];
      }
    }
  }

  return tree;
}

function applyFlange(options) {
  const tree = buildPreF18TreeWithMultiPointCutoutEdge();
  const targets = [{ flatId: "SM.F13:flat", edgeId: "SM.F13:flat:edge" }];
  return __test_applyFlangesToTree({
    tree,
    featureID: "SM.TEST",
    targets,
    options: {
      angleDeg: 90,
      midRadius: 2.5,
      kFactor: 0.5,
      legLength: 7,
      requestedLegLength: 10,
      legLengthReference: "outside",
      legLengthReferenceSetback: 3,
      thickness: 1,
      insideRadius: 2,
      ...options,
    },
  });
}

export async function test_sheetMetal_cutoutEdge_flange_controls(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const base = applyFlange({
    insetMode: "material_inside",
    offset: 0,
    edgeStartSetback: 0,
    edgeEndSetback: 0,
  });
  if (base?.summary?.applied !== 1) {
    throw new Error("Baseline cutout-edge flange was not applied.");
  }

  const setback = applyFlange({
    insetMode: "material_inside",
    offset: 0,
    edgeStartSetback: 2,
    edgeEndSetback: 2,
  });
  if (setback?.summary?.applied !== 1) {
    throw new Error("Setback cutout-edge flange was not applied.");
  }
  const setbackTarget = setback.summary.appliedTargets?.[0] || {};
  if (!(Number(setbackTarget.edgeStartSetbackApplied) > 1.5 && Number(setbackTarget.edgeEndSetbackApplied) > 1.5)) {
    throw new Error("Cutout-edge start/end setback were not applied.");
  }

  const baseFlat = findFlatById(base.tree.root, "SM.F13:flat");
  const setbackFlat = findFlatById(setback.tree.root, "SM.F13:flat");
  const baseEdge = findEdgeById(baseFlat, "SM.F13:flat:edge");
  const setbackEdge = findEdgeById(setbackFlat, "SM.F13:flat:edge");
  const baseLen = polylineLength2(baseEdge?.polyline);
  const setbackLen = polylineLength2(setbackEdge?.polyline);
  if (!(setbackLen + 1e-6 < baseLen)) {
    throw new Error("Cutout-edge setbacks did not shorten the parent edge span.");
  }

  const insetA = applyFlange({
    insetMode: "bend_outside",
    offset: 0,
    edgeStartSetback: 0,
    edgeEndSetback: 0,
  });
  const insetB = applyFlange({
    insetMode: "material_inside",
    offset: 0,
    edgeStartSetback: 0,
    edgeEndSetback: 0,
  });
  const insetShiftA = Number(insetA.summary.appliedTargets?.[0]?.edgeShiftApplied || 0);
  const insetShiftB = Number(insetB.summary.appliedTargets?.[0]?.edgeShiftApplied || 0);
  if (!(Math.abs(insetShiftA - insetShiftB) > 0.5)) {
    throw new Error("Cutout-edge inset mode did not change edge shift.");
  }

  const offsetA = applyFlange({
    insetMode: "material_inside",
    offset: 0,
    edgeStartSetback: 0,
    edgeEndSetback: 0,
  });
  const offsetB = applyFlange({
    insetMode: "material_inside",
    offset: 1,
    edgeStartSetback: 0,
    edgeEndSetback: 0,
  });
  const offsetShiftA = Number(offsetA.summary.appliedTargets?.[0]?.edgeShiftApplied || 0);
  const offsetShiftB = Number(offsetB.summary.appliedTargets?.[0]?.edgeShiftApplied || 0);
  if (!(Math.abs(offsetShiftA - offsetShiftB) > 0.5)) {
    throw new Error("Cutout-edge offset did not change edge shift.");
  }

  return partHistory;
}
