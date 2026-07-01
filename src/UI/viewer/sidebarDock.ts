import { readBrowserStorageValue, writeBrowserStorageValue } from '../../utils/browserStorage.js';

import { CAD_MATERIAL_SETTINGS_KEY } from './constants.js';
import { ensureSidebarDockStyles, ensureSidebarResizerStyles } from './styles.js';
import { safe } from './utils.js';

type CleanupFn = () => void;
type ViewerLike = Record<string, any>;
type PersistWidthOptions = {
    persist?: boolean;
};
type DragState = {
    active: boolean;
    startX: number;
    startWidth: number;
    lastWidth: number;
    pointerId: number | null;
    prevCursor: string;
    prevUserSelect: string;
};
type HoverBindOptions = {
    captureSidebarOnLeave?: boolean;
    capturePinOnLeave?: boolean;
    requireSidebarVisible?: boolean;
};
type DomEventListener = Parameters<HTMLElement['addEventListener']>[1];
type DomEventOptions = Parameters<HTMLElement['addEventListener']>[2];

export class SidebarDockController {
    viewer: ViewerLike;
    _cleanup: CleanupFn[];
    _hoverUpdateRaf: number | null;
    _resizer: HTMLDivElement | null;
    _pinTab: HTMLButtonElement | null;
    _hoverStrip: HTMLDivElement | null;

    constructor(viewer: ViewerLike) {
        this.viewer = viewer;
        this._cleanup = [];
        this._hoverUpdateRaf = null;
        this._resizer = null;
        this._pinTab = null;
        this._hoverStrip = null;
    }

