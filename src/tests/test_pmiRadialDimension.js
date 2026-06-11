import * as THREE from "three";
import {
  RadialDimensionAnnotation,
  __testOnlyRadialDimensionInternals,
} from "../UI/pmi/dimensions/RadialDimensionAnnotation.js";

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed.");
}

function assertApprox(actual, expected, tolerance, message) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message || "Expected approximate equality"}: expected ${expected}, got ${actual}.`);
  }
}

function makePipeFaceGeometry(radius, height, segments = 24) {
  const positions = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p00 = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius];
    const p01 = [Math.cos(a0) * radius, height, Math.sin(a0) * radius];
    const p10 = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius];
    const p11 = [Math.cos(a1) * radius, height, Math.sin(a1) * radius];
    positions.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geom;
}

function makePipeScene({
  faceName,
  pathName,
  geometryRadius,
  metadata = {},
  height = 10,
}) {
  const scene = new THREE.Scene();
  const owner = new THREE.Group();
  owner.name = `${faceName}_OWNER`;
  owner.type = "SOLID";
  owner._auxEdges = [{
    name: pathName,
    points: [[0, 0, 0], [0, height, 0]],
    closedLoop: false,
    polylineWorld: true,
    centerline: true,
  }];
  owner.getFaceMetadata = (name) => (name === faceName ? metadata : {});

  const face = new THREE.Mesh(
    makePipeFaceGeometry(geometryRadius, height),
    new THREE.MeshBasicMaterial(),
  );
  face.name = faceName;
  face.type = "FACE";
  face.userData.faceName = faceName;
  owner.add(face);
  scene.add(owner);
  scene.updateMatrixWorld(true);

  return { scene, face };
}

function makePMIMode(scene) {
  return { viewer: { partHistory: { scene } } };
}

export async function test_pmi_radial_dimension_accepts_pipe_aux_path_face() {
  const faceName = "PMI_PIPE_Outer";
  const { scene, face } = makePipeScene({
    faceName,
    pathName: "PMI_PIPE_PATH",
    geometryRadius: 2,
  });

  const context = RadialDimensionAnnotation.showContexButton([face]);
  assert(context?.params?.cylindricalFaceRef === faceName, "Expected radial PMI context action for pipe outer face.");

  const data = __testOnlyRadialDimensionInternals.computeRadialPoints(
    makePMIMode(scene),
    { cylindricalFaceRef: faceName },
  );
  assert(data?.center && data?.radiusPoint, "Expected radial PMI to resolve pipe geometry from the auxiliary path.");
  assertApprox(data.radius, 2, 1e-6, "Expected radial PMI to measure pipe radius from geometry.");
}

export async function test_pmi_radial_dimension_uses_fillet_pipe_radius_override() {
  const faceName = "PMI_FILLET_E1_TUBE_Outer";
  const { scene, face } = makePipeScene({
    faceName,
    pathName: "PMI_FILLET_E1_TUBE_PATH",
    geometryRadius: 2.4,
    metadata: {
      type: "pipe",
      source: "FilletFeature",
      pmiRadiusOverride: 1.5,
      radiusOverride: 1.5,
      inflatedRadius: 2.4,
      filletSideWall: true,
    },
  });

  const context = RadialDimensionAnnotation.showContexButton([face]);
  assert(context?.params?.cylindricalFaceRef === faceName, "Expected radial PMI context action for fillet pipe face.");

  const measured = __testOnlyRadialDimensionInternals.measureRadialValue(
    makePMIMode(scene),
    { cylindricalFaceRef: faceName },
  );
  assertApprox(measured, 1.5, 1e-9, "Expected radial PMI to use fillet pmiRadiusOverride.");
}

export async function test_pmi_radial_dimension_uses_offset_shell_pipe_radius_override() {
  const faceName = "O.S17_ROUND_PIPE_3_Outer";
  const pathName = "O.S17_ROUND_PIPE_3_PATH";
  const { scene, face } = makePipeScene({
    faceName,
    pathName,
    geometryRadius: 0.421,
    metadata: {
      type: "rounded_pipe",
      faceRole: "rounded_pipe",
      offsetShellFaceRole: "rounded_pipe",
      offsetShellRoundedPipe: true,
      sourceFeatureId: "O.S17",
      pmiRadiusOverride: 0.5,
      radiusOverride: 0.5,
      offsetShellRadius: 0.5,
      pmiCenterlineAuxName: pathName,
    },
  });

  const context = RadialDimensionAnnotation.showContexButton([face]);
  assert(context?.params?.cylindricalFaceRef === faceName, "Expected radial PMI context action for offset-shell rounded pipe face.");

  const measured = __testOnlyRadialDimensionInternals.measureRadialValue(
    makePMIMode(scene),
    { cylindricalFaceRef: faceName },
  );
  assertApprox(measured, 0.5, 1e-9, "Expected radial PMI to use offset-shell rounded-pipe radius override.");
}
