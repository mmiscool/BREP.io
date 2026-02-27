export async function test_visibility_hidden_state_persistence(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  cube.inputParams.sizeX = 8;
  cube.inputParams.sizeY = 6;
  cube.inputParams.sizeZ = 4;
}

export async function afterRun_visibility_hidden_state_persistence(partHistory) {
  const firstFeature = Array.isArray(partHistory?.features) ? partHistory.features[0] : null;
  const cubeName = firstFeature?.inputParams?.featureID;
  if (!cubeName) {
    throw new Error('Visibility persistence test requires a first feature with featureID.');
  }

  const cube = partHistory.scene?.getObjectByName?.(cubeName);
  if (!cube || cube.type !== 'SOLID') {
    throw new Error('Visibility persistence test could not find initial cube solid.');
  }

  const face = (Array.isArray(cube.children) ? cube.children : []).find((child) => child?.type === 'FACE') || null;
  const edge = (Array.isArray(cube.children) ? cube.children : []).find((child) => child?.type === 'EDGE') || null;
  if (!face || !edge) {
    throw new Error('Visibility persistence test requires one face and one edge on the cube.');
  }

  const hiddenFaceName = String(face?.userData?.faceName || face?.name || '');
  const hiddenEdgeName = String(edge?.name || '');
  if (!hiddenFaceName || !hiddenEdgeName) {
    throw new Error('Visibility persistence test requires named face and edge.');
  }

  cube.visible = false;
  face.visible = false;
  edge.visible = false;

  await partHistory.newFeature('P.CU');
  await partHistory.runHistory();

  const rebuiltCube = partHistory.scene?.getObjectByName?.(cubeName);
  if (!rebuiltCube) {
    throw new Error('Visibility persistence test could not find rebuilt cube.');
  }
  if (rebuiltCube.visible !== false) {
    throw new Error('Hidden solid visibility state was not preserved after history run.');
  }

  const rebuiltChildren = Array.isArray(rebuiltCube.children) ? rebuiltCube.children : [];
  const rebuiltFace = rebuiltChildren.find((child) => {
    if (child?.type !== 'FACE') return false;
    const faceName = String(child?.userData?.faceName || child?.name || '');
    return faceName === hiddenFaceName;
  }) || null;
  const rebuiltEdge = rebuiltChildren.find((child) => (
    child?.type === 'EDGE' && String(child?.name || '') === hiddenEdgeName
  )) || null;

  if (!rebuiltFace) {
    throw new Error('Hidden face could not be resolved after history run.');
  }
  if (!rebuiltEdge) {
    throw new Error('Hidden edge could not be resolved after history run.');
  }
  if (rebuiltFace.visible !== false) {
    throw new Error('Hidden face visibility state was not preserved after history run.');
  }
  if (rebuiltEdge.visible !== false) {
    throw new Error('Hidden edge visibility state was not preserved after history run.');
  }
}
