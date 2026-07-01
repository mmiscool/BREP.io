export async function test_history_expand_does_not_dirty(partHistory) {
  await partHistory.newFeature("P.CU");
}

export async function afterRun_history_expand_does_not_dirty(partHistory) {
  const feature = Array.isArray(partHistory?.features) ? partHistory.features[0] : null;
  if (!feature) {
    throw new Error("Expand-state dirty test requires one feature in history.");
  }

  const initialTimestamp = Number(feature.timestamp);
  if (!Number.isFinite(initialTimestamp)) {
    throw new Error("Feature timestamp missing after initial run.");
  }
  const initialLastRun = feature.lastRun;
  if (!initialLastRun || initialLastRun.ok !== true) {
    throw new Error("Feature lastRun state missing after initial run.");
  }

  feature.inputParams = feature.inputParams || {};
  feature.inputParams.__open = true;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await partHistory.runHistory();

  if (Number(feature.timestamp) !== initialTimestamp) {
    throw new Error("Expanding a feature should not mark it dirty or rerun.");
  }
  if (feature.lastRun !== initialLastRun) {
    throw new Error("Expanding a feature should not replace lastRun metadata.");
  }

  feature.inputParams.__open = false;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await partHistory.runHistory();

  if (Number(feature.timestamp) !== initialTimestamp) {
    throw new Error("Collapsing a feature should not mark it dirty or rerun.");
  }
  if (feature.lastRun !== initialLastRun) {
    throw new Error("Collapsing a feature should not replace lastRun metadata.");
  }
}
