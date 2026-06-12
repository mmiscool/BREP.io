// FloatingWindow.js - lightweight draggable, shadable, resizable window
// Framework-free ES module used across UI widgets.

export class FloatingWindow {
  constructor({
    title = 'Window',
    width = 420,
    height = 320,
    minWidth = 260,
    minHeight = 140,
    x = null,
    y = null,
    right = 16,    // if x is null and right provided, compute from viewport width
    top = 40,      // default top if y not provided
    bottom = null, // if provided and y is null, compute from viewport height
    shaded = false,
    zIndex = 10,
    closable = true,
    modal = false,
    closeOnBackdrop = true,
    closeOnEscape = true,
    backdrop = true,
    restoreFocus = true,
    center = null,
    onClose = null,
  } = {}) {
    this._minW = Math.max(160, Number(minWidth) || 260);
    this._minH = Math.max(100, Number(minHeight) || 140);
    this._isShaded = Boolean(shaded);
    this._dragging = false;
    this._resizing = false;
    this._dragStart = { x: 0, y: 0, left: 0, top: 0 };
    this._resizeStart = { x: 0, y: 0, w: 0, h: 0 };
    this._unshadedH = null; // cache last expanded height
    this._movedDuringPress = false;
    this._moveThreshold = 5; // px to distinguish click vs drag
    this._wasTopmostOnPointerDown = false;
    this._closable = closable !== false;
    this._modal = Boolean(modal);
    this._closeOnBackdrop = closeOnBackdrop !== false;
    this._closeOnEscape = closeOnEscape !== false;
    this._hasBackdrop = backdrop !== false;
    this._restoreFocus = restoreFocus !== false;
    this._center = center == null ? this._modal : Boolean(center);
    this._previousFocus = null;
    this._modalActive = false;
    this._isTransparent = false;
    this._visibilityObserver = null;
    this._lastVisible = null;
    this.onClose = (typeof onClose === 'function') ? onClose : null;

    this._ensureStyles();

    const root = document.createElement('div');
    root.className = 'floating-window';
    if (this._modal) root.classList.add('floating-window--modal');
    root.style.zIndex = String(zIndex);
    root.style.width = Math.max(this._minW, Number(width) || 420) + 'px';
    root.style.height = Math.max(this._minH, Number(height) || 320) + 'px';

    // Positioning (fixed)
    const { innerWidth: vw = 0, innerHeight: vh = 0 } = window || {};
    let left = (x != null) ? Number(x) : null;
    let topPx = (y != null) ? Number(y) : null;
    const w = parseInt(root.style.width, 10) || 0;
    const h = parseInt(root.style.height, 10) || 0;
    if (this._center && left == null && topPx == null && bottom == null) {
      left = Math.max(8, Math.round((vw - w) / 2));
      topPx = Math.max(8, Math.round((vh - h) / 2));
    }
    if (left == null && right != null && Number.isFinite(Number(right))) {
      left = Math.max(8, (vw - w - Number(right)));
    }
    if (topPx == null) {
      if (bottom != null && Number.isFinite(Number(bottom))) {
        topPx = Math.max(8, (vh - h - Number(bottom)));
      } else {
        topPx = Number(top) || 40;
      }
    }
    root.style.position = 'fixed';
    root.style.left = (Math.max(0, left ?? 16)) + 'px';
    root.style.top = (Math.max(0, topPx ?? 40)) + 'px';

    // Header
    const header = document.createElement('div');
    header.className = 'floating-window__header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');

    const titleEl = document.createElement('div');
    titleEl.className = 'floating-window__title';
    titleEl.textContent = String(title || '');
    const actions = document.createElement('div');
    actions.className = 'floating-window__actions';
    header.appendChild(titleEl);
    header.appendChild(actions);
    const transparencyBtn = this._buildTransparencyButton();
    const closeBtn = this._closable ? this._buildCloseButton() : null;
    actions.appendChild(transparencyBtn);
    if (closeBtn) actions.appendChild(closeBtn);

    // Content
    const content = document.createElement('div');
    content.className = 'floating-window__content';

