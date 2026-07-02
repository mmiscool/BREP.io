import type { CamToolpathProgressEvent, CamToolpathResult } from './camToolpath.js';
import { combineCamToolpathResults, generateThreeAxisToolpathAsync } from './camToolpath.js';
import type { CamToolpathWorkerJob } from './camToolpathWorkerClient.js';

const workerScope: any = self;

function postProgress(event: CamToolpathProgressEvent) {
  workerScope.postMessage({ type: 'progress', event });
}

function workerYield() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function operationNameFor(params: Record<string, any>, index: number) {
  return String(params?.name || params?.id || `Operation ${index + 1}`);
}

workerScope.onmessage = (event) => {
  void (async () => {
    const data = event.data || {};
    if (data.type !== 'generate-all') return;

    try {
      const job = (data.job || {}) as CamToolpathWorkerJob;
      const operations = Array.isArray(job.operations) ? job.operations : [];
      const results: CamToolpathResult[] = [];
      const operationCount = Math.max(1, operations.length);
      const operationSpan = operations.length ? 84 / operationCount : 0;

      postProgress({
        phase: 'worker-start',
        message: 'Starting CAM worker',
        detail: `${operations.length} operation${operations.length === 1 ? '' : 's'} queued.`,
        current: 3,
        total: 100,
      });
      await workerYield();

      for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        const operationParams: Record<string, any> = operation.params || {};
        const params: Record<string, any> = {
          ...operationParams,
          machineProfile: job.machineProfile || operationParams.machineProfile,
        };
        const operationName = operationNameFor(params, index);

        postProgress({
          phase: 'worker-operation',
          message: 'Generating CAM operation',
          detail: `${operationName} (${index + 1} of ${operations.length})`,
          current: 4 + index * operationSpan,
          total: 100,
          operationId: String(params.id || operation.id || ''),
          operationName,
          operationIndex: index + 1,
          operationCount: operations.length,
        });
        await workerYield();

        const result = await generateThreeAxisToolpathAsync(null, {
          ...params,
          onProgress: (progress: CamToolpathProgressEvent) => {
            const localTotal = Math.max(1, Number(progress.total) || 100);
            const localCurrent = Math.max(0, Math.min(localTotal, Number(progress.current) || 0));
            postProgress({
              ...progress,
              current: 4 + index * operationSpan + (localCurrent / localTotal) * operationSpan,
              total: 100,
              operationId: String(params.id || progress.operationId || operation.id || ''),
              operationName,
              operationIndex: index + 1,
              operationCount: operations.length,
            });
          },
          progressYield: workerYield,
        });
        results.push(result);
      }

      postProgress({
        phase: 'combine',
        message: 'Combining generated operations',
        detail: 'Building final program motion and G-code.',
        current: 90,
        total: 100,
      });
      await workerYield();

      const combined = combineCamToolpathResults(results, { machineProfile: job.machineProfile });
      postProgress({
        phase: 'complete',
        message: 'CAM generation complete',
        detail: `${combined.summary.pathCount} path${combined.summary.pathCount === 1 ? '' : 's'} generated.`,
        current: 100,
        total: 100,
      });

      workerScope.postMessage({
        type: 'result',
        result: {
          operations: results,
          combined,
        },
      });
    } catch (error) {
      workerScope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : '',
      });
    }
  })();
};

export {};
