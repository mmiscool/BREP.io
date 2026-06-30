import * as THREE from "three";
import { resolveHistoryDisplayInfo } from "../UI/history/historyDisplayInfo.js";
import { buildLinearDimensionGeometry } from "../UI/dimensions/dimensionGeometry.js";
import {
  LinearDimensionAnnotation,
  __testOnlyLinearDimensionInternals,
} from "../UI/pmi/dimensions/LinearDimensionAnnotation.js";

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed.");
}

function assertApprox(actual, expected, tolerance, message) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message || "Expected approximate equality"}: expected ${expected}, got ${actual}.`);
  }
}

function makePlanarFace(name, z = 0, {
  x0 = -1,
  x1 = 1,
  y0 = -1,
  y1 = 1,
} = {}) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute([
    x0, y0, z,
    x1, y0, z,
    x1, y1, z,
    x0, y0, z,
    x1, y1, z,
    x0, y1, z,
  ], 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  const face = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
  face.name = name;
  face.type = "FACE";
  return face;
}

function makeVertex(name, position) {
  const vertex = new THREE.Object3D();
  vertex.name = name;
  vertex.type = "VERTEX";
  vertex.position.copy(position);
  return vertex;
}

function makeLinearEdge(name, a, b) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
  ], 3));
  const edge = new THREE.Line(geom, new THREE.LineBasicMaterial());
  edge.name = name;
  edge.type = "EDGE";
  return edge;
}

function makePMIMode(scene) {
  return { viewer: { partHistory: { scene } } };
}

export async function test_pmi_linear_dimension_face_target_measures_perpendicular_to_face() {
  const scene = new THREE.Scene();
  const face = makePlanarFace("BASE_FACE", 0);
  const vertex = makeVertex("TARGET_VERTEX", new THREE.Vector3(2, 3, 5));
  scene.add(face);
  scene.add(vertex);
  scene.updateMatrixWorld(true);

  const context: any = LinearDimensionAnnotation.showContexButton([face, vertex]);
  assert(Array.isArray(context?.params?.targets), "Expected linear PMI context action for face and vertex.");

  const points: any = __testOnlyLinearDimensionInternals.computeDimPoints(
    makePMIMode(scene),
    { targets: ["BASE_FACE", "TARGET_VERTEX"] },
  );
  assert(points?.measurementMode === "faceNormal", "Expected face-normal linear dimension mode.");
  assertApprox(points.p0.x, 2, 1e-9, "Expected projected foot x.");
  assertApprox(points.p0.y, 3, 1e-9, "Expected projected foot y.");
  assertApprox(points.p0.z, 0, 1e-9, "Expected projected foot on base face.");
  assertApprox(points.p1.z, 5, 1e-9, "Expected target point to remain along face normal.");
  assertApprox(points.p0.distanceTo(points.p1), 5, 1e-9, "Expected perpendicular face distance.");
}

export async function test_pmi_linear_dimension_parallel_faces_measure_plane_spacing() {
  const scene = new THREE.Scene();
  const base = makePlanarFace("BASE_FACE", 0);
  const target = makePlanarFace("TARGET_FACE", 4, { x0: 1, x1: 3, y0: 2, y1: 4 });
  scene.add(base);
  scene.add(target);
  scene.updateMatrixWorld(true);

  const points: any = __testOnlyLinearDimensionInternals.computeDimPoints(
    makePMIMode(scene),
    { targets: ["BASE_FACE", "TARGET_FACE"] },
  );
  assert(points?.measurementMode === "faceNormal", "Expected face-normal linear dimension mode for planar faces.");
  assertApprox(points.p0.z, 0, 1e-9, "Expected base measurement point on base face plane.");
  assertApprox(points.p1.z, 4, 1e-9, "Expected target measurement point on target face plane.");
  assertApprox(points.p0.distanceTo(points.p1), 4, 1e-9, "Expected parallel planar face spacing.");
}

export async function test_pmi_linear_dimension_face_extensions_can_jog_to_measurement_line() {
  const p0 = new THREE.Vector3(2, 3, 0);
  const p1 = new THREE.Vector3(2, 3, 5);
  const geometry = buildLinearDimensionGeometry({
    pointA: p0,
    pointB: p1,
    extensionAnchorA: new THREE.Vector3(0, 0, 0),
    extensionAnchorB: p1,
    normal: new THREE.Vector3(0, 1, 0),
    offset: 1,
    showExtensions: true,
    screenSizeWorld: (pixels) => pixels * 0.01,
  });

  assert(geometry?.segments?.length >= 4, "Expected jogged extension plus dimension segments.");
  const first = geometry.segments[0];
  assertApprox(first[0].x, 0, 1e-9, "Expected first jog segment to begin at face anchor.");
  assertApprox(first[0].y, 0, 1e-9, "Expected first jog segment to begin at face anchor.");
  assertApprox(first[1].x, 2, 1e-9, "Expected first jog segment to end at measurement foot.");
  assertApprox(first[1].y, 3, 1e-9, "Expected first jog segment to end at measurement foot.");
}

export async function test_pmi_linear_dimension_edge_target_measures_perpendicular_to_edge() {
  const scene = new THREE.Scene();
  const edge = makeLinearEdge("BASE_EDGE", new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
  const vertex = makeVertex("TARGET_VERTEX", new THREE.Vector3(4, 3, 5));
  scene.add(edge);
  scene.add(vertex);
  scene.updateMatrixWorld(true);

  const points: any = __testOnlyLinearDimensionInternals.computeDimPoints(
    makePMIMode(scene),
    { targets: ["BASE_EDGE", "TARGET_VERTEX"] },
  );
  assert(points?.measurementMode === "edgeNormal", "Expected edge-normal linear dimension mode.");
  assertApprox(points.p0.x, 4, 1e-9, "Expected projected foot on edge line x.");
  assertApprox(points.p0.y, 0, 1e-9, "Expected projected foot on edge line y.");
  assertApprox(points.p0.z, 0, 1e-9, "Expected projected foot on edge line z.");
  assertApprox(points.p1.x, 4, 1e-9, "Expected target point to stay on perpendicular line x.");
  assertApprox(points.p1.y, 3, 1e-9, "Expected target y.");
  assertApprox(points.p1.z, 5, 1e-9, "Expected target z.");
  assertApprox(points.p1.clone().sub(points.p0).dot(new THREE.Vector3(1, 0, 0)), 0, 1e-9, "Expected measurement direction perpendicular to edge.");

  const reversed: any = __testOnlyLinearDimensionInternals.computeDimPoints(
    makePMIMode(scene),
    { targets: ["TARGET_VERTEX", "BASE_EDGE"] },
  );
  assert(reversed?.measurementMode === "edgeNormal", "Expected edge-normal mode regardless of selection order.");
  assertApprox(reversed.p0.x, 4, 1e-9, "Expected reversed projected foot x.");
  assertApprox(reversed.p0.distanceTo(reversed.p1), Math.sqrt(34), 1e-9, "Expected reversed perpendicular distance.");
}

export async function test_pmi_linear_dimension_parallel_edges_measure_perpendicular_spacing() {
  const scene = new THREE.Scene();
  const base = makeLinearEdge("BASE_EDGE", new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
  const target = makeLinearEdge("TARGET_EDGE", new THREE.Vector3(2, 3, 4), new THREE.Vector3(8, 3, 4));
  scene.add(base);
  scene.add(target);
  scene.updateMatrixWorld(true);

  const points: any = __testOnlyLinearDimensionInternals.computeDimPoints(
    makePMIMode(scene),
    { targets: ["BASE_EDGE", "TARGET_EDGE"] },
  );
  assert(points?.measurementMode === "edgeNormal", "Expected edge-normal linear dimension mode for parallel edges.");
  assertApprox(points.p0.y, 0, 1e-9, "Expected base point on base edge y.");
  assertApprox(points.p0.z, 0, 1e-9, "Expected base point on base edge z.");
  assertApprox(points.p1.y, 3, 1e-9, "Expected target point on target edge y.");
  assertApprox(points.p1.z, 4, 1e-9, "Expected target point on target edge z.");
  assertApprox(points.p0.distanceTo(points.p1), 5, 1e-9, "Expected parallel edge spacing.");
}

export async function test_pmi_linear_dimension_single_edge_still_measures_edge_length() {
  const scene = new THREE.Scene();
  const edge = makeLinearEdge("BASE_EDGE", new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
  scene.add(edge);
  scene.updateMatrixWorld(true);

  const points: any = __testOnlyLinearDimensionInternals.computeDimPoints(
    makePMIMode(scene),
    { targets: ["BASE_EDGE"] },
  );
  assert(points?.measurementMode !== "edgeNormal", "Expected a single edge to keep length dimension behavior.");
  assertApprox(points.p0.distanceTo(points.p1), 10, 1e-9, "Expected single edge length.");
}

export async function test_pmi_linear_dimension_limits_targets_to_two() {
  const schema: any = LinearDimensionAnnotation.inputParamsSchema?.targets || {};
  assert(schema.maxSelections === 2, "Expected linear dimension target selector to cap selections at two.");

  const ann = { targets: ["A", "B", "C"] };
  LinearDimensionAnnotation.applyParams(null, ann, ann);
  assert(Array.isArray(ann.targets), "Expected linear dimension targets to stay an array.");
  assert(ann.targets.length === 2, "Expected linear dimension params to clamp targets to two.");
  assert(ann.targets[0] === "A" && ann.targets[1] === "B", "Expected linear dimension to keep the first two targets.");

  const scene = new THREE.Scene();
  scene.add(makeVertex("A", new THREE.Vector3(0, 0, 0)));
  scene.add(makeVertex("B", new THREE.Vector3(1, 0, 0)));
  scene.add(makeVertex("C", new THREE.Vector3(100, 0, 0)));
  scene.updateMatrixWorld(true);

  const points = __testOnlyLinearDimensionInternals.computeDimPoints(
    makePMIMode(scene),
    { targets: ["A", "B", "C"] },
  );
  assertApprox(points.p0.distanceTo(points.p1), 1, 1e-9, "Expected runtime measurement to ignore targets after the first two.");
}

export async function test_pmi_annotation_failure_status_is_visible() {
  const entry = {
    type: "linear",
    inputParams: { id: "DIM1", type: "linear" },
    lastRun: {
      ok: false,
      durationMs: 4.2,
      errorMessage: "Linear dimension could not resolve two measurement points.",
    },
  };
  const history = {
    registry: {
      resolve(type) {
        return type === "linear" ? LinearDimensionAnnotation : null;
      },
    },
  };
  const info = resolveHistoryDisplayInfo(entry, { history });
  assert(info.hasError === true, "Expected failed annotation to be marked as an error.");
  assert(String(info.statusText || "").includes("Error"), "Expected failed annotation status text to show Error.");
  assert(
    String(info.statusTitle || "").includes("could not resolve"),
    "Expected failed annotation status title to include the render error message.",
  );
}