    // Resizers (corners + edges)
    root.appendChild(header);
    root.appendChild(content);
    const resizers = [];
    const resizerDirs = ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'];
    for (const dir of resizerDirs) {
      const handle = document.createElement('div');
      handle.className = `floating-window__resizer floating-window__resizer--${dir}`;
      handle.dataset.dir = dir;
      handle.addEventListener('pointerdown', (ev) => this._onResizerPointerDown(ev, dir));
      resizers.push(handle);
      root.appendChild(handle);
    }
    let modalOverlay = null;
    if (this._modal) {
      modalOverlay = document.createElement('div');
      modalOverlay.className = `floating-window-modal-overlay${this._hasBackdrop ? '' : ' floating-window-modal-overlay--clear'}`;
      modalOverlay.style.zIndex = String(Math.max(0, Number(zIndex) || 0));
      modalOverlay.appendChild(root);
      document.body.appendChild(modalOverlay);
      root.style.zIndex = String(Math.max(1, (Number(zIndex) || 0) + 1));
    } else {
      document.body.appendChild(root);
    }

    // Persist refs
    this.root = root;
    this.modalOverlay = modalOverlay;
    this.header = header;
    this.titleEl = titleEl;
    this.actionsEl = actions;
    this.content = content;
    this.resizers = resizers;
    this.transparencyButton = transparencyBtn;
    this.closeButton = closeBtn;
    this._onModalKeyDown = (ev) => this._handleModalKeyDown(ev);

    // Initial shaded state
    this.setShaded(this._isShaded);
    this._setupVisibilityObserver();
    this._bringToFrontIfVisible();

    // Events: drag-to-move on header (but click toggles shade if not dragged)
    header.addEventListener('pointerdown', (ev) => this._onHeaderPointerDown(ev));
    // Prevent text selection while dragging
    header.addEventListener('dragstart', (e) => { try { e.preventDefault(); } catch {} });

    root.addEventListener('pointerdown', () => {
      this._wasTopmostOnPointerDown = this._isTopmost();
      this._bringToFront();
    }, true);

    if (modalOverlay) {
      modalOverlay.addEventListener('pointerdown', (ev) => {
        if (!this._closeOnBackdrop || ev.target !== modalOverlay) return;
        try { ev.preventDefault(); ev.stopPropagation(); } catch {}
        this.close();
      });
      this._activateModal();
    }

