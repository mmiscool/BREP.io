import { getComponentRecord } from '../services/componentLibrary.js';
import { WorkspaceFileBrowserWidget } from './WorkspaceFileBrowserWidget.js';

function buildScope(entry) {
  const scope = {};
  const source = String(entry?.source || '').trim().toLowerCase();
  const repoFull = String(entry?.repoFull || '').trim();
  const branch = String(entry?.branch || '').trim();
  const path = String(entry?.path || entry?.name || '').trim();
  if (source === 'github' || source === 'local') scope.source = source;
  if (repoFull) scope.repoFull = repoFull;
  if (branch) scope.branch = branch;
  if (path) scope.path = path;
  return scope;
}

export function openComponentSelectorModal({ title = 'Select Component' } = {}) {
  return new Promise((resolve) => {
    let browser = null;
    let settled = false;

    const overlay = document.createElement('div');
    overlay.className = 'component-selector-overlay';

    const panel = document.createElement('section');
    panel.className = 'component-selector-panel';

    const header = document.createElement('div');
    header.className = 'cs-header';
    header.textContent = title;

    const body = document.createElement('div');
    body.className = 'cs-body';

    const browserMount = document.createElement('div');
    browserMount.className = 'cs-browser-mount';
    body.appendChild(browserMount);

    const footer = document.createElement('div');
    footer.className = 'cs-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'cs-btn';
    cancelBtn.textContent = 'Cancel';
    footer.appendChild(cancelBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      try { browser?.destroy?.(); } catch { /* ignore */ }
      try { document.removeEventListener('keydown', onKeyDown, true); } catch { /* ignore */ }
      try { document.body.removeChild(overlay); } catch { /* ignore */ }
      resolve(result ?? null);
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cleanup(null);
    };

    document.addEventListener('keydown', onKeyDown, true);

    cancelBtn.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup(null);
    });

    browser = new WorkspaceFileBrowserWidget({
      container: browserMount,
      onPickFile: async (entry) => {
        const path = String(entry?.path || entry?.name || '').trim();
        if (!path) return;
        const record = await getComponentRecord(path, buildScope(entry));
        if (!record || !record.data3mf) {
          throw new Error('Failed to load selected component');
        }
        cleanup(record);
      },
      scrollBody: true,
    });

    void browser.reload();
  });
}

(function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('component-selector-styles')) return;
  const style = document.createElement('style');
  style.id = 'component-selector-styles';
  style.textContent = `
    .component-selector-overlay {
      position: fixed;
      inset: 0;
      z-index: 2000;
      background: rgba(2, 6, 16, 0.62);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      box-sizing: border-box;
    }
    .component-selector-panel {
      width: min(1100px, 96vw);
      height: min(760px, 90vh);
      background: #071126;
      border: 1px solid #274268;
      border-radius: 12px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      color: #dbe5f0;
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .cs-header {
      padding: 12px 14px;
      border-bottom: 1px solid #22385a;
      font-weight: 700;
      color: #dbe5f0;
      letter-spacing: 0.02em;
      background: rgba(255, 255, 255, 0.03);
    }
    .cs-body {
      min-height: 0;
      flex: 1 1 auto;
      padding: 10px 12px;
      overflow: hidden;
    }
    .cs-browser-mount {
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .cs-footer {
      border-top: 1px solid #22385a;
      padding: 10px 12px;
      display: flex;
      justify-content: flex-end;
    }
    .cs-btn {
      border: 1px solid #2d405f;
      background: #0e1a33;
      color: #dbe5f0;
      border-radius: 8px;
      padding: 8px 12px;
      font: inherit;
      cursor: pointer;
    }
    .cs-btn:hover {
      border-color: #5f8dff;
      background: #1a2f59;
    }
  `;
  document.head.appendChild(style);
})();
