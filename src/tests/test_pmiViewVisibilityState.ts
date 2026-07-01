import * as THREE from 'three';

export async function test_pmi_view_visibility_state_round_trip(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  cube.inputParams.sizeX = 8;
  cube.inputParams.sizeY = 6;
  cube.inputParams.sizeZ = 4;
}

export async function afterRun_pmi_view_visibility_state_round_trip(partHistory) {
  const firstFeature = Array.isArray(partHistory?.features) ? partHistory.features[0] : null;
  const cubeName = firstFeature?.inputParams?.featureID;
  if (!cubeName) {
    throw new Error('PMI visibility state test requires a first feature with featureID.');
  }

  const cube = partHistory.scene?.getObjectByName?.(cubeName);
  if (!cube || cube.type !== 'SOLID') {
    throw new Error('PMI visibility state test could not find the cube solid.');
  }

  const face = (Array.isArray(cube.children) ? cube.children : []).find((child) => child?.type === 'FACE') || null;
  const edge = (Array.isArray(cube.children) ? cube.children : []).find((child) => child?.type === 'EDGE') || null;
  if (!face || !edge) {
    throw new Error('PMI visibility state test requires one face and one edge on the cube.');
  }

  cube.visible = false;
  face.visible = false;
  edge.visible = false;
  const component = new THREE.Object3D();
  component.type = 'COMPONENT';
  component.name = 'PMI_VIS_COMPONENT';
  component.visible = false;
  partHistory.scene.add(component);

  const visibilityState = partHistory.captureVisibilityState();
  if (!Array.isArray(visibilityState) || visibilityState.length < 4) {
    throw new Error('Expected captureVisibilityState() to capture hidden scene objects beyond just faces and edges.');
  }

  cube.visible = true;
  face.visible = true;
  edge.visible = true;
  component.visible = true;
  partHistory.applyVisibilityState(visibilityState);

  if (cube.visible !== false || face.visible !== false || edge.visible !== false || component.visible !== false) {
    throw new Error('applyVisibilityState() did not restore the captured hidden state.');
  }

  partHistory.applyVisibilityState([]);
  if (cube.visible !== true || face.visible !== true || edge.visible !== true || component.visible !== true) {
    throw new Error('applyVisibilityState([]) did not clear the captured hidden state.');
  }
}
