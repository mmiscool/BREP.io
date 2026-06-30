import { getComponentRecord } from '../services/componentLibrary.js';
import { FloatingWindow } from './FloatingWindow.js';
import { WorkspaceFileBrowserWidget } from './WorkspaceFileBrowserWidget.js';

type ComponentEntry = Record<string, any> | null | undefined;
export type ComponentSelectorRecord = {
  data3mf?: unknown;
  path?: string;
  name?: string;
  [key: string]: any;
};

type ComponentSelectorOptions = {
  title?: string;
};

function buildScope(entry: ComponentEntry): Record<string, string> {
  const scope: Record<string, string> = {};
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

export function openComponentSelectorModal({ title = 'Select Component' }: ComponentSelectorOptions = {}): Promise<ComponentSelectorRecord | null> {
  return new Promise((resolve) => {
    let browser: any = null;
    let settled = false;

    let fw: any = null;
    const panel = document.createElement('section');
    panel.className = 'component-selector-panel';

    const body = document.createElement('div');
    body.className = 'cs-body';

    const browserMount = document.createElement('div');
    browserMount.className = 'cs-browser-mount';
    body.appendChild(browserMount);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'fw-btn cs-btn';
    cancelBtn.textContent = 'Cancel';

    panel.appendChild(body);

    const cleanup = (result: ComponentSelectorRecord | null) => {
      if (settled) return;
      settled = true;
      try { browser?.destroy?.(); } catch { /* ignore */ }
      try { fw?.destroy?.(); } catch { /* ignore */ }
      resolve(result ?? null);
    };

    cancelBtn.addEventListener('click', () => cleanup(null));

    fw = new FloatingWindow({
      title,
      width: Math.min(1100, Math.max(320, window.innerWidth - 48)),
      height: Math.min(760, Math.max(320, window.innerHeight - 80)),
      minWidth: 360,
      minHeight: 260,
      modal: true,
      closeOnBackdrop: true,
      closeOnEscape: true,
      onClose: () => cleanup(null),
    });
    fw.addHeaderAction(cancelBtn);
    fw.content.appendChild(panel);

    browser = new (WorkspaceFileBrowserWidget as any)({
      container: browserMount,
      onPickFile: async (entry: ComponentEntry) => {
        const path = String(entry?.path || entry?.name || '').trim();
        if (!path) return;
        const record = await getComponentRecord(path, buildScope(entry)) as ComponentSelectorRecord | null;
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
    .component-selector-panel {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      color: #dbe5f0;
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
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
