// LabelOverlay.js
// Manages creation and positioning of PMI label overlays in viewer container.

import './LabelOverlay.css';

type AnyRecord = Record<string | symbol, any>;
type LabelElement = HTMLElement & AnyRecord;
type LabelCallback = ((idx: any, ann: any, event: any) => void) | null;

export class LabelOverlay {
  viewer: AnyRecord | null;
  onPointerDown: LabelCallback;
  onDblClick: LabelCallback;
  onClick: LabelCallback;
  onDragEnd: LabelCallback;
  _labelMap: Map<any, LabelElement>;
  _root: HTMLElement | null;
  _visible: boolean;
  _activePointers: Map<any, AnyRecord>;
  _onGlobalPointerMove: (event: PointerEvent) => void;
  _onGlobalPointerUp: (event: PointerEvent) => void;

  constructor(viewer, onPointerDown, onDblClick, onClick, onDragEnd) {
    this.viewer = viewer;
    this.onPointerDown = typeof onPointerDown === 'function' ? onPointerDown : null;
    this.onDblClick = typeof onDblClick === 'function' ? onDblClick : null;
    this.onClick = typeof onClick === 'function' ? onClick : null;
    this.onDragEnd = typeof onDragEnd === 'function' ? onDragEnd : null;
    this._labelMap = new Map(); // idx -> HTMLElement
    this._root = null;
    this._visible = true;
    this._activePointers = new Map(); // pointerId -> { idx, ann, startX, startY, moved }
    this._onGlobalPointerMove = (ev) => this.#handleGlobalPointerMove(ev);
    this._onGlobalPointerUp = (ev) => this.#handleGlobalPointerUp(ev);
    this._ensureRoot();
  }

  _ensureRoot() {
    if (this._root && this._root.parentNode) return;
    const host = this.viewer?.container;
    if (!host) return;
    try { if (!host.style.position || host.style.position === 'static') host.style.position = 'relative'; } catch { /* ignore */ }
    const div = document.createElement('div');
    div.className = 'pmi-label-root';
    try {
      div.style.overflow = 'hidden';
      div.style.contain = 'layout paint size';
      div.style.maxWidth = '100%';
      div.style.maxHeight = '100%';
    } catch { /* ignore */ }
    host.appendChild(div);
    this._root = div;
    if (!this._visible) {
      try {
        this._root.style.display = 'none';
        this._root.style.pointerEvents = 'none';
      } catch { /* ignore */ }
    }
  }

  updateLabel(idx, text, worldPos, ann) {
    this._ensureRoot();
    let el = this._labelMap.get(idx);
    if (!el) {
      el = document.createElement('div') as LabelElement;
      el.className = 'pmi-label';
      try { el.style.width = 'max-content'; } catch { /* ignore */ }
      if (text != null) {
        const normalized = String(text).replace(/\r\n/g, '\n');
        el.textContent = normalized;
      }
      if (this.onPointerDown || this.onClick) {
        el.addEventListener('pointerdown', (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
          } catch { /* ignore */ }
          if (this.onClick || this.onPointerDown) {
            this.#trackPointerDown(e, idx, ann);
          }
        });
      }
      if (!el.__wheelPassThrough) {
        const onWheel = (e) => {
          if (!el.classList.contains('constraint-label')) return;
          const canvas = this.viewer?.renderer?.domElement;
          if (!canvas) return;
          let canceled = false;
          try {
            const forwarded = new WheelEvent(e.type, {
              bubbles: true,
              cancelable: true,
              deltaX: e.deltaX,
              deltaY: e.deltaY,
              deltaZ: e.deltaZ,
              deltaMode: e.deltaMode,
              clientX: e.clientX,
              clientY: e.clientY,
              screenX: e.screenX,
              screenY: e.screenY,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
              metaKey: e.metaKey,
            });
            canceled = !canvas.dispatchEvent(forwarded);
          } catch { /* ignore */ }
          if (canceled) {
            try { e.preventDefault(); } catch { /* ignore */ }
          }
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        el.__wheelPassThrough = onWheel;
      }
      if (this.onDblClick) el.addEventListener('dblclick', (e) => this.onDblClick(idx, ann, e));
      try { this._root.appendChild(el); this._labelMap.set(idx, el); } catch { /* ignore */ }
    } else if (text != null) {
      const normalized = String(text).replace(/\r\n/g, '\n');
      el.textContent = normalized;
    }

    if (ann && typeof ann.anchorPosition === 'string' && ann.anchorPosition) {
      el.dataset.anchorPosition = ann.anchorPosition;
    } else {
      delete el.dataset.anchorPosition;
    }
    if (worldPos) this._position(el, worldPos);
  }

