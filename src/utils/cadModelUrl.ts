export type CadModelUrlOptions = {
  source?: unknown;
  path?: unknown;
  modelPath?: unknown;
  repoFull?: unknown;
  mountId?: unknown;
  branch?: unknown;
};

export function normalizeCadModelPath(input: unknown): string {
  const raw = String(input || '').replace(/\\/g, '/');
  const out: string[] = [];
  for (const part of raw.split('/')) {
    const token = String(part || '').trim();
    if (!token || token === '.' || token === '..') continue;
    out.push(token);
  }
  return out.join('/');
}

export function normalizeCadStorageSource(input: unknown): 'local' | 'github' | 'mounted' {
  const source = String(input || '').trim().toLowerCase();
  if (source === 'github') return 'github';
  if (source === 'mounted') return 'mounted';
  return 'local';
}

export function encodeCadPathForUrl(value: unknown): string {
  return normalizeCadModelPath(value)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function encodeCadRefForUrl(ref: unknown): string {
  return String(ref || '')
    .trim()
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function buildCadModelPathParam(options: CadModelUrlOptions = {}): string {
  const source = normalizeCadStorageSource(options?.source);
  const modelPath = normalizeCadModelPath(options?.path ?? options?.modelPath ?? '');
  if (!modelPath) return '';

  if (source === 'github') {
    const repoPath = encodeCadRefForUrl(options?.repoFull || '');
    const modelUrlPath = encodeCadPathForUrl(modelPath);
    return repoPath ? `github/${repoPath}/${modelUrlPath}` : `github/${modelUrlPath}`;
  }

  if (source === 'mounted') {
    const mountId = encodeCadRefForUrl(options?.repoFull || options?.mountId || '');
    const modelUrlPath = encodeCadPathForUrl(modelPath);
    return mountId ? `mounted/${mountId}/${modelUrlPath}` : `mounted/${modelUrlPath}`;
  }

  return modelPath;
}

export function buildCadModelUrl(options: CadModelUrlOptions = {}, baseHref?: string | URL): URL | null {
  const base = baseHref || (typeof window !== 'undefined' ? window.location.href : '');
  if (!base) return null;

  const url = new URL('cad.html', base);
  const pathParam = buildCadModelPathParam(options);
  if (pathParam) url.searchParams.set('path', pathParam);
  const branch = String(options?.branch || '').trim();
  if (branch) url.searchParams.set('branch', branch);
  return url;
}

export function replaceCurrentCadModelUrl(options: CadModelUrlOptions = {}): boolean {
  try {
    if (typeof window === 'undefined' || !window.history?.replaceState) return false;
    const url = buildCadModelUrl(options, window.location.href);
    if (!url) return false;
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, '', url);
    }
    return true;
  } catch {
    return false;
  }
}
