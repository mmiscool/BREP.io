import type { CamMachineProfile } from './CamMachineProfile.js';
import type { CamStockProfile } from './CamStockProfile.js';
import type { CamToolpathProgressEvent, CamToolpathResult } from './camToolpath.js';

export type CamToolpathWorkerOperation = {
  id?: string;
  name?: string;
  params: Record<string, any>;
};

export type CamToolpathWorkerJob = {
  machineProfile: CamMachineProfile;
  stockProfile?: CamStockProfile;
  operations: CamToolpathWorkerOperation[];
};

export type CamToolpathWorkerResult = {
  operations: CamToolpathResult[];
  combined: CamToolpathResult;
};

export type CamToolpathWorkerOptions = {
  onProgress?: (event: CamToolpathProgressEvent) => void;
  progressYield?: () => Promise<void> | void;
  signal?: AbortSignal;
};

export function canRunCamToolpathWorker() {
  return typeof Worker === 'function' && typeof URL !== 'undefined';
}

export function runCamToolpathWorker(
  job: CamToolpathWorkerJob,
  options: CamToolpathWorkerOptions = {},
): Promise<CamToolpathWorkerResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    let settled = false;
    let progressChain: Promise<void> = Promise.resolve();
    const abortError = () => {
      const reason = options.signal?.reason;
      const error = new Error(String(reason?.message || reason || 'CAM generation canceled'));
      error.name = 'AbortError';
      return error;
    };
    const cleanup = () => {
      if (options.signal) {
        try { options.signal.removeEventListener('abort', onAbort); } catch { /* ignore abort listener cleanup */ }
      }
      try { worker?.terminate?.(); } catch { /* ignore worker shutdown failures */ }
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const settleResolve = (result: CamToolpathWorkerResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAbort = () => settleReject(abortError());
    const yieldError = (error: any) => {
      if (options.signal?.aborted) return abortError();
      if (error instanceof Error) return error;
      return new Error(String(error || 'CAM worker progress yield failed'));
    };
    const queueProgressYield = () => {
      if (typeof options.progressYield !== 'function') return;
      progressChain = progressChain
        .then(async () => {
          if (settled) return;
          await options.progressYield?.();
          if (options.signal?.aborted) throw abortError();
        })
        .catch((error) => {
          settleReject(yieldError(error));
        });
    };
    const settleAfterProgressYield = (result: CamToolpathWorkerResult) => {
      void progressChain.then(() => {
        if (settled) return;
        if (options.signal?.aborted) {
          settleReject(abortError());
          return;
        }
        settleResolve(result);
      });
    };

    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }

    try {
      worker = new Worker(new URL('./camToolpathWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    if (options.signal) {
      try { options.signal.addEventListener('abort', onAbort, { once: true }); } catch { /* ignore abort listener setup */ }
    }

    worker.onmessage = (event) => {
      const data = event.data || {};
      if (settled) return;
      if (data.type === 'progress') {
        try { options.onProgress?.(data.event || {}); } catch { /* progress observers should not stop generation */ }
        queueProgressYield();
        return;
      }
      if (data.type === 'result') {
        settleAfterProgressYield(data.result);
        return;
      }
      if (data.type === 'error') {
        const error = new Error(data.message || 'CAM worker failed');
        if (data.stack) {
          try { error.stack = data.stack; } catch { /* ignore stack assignment failures */ }
        }
        settleReject(error);
      }
    };

    worker.onerror = (event) => {
      settleReject(new Error(String(event?.message || 'CAM worker failed')));
    };

    try {
      worker.postMessage({ type: 'generate-all', job });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      settleReject(new Error(`CAM worker serialization failed: ${message}`));
    }
  });
}
