import { computeFilletCenterlineForEdge } from "../BREP/CppSolidCore.js";
import { filletSolid } from "../BREP/fillets/fillet.js";
import { fs } from "../fs.proxy.js";

const PART_PATH = "src/tests/partFiles/fillet_test.BREP.json";

export async function test_fillet_edge_degenerate_segment(partHistory) {
  const content = await (fs.promises as any).readFile(PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  // Stop before the fillet so we can evaluate the source edge geometry directly.
  partHistory.currentHistoryStepId = "E7";
  return partHistory;
}

export async function afterRun_fillet_edge_degenerate_segment(partHistory) {
  const filletFeature = partHistory.features.find((feature) => feature?.type === "F");
  if (!filletFeature) throw new Error("Fillet feature missing from part file.");

  const rawEdge = Array.isArray(filletFeature.inputParams?.edges)
    ? filletFeature.inputParams.edges[0]
    : null;
  if (!rawEdge) throw new Error("Fillet edge reference missing from part file.");

  const edgeObj = (typeof rawEdge === "object")
    ? rawEdge
    : partHistory.getObjectByName(String(rawEdge));
  if (!edgeObj) throw new Error(`Fillet source edge not found: ${String(rawEdge)}`);

  const radii = [0.5, 0.675, 1.0];
  const results = radii.map((radius) => ({ radius, res: computeFilletCenterlineForEdge(edgeObj, radius, "INSET") }));

  for (const { radius, res } of results) {
    if (!Array.isArray(res.points) || !Array.isArray(res.edge)) {
      throw new Error(`computeFilletCenterline should provide point arrays (radius=${radius}).`);
    }
    if (res.nativeKernel !== true) {
      throw new Error(`Expected native fillet centerline kernel for radius=${radius}.`);
    }
    if (res.points.length < 2) {
      throw new Error(`computeFilletCenterline should produce at least 2 points (radius=${radius}).`);
    }

    let minSeg = Infinity;
    let maxSeg = 0;
    for (let i = 1; i < res.points.length; i++) {
      const a = res.points[i - 1];
      const b = res.points[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d < minSeg) minSeg = d;
      if (d > maxSeg) maxSeg = d;
    }
    // Degenerate micro-segments in the source edge should be sanitized out for all radii.
    if (Number.isFinite(minSeg) && Number.isFinite(maxSeg) && maxSeg > 0 && minSeg < (maxSeg * 1e-5)) {
      throw new Error(
        `Fillet centerline contains a degenerate segment at radius=${radius}: minSeg=${minSeg}, maxSeg=${maxSeg}`,
      );
    }
  }

  const pointCounts = results.map(({ res }) => res.points.length);
  const allSameCount = pointCounts.every((count) => count === pointCounts[0]);
  if (!allSameCount) {
    throw new Error(`Degenerate-edge sampling changed with radius: pointCounts=${JSON.stringify(pointCounts)}`);
  }

  const faceAName = String(edgeObj?.faces?.[0]?.name || edgeObj?.userData?.faceA || "");
  const faceBName = String(edgeObj?.faces?.[1]?.name || edgeObj?.userData?.faceB || "");
  const polylineLocal = Array.isArray(edgeObj?.userData?.polylineLocal) ? edgeObj.userData.polylineLocal : [];
  if (faceAName && faceBName && polylineLocal.length >= 2) {
    const segmentCount = Math.max(1, polylineLocal.length - 1);
    edgeObj.userData.segmentFacePairs = Array.from({ length: segmentCount }, () => [faceAName, faceBName]);
    let segmentResult = null;
    try {
      const segmented = computeFilletCenterlineForEdge(edgeObj, radii[0], "INSET");
      if (segmented.nativeKernel !== true || segmented.points.length < 2) {
        throw new Error("Native segmented centerline path did not return a usable result.");
      }

      segmentResult = (filletSolid as any)({
        edgeToFillet: edgeObj,
        radius: radii[0],
        sideMode: "INSET",
        name: "SEGMENT_FACE_PAIR_NATIVE_TEST",
      });
      if (!segmentResult?.finalSolid || !Array.isArray(segmentResult.finalSolid?._triVerts) || segmentResult.finalSolid._triVerts.length < 3) {
        throw new Error("Native segmented fillet edge build did not produce a solid.");
      }
    } finally {
      try { segmentResult?.tube?.free?.(); } catch { /* ignore cleanup failure */ }
      try { segmentResult?.wedge?.free?.(); } catch { /* ignore cleanup failure */ }
      try { segmentResult?.finalSolid?.free?.(); } catch { /* ignore cleanup failure */ }
      try { delete edgeObj.userData.segmentFacePairs; } catch { /* ignore cleanup failure */ }
    }
  }

  console.log(
    `✓ Fillet degenerate-edge tangent test passed: radii=${radii.join(", ")}, points=${pointCounts.join(",")}`,
  );
}
