export function setSketchFeatureSceneVisibility(partHistory, featureID, visible) {
  if (!partHistory || !featureID) return false;
  try {
    const sketchObject = typeof partHistory.getObjectByName === 'function'
      ? partHistory.getObjectByName(featureID)
      : partHistory?.scene?.getObjectByName?.(featureID);
    if (!sketchObject) return false;
    sketchObject.visible = !!visible;
    return true;
  } catch {
    return false;
  }
}
