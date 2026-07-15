// featureHistoryWorkerClient.ts
// Main-thread transport for the feature-history execution worker. Owns the
// Worker instance, correlates request/response messages, and surfaces
// per-feature progress callbacks. All payloads are plain structured-clone
// data; PartHistory builds and applies them.

type AnyRecord = Record<string, any>;

type PendingEntry = {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  onFeatureStart?: (featureId: string | null) => void;
};

const INIT_TIMEOUT_MS = 120000;

export class WorkerExecutionError extends Error {
  code: string;
  featureTypes?: string[];

  constructor(message: string, code = 'worker-error', extra: AnyRecord = {}) {
    super(message);
    this.name = 'WorkerExecutionError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export class FeatureHistoryWorkerClient {
  _worker: Worker | null;
  _pending: Map<number, PendingEntry>;
  _nextId: number;
  _readyPromise: Promise<void> | null;
  _disposed: boolean;

  static isSupported(): boolean {
    return typeof Worker !== 'undefined';
  }

  constructor() {
    this._worker = null;
    this._pending = new Map();
    this._nextId = 1;
    this._readyPromise = null;
    this._disposed = false;
  }

  // Create the worker eagerly so the kernel WASM warms up during page load.
  start() {
    if (this._worker || this._disposed) return;
    const worker = new Worker(new URL('./featureHistoryWorker.ts', import.meta.url), {
      type: 'module',
      name: 'brep-feature-history',
    });
    this._worker = worker;

    this._readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new WorkerExecutionError('History worker did not become ready in time', 'worker-init-timeout'));
      }, INIT_TIMEOUT_MS);

      const onReady = () => { clearTimeout(timeout); resolve(); };
      const onInitError = (error: AnyRecord) => {
        clearTimeout(timeout);
        reject(new WorkerExecutionError(error?.message || 'History worker failed to initialize', error?.code || 'worker-init-failed'));
      };
      (this as AnyRecord)._resolveReady = onReady;
      (this as AnyRecord)._rejectReady = onInitError;
    });
    // Avoid unhandled rejection noise if nothing ever awaits readiness.
    this._readyPromise.catch(() => { });

    worker.onmessage = (event: MessageEvent) => this.#handleMessage(event);
    worker.onerror = (event: ErrorEvent) => {
      const error = new WorkerExecutionError(event?.message || 'History worker crashed', 'worker-crashed');
      try { (this as AnyRecord)._rejectReady?.(error); } catch { /* ignore */ }
      this.#rejectAllPending(error);
    };
    worker.onmessageerror = () => {
      this.#rejectAllPending(new WorkerExecutionError('History worker message could not be deserialized', 'worker-message-error'));
    };
  }

  #handleMessage(event: MessageEvent) {
    const data: AnyRecord = event?.data;
    if (!data || typeof data !== 'object') return;

    if (data.kind === 'ready') {
      try { (this as AnyRecord)._resolveReady?.(); } catch { /* ignore */ }
      return;
    }
    if (data.kind === 'init-error') {
      try { (this as AnyRecord)._rejectReady?.(data.error || {}); } catch { /* ignore */ }
      return;
    }

    const id = Number(data.id);
    if (!Number.isFinite(id)) return;
    const pending = this._pending.get(id);
    if (!pending) return;

    if (data.kind === 'progress') {
      try { pending.onFeatureStart?.(data.featureId != null ? String(data.featureId) : null); } catch { /* ignore */ }
      return;
    }

    if (data.kind === 'result') {
      this._pending.delete(id);
      if (data.ok) {
        pending.resolve(data.result || {});
      } else {
        const error = data.error || {};
        pending.reject(new WorkerExecutionError(
          error.message || 'History worker reported an error',
          error.code || 'worker-error',
          { featureTypes: error.featureTypes },
        ));
      }
    }
  }

  #rejectAllPending(error: any) {
    const pending = [...this._pending.values()];
    this._pending.clear();
    for (const entry of pending) {
      try { entry.reject(error); } catch { /* ignore */ }
    }
  }

  async runHistory(request: AnyRecord, { onFeatureStart }: { onFeatureStart?: (featureId: string | null) => void } = {}): Promise<AnyRecord> {
    if (this._disposed) throw new WorkerExecutionError('History worker client is disposed', 'worker-disposed');
    this.start();
    await this._readyPromise;
    const worker = this._worker;
    if (!worker) throw new WorkerExecutionError('History worker is not available', 'worker-unavailable');

    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, onFeatureStart });
      try {
        worker.postMessage({ id, kind: 'run', request });
      } catch (error: any) {
        this._pending.delete(id);
        reject(new WorkerExecutionError(
          `Failed to send history run request to worker: ${error?.message || error}`,
          'worker-post-failed',
        ));
      }
    });
  }

  dispose() {
    this._disposed = true;
    this.#rejectAllPending(new WorkerExecutionError('History worker client disposed', 'worker-disposed'));
    try { this._worker?.terminate(); } catch { /* ignore */ }
    this._worker = null;
  }
}