    init(): void {
        const v = this.viewer;
        if (!v.sidebar || typeof document === 'undefined' || !document.body) return;
        ensureSidebarResizerStyles();
        ensureSidebarDockStyles();
        this.dispose();

        const removeById = (id: string) => {
            const el = document.getElementById(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        };
        removeById('sidebar-resizer');
        removeById('sidebar-pin-tab');
        removeById('sidebar-hover-strip');

        const on = (
            el: HTMLElement | Window,
            event: string,
            fn: DomEventListener,
            opts?: DomEventOptions,
        ) => {
            el.addEventListener(event, fn, opts);
            this._cleanup.push(() => el.removeEventListener(event, fn, opts));
        };

        const handleWidth = 10;
        const resizer = document.createElement('div');
        resizer.id = 'sidebar-resizer';
        resizer.title = 'Drag to resize sidebar';
        resizer.setAttribute('aria-hidden', 'true');
        resizer.style.width = `${handleWidth}px`;
        resizer.style.cursor = 'ew-resize';
        document.body.appendChild(resizer);
        this._resizer = resizer;
        v._sidebarResizer = resizer;

        const hoverStrip = document.createElement('div');
        hoverStrip.id = 'sidebar-hover-strip';
        hoverStrip.setAttribute('aria-hidden', 'true');
        document.body.appendChild(hoverStrip);
        this._hoverStrip = hoverStrip;
        v._sidebarHoverStrip = hoverStrip;

        const pinTab = document.createElement('button');
        pinTab.id = 'sidebar-pin-tab';
        pinTab.type = 'button';
        pinTab.textContent = '📌';
        pinTab.setAttribute('aria-pressed', 'true');
        pinTab.title = 'Collapse sidebar';
        document.body.appendChild(pinTab);
        this._pinTab = pinTab;
        v._sidebarPinTab = pinTab;

        const hoverTargets = new Set();
        v._sidebarHoverTargets = hoverTargets;

        const updateResizer = () => {
            const sidebar = v.sidebar;
            if (!sidebar) return;
            const rect = sidebar.getBoundingClientRect();
            const hidden = !v._isSidebarVisible();
            if (hidden || rect.width <= 0 || rect.height <= 0) {
                resizer.style.display = 'none';
                return;
            }
            resizer.style.display = '';
            resizer.style.left = `${Math.round(rect.right - handleWidth / 2)}px`;
            resizer.style.top = `${Math.round(rect.top)}px`;
            resizer.style.height = `${Math.round(rect.height)}px`;
        };

        const syncLayout = () => {
            updateResizer();
            v._positionSidebarPinTab();
        };

        const clampWidth = (value: unknown): number => {
            let vNum = Number(value);
            if (!Number.isFinite(vNum)) return 200;
            const input = v.cadMaterialsUi?._widthInput;
            const min = Number(input?.min) || 200;
            const max = Number(input?.max) || 600;
            if (vNum < min) vNum = min; else if (vNum > max) vNum = max;
            return Math.round(vNum);
        };

        const persistWidthFallback = (value: number) => {
            safe(() => {
                const raw = readBrowserStorageValue(CAD_MATERIAL_SETTINGS_KEY, {
                    fallback: '',
                });
                const settings = raw ? JSON.parse(raw) : {};
                settings['__SIDEBAR_WIDTH__'] = value;
                writeBrowserStorageValue(CAD_MATERIAL_SETTINGS_KEY, JSON.stringify(settings, null, 2));
            });
        };

        const applyWidth = (value: unknown, { persist = false }: PersistWidthOptions = {}) => {
            const next = clampWidth(value);
            if (v.cadMaterialsUi && typeof v.cadMaterialsUi.setSidebarWidth === 'function') {
                v.cadMaterialsUi.setSidebarWidth(next, { persist });
            } else if (v.sidebar) {
                v.sidebar.style.width = `${next}px`;
                if (persist) persistWidthFallback(next);
            }
            syncLayout();
            return next;
        };

        const drag: DragState = {
            active: false,
            startX: 0,
            startWidth: 0,
            lastWidth: 0,
            pointerId: null,
            prevCursor: '',
            prevUserSelect: '',
        };

        const startDrag = (ev: PointerEvent) => {
            if (ev.button !== 0 || !v.sidebar) return;
            ev.preventDefault();
            drag.active = true;
            drag.startX = ev.clientX;
            drag.startWidth = v.sidebar.getBoundingClientRect().width;
            drag.lastWidth = drag.startWidth;
            drag.pointerId = ev.pointerId;
            drag.prevCursor = document.body.style.cursor;
            drag.prevUserSelect = document.body.style.userSelect;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            resizer.classList.add('is-active');
            safe(() => resizer.setPointerCapture(ev.pointerId));
        };

        const onDragMove = (ev: PointerEvent) => {
            if (!drag.active) return;
            const delta = ev.clientX - drag.startX;
            drag.lastWidth = applyWidth(drag.startWidth + delta);
        };

        const stopDrag = (persist = true) => {
            if (!drag.active) return;
            drag.active = false;
            resizer.classList.remove('is-active');
            document.body.style.cursor = drag.prevCursor || '';
            document.body.style.userSelect = drag.prevUserSelect || '';
            const finalWidth = Number.isFinite(drag.lastWidth) ? drag.lastWidth : drag.startWidth;
            applyWidth(finalWidth, { persist });
            if (drag.pointerId != null) safe(() => resizer.releasePointerCapture(drag.pointerId));
            drag.pointerId = null;
        };

        on(resizer, 'pointerdown', startDrag);
        on(resizer, 'pointermove', onDragMove);
        on(resizer, 'pointerup', () => stopDrag(true));
        on(resizer, 'pointercancel', () => stopDrag(false));
        on(window, 'pointerup', () => stopDrag(true), true);
        on(window, 'resize', syncLayout);
        this._cleanup.push(() => safe(() => stopDrag(false)));

        if (window.ResizeObserver) {
            const ro = new ResizeObserver(syncLayout);
            ro.observe(v.sidebar);
            this._cleanup.push(() => safe(() => ro.disconnect()));
        }
        if (window.MutationObserver) {
            const mo = new MutationObserver(syncLayout);
            mo.observe(v.sidebar, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
            this._cleanup.push(() => safe(() => mo.disconnect()));
        }

        const scheduleHoverUpdate = () => {
            if (v._sidebarPinned || v._sidebarAutoHideSuspended) return;
            if (this._hoverUpdateRaf != null) cancelAnimationFrame(this._hoverUpdateRaf);
            this._hoverUpdateRaf = requestAnimationFrame(() => {
                this._hoverUpdateRaf = null;
                if (v._sidebarPinned || v._sidebarAutoHideSuspended) return;
                v._setSidebarHoverVisible(hoverTargets.size > 0);
            });
        };

        const isPointIn = (el: HTMLElement | null | undefined, ev: PointerEvent | MouseEvent | null | undefined) => {
            const rect = el?.getBoundingClientRect?.();
            return !!(rect && ev
                && ev.clientX >= rect.left && ev.clientX <= rect.right
                && ev.clientY >= rect.top && ev.clientY <= rect.bottom);
        };

        const bindHover = (
            el: HTMLElement | null | undefined,
            { captureSidebarOnLeave = false, capturePinOnLeave = false, requireSidebarVisible = false }: HoverBindOptions = {},
        ) => {
            if (!el) return;
            const onEnter = () => {
                if (requireSidebarVisible && !v._isSidebarVisible()) return;
                hoverTargets.add(el);
                scheduleHoverUpdate();
            };
            const onLeave = (ev: PointerEvent) => {
                hoverTargets.delete(el);
                const pinTabEl = v._sidebarPinTab;
                if (capturePinOnLeave && pinTabEl) {
                    const related = ev?.relatedTarget;
                    if (related === pinTabEl || (related instanceof Node && pinTabEl.contains?.(related))) {
                        hoverTargets.add(pinTabEl);
                        scheduleHoverUpdate();
                        return;
                    }
                    if (v._isSidebarVisible() && isPointIn(pinTabEl, ev)) {
                        hoverTargets.add(pinTabEl);
                        scheduleHoverUpdate();
                        return;
                    }
                }
                if (captureSidebarOnLeave && v.sidebar && v._isSidebarVisible() && isPointIn(v.sidebar, ev)) {
                    hoverTargets.add(v.sidebar);
                }
                scheduleHoverUpdate();
            };
            on(el, 'pointerenter', onEnter);
            on(el, 'pointerleave', onLeave);
        };

        bindHover(hoverStrip, { captureSidebarOnLeave: true });
        bindHover(pinTab, { captureSidebarOnLeave: true, requireSidebarVisible: true });
        bindHover(v.sidebar, { capturePinOnLeave: true });
        bindHover(resizer, { captureSidebarOnLeave: true, capturePinOnLeave: true });

        on(window, 'pointermove', (ev) => {
            if (!(ev instanceof PointerEvent)) return;
            v._sidebarLastPointer = { x: ev.clientX, y: ev.clientY };
        }, { passive: true });

        on(pinTab, 'click', (ev) => {
            safe(() => { ev.preventDefault(); ev.stopPropagation(); });
            v._setSidebarPinned(!v._sidebarPinned);
        });

        this._cleanup.push(() => {
            if (this._hoverUpdateRaf != null) cancelAnimationFrame(this._hoverUpdateRaf);
            this._hoverUpdateRaf = null;
        });

        syncLayout();
        v._syncSidebarVisibility();
    }

    dispose(): void {
        this._cleanup.forEach((fn) => safe(fn));
        this._cleanup.length = 0;
        if (this._hoverUpdateRaf != null) cancelAnimationFrame(this._hoverUpdateRaf);
        this._hoverUpdateRaf = null;
        const v = this.viewer;
        const remove = (el: HTMLElement | null) => { if (el && el.parentNode) el.parentNode.removeChild(el); };
        remove(this._resizer);
        remove(this._hoverStrip);
        remove(this._pinTab);
        if (v._sidebarResizer === this._resizer) v._sidebarResizer = null;
        if (v._sidebarHoverStrip === this._hoverStrip) v._sidebarHoverStrip = null;
        if (v._sidebarPinTab === this._pinTab) v._sidebarPinTab = null;
        v._sidebarHoverTargets = null;
        this._resizer = null;
        this._pinTab = null;
        this._hoverStrip = null;
    }
}
