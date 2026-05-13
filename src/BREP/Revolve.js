import { Solid } from './BetterSolid.js';
import * as THREE from 'three';
import { getEdgeLineEndpointsWorld, getEdgePolylineWorld } from './edgePolylineUtils.js';
import { computeBoundaryLoopsFromFaceNative } from './Sweep.js';
import { makeRevolution, setOccState } from './OpenCascadeKernel.js';

function computeFaceCentroidWorld(faceObj) {
  try {
    const geom = faceObj?.geometry;
    const posAttr = geom?.getAttribute?.('position');
    if (posAttr && posAttr.itemSize === 3 && posAttr.count > 0) {
      const sum = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(faceObj.matrixWorld);
        sum.add(tmp);
      }
      return sum.multiplyScalar(1 / posAttr.count);
    }
  } catch {}

  try {
    const loops = Array.isArray(faceObj?.userData?.boundaryLoopsWorld)
      ? faceObj.userData.boundaryLoopsWorld
      : null;
    const outer = loops?.find((loop) => Array.isArray(loop?.pts) && loop.pts.length);
    if (outer) {
      const center = new THREE.Vector3();
      let count = 0;
      for (const pt of outer.pts) {
        center.add(new THREE.Vector3(pt[0], pt[1], pt[2]));
        count++;
      }
      if (count) return center.multiplyScalar(1 / count);
    }
  } catch {}

  return null;
}

function cloneBoundaryLoopsWorld(face) {
  const loops = Array.isArray(face?.userData?.boundaryLoopsWorld) && face.userData.boundaryLoopsWorld.length
    ? face.userData.boundaryLoopsWorld
    : null;
  if (!loops) return null;
  return loops.map((loop) => ({
    pts: (Array.isArray(loop?.pts) ? loop.pts : loop).map((p) => [p[0], p[1], p[2]]),
    isHole: !!loop?.isHole,
    segmentIds: Array.isArray(loop?.segmentIds) ? loop.segmentIds.slice() : [],
  }));
}

