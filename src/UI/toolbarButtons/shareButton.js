import { FloatingWindow } from '../FloatingWindow.js';
import { getGithubStorageConfig } from '../../idbStorage.js';

const PANEL_KEY = Symbol('ShareModelPanel');
const GITHUB_HOST = 'github.com';
const GITHUB_RAW_HOST = 'raw.githubusercontent.com';
const GITHUB_API_BASE = 'https://api.github.com';
const SHARE_MODE_CAD = 'cad';
const SHARE_MODE_VIEWER = 'viewer';
const SHARE_PAGE_CAD = 'cad.html';
const SHARE_PAGE_VIEWER = 'viewer.html';

function ensureSharePanelStyles() {
  if (document.getElementById('share-model-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'share-model-panel-styles';
  style.textContent = `
    .share-model-panel .share-btn {
      appearance: none;
      background: #1f2937;
      color: #f9fafb;
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font: 700 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      line-height: 1.1;
      transition: background .12s ease, border-color .12s ease, transform .05s ease, color .12s ease;
    }
    .share-model-panel .share-btn:hover {
      background: #2b3545;
      border-color: #4b5563;
    }
    .share-model-panel .share-btn:active {
      transform: translateY(1px);
    }
    .share-model-panel .share-btn:disabled {
      opacity: .45;
      cursor: not-allowed;
      transform: none;
    }
    .share-model-panel .share-mode-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #0b1220;
      border: 1px solid #303846;
      border-radius: 10px;
      padding: 3px;
    }
    .share-model-panel .share-mode-btn {
      min-width: 78px;
      padding: 6px 10px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: #aeb6c5;
    }
    .share-model-panel .share-mode-btn:hover {
      background: rgba(255,255,255,.08);
      border-color: transparent;
      color: #f3f4f6;
    }
    .share-model-panel .share-mode-btn.is-active {
      color: #e9f0ff;
      background: linear-gradient(180deg, rgba(110,168,254,.3), rgba(110,168,254,.16));
      box-shadow: 0 0 0 1px rgba(110,168,254,.3) inset;
    }
  `;
  document.head.appendChild(style);
}

function normalizeModelPath(input) {
  const raw = String(input || '').replace(/\\/g, '/');
  const out = [];
  for (const part of raw.split('/')) {
    const token = String(part || '').trim();
    if (!token || token === '.' || token === '..') continue;
    out.push(token);
  }
  return out.join('/');
}

function ensureModelPathWithExtension(input) {
  const modelPath = normalizeModelPath(input);
  if (!modelPath) return '';
  if (modelPath.toLowerCase().endsWith('.3mf')) return modelPath;
  return `${modelPath}.3mf`;
}

function decodePathPart(part) {
  const token = String(part || '');
  if (!token) return '';
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function encodePathPart(part) {
  const token = String(part || '');
  if (!token) return '';
  try {
    return encodeURIComponent(decodeURIComponent(token));
  } catch {
    return encodeURIComponent(token);
  }
}

function parseRepoFull(repoFull) {
  const parts = String(repoFull || '').trim().split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return {
    owner: String(parts[0] || '').trim(),
    repo: String(parts[1] || '').trim(),
  };
}

function parseGithubTarget(input) {
  const rawTarget = String(input || '').trim();
  if (!rawTarget) return null;

  const withScheme = /^[a-z]+:\/\//i.test(rawTarget) ? rawTarget : `https://${rawTarget}`;
  let parsed = null;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const host = String(parsed.hostname || '').trim().toLowerCase();
  const parts = String(parsed.pathname || '').split('/').filter(Boolean);

  let owner = '';
  let repo = '';
  let branch = '';
  let fileSegments = [];

  if (host === GITHUB_RAW_HOST) {
    if (parts.length < 4) return null;
    owner = decodePathPart(parts[0]);
    repo = decodePathPart(parts[1]);
    branch = decodePathPart(parts[2]);
    fileSegments = parts.slice(3);
  } else if (host === GITHUB_HOST || host === `www.${GITHUB_HOST}`) {
    if (parts.length < 4) return null;
    owner = decodePathPart(parts[0]);
    repo = decodePathPart(parts[1]);
    const mode = String(parts[2] || '').trim().toLowerCase();
    if (mode === 'blob' || mode === 'raw') {
      if (parts.length < 5) return null;
      branch = decodePathPart(parts[3]);
      fileSegments = parts.slice(4);
    } else {
      branch = decodePathPart(parts[2]);
      fileSegments = parts.slice(3);
    }
  } else {
    return null;
  }

  if (!owner || !repo || !branch || !fileSegments.length) return null;
  const modelPath = ensureModelPathWithExtension(
    fileSegments.map(decodePathPart).join('/'),
  );
  if (!modelPath || !modelPath.toLowerCase().endsWith('.3mf')) return null;

  return {
    owner,
    repo,
    branch,
    modelPath,
  };
}

function buildGithubTargetValue({ owner, repo, branch, modelPath }) {
  const pathSegments = normalizeModelPath(modelPath).split('/').filter(Boolean);
  if (!owner || !repo || !branch || !pathSegments.length) return '';
  return [
    GITHUB_HOST,
    encodePathPart(owner),
    encodePathPart(repo),
    encodePathPart(branch),
    ...pathSegments.map(encodePathPart),
  ].join('/');
}

function parseBooleanParam(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeShareMode(value) {
  return String(value || '').trim().toLowerCase() === SHARE_MODE_VIEWER
    ? SHARE_MODE_VIEWER
    : SHARE_MODE_CAD;
}

function resolveSharePageForMode(mode) {
  return normalizeShareMode(mode) === SHARE_MODE_VIEWER
    ? SHARE_PAGE_VIEWER
    : SHARE_PAGE_CAD;
}

function detectDefaultShareMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    const mode = String(params.get('mode') || '').trim().toLowerCase();
    if (mode === 'viewer' || mode === 'readonly') return SHARE_MODE_VIEWER;
    if (
      parseBooleanParam(params.get('viewerOnly'))
      || parseBooleanParam(params.get('viewer'))
      || parseBooleanParam(params.get('readonly'))
    ) return SHARE_MODE_VIEWER;
    const pathName = String(window.location.pathname || '').trim().toLowerCase();
    return pathName.endsWith(`/${SHARE_PAGE_VIEWER}`) || pathName === `/${SHARE_PAGE_VIEWER}`
      ? SHARE_MODE_VIEWER
      : SHARE_MODE_CAD;
  } catch {
    return SHARE_MODE_CAD;
  }
}

function buildShareUrl(githubTargetValue, { mode = SHARE_MODE_CAD } = {}) {
  const url = new URL(window.location.href);
  const pageName = resolveSharePageForMode(mode);
  const rawPath = String(url.pathname || '');
  if (!rawPath || rawPath.endsWith('/')) {
    url.pathname = `${rawPath}${pageName}`;
  } else {
    const segments = rawPath.split('/');
    const last = String(segments[segments.length - 1] || '').trim();
    if (!last || !last.includes('.')) segments.push(pageName);
    else segments[segments.length - 1] = pageName;
    url.pathname = segments.join('/');
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set('githubTarget', String(githubTargetValue || '').trim());
  return url.toString();
}

function escapeHtmlAttribute(input) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildIframeMarkup(shareUrl) {
  const src = escapeHtmlAttribute(shareUrl);
  return `<iframe src="${src}" width="100%" height="640" style="border:0;" loading="lazy" allow="fullscreen; clipboard-read; clipboard-write" allowfullscreen></iframe>`;
}

function getUrlGithubTargetParam() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('githubTarget') || '').trim();
}

function resolveCurrentShareTarget(viewer) {
  const fm = viewer?.fileManagerWidget;
  const source = String(fm?.currentSource || '').trim().toLowerCase();
  if (source === 'github') {
    const repoFull = String(fm?.currentRepoFull || '').trim();
    const modelPath = ensureModelPathWithExtension(fm?.currentName || '');
    const branch = String(fm?.currentBranch || '').trim();
    const repo = parseRepoFull(repoFull);
    if (repo && modelPath) {
      return {
        owner: repo.owner,
        repo: repo.repo,
        branch,
        modelPath,
      };
    }
  }

  const fromUrl = parseGithubTarget(getUrlGithubTargetParam());
  if (fromUrl) return fromUrl;
  return null;
}

async function fetchRepoMetadata(owner, repo, token = '') {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${encodePathPart(owner)}/${encodePathPart(repo)}`, {
    headers: token
      ? {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        }
      : {
          Accept: 'application/vnd.github+json',
        },
    cache: 'no-store',
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

async function fetchRepoFileMetadata(owner, repo, branch, modelPath, token = '') {
  const cleanPath = normalizeModelPath(modelPath);
  if (!cleanPath) return { ok: false, status: 400, data: null };
  const encodedPath = cleanPath.split('/').filter(Boolean).map(encodePathPart).join('/');
  const url = new URL(`${GITHUB_API_BASE}/repos/${encodePathPart(owner)}/${encodePathPart(repo)}/contents/${encodedPath}`);
  if (branch) url.searchParams.set('ref', branch);
  const response = await fetch(url.toString(), {
    headers: token
      ? {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        }
      : {
          Accept: 'application/vnd.github+json',
        },
    cache: 'no-store',
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

async function checkPublicRepo(owner, repo) {
  const repoFull = `${owner}/${repo}`;
  const token = String(getGithubStorageConfig()?.token || '').trim();

  let meta = null;
  try {
    meta = await fetchRepoMetadata(owner, repo, '');
  } catch (err) {
    return {
      ok: false,
      message: `Unable to verify repository "${repoFull}". ${err?.message || err || ''}`.trim(),
      defaultBranch: '',
    };
  }

  if (!meta.ok && token && (meta.status === 403 || meta.status === 404 || meta.status === 429)) {
    try {
      const authedMeta = await fetchRepoMetadata(owner, repo, token);
      if (authedMeta.ok || authedMeta.status !== 401) {
        meta = authedMeta;
      }
    } catch {
      // Keep the original unauthenticated result.
    }
  }

  if (meta.ok) {
    const isPrivate = !!meta?.data?.private;
    return {
      ok: !isPrivate,
      message: isPrivate
        ? `Repository "${repoFull}" is private and cannot be shared publicly.`
        : '',
      defaultBranch: String(meta?.data?.default_branch || '').trim(),
    };
  }

  if (meta.status === 404) {
    return {
      ok: false,
      message: `Repository "${repoFull}" is not publicly accessible.`,
      defaultBranch: '',
    };
  }

  return {
    ok: false,
    message: `Unable to verify repository "${repoFull}" visibility (HTTP ${meta.status || 'error'}).`,
    defaultBranch: '',
  };
}

async function checkPublicFile(owner, repo, branch, modelPath) {
  const repoFull = `${owner}/${repo}`;
  const filePath = normalizeModelPath(modelPath);
  if (!filePath) {
    return {
      ok: false,
      message: 'Current model path is invalid for sharing.',
    };
  }
  const token = String(getGithubStorageConfig()?.token || '').trim();

  let meta = null;
  try {
    meta = await fetchRepoFileMetadata(owner, repo, branch, filePath, '');
  } catch (err) {
    return {
      ok: false,
      message: `Unable to verify shared file path. ${err?.message || err || ''}`.trim(),
    };
  }

  if (!meta.ok && token && (meta.status === 403 || meta.status === 404 || meta.status === 429)) {
    try {
      const authedMeta = await fetchRepoFileMetadata(owner, repo, branch, filePath, token);
      if (authedMeta.ok || authedMeta.status !== 401) {
        meta = authedMeta;
      }
    } catch {
      // Keep the original unauthenticated result.
    }
  }

  if (meta.ok) {
    const fileType = String(meta?.data?.type || '').trim().toLowerCase();
    if (fileType && fileType !== 'file') {
      return {
        ok: false,
        message: `Path "${filePath}" in "${repoFull}@${branch}" is not a file.`,
      };
    }
    return { ok: true, message: '' };
  }

  if (meta.status === 404) {
    return {
      ok: false,
      message: `File "${filePath}" was not found in "${repoFull}" on branch "${branch}".`,
    };
  }

  return {
    ok: false,
    message: `Unable to verify file "${filePath}" in "${repoFull}@${branch}" (HTTP ${meta.status || 'error'}).`,
  };
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Continue to fallback.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return !!ok;
  } catch {
    return false;
  }
}

class ShareModelPanel {
  constructor(viewer) {
    this.viewer = viewer;
    this.window = null;
    this.root = null;
    this.statusEl = null;
    this.linkEl = null;
    this.iframeEl = null;
    this.copyLinkBtn = null;
    this.copyIframeBtn = null;
    this.openLinkBtn = null;
    this.refreshBtn = null;
    this.modeCadBtn = null;
    this.modeViewerBtn = null;
    this.shareUrl = '';
    this.iframeHtml = '';
    this.shareMode = detectDefaultShareMode();
    this._lastGithubTarget = '';
  }

  toggle() {
    if (this.root && this.root.style.display !== 'none') this.close();
    else this.open();
  }

  open() {
    this._ensureWindow();
    if (!this.root) return;
    this.root.style.display = 'flex';
    void this.refresh();
  }

  close() {
    if (!this.root) return;
    try { this.root.style.display = 'none'; } catch {}
  }

  async refresh() {
    this._setBusy(true);
    this._setStatus('Checking current file shareability...', 'info');
    this._lastGithubTarget = '';
    this._setValues('', '');

    try {
      const target = resolveCurrentShareTarget(this.viewer);
      if (!target) {
        this._setStatus(
          'Current file is not linked to a GitHub file. Save/load the model from a public GitHub repo first.',
          'warn',
        );
        return;
      }

      const visibility = await checkPublicRepo(target.owner, target.repo);
      if (!visibility.ok) {
        this._setStatus(visibility.message || 'This file is not in a public repository.', 'warn');
        return;
      }

      const branch = String(target.branch || visibility.defaultBranch || '').trim();
      if (!branch) {
        this._setStatus(
          `Could not determine branch for "${target.owner}/${target.repo}". Save or load the model with a branch selected.`,
          'warn',
        );
        return;
      }

      const fileStatus = await checkPublicFile(target.owner, target.repo, branch, target.modelPath);
      if (!fileStatus.ok) {
        this._setStatus(fileStatus.message || 'This file cannot be publicly shared.', 'warn');
        return;
      }

      const githubTarget = buildGithubTargetValue({
        owner: target.owner,
        repo: target.repo,
        branch,
        modelPath: target.modelPath,
      });
      if (!githubTarget) {
        this._setStatus('Could not construct share link for this model.', 'warn');
        return;
      }

      this._lastGithubTarget = githubTarget;
      this._rebuildShareOutputs();
      this._setStatus('Share link is ready.', 'ok');
    } catch (err) {
      this._setStatus(`Failed to build share link: ${err?.message || err || 'Unknown error.'}`, 'error');
    } finally {
      this._setBusy(false);
    }
  }

  _setValues(shareUrl, iframeHtml) {
    this.shareUrl = String(shareUrl || '');
    this.iframeHtml = String(iframeHtml || '');
    if (this.linkEl) this.linkEl.value = this.shareUrl;
    if (this.iframeEl) this.iframeEl.value = this.iframeHtml;
    const hasLink = !!this.shareUrl;
    const hasIframe = !!this.iframeHtml;
    if (this.copyLinkBtn) this.copyLinkBtn.disabled = !hasLink;
    if (this.openLinkBtn) this.openLinkBtn.disabled = !hasLink;
    if (this.copyIframeBtn) this.copyIframeBtn.disabled = !hasIframe;
  }

  _setBusy(isBusy) {
    const busy = !!isBusy;
    if (this.refreshBtn) this.refreshBtn.disabled = busy;
    if (this.copyLinkBtn) this.copyLinkBtn.disabled = busy || !this.shareUrl;
    if (this.copyIframeBtn) this.copyIframeBtn.disabled = busy || !this.iframeHtml;
    if (this.openLinkBtn) this.openLinkBtn.disabled = busy || !this.shareUrl;
    if (this.modeCadBtn) this.modeCadBtn.disabled = busy;
    if (this.modeViewerBtn) this.modeViewerBtn.disabled = busy;
  }

  _rebuildShareOutputs() {
    const githubTarget = String(this._lastGithubTarget || '').trim();
    if (!githubTarget) {
      this._setValues('', '');
      return;
    }
    const shareUrl = buildShareUrl(githubTarget, { mode: this.shareMode });
    const iframeHtml = buildIframeMarkup(shareUrl);
    this._setValues(shareUrl, iframeHtml);
  }

  _setShareMode(mode) {
    const next = normalizeShareMode(mode);
    if (this.shareMode === next) return;
    this.shareMode = next;
    this._syncShareModeUi();
    this._rebuildShareOutputs();
  }

  _syncShareModeUi() {
    const applyActive = (button, active) => {
      if (!button) return;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('is-active', !!active);
    };
    applyActive(this.modeCadBtn, this.shareMode === SHARE_MODE_CAD);
    applyActive(this.modeViewerBtn, this.shareMode === SHARE_MODE_VIEWER);
  }

  _setStatus(message, tone = 'info') {
    if (!this.statusEl) return;
    this.statusEl.textContent = String(message || '');
    this.statusEl.dataset.tone = String(tone || 'info');
    if (tone === 'ok') this.statusEl.style.color = '#86efac';
    else if (tone === 'warn') this.statusEl.style.color = '#fcd34d';
    else if (tone === 'error') this.statusEl.style.color = '#fca5a5';
    else this.statusEl.style.color = '#9ca3af';
  }

  _ensureWindow() {
    if (this.root) return;
    ensureSharePanelStyles();
    const fw = new FloatingWindow({
      title: 'Share Model',
      width: 760,
      height: 420,
      right: 16,
      top: 56,
      shaded: false,
      onClose: () => this.close(),
    });

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'fw-btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('click', () => { void this.refresh(); });
    fw.addHeaderAction(refreshBtn);

    const content = document.createElement('div');
    content.className = 'share-model-panel';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '10px';
    content.style.width = '100%';
    content.style.height = '100%';
    content.style.boxSizing = 'border-box';
    content.style.minHeight = '0';

    const intro = document.createElement('div');
    intro.textContent = 'Share the currently open model from a public GitHub repository.';
    intro.style.color = '#aeb6c5';
    intro.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    intro.style.opacity = '0.92';
    content.appendChild(intro);

    const status = document.createElement('div');
    status.textContent = 'Checking current file...';
    status.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    status.style.color = '#9ca3af';
    status.style.minHeight = '16px';
    status.dataset.tone = 'info';
    content.appendChild(status);

    const modeSection = document.createElement('section');
    modeSection.style.display = 'flex';
    modeSection.style.alignItems = 'center';
    modeSection.style.gap = '10px';
    const modeLabel = document.createElement('div');
    modeLabel.textContent = 'Open In';
    modeLabel.style.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    const modeButtons = document.createElement('div');
    modeButtons.className = 'share-mode-toggle';
    modeButtons.style.display = 'flex';
    modeButtons.style.gap = '8px';
    const modeCadBtn = document.createElement('button');
    modeCadBtn.className = 'share-btn share-mode-btn';
    modeCadBtn.type = 'button';
    modeCadBtn.textContent = 'CAD';
    modeCadBtn.title = 'Open the shared model in the full CAD editor';
    const modeViewerBtn = document.createElement('button');
    modeViewerBtn.className = 'share-btn share-mode-btn';
    modeViewerBtn.type = 'button';
    modeViewerBtn.textContent = 'Viewer';
    modeViewerBtn.title = 'Open the shared model in the read-only viewer';
    modeButtons.appendChild(modeCadBtn);
    modeButtons.appendChild(modeViewerBtn);
    modeSection.appendChild(modeLabel);
    modeSection.appendChild(modeButtons);
    content.appendChild(modeSection);

    const linkSection = document.createElement('section');
    linkSection.style.display = 'flex';
    linkSection.style.flexDirection = 'column';
    linkSection.style.gap = '6px';
    const linkHeader = document.createElement('div');
    linkHeader.style.display = 'flex';
    linkHeader.style.alignItems = 'center';
    linkHeader.style.justifyContent = 'space-between';
    linkHeader.style.gap = '8px';
    const linkLabel = document.createElement('div');
    linkLabel.textContent = 'Share Link';
    linkLabel.style.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    const linkActions = document.createElement('div');
    linkActions.style.display = 'flex';
    linkActions.style.gap = '8px';
    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.className = 'share-btn';
    copyLinkBtn.textContent = 'Copy Link';
    const openLinkBtn = document.createElement('button');
    openLinkBtn.className = 'share-btn';
    openLinkBtn.textContent = 'Open';
    linkActions.appendChild(copyLinkBtn);
    linkActions.appendChild(openLinkBtn);
    linkHeader.appendChild(linkLabel);
    linkHeader.appendChild(linkActions);
    linkSection.appendChild(linkHeader);

    const linkArea = document.createElement('textarea');
    linkArea.readOnly = true;
    linkArea.rows = 3;
    linkArea.placeholder = 'Share URL will appear here for public GitHub files.';
    linkArea.style.width = '100%';
    linkArea.style.boxSizing = 'border-box';
    linkArea.style.resize = 'vertical';
    linkArea.style.minHeight = '62px';
    linkArea.style.background = '#06080c';
    linkArea.style.color = '#dbe7ff';
    linkArea.style.border = '1px solid #374151';
    linkArea.style.borderRadius = '8px';
    linkArea.style.padding = '8px';
    linkArea.style.font = '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    linkSection.appendChild(linkArea);
    content.appendChild(linkSection);

    const iframeSection = document.createElement('section');
    iframeSection.style.display = 'flex';
    iframeSection.style.flexDirection = 'column';
    iframeSection.style.gap = '6px';
    iframeSection.style.flex = '1 1 auto';
    iframeSection.style.minHeight = '0';
    const iframeHeader = document.createElement('div');
    iframeHeader.style.display = 'flex';
    iframeHeader.style.alignItems = 'center';
    iframeHeader.style.justifyContent = 'space-between';
    iframeHeader.style.gap = '8px';
    const iframeLabel = document.createElement('div');
    iframeLabel.textContent = 'Embed HTML (iframe)';
    iframeLabel.style.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    const copyIframeBtn = document.createElement('button');
    copyIframeBtn.className = 'share-btn';
    copyIframeBtn.textContent = 'Copy Iframe';
    iframeHeader.appendChild(iframeLabel);
    iframeHeader.appendChild(copyIframeBtn);
    iframeSection.appendChild(iframeHeader);

    const iframeArea = document.createElement('textarea');
    iframeArea.readOnly = true;
    iframeArea.rows = 8;
    iframeArea.placeholder = 'Iframe HTML will appear here for public GitHub files.';
    iframeArea.style.width = '100%';
    iframeArea.style.flex = '1 1 auto';
    iframeArea.style.minHeight = '120px';
    iframeArea.style.boxSizing = 'border-box';
    iframeArea.style.resize = 'vertical';
    iframeArea.style.background = '#06080c';
    iframeArea.style.color = '#dbe7ff';
    iframeArea.style.border = '1px solid #374151';
    iframeArea.style.borderRadius = '8px';
    iframeArea.style.padding = '8px';
    iframeArea.style.font = '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    iframeSection.appendChild(iframeArea);
    content.appendChild(iframeSection);

    fw.content.appendChild(content);

    copyLinkBtn.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(this.shareUrl);
      this._setStatus(ok ? 'Share link copied.' : 'Clipboard copy failed. Use Ctrl/Cmd+C.', ok ? 'ok' : 'warn');
    });
    copyIframeBtn.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(this.iframeHtml);
      this._setStatus(ok ? 'Iframe HTML copied.' : 'Clipboard copy failed. Use Ctrl/Cmd+C.', ok ? 'ok' : 'warn');
    });
    openLinkBtn.addEventListener('click', () => {
      if (!this.shareUrl) return;
      try { window.open(this.shareUrl, '_blank', 'noopener,noreferrer'); } catch {}
    });
    modeCadBtn.addEventListener('click', () => this._setShareMode(SHARE_MODE_CAD));
    modeViewerBtn.addEventListener('click', () => this._setShareMode(SHARE_MODE_VIEWER));

    this.window = fw;
    this.root = fw.root;
    this.statusEl = status;
    this.linkEl = linkArea;
    this.iframeEl = iframeArea;
    this.copyLinkBtn = copyLinkBtn;
    this.copyIframeBtn = copyIframeBtn;
    this.openLinkBtn = openLinkBtn;
    this.refreshBtn = refreshBtn;
    this.modeCadBtn = modeCadBtn;
    this.modeViewerBtn = modeViewerBtn;
    this._setValues('', '');
    this._syncShareModeUi();
    try { this.root.style.display = 'none'; } catch {}
    this._setStatus('Checking current file...', 'info');
  }
}

export function createShareButton(viewer) {
  if (!viewer) return null;
  if (!viewer[PANEL_KEY]) viewer[PANEL_KEY] = new ShareModelPanel(viewer);
  return {
    label: '⠪',
    title: 'Share current model',
    onClick: () => viewer[PANEL_KEY].toggle(),
  };
}
