// Exercises the feature-history worker protocol end-to-end without a browser:
// the test partHistory acts as the UI side and delegates execution through a
// loopback "worker" client backed by a second, kernel-side PartHistory. Both
// the request and the result are round-tripped through structuredClone, which
// enforces the same serialization constraints as postMessage.

import { PartHistory } from '../PartHistory.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeRectangleSketch() {
  return {
    points: [
      { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
      { id: 1, x: 2, y: 2, fixed: false, construction: false, externalReference: false },
      { id: 2, x: 8, y: 2, fixed: false, construction: false, externalReference: false },
      { id: 3, x: 8, y: 2, fixed: false, construction: false, externalReference: false },
      { id: 4, x: 8, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 5, x: 8, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 6, x: 2, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 7, x: 2, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 8, x: 2, y: 2, fixed: false, construction: false, externalReference: false },
    ],
    geometries: [
      { id: 1, type: 'line', points: [1, 2], construction: false },
      { id: 2, type: 'line', points: [3, 4], construction: false },
      { id: 3, type: 'line', points: [5, 6], construction: false },
      { id: 4, type: 'line', points: [7, 8], construction: false },
    ],
    constraints: [],
  };
}

// Minimal stand-in for FeatureHistoryWorkerClient: same interface, but the
// "worker" is a second PartHistory in this process, and payloads go through
// structuredClone instead of postMessage.
function makeLoopbackClient(kernelHistory, log: any = {}) {
  return {
    async runHistory(request, { onFeatureStart } = {} as any) {
      const clonedRequest = structuredClone(request);
      log.requests = log.requests || [];
      log.requests.push(clonedRequest);

      await kernelHistory.applyHistoryExecutionRequest(clonedRequest);
      kernelHistory.callbacks.run = async (featureId) => {
        try { await onFeatureStart?.(featureId != null ? String(featureId) : null); } catch { /* ignore */ }
      };

      let fatalError = null;
      try {
        await kernelHistory.runHistory(clonedRequest.options || {});
      } catch (error: any) {
        if (error && error.name === 'FeatureHistoryError') {
          fatalError = {
            name: error.name,
            message: error.message,
            stack: error.stack || null,
            featureId: error.featureId ?? null,
            featureType: error.featureType ?? null,
            featureIndex: error.featureIndex ?? null,
            featureLastRun: error.featureLastRun ?? null,
          };
        } else {
          throw error;
        }
      } finally {
        kernelHistory.callbacks.run = null;
      }

      const result: any = kernelHistory.buildHistoryExecutionResult();
      if (fatalError) result.fatalError = fatalError;
      return structuredClone(result);
    },
    dispose() { /* nothing to terminate */ },
  };
}