function cloneSketchEdgeInputsWorld(face) {
  const inputs = Array.isArray(face?.userData?.sketchEdgeInputsWorld)
    ? face.userData.sketchEdgeInputsWorld
    : null;
  if (!inputs) return null;
  const faceToken = String(face?.name || face?.userData?.faceName || 'Face');
  return inputs.map((edge, index) => {
    const sourceName = String(edge?.name || edge?.metadata?.sourceEdgeName || edge?.sketchGeometryId || `EDGE_${index}`);
    const metadata = (() => {
      try {
        const parsed = edge?.metadataJson ? JSON.parse(String(edge.metadataJson)) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    })();
    if (sourceName) metadata.sourceEdgeName = sourceName;
    return {
      ...edge,
      name: `${faceToken}:${sourceName}_RV`,
      sketchGeometryId: edge?.sketchGeometryId ?? null,
      polyline: (Array.isArray(edge?.polyline) ? edge.polyline : []).map((p) => [p[0], p[1], p[2]]),
      curveType: edge?.curveType || edge?.sketchGeomType || null,
      bezierPoles: Array.isArray(edge?.bezierPoles) ? edge.bezierPoles.map((p) => p.slice()) : null,
      circleCenter: Array.isArray(edge?.circleCenter) ? edge.circleCenter.slice() : null,
      circleRadius: Number.isFinite(Number(edge?.circleRadius)) ? Number(edge.circleRadius) : null,
      arcCenter: Array.isArray(edge?.arcCenter) ? edge.arcCenter.slice() : null,
      arcRadius: Number.isFinite(Number(edge?.arcRadius)) ? Number(edge.arcRadius) : null,
      metadataJson: JSON.stringify(metadata),
    };
  }).filter((entry) => Array.isArray(entry.polyline) && entry.polyline.length >= 2);
}

function generateNativeRevolve(target, params = {}) {
  const { face, axis, angle = 360, resolution = 64 } = params;
  if (!face || !face.geometry) return false;

  const axisObj = Array.isArray(axis) ? (axis[0] || null) : (axis || null);
  const A = new THREE.Vector3(0, 0, 0);
  const B = new THREE.Vector3(0, 1, 0);
  if (axisObj) {
    const endpoints = getEdgeLineEndpointsWorld(axisObj);
    if (endpoints) {
      A.copy(endpoints.start);
      B.copy(endpoints.end);
    }
  }
  let axisDir = B.clone().sub(A);
  if (axisDir.lengthSq() < 1e-12) axisDir.set(0, 1, 0);
  axisDir.normalize();

  const storedNormal = Array.isArray(face?.userData?.profileNormal) && face.userData.profileNormal.length >= 3
    ? new THREE.Vector3(face.userData.profileNormal[0], face.userData.profileNormal[1], face.userData.profileNormal[2])
    : null;
  const faceNormal = storedNormal
    || (typeof face.getAverageNormal === 'function'
      ? face.getAverageNormal().clone()
      : new THREE.Vector3(0, 1, 0));
  const faceCentroid = computeFaceCentroidWorld(face);
  if (faceNormal.lengthSq() < 1e-12) faceNormal.set(0, 1, 0);
  faceNormal.normalize();
  if (faceCentroid) {
    const radial = faceCentroid.clone().sub(A);
    radial.sub(axisDir.clone().multiplyScalar(radial.dot(axisDir)));
    if (radial.lengthSq() > 1e-12) {
      const orient = new THREE.Vector3().crossVectors(axisDir, radial).dot(faceNormal);
      if (orient < 0) axisDir.negate();
    }
  }

  const boundaryLoops = cloneBoundaryLoopsWorld(face) || computeBoundaryLoopsFromFaceNative(face);
  if (!boundaryLoops.length) {
    throw new Error('Revolve generation requires boundary loops on the source face.');
  }

  const storedEdgeInputs = cloneSketchEdgeInputsWorld(face);
  const edgeInputs = storedEdgeInputs || (Array.isArray(face?.edges) ? face.edges : [])
    .map((edge) => ({
      name: `${edge?.name || 'EDGE'}_RV`,
      polyline: getEdgePolylineWorld(edge, { dedupe: false }).map((p) => [p[0], p[1], p[2]]),
      metadataJson: JSON.stringify({
        faceType: 'SIDEWALL',
        sourceEdgeName: String(edge?.name || edge?.userData?.edgeName || 'EDGE'),
      }),
    }))
    .filter((entry) => Array.isArray(entry.polyline) && entry.polyline.length >= 2);

  const occState = makeRevolution({
    faceName: face?.name || 'Face',
    boundaryLoops,
    axisOrigin: [A.x, A.y, A.z],
    axisDirection: [axisDir.x, axisDir.y, axisDir.z],
    angleDegrees: Number.isFinite(Number(angle)) ? Number(angle) : 360,
    edgeInputs,
    normal: [faceNormal.x, faceNormal.y, faceNormal.z],
  });
  setOccState(target, occState);
  try { target.name = params.name || target.name || 'Revolve'; } catch {}
  if (axisObj) {
    try { target.addCenterline(A, B, `${target.name || 'Revolve'}_AXIS`, { polylineWorld: true }); } catch {}
  }
  return true;
}

export class Revolve extends Solid {
  constructor({ face, axis, angle = 360, resolution = 64, name = 'Revolve' } = {}) {
    super();
    this.params = { face, axis, angle, resolution };
    this.name = name || 'Revolve';
    this.generate();
  }

  generate() {
    const { face, axis, angle, resolution } = this.params;
    if (!face || !face.geometry) return this;
    generateNativeRevolve(this, {
      face,
      axis,
      angle,
      resolution,
      name: this.name || 'Revolve',
    });
    return this;
  }
}
