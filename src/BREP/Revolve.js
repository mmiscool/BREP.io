import { Solid } from './BetterSolid.js';
import * as THREE from 'three';
import { applySolidAuthoringStateSnapshot } from './CppSolidCore.js';
import { getEdgeLineEndpointsWorld, getEdgePolylineWorld } from './edgePolylineUtils.js';
import { computeBoundaryLoopsFromFaceNative } from './Sweep.js';
import { manifold } from './setupManifold.js';

function requireNativeRevolveBuilder() {
  if (typeof manifold?.buildRevolveAuthoringState === 'function') return;
  throw new Error('Revolve generation requires the custom local manifold build with native revolve support.');
}

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

function generateNativeRevolve(target, params = {}) {
  requireNativeRevolveBuilder();
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

  const faceNormal = (typeof face.getAverageNormal === 'function')
    ? face.getAverageNormal().clone()
    : new THREE.Vector3(0, 1, 0);
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

  const boundaryLoops = Array.isArray(face?.userData?.boundaryLoopsWorld) && face.userData.boundaryLoopsWorld.length
    ? face.userData.boundaryLoopsWorld.map((loop) => ({
        pts: (Array.isArray(loop?.pts) ? loop.pts : loop).map((p) => [p[0], p[1], p[2]]),
        isHole: !!loop?.isHole,
      }))
    : computeBoundaryLoopsFromFaceNative(face);
  if (!boundaryLoops.length) {
    throw new Error('Revolve generation requires boundary loops on the source face.');
  }

  const edgeInputs = (Array.isArray(face?.edges) ? face.edges : [])
    .map((edge) => ({
      name: `${edge?.name || 'EDGE'}_RV`,
      polyline: getEdgePolylineWorld(edge, { dedupe: false }).map((p) => [p[0], p[1], p[2]]),
      metadataJson: JSON.stringify({
        faceType: 'SIDEWALL',
        sourceEdgeName: String(edge?.name || edge?.userData?.edgeName || 'EDGE'),
      }),
    }))
    .filter((entry) => Array.isArray(entry.polyline) && entry.polyline.length >= 2);

  const snapshot = manifold.buildRevolveAuthoringState({
    name: target.name || params.name || 'Revolve',
    faceName: face?.name || 'Face',
    axisOrigin: [A.x, A.y, A.z],
    axisDirection: [axisDir.x, axisDir.y, axisDir.z],
    angle: Number.isFinite(Number(angle)) ? Number(angle) : 360,
    resolution: Number.isFinite(Number(resolution)) ? Number(resolution) : 64,
    faceNormal: [faceNormal.x, faceNormal.y, faceNormal.z],
    boundaryLoops,
    edges: edgeInputs,
  });

  applySolidAuthoringStateSnapshot(target, snapshot, { remapFaceIDs: true });
  target._dirty = true;
  target._manifold = null;
  target._faceIndex = null;
  try { target.setEpsilon(Number(snapshot?.suggestedEpsilon) || 1e-6); } catch {}

  try {
    const vp = Array.isArray(target._vertProperties) ? target._vertProperties : null;
    if (vp && vp.length >= 6) {
      const tmp = new THREE.Vector3();
      let minT = Infinity;
      let maxT = -Infinity;
      for (let i = 0; i < vp.length; i += 3) {
        tmp.set(vp[i], vp[i + 1], vp[i + 2]);
        const t = tmp.clone().sub(A).dot(axisDir);
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
      if (Number.isFinite(minT) && Number.isFinite(maxT) && maxT - minT > 1e-9) {
        const p0 = A.clone().add(axisDir.clone().multiplyScalar(minT));
        const p1 = A.clone().add(axisDir.clone().multiplyScalar(maxT));
        target.addCenterline(p0, p1, `${target.name || 'Revolve'}_AXIS`, { polylineWorld: true });
      }
    }
  } catch {}

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
