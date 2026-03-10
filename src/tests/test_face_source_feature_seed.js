function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_face_source_feature_seed(partHistory) {
  const cyl = await partHistory.newFeature('P.CY');
  const featureID = String(cyl?.inputParams?.featureID || '');
  assert(featureID, 'Cylinder feature should have a featureID.');

  await partHistory.runHistory();

  const solid = partHistory?.scene?.getObjectByName?.(featureID) || null;
  assert(solid, 'Expected cylinder solid in the scene.');
  assert(typeof solid.getFaceMetadata === 'function', 'Expected solid face metadata API.');

  const sideMeta = solid.getFaceMetadata(`${featureID}_S`);
  const topMeta = solid.getFaceMetadata(`${featureID}_T`);

  assert(sideMeta?.sourceFeatureId === featureID, 'Cylinder side face should be seeded with sourceFeatureId.');
  assert(topMeta?.sourceFeatureId === featureID, 'Cylinder top face should be seeded with sourceFeatureId.');
}
