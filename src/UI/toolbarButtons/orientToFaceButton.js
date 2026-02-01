import * as THREE from 'three';
import { computeFaceCenter, computeFaceNormal } from '../faceUtils.js';

const FACE_TYPES = new Set(['FACE', 'PLANE']);

function _isFaceType(obj) {
  const type = String(obj?.type || '').toUpperCase();
  return FACE_TYPES.has(type);
}

function _getScene(viewer) {
  return viewer?.partHistory?.scene || viewer?.scene || null;
}

function _findSelectedFace(viewer) {
  const scene = _getScene(viewer);
  if (!scene) return null;

  const last = viewer?._lastInspectorTarget || null;
  if (last && _isFaceType(last) && last.selected === true) return last;

  let found = null;
  scene.traverse((obj) => {
    if (found || !obj || !obj.selected) return;
    if (_isFaceType(obj)) found = obj;
  });
  return found;
}

function _orientCameraToFace(viewer, face) {
  const cam = viewer?.camera;
  if (!viewer || !cam || !face) return false;

  const target = computeFaceCenter(face);
  const normal = computeFaceNormal(face);
  if (!target || !normal) return false;

  const toCam = cam.position.clone().sub(target);
  const dir = normal.dot(toCam) < 0 ? normal.clone().multiplyScalar(-1) : normal.clone();
  dir.normalize();

  const worldUp = new THREE.Vector3(0, 1, 0);
  const ref = Math.abs(dir.dot(worldUp)) > 0.9 ? new THREE.Vector3(1, 0, 0) : worldUp;
  const x = new THREE.Vector3().crossVectors(ref, dir).normalize();
  const y = new THREE.Vector3().crossVectors(dir, x).normalize();

  let dist = cam.position.distanceTo(target);
  if (!Number.isFinite(dist) || dist < 1e-3) {
    dist = Math.max(5, (viewer.viewSize || 10) * 1.5);
  }

  const nextPos = target.clone().add(dir.multiplyScalar(dist));
  cam.position.copy(nextPos);
  cam.up.copy(y);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);

  const controls = viewer.controls;
  try { if (controls?.target) controls.target.copy(target); } catch {}
  try { if (controls?._gizmos?.position) controls._gizmos.position.copy(target); } catch {}
  try { controls?.update?.(); } catch {}
  try { controls?._gizmos?.updateMatrix?.(); } catch {}
  try { controls?._gizmos?.updateMatrixWorld?.(true); } catch {}
  try { controls?.updateMatrixState?.(); } catch {}
  try { controls?.saveState?.(); } catch {}
  try { viewer.render?.(); } catch {}

  return true;
}

export function createOrientToFaceButton(viewer) {
  const onClick = () => {
    const face = _findSelectedFace(viewer);
    if (!face) {
      viewer?._toast?.('Select a face to orient the view.');
      return;
    }
    if (!_orientCameraToFace(viewer, face)) {
      viewer?._toast?.('Unable to orient view to that face.');
    }
  };

  return { label: 'Perp', title: 'Orient view perpendicular to selected face', onClick };
}
