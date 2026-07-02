import type { CamMachineProfile } from './CamMachineProfile.js';
import type { CamToolpathProgressEvent, CamToolpathResult } from './camToolpath.js';

export type CamToolpathWorkerOperation = {
  id?: string;
  name?: string;
  params: Record<string, any>;
};

export type CamToolpathWorkerJob = {
  machineProfile: CamMachineProfile;
  operations: CamToolpathWorkerOperation[];
};

export type CamToolpathWorkerResult = {
  operations: CamToolpathResult[];
  combined: CamToolpathResult;
};

export type CamToolpathWorkerOptions = {
  onProgress?: (event: CamToolpathProgressEvent) => void;
  progressYield?: () => Promise<void> | void;
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
    const cleanup = () => {
      try { worker?.terminate?.(); } catch { /* ignore worker shutdown failures */ }
    };

    try {
      worker = new Worker(new URL('./camToolpathWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }

    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'progress') {
        try { options.onProgress?.(data.event || {}); } catch { /* progress observers should not stop generation */ }
        void Promise.resolve(options.progressYield?.()).catch(() => undefined);
        return;
      }
      if (data.type === 'result') {
        cleanup();
        resolve(data.result);
        return;
      }
      if (data.type === 'error') {
        cleanup();
        const error = new Error(data.message || 'CAM worker failed');
        if (data.stack) {
          try { error.stack = data.stack; } catch { /* ignore stack assignment failures */ }
        }
        reject(error);
      }
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(String(event?.message || 'CAM worker failed')));
    };

    worker.postMessage({ type: 'generate-all', job });
  });
}
