// featureHistoryWorker.ts
// Dedicated worker that hosts a headless PartHistory (full BREP kernel,
// including the manifold WASM) and executes feature history on behalf of the
// UI thread. The UI talks to it exclusively through structured-clone message
// passing:
//
//   UI -> worker:  { id, kind: 'run', request }   (see buildHistoryExecutionRequest)
//   worker -> UI:  { kind: 'ready' } | { kind: 'init-error', error }
//                  { id, kind: 'progress', featureId }
//                  { id, kind: 'result', ok, result | error }
//
// The kernel is loaded via dynamic import so the message handler is installed
// synchronously (no messages are lost while the WASM boots) and so load
// failures can be reported back instead of silently killing the worker.

type AnyRecord = Record<string, any>;

const scope: any = self;

function post(message: AnyRecord, transfer?: Transferable[]) {
  try {
    if (transfer && transfer.length) scope.postMessage(message, transfer);
    else scope.postMessage(message);
  } catch (error) {
    // Fall back to a plain copy if a transferable was rejected.
    try { scope.postMessage(message); } catch {
      scope.postMessage({
        id: message?.id,
        kind: 'result',
        ok: false,
        error: {
          code: 'worker-post-failed',
          message: `Failed to post worker result: ${(error as any)?.message || error}`,
        },
      });
    }
  }
}

function describeError(error: any, code = 'worker-run-failed'): AnyRecord {
  return {
    code,
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || null,
  };
}

const initPromise = (async () => {
  const [{ PartHistory }, codec] = await Promise.all([
    import('../PartHistory.js'),
    import('./historySceneCodec.js'),
  ]);
  return { partHistory: new PartHistory(), codec };
})();

initPromise
  .then(() => post({ kind: 'ready' }))
  .catch((error) => post({ kind: 'init-error', error: describeError(error, 'worker-init-failed') }));

let queue: Promise<void> = Promise.resolve();

async function handleRun(id: any, request: AnyRecord) {
  const { partHistory, codec } = await initPromise;

  // Plugin-provided feature types only exist on the UI thread; report them so
  // the caller can run that history locally instead.
  const missingTypes = new Set<string>();
  for (const feature of Array.isArray(request?.features) ? request.features : []) {
    const type = feature?.type;
    if (type == null) continue;
    let FeatureClass = null;
    try { FeatureClass = partHistory.featureRegistry?.getSafe?.(type) || null; } catch { FeatureClass = null; }
    if (!FeatureClass) missingTypes.add(String(type));
  }
  if (missingTypes.size) {
    post({
      id,
      kind: 'result',
      ok: false,
      error: {
        code: 'unsupported-feature-types',
        message: `Feature types not available in history worker: ${[...missingTypes].join(', ')}`,
        featureTypes: [...missingTypes],
      },
    });
    return;
  }

  await partHistory.applyHistoryExecutionRequest(request);

  partHistory.callbacks.run = (featureId: any) => {
    post({ id, kind: 'progress', featureId: featureId != null ? String(featureId) : null });
  };

  let fatalError: AnyRecord | null = null;
  try {
    await partHistory.runHistory(request?.options || {});
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
    partHistory.callbacks.run = null;
  }

  const result: AnyRecord = partHistory.buildHistoryExecutionResult();
  if (fatalError) result.fatalError = fatalError;

  const transfer = codec.collectTransferables([result]);
  post({ id, kind: 'result', ok: true, result }, transfer);
}

scope.onmessage = (event: MessageEvent) => {
  const data = event?.data;
  if (!data || typeof data !== 'object') return;
  const { id, kind } = data as AnyRecord;

  if (kind === 'ping') {
    initPromise
      .then(() => post({ id, kind: 'result', ok: true, result: { ready: true } }))
      .catch((error) => post({ id, kind: 'result', ok: false, error: describeError(error, 'worker-init-failed') }));
    return;
  }

  if (kind === 'run') {
    // Serialize runs; PartHistory also queues internally, but keeping one
    // in-flight request per message id keeps progress attribution simple.
    queue = queue
      .catch(() => { /* previous run already reported its error */ })
      .then(() => handleRun(id, (data as AnyRecord).request || {}))
      .catch((error) => {
        post({ id, kind: 'result', ok: false, error: describeError(error) });
      });
  }
};
