// MainToolbar.js - top toolbar that manages layout and button registration.
// Button logic is implemented externally and registered via addCustomButton()/viewer.addToolbarButton.

export class MainToolbar {
  constructor(viewer) {
    this.viewer = viewer;
    this._rightReserveByKey = new Map();
    this._rightReserveWatchers = new Map();
    // Guard against duplicate toolbars if constructed twice (e.g., hot reloads)
    try {
      const existing = document.getElementById('main-toolbar');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    } catch { /* ignore */ }
    this.root = document.createElement('div');
    this.root.id = 'main-toolbar';
    this._ensureStyles();
    this._buildUI();
    this._positionWithSidebar();

    // Keep position in sync with sidebar and window resizes
    window.addEventListener('resize', () => this._positionWithSidebar());
    try {
      if (window.ResizeObserver && this.viewer?.sidebar) {
        const ro = new ResizeObserver(() => this._positionWithSidebar());
        ro.observe(this.viewer.sidebar);
        this._ro = ro;
      }
    } catch { /* ignore */ }
  }

  _ensureStyles() {
    if (document.getElementById('main-toolbar-styles')) return;
    const style = document.createElement('style');
    style.id = 'main-toolbar-styles';
    style.textContent = `
      #main-toolbar {
        position: fixed;
        top: 0; left: 0; right: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
        padding: 6px calc(6px + var(--mtb-reserved-right, 0px)) 6px 6px;
        box-sizing: border-box;
        background: rgba(20,24,30,.85);
        border: 1px solid #262b36;
        border-radius: 8px;
        z-index: 10;
        pointer-events: auto;
        user-select: none;
      }
      .mtb-left, .mtb-right {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .mtb-left { flex: 1 1 auto; }
      .mtb-right { margin-left: auto; justify-content: flex-end; }
      .mtb-spacer { flex: 1; }

      .mtb-btn {
        background: transparent;
        color: #ddd;
        border: 1px solid #364053;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        line-height: 18px;
        user-select: none;
      }
      .mtb-btn.mtb-icon {
        min-width: 36px;
        font-size: 16px;
      }
      .mtb-btn.is-active {
        background: linear-gradient(180deg, rgba(110,168,254,.25), rgba(110,168,254,.15));
        border-color: #6ea8fe;
        color: #e9f0ff;
        box-shadow: 0 0 0 1px rgba(110,168,254,.2) inset;
      }
      .mtb-selection {
        display: none;
        align-items: center;
        gap: 6px;
        padding-left: 6px;
        margin-left: 2px;
        border-left: 1px solid #364053;
      }
    `;
    document.head.appendChild(style);
  }

  _buildUI() {
    const left = document.createElement('div');
    left.className = 'mtb-left';
    this._left = left;

    // Buttons are provided by external modules via addCustomButton()/viewer.addToolbarButton

    const right = document.createElement('div');
    right.className = 'mtb-right';

    this.root.appendChild(left);
    this.root.appendChild(right);
    document.body.appendChild(this.root);
  }

  _btn(label, title, onClick) {
    const b = document.createElement('button');
    b.className = 'mtb-btn';
    b.textContent = label;
    b.title = title || label;
    b.__mtbOnClick = onClick;
    b.addEventListener('click', (e) => { e.stopPropagation(); try { b.__mtbOnClick && b.__mtbOnClick(); } catch {} });
    return b;
  }

  // Public: allow plugins to add custom buttons to the left cluster
  addCustomButton({ label, title, onClick }) {
    try {
      const btn = this._btn(String(label ?? '🔧'), String(title || ''), onClick);
      const anchor = this._selectionContainer && this._selectionContainer.parentNode === this._left
        ? this._selectionContainer
        : null;
      if (anchor) this._left?.insertBefore(btn, anchor);
      else this._left?.appendChild(btn);
      return btn;
    } catch { return null; }
  }