export async function test_worker_history_protocol_round_trip(partHistory) {
  const kernel = new PartHistory();
  const log: any = {};
  const progressIds: string[] = [];
  let afterRunHistoryCalls = 0;

  partHistory.setHistoryWorkerClient(makeLoopbackClient(kernel, log));
  const previousRunCallback = partHistory.callbacks.run;
  const previousAfterRunHistory = partHistory.callbacks.afterRunHistory;
  partHistory.callbacks.run = async (featureId) => { progressIds.push(String(featureId)); };
  partHistory.callbacks.afterRunHistory = async () => { afterRunHistoryCalls += 1; };

  try {
    const sketch = await partHistory.newFeature('S');
    Object.assign(sketch.inputParams, { id: 'S1', sketchPlane: null, curveResolution: 32 });
    sketch.persistentData = { sketch: makeRectangleSketch() };

    const extrude = await partHistory.newFeature('E');
    Object.assign(extrude.inputParams, {
      id: 'E2',
      profile: 'S1:PROFILE',
      consumeProfileSketch: false,
      distance: 10,
      distanceBack: 1,
      boolean: { targets: [], operation: 'NONE' },
    });

    await partHistory.runHistory({ throwOnFeatureError: true });

    // The kernel side actually executed the features...
    assert(kernel.getObjectByName('E2'), '[worker protocol] Kernel scene should contain extrude output E2.');
    assert(
      (kernel._lastRunSummary?.executedFeatureIds || []).includes('E2'),
      '[worker protocol] Kernel should report E2 as executed.',
    );

    // ...and the UI side got a faithful rehydrated copy.
    const uiSolid = partHistory.getObjectByName('E2');
    assert(uiSolid, '[worker protocol] UI scene should contain rehydrated solid E2.');
    assert(String(uiSolid.type).toUpperCase() === 'SOLID', '[worker protocol] Rehydrated E2 should be a SOLID.');
    assert(Array.isArray(uiSolid._vertProperties) && uiSolid._vertProperties.length > 0,
      '[worker protocol] Rehydrated E2 should carry authoring vertices.');
    const faceChildren = (uiSolid.children || []).filter((child) => String(child?.type).toUpperCase() === 'FACE');
    assert(faceChildren.length >= 6, `[worker protocol] Rehydrated E2 should visualize faces (got ${faceChildren.length}).`);

    const uiSketch = partHistory.getObjectByName('S1');
    assert(uiSketch, '[worker protocol] UI scene should contain rehydrated sketch group S1.');
    const profileFace = partHistory.getObjectByName('S1:PROFILE');
    assert(profileFace, '[worker protocol] UI scene should contain the sketch profile face.');

    // Feature bookkeeping came back from the worker run.
    assert(extrude.lastRun?.ok === true, '[worker protocol] E2 lastRun should be ok on the UI side.');
    assert(extrude.dirty === false, '[worker protocol] E2 should be clean after the run.');
    assert(sketch.lastRun?.ok === true, '[worker protocol] S1 lastRun should be ok on the UI side.');
    assert(Array.isArray(extrude.effects?.added) && extrude.effects.added.includes(uiSolid),
      '[worker protocol] E2 effects.added should reference the live rehydrated solid.');

    // Progress + completion callbacks fired on the UI side.
    assert(progressIds.includes('S1') && progressIds.includes('E2'),
      `[worker protocol] Progress callback should report feature ids (got: ${progressIds.join(', ')}).`);
    assert(afterRunHistoryCalls === 1, '[worker protocol] afterRunHistory should fire exactly once.');

    // Second run with an edited parameter: incremental execution in the kernel.
    extrude.inputParams.distance = 5;
    await partHistory.runHistory({ throwOnFeatureError: true });

    const executed = kernel._lastRunSummary?.executedFeatureIds || [];
    assert(executed.includes('E2'), '[worker protocol] Edited extrude should re-execute in the kernel.');
    assert(!executed.includes('S1'), '[worker protocol] Unchanged sketch should not re-execute in the kernel.');

    const uiSolid2 = partHistory.getObjectByName('E2');
    assert(uiSolid2 && uiSolid2 !== uiSolid, '[worker protocol] Rerun should produce a fresh rehydrated solid.');
    assert(partHistory.hasHistoryWorkerClient, '[worker protocol] Worker client should stay attached after successful runs.');

    console.log('✓ Worker history protocol round-trips features and scene through message passing');
    return partHistory;
  } finally {
    partHistory.setHistoryWorkerClient(null);
    if (previousRunCallback) partHistory.callbacks.run = previousRunCallback;
    else delete partHistory.callbacks.run;
    if (previousAfterRunHistory) partHistory.callbacks.afterRunHistory = previousAfterRunHistory;
    else delete partHistory.callbacks.afterRunHistory;
  }
}

export async function test_worker_history_protocol_feature_errors(partHistory) {
  const kernel = new PartHistory();
  partHistory.setHistoryWorkerClient(makeLoopbackClient(kernel));

  try {
    // A feature type the kernel cannot resolve fails deterministically.
    const broken: any = {
      type: 'TOTALLY_MISSING_FEATURE',
      inputParams: { id: 'X1' },
      persistentData: {},
    };
    partHistory.features.push(broken);

    // throwOnFeatureError: the worker failure surfaces as FeatureHistoryError
    // on the UI side and must NOT trigger the local-execution fallback.
    let thrown = null;
    try {
      await partHistory.runHistory({ throwOnFeatureError: true });
    } catch (error) {
      thrown = error;
    }
    assert(thrown, '[worker protocol errors] Expected runHistory to reject for a failing feature.');
    assert((thrown as any).name === 'FeatureHistoryError',
      `[worker protocol errors] Expected FeatureHistoryError, got ${(thrown as any).name}.`);
    assert(String((thrown as any).featureId) === 'X1',
      `[worker protocol errors] Error should identify the failing feature (got ${(thrown as any).featureId}).`);
    assert(partHistory.hasHistoryWorkerClient,
      '[worker protocol errors] Feature failures must not detach the worker client.');

    // Without throw semantics the run resolves and the error lands on lastRun.
    await partHistory.runHistory();
    assert(broken.lastRun?.ok === false, '[worker protocol errors] X1 lastRun should record the failure.');
    assert(broken.lastRun?.error?.message, '[worker protocol errors] X1 lastRun should carry the error message.');

    // Drop the intentionally broken feature so the harness's post-test rerun
    // (throwOnFeatureError) sees a clean history.
    partHistory.features = [];

    console.log('✓ Worker history protocol propagates feature errors faithfully');
    return partHistory;
  } finally {
    partHistory.setHistoryWorkerClient(null);
  }
}