    // Keyboard: toggle shade
    header.addEventListener('keydown', (ev) => {
      // Only toggle when focus is on header or title; ignore when on action buttons/inputs
      const t = ev.target;
      const onHeader = (t === header) || (this.titleEl && this.titleEl.contains(t));
      if (!onHeader) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.toggleShaded();
      }
    });
  }

  destroy() {
    this._deactivateModal();
    try { this._visibilityObserver?.disconnect?.(); } catch {}
    try { this.modalOverlay && this.modalOverlay.parentNode && this.modalOverlay.parentNode.removeChild(this.modalOverlay); } catch {}
    try { this.root && this.root.parentNode && this.root.parentNode.removeChild(this.root); } catch {}
    this.root = null; this.modalOverlay = null; this.header = null; this.actionsEl = null; this.titleEl = null; this.content = null; this.resizers = null; this.transparencyButton = null; this.closeButton = null;
  }

  setTitle(text) { if (this.titleEl) this.titleEl.textContent = String(text || ''); }
  addHeaderAction(el) {
    if (!el || !this.actionsEl) return;
    const anchor = this.transparencyButton && this.transparencyButton.parentNode === this.actionsEl
      ? this.transparencyButton
      : this.closeButton;
    if (anchor && anchor.parentNode === this.actionsEl) {
      this.actionsEl.insertBefore(el, anchor);
      return;
    }
    if (this.closeButton && this.closeButton.parentNode === this.actionsEl) {
      this.actionsEl.insertBefore(el, this.closeButton);
    } else {
      this.actionsEl.appendChild(el);
    }
  }
  close() {
    if (typeof this.onClose === 'function') {
      this.onClose();
    } else {
      this.hide();
    }
    if (this._modal && this._isVisible()) this.hide();
  }
  show() {
    if (this.modalOverlay) this.modalOverlay.style.display = 'flex';
    if (this.root) this.root.style.display = 'flex';
    this._activateModal();
    this._bringToFront();
    this.focus();
  }
  hide() {
    if (this.root) this.root.style.display = 'none';
    if (this.modalOverlay) this.modalOverlay.style.display = 'none';
    this._deactivateModal();
  }
  focus() {
    const target = this._getFocusableElements()[0] || this.closeButton || this.header || this.root;
    try { target?.focus?.({ preventScroll: true }); } catch { try { target?.focus?.(); } catch {} }
  }
  bringToFront() { this._bringToFront(); }
  setTransparent(transparent) {
    this._isTransparent = Boolean(transparent);
    if (!this.root) return;
    this.root.classList.toggle('is-transparent', this._isTransparent);
    if (this.transparencyButton) {
      this.transparencyButton.setAttribute('aria-pressed', this._isTransparent ? 'true' : 'false');
      this.transparencyButton.setAttribute('title', this._isTransparent ? 'Disable transparency' : 'Enable transparency');
    }
    try {
      this.root.dispatchEvent(new CustomEvent('transparencychange', { detail: { transparent: this._isTransparent } }));
    } catch {}
  }
  toggleTransparent() { this.setTransparent(!this._isTransparent); }
  _bringToFrontIfVisible() {
    const visible = this._isVisible();
    this._lastVisible = visible;
    if (visible) this._bringToFront();
  }
  _bringToFront() {
    if (!this.root) return;
    const maxZ = this._getMaxZIndex(this.root);
    const current = this._readZIndex(this.root);
    if (!Number.isFinite(current)) return;
    if (current <= maxZ) {
      const nextZ = maxZ + 1;
      if (this.modalOverlay) this.modalOverlay.style.zIndex = String(Math.max(0, nextZ - 1));
      this.root.style.zIndex = String(nextZ);
    }
    if (this._modal && this._modalActive) FloatingWindow._activeModal = this;
  }
  _isTopmost() {
    if (!this.root) return false;
    const windows = document.querySelectorAll('.floating-window');
    let maxZ = -Infinity;
    let topmost = null;
    for (const win of windows) {
      const z = this._readZIndex(win);
      if (!Number.isFinite(z)) continue;
      if (z > maxZ || z === maxZ) {
        maxZ = z;
        topmost = win;
      }
    }
    return topmost === this.root;
  }
  _isVisible() {
    const target = this.modalOverlay || this.root;
    if (!target || !window || !window.getComputedStyle) return false;
    try {
      return window.getComputedStyle(target).display !== 'none';
    } catch {
      return true;
    }
  }
  _readZIndex(el) {
    if (!el || !window || !window.getComputedStyle) return null;
    try {
      const z = parseInt(window.getComputedStyle(el).zIndex || '0', 10);
      return Number.isFinite(z) ? z : null;
    } catch {
      return null;
    }
  }
  _getMaxZIndex(excludeEl = null) {
    if (!document || !document.body) return 0;
    const elements = document.body.getElementsByTagName('*');
    let maxZ = -Infinity;
    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      if (excludeEl && el === excludeEl) continue;
      const z = this._readZIndex(el);
      if (!Number.isFinite(z)) continue;
      if (z > maxZ) maxZ = z;
    }
    return Number.isFinite(maxZ) ? maxZ : 0;
  }
  _setupVisibilityObserver() {
    if (!this.root || typeof MutationObserver === 'undefined') return;
    this._visibilityObserver = new MutationObserver(() => {
      const visible = this._isVisible();
      if (visible && !this._lastVisible) {
        this._activateModal();
        this._bringToFront();
      } else if (!visible && this._lastVisible) {
        this._deactivateModal();
      }
      this._lastVisible = visible;
    });
    this._visibilityObserver.observe(this.root, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    if (this.modalOverlay) this._visibilityObserver.observe(this.modalOverlay, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
  setShaded(shaded) {
    this._isShaded = Boolean(shaded);
    if (!this.root || !this.content) return;
    this.root.classList.toggle('is-shaded', this._isShaded);
    if (this._isShaded) {
      const rect = this.root.getBoundingClientRect();
      this._unshadedH = Math.max(this._minH, Math.round(rect.height));
      const hh = this._headerHeight();
      this.content.hidden = true;
      this.root.style.height = hh + 'px';
    } else {
      const restore = Math.max(this._minH, Number(this._unshadedH) || parseInt(this.root.style.height, 10) || 320);
      this.content.hidden = false;
      this.root.style.height = restore + 'px';
    }
    try {
      this.root.dispatchEvent(new CustomEvent('shadechange', { detail: { shaded: this._isShaded } }));
    } catch {}
  }
  toggleShaded() { this.setShaded(!this._isShaded); }

  _buildTransparencyButton() {
    const btn = document.createElement('button');
    btn.className = 'fw-btn floating-window__transparency';
    btn.type = 'button';
    btn.textContent = '◐';
    btn.setAttribute('aria-label', 'Toggle transparency');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('title', 'Enable transparency');
    btn.addEventListener('click', (ev) => {
      try { ev.stopPropagation(); } catch {}
      this.toggleTransparent();
    });
    return btn;
  }

  _buildCloseButton() {
    const btn = document.createElement('button');
    btn.className = 'fw-btn floating-window__close';
    btn.type = 'button';
    btn.textContent = '❌';
    btn.setAttribute('aria-label', 'Close');
    btn.setAttribute('title', 'Close');
    btn.addEventListener('click', (ev) => {
      try { ev.stopPropagation(); } catch {}
      this.close();
    });
    return btn;
  }

  _onHeaderPointerDown(ev) {
    if (ev.button !== 0) return;
    // Ignore drags starting from header action controls (buttons/links/inputs)
    const t = ev.target;
    const interactive = (node) => {
      if (!node) return false;
      const tag = (node.tagName || '').toLowerCase();
      if (['button','a','input','select','textarea','label'].includes(tag)) return true;
      if (node.closest && (node.closest('.floating-window__actions') || node.closest('[data-no-drag]'))) return true;
      return false;
    };
    if (interactive(t)) return; // let the inner control handle the gesture
    this._dragging = true; this._movedDuringPress = false;
    this.header.setPointerCapture?.(ev.pointerId);
    const rect = this.root.getBoundingClientRect();
    this._dragStart = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    const onMove = (e) => {
      const dx = (e.clientX - this._dragStart.x);
      const dy = (e.clientY - this._dragStart.y);
      if (Math.abs(dx) + Math.abs(dy) > this._moveThreshold) this._movedDuringPress = true;
      const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      const w = this.root.offsetWidth || 0, h = this.root.offsetHeight || 0;
      let nx = this._dragStart.left + dx; let ny = this._dragStart.top + dy;
      nx = Math.min(Math.max(0, nx), Math.max(0, vw - w));
      const hh = this._headerHeight();
      ny = Math.min(Math.max(0, ny), Math.max(0, vh - (this._isShaded ? hh : h)));
      this.root.style.left = nx + 'px';
      this.root.style.top = ny + 'px';
    };
    const onUp = (e) => {
      this._dragging = false;
      try { this.header.releasePointerCapture?.(ev.pointerId); } catch {}
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      const totalMove = Math.abs(e.clientX - this._dragStart.x) + Math.abs(e.clientY - this._dragStart.y);
      if (totalMove <= this._moveThreshold && this._wasTopmostOnPointerDown) {
        this.toggleShaded();
      }
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    try { ev.preventDefault(); ev.stopPropagation(); } catch {}
  }

  _onResizerPointerDown(ev, dir = 'se') {
    if (ev.button !== 0) return;
    this._resizing = true;
    this.root.classList.add('is-resizing');
    const resizerEl = ev.currentTarget;
    resizerEl?.setPointerCapture?.(ev.pointerId);
    const rect = this.root.getBoundingClientRect();
    this._resizeStart = { x: ev.clientX, y: ev.clientY, w: rect.width, h: rect.height, left: rect.left, top: rect.top };
    const onMove = (e) => {
      const dx = (e.clientX - this._resizeStart.x);
      const dy = (e.clientY - this._resizeStart.y);
      const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      let left = this._resizeStart.left;
      let top = this._resizeStart.top;
      let nw = this._resizeStart.w;
      let nh = this._resizeStart.h;
      if (dir.includes('e')) nw += dx;
      if (dir.includes('s')) nh += dy;
      if (dir.includes('w')) { nw -= dx; left += dx; }
      if (dir.includes('n')) { nh -= dy; top += dy; }
      nw = Math.max(this._minW, nw);
      nh = Math.max(this._minH, nh);
      if (left < 0) { nw += left; left = 0; }
      if (top < 0) { nh += top; top = 0; }
      nw = Math.min(nw, vw - left - 8);
      nh = Math.min(nh, vh - top - 8);
      this.root.style.left = left + 'px';
      this.root.style.top = top + 'px';
      this.root.style.width = nw + 'px';
      this.root.style.height = nh + 'px';
    };
    const onUp = (_e) => {
      this._resizing = false;
      try { resizerEl?.releasePointerCapture?.(ev.pointerId); } catch {}
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      this.root.classList.remove('is-resizing');
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    try { ev.preventDefault(); ev.stopPropagation(); } catch {}
  }

  _ensureStyles() {
    if (document.getElementById('floating-window-styles')) return;
    const style = document.createElement('style');
    style.id = 'floating-window-styles';
    style.textContent = `
      .floating-window { position: fixed; background:#0b0b0e; color:#e5e7eb; border:1px solid #2a2a33; border-radius:12px; box-shadow:0 10px 28px rgba(0,0,0,.55); display:flex; flex-direction:column; overflow:hidden; user-select:none; }
      .floating-window-modal-overlay { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.58); pointer-events:auto; }
      .floating-window-modal-overlay--clear { background:transparent; }
      .floating-window--modal { position:fixed; }
      .floating-window.is-transparent { opacity:.58; }
      .floating-window.is-transparent:hover,
      .floating-window.is-transparent:focus-within,
      .floating-window.is-transparent.is-resizing { opacity:.78; }
      .floating-window.is-shaded { overflow:hidden; }
      .floating-window__header { display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid #23232b; cursor:grab; font:600 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; letter-spacing:.2px; }
      .floating-window__title { flex:1; }
      .floating-window__actions { display:flex; align-items:center; gap:6px; }
      .floating-window__actions .fw-btn { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; height:27px; min-height:27px; max-height:27px; min-width:32px; background:#1f2937; color:#f9fafb; border:1px solid #374151; padding:0 10px; border-radius:8px; cursor:pointer; font:700 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; text-align:center; vertical-align:middle; }
      .floating-window__actions .fw-btn:hover { background:#2b3545; }
      .floating-window__actions .floating-window__transparency { width:32px; padding:0; border-radius:8px; color:#f1f5f9; }
      .floating-window__actions .floating-window__transparency[aria-pressed="true"] { background:#334155; border-color:#64748b; }
      .floating-window__actions .floating-window__close { width:32px; padding:0; border-radius:8px; color:#f1f5f9; }
      .floating-window__actions .floating-window__close:hover { background:#3a1f24; border-color:#5b2a33; }
      .floating-window__content { flex:1; overflow:auto; padding:8px; user-select:text; }
      .floating-window.is-shaded .floating-window__content { display:none; }
      .floating-window__resizer { position:absolute; width:16px; height:16px; z-index:2; touch-action:none; }
      .floating-window__resizer--se { right:2px; bottom:2px; cursor:se-resize; }
      .floating-window__resizer--sw { left:2px; bottom:2px; cursor:sw-resize; }
      .floating-window__resizer--ne { right:2px; top:2px; cursor:ne-resize; }
      .floating-window__resizer--nw { left:2px; top:2px; cursor:nw-resize; }
      .floating-window__resizer--n { left:16px; right:16px; top:-4px; height:8px; width:auto; cursor:n-resize; }
      .floating-window__resizer--s { left:16px; right:16px; bottom:-4px; height:8px; width:auto; cursor:s-resize; }
      .floating-window__resizer--e { top:16px; bottom:16px; right:-4px; width:8px; height:auto; cursor:e-resize; }
      .floating-window__resizer--w { top:16px; bottom:16px; left:-4px; width:8px; height:auto; cursor:w-resize; }
      .floating-window.is-shaded .floating-window__resizer { display:none; }
      .floating-window__resizer::after { content:""; position:absolute; width:10px; height:10px; opacity:.8; }
      .floating-window__resizer--se::after { right:3px; bottom:3px; border-right:2px solid #4b5563; border-bottom:2px solid #4b5563; }
      .floating-window__resizer--sw::after { left:3px; bottom:3px; border-left:2px solid #4b5563; border-bottom:2px solid #4b5563; }
      .floating-window__resizer--ne::after { right:3px; top:3px; border-right:2px solid #4b5563; border-top:2px solid #4b5563; }
      .floating-window__resizer--nw::after { left:3px; top:3px; border-left:2px solid #4b5563; border-top:2px solid #4b5563; }
      .floating-window__resizer--n::after,
      .floating-window__resizer--s::after,
      .floating-window__resizer--e::after,
      .floating-window__resizer--w::after { display:none; }
      .floating-window.is-resizing, .floating-window__header:active { cursor:grabbing; }
    `;
    document.head.appendChild(style);
  }

  _headerHeight() {
    try {
      const r = this.header.getBoundingClientRect();
      return Math.max(28, Math.round(r.height));
    } catch { return 42; }
  }

  _activateModal() {
    if (!this._modal || this._modalActive || !this._isVisible()) return;
    this._modalActive = true;
    FloatingWindow._activeModal = this;
    try { this._previousFocus = document.activeElement || null; } catch { this._previousFocus = null; }
    FloatingWindow._modalOpenCount = Math.max(0, (FloatingWindow._modalOpenCount || 0)) + 1;
    FloatingWindow._syncGlobalDialogFlag();
    try { document.addEventListener('keydown', this._onModalKeyDown, true); } catch {}
  }

  _deactivateModal() {
    if (!this._modal || !this._modalActive) return;
    this._modalActive = false;
    if (FloatingWindow._activeModal === this) FloatingWindow._activeModal = null;
    FloatingWindow._modalOpenCount = Math.max(0, (FloatingWindow._modalOpenCount || 0) - 1);
    FloatingWindow._syncGlobalDialogFlag();
    try { document.removeEventListener('keydown', this._onModalKeyDown, true); } catch {}
    if (this._restoreFocus && this._previousFocus && this._previousFocus !== document.body) {
      try { this._previousFocus.focus?.({ preventScroll: true }); } catch { try { this._previousFocus.focus?.(); } catch {} }
    }
    this._previousFocus = null;
  }

  _handleModalKeyDown(ev) {
    if (!this._modal || !this._modalActive || !this._isVisible()) return;
    if (FloatingWindow._activeModal && FloatingWindow._activeModal !== this) return;
    if (ev.key === 'Escape' && this._closeOnEscape && this._closable) {
      try { ev.preventDefault(); ev.stopPropagation(); } catch {}
      this.close();
      return;
    }
    if (ev.key !== 'Tab') return;
    const focusable = this._getFocusableElements();
    if (!focusable.length) {
      try { ev.preventDefault(); this.focus(); } catch {}
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (ev.shiftKey && (!active || active === first || !this.root.contains(active))) {
      ev.preventDefault();
      try { last.focus(); } catch {}
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      try { first.focus(); } catch {}
    }
  }

  _getFocusableElements() {
    if (!this.root) return [];
    const selector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    try {
      return Array.from(this.root.querySelectorAll(selector)).filter((el) => {
        if (!el || el.hidden) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        return !style || (style.display !== 'none' && style.visibility !== 'hidden');
      });
    } catch {
      return [];
    }
  }

  static _syncGlobalDialogFlag() {
    try {
      const hasFloatingModal = (FloatingWindow._modalOpenCount || 0) > 0;
      const hasLegacyDialog = typeof window.isDialogOpen === 'function' && window.isDialogOpen();
      window.__BREPDialogOpen = hasFloatingModal || hasLegacyDialog;
    } catch {}
  }
}

FloatingWindow._modalOpenCount = 0;