  _ensureSelectionContainer() {
    if (this._selectionContainer) return this._selectionContainer;
    const wrap = document.createElement('div');
    wrap.className = 'mtb-selection';
    this._selectionContainer = wrap;
    this._left?.appendChild(wrap);
    return wrap;
  }

  // Public: allow selection-based buttons in their own cluster
  addSelectionButton({ label, title, onClick }) {
    try {
      const btn = this._btn(String(label ?? '🔧'), String(title || ''), onClick);
      if (label && String(label).length <= 2) btn.classList.add('mtb-icon');
      const wrap = this._ensureSelectionContainer();
      wrap.appendChild(btn);
      return btn;
    } catch { return null; }
  }

  getSelectionContainer() {
    return this._ensureSelectionContainer();
  }

  _positionWithSidebar() {
    try {
      const sb = this.viewer?.sidebar;
      const shouldOffset = (typeof this.viewer?._getSidebarShouldShow === 'function')
        ? this.viewer._getSidebarShouldShow()
        : true;
      const w = shouldOffset
        ? Math.ceil(sb?.getBoundingClientRect?.().width || sb?.offsetWidth || 0)
        : 0;
      this.root.style.left = `${w}px`;
    } catch { this.root.style.left = '0px'; }
  }

  _applyRightReserve() {
    let reserve = 0;
    for (const value of this._rightReserveByKey.values()) {
      const px = Number(value);
      if (Number.isFinite(px) && px > reserve) reserve = px;
    }
    try {
      this.root.style.setProperty('--mtb-reserved-right', `${Math.max(0, Math.ceil(reserve))}px`);
    } catch { /* ignore */ }
  }

  _teardownRightReserveWatcher(key) {
    const watcher = this._rightReserveWatchers.get(key);
    if (!watcher) return;
    try { window.removeEventListener('resize', watcher.onResize); } catch { /* ignore */ }
    try { watcher.ro?.disconnect?.(); } catch { /* ignore */ }
    this._rightReserveWatchers.delete(key);
  }

  setRightReserve(key, widthPx = 0) {
    if (!key) return 0;
    const px = Number(widthPx);
    if (!Number.isFinite(px) || px <= 0) this._rightReserveByKey.delete(key);
    else this._rightReserveByKey.set(key, Math.ceil(px));
    this._applyRightReserve();
    return this._rightReserveByKey.get(key) || 0;
  }

  clearRightReserve(key) {
    if (!key) return;
    this._teardownRightReserveWatcher(key);
    this._rightReserveByKey.delete(key);
    this._applyRightReserve();
  }

  reserveRightSpaceForElement(key, element, { extraPx = 12, minPx = 0 } = {}) {
    if (!key) return () => {};
    this._teardownRightReserveWatcher(key);
    const canMeasure = !!element && typeof element.getBoundingClientRect === 'function';
    if (!canMeasure) {
      this.setRightReserve(key, minPx);
      return () => this.clearRightReserve(key);
    }

    const measure = () => {
      try {
        const rect = element.getBoundingClientRect();
        const viewportW = window.innerWidth || document.documentElement?.clientWidth || 0;
        const rightGap = Math.max(0, viewportW - rect.right);
        const reserve = rect && rect.width > 0
          ? (rect.width + rightGap + Number(extraPx || 0))
          : Number(minPx || 0);
        this.setRightReserve(key, Math.max(Number(minPx || 0), reserve));
      } catch {
        this.setRightReserve(key, minPx);
      }
    };

    const onResize = () => measure();
    try { window.addEventListener('resize', onResize); } catch { /* ignore */ }
    let ro = null;
    try {
      if (window.ResizeObserver) {
        ro = new ResizeObserver(() => measure());
        ro.observe(element);
      }
    } catch { /* ignore */ }
    this._rightReserveWatchers.set(key, { onResize, ro });
    measure();
    return () => this.clearRightReserve(key);
  }
}