  getElement(idx) {
    return this._labelMap.get(idx) || null;
  }

  #trackPointerDown(e, idx, ann) {
    if (typeof e !== 'object') return;
    if (e.button != null && e.button !== 0) return; // left-click only
    const entry = {
      idx,
      ann,
      startX: typeof e.clientX === 'number' ? e.clientX : 0,
      startY: typeof e.clientY === 'number' ? e.clientY : 0,
      hasMoved: false,
      dragStarted: false,
      initialEvent: e,
    };
    this._activePointers.set(e.pointerId ?? 'mouse', entry);
    try { window.addEventListener('pointermove', this._onGlobalPointerMove, true); } catch { /* ignore */ }
    try { window.addEventListener('pointerup', this._onGlobalPointerUp, true); } catch { /* ignore */ }
  }

  #handleGlobalPointerMove(ev) {
    const id = ev.pointerId ?? 'mouse';
    const state = this._activePointers.get(id);
    if (!state) return;
    const cx = ev.clientX;
    const cy = ev.clientY;
    if (cx == null || cy == null) {
      state.hasMoved = true;
      return;
    }
    const dx = cx - state.startX;
    const dy = cy - state.startY;
    const threshold = 4;
    if (!state.hasMoved && (dx * dx + dy * dy) >= threshold * threshold) {
      state.hasMoved = true;
      if (!state.dragStarted && this.onPointerDown) {
        state.dragStarted = true;
        try { this.onPointerDown(state.idx, state.ann, state.initialEvent); } catch { /* ignore */ }
      }
    }
  }

  #handleGlobalPointerUp(ev) {
    const id = ev.pointerId ?? 'mouse';
    const state = this._activePointers.get(id);
    if (!state) return;
    this._activePointers.delete(id);
    if (this._activePointers.size === 0) {
      try { window.removeEventListener('pointermove', this._onGlobalPointerMove, true); } catch { /* ignore */ }
      try { window.removeEventListener('pointerup', this._onGlobalPointerUp, true); } catch { /* ignore */ }
    }

    if (state.dragStarted) {
      if (this.onDragEnd) {
        try { this.onDragEnd(state.idx, state.ann, ev); } catch { /* ignore */ }
      }
      return;
    }
    if (!this.onClick) return;
    if (state.hasMoved) return;
    if (ev.button != null && ev.button !== 0) return;
    try { this.onClick(state.idx, state.ann, ev); } catch { /* ignore */ }
  }

  _position(el, world) {
    try {
      const v = this.viewer; if (!v) return;
      const vec = world.clone().project(v.camera);
      const canvasRect = v.renderer.domElement.getBoundingClientRect();
      const rootRect = this._root?.getBoundingClientRect?.() || canvasRect;
      const x = rootRect.left + (vec.x * 0.5 + 0.5) * canvasRect.width;
      const y = rootRect.top + (-vec.y * 0.5 + 0.5) * canvasRect.height;
      const relX = x - rootRect.left;
      const relY = y - rootRect.top;
      el.style.left = `${relX}px`;
      el.style.top = `${relY}px`;
    } catch { /* ignore */ }
  }

  clear() {
    try { this._labelMap.forEach((el) => el?.remove()); } catch { /* ignore */ }
    try { this._labelMap.clear(); } catch { /* ignore */ }
  }

  setVisible(visible) {
    this._visible = !!visible;
    this._ensureRoot();
    if (!this._root) return;
    const display = this._visible ? '' : 'none';
    try {
      this._root.style.display = display;
      this._root.style.pointerEvents = this._visible ? '' : 'none';
    } catch { /* ignore */ }
  }

  isVisible() {
    return this._visible;
  }

  dispose() {
    this.clear();
    try { this._root?.remove(); } catch { /* ignore */ }
    this._root = null;
    this._activePointers.clear();
    try { window.removeEventListener('pointermove', this._onGlobalPointerMove, true); } catch { /* ignore */ }
    try { window.removeEventListener('pointerup', this._onGlobalPointerUp, true); } catch { /* ignore */ }
  }
}
