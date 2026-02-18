import {
  readBrowserStorageValue,
  writeBrowserStorageValue,
  removeBrowserStorageValue,
} from '../utils/browserStorage.js';

const TOUR_STORAGE_KEY = '__BREP_STARTUP_TOUR_DONE__';
const TOUR_STORAGE_VALUE = '1';

const DEFAULT_PADDING = 8;
const CARD_MARGIN = 14;
const MIN_CARD_GAP = 12;

function ensureTourStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('startup-tour-styles')) return;
  const style = document.createElement('style');
  style.id = 'startup-tour-styles';
  style.textContent = `
    .brep-tour-overlay {
      position: fixed;
      inset: 0;
      z-index: 20000;
      pointer-events: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .brep-tour-highlight {
      position: fixed;
      border: 2px solid #6ea8fe;
      border-radius: 10px;
      box-shadow: 0 0 0 9999px rgba(6, 10, 18, 0.7), 0 0 18px rgba(110, 168, 254, 0.4);
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.18s ease, width 0.18s ease, height 0.18s ease;
      opacity: 0;
    }
    .brep-tour-card {
      position: fixed;
      width: min(360px, calc(100vw - 32px));
      background: #0b0e14;
      color: #e5e7eb;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 18px 50px rgba(0,0,0,0.5);
      font-size: 12px;
      line-height: 1.4;
      pointer-events: auto;
    }
    .brep-tour-card.is-center {
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }
    .brep-tour-title {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .brep-tour-body {
      color: #c7cdd7;
      margin-bottom: 10px;
    }
    .brep-tour-progress {
      font-size: 11px;
      color: #9aa4b2;
      margin-bottom: 10px;
    }
    .brep-tour-skipnext {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #c7cdd7;
      margin-bottom: 10px;
      user-select: none;
    }
    .brep-tour-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .brep-tour-action-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .brep-tour-btn {
      border: 1px solid #364053;
      background: rgba(255,255,255,0.04);
      color: #e5e7eb;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      transition: border-color .15s ease, background-color .15s ease, transform .05s ease;
    }
    .brep-tour-btn:hover { border-color: #6ea8fe; background: rgba(110,168,254,0.12); }
    .brep-tour-btn:active { transform: translateY(1px); }
    .brep-tour-btn.primary {
      border-color: #6ea8fe;
      background: linear-gradient(180deg, rgba(110,168,254,.35), rgba(110,168,254,.15));
      color: #e9f0ff;
      box-shadow: 0 0 0 1px rgba(110,168,254,.25) inset;
    }
    .brep-tour-btn[disabled] {
      opacity: 0.45;
      cursor: default;
    }
    .brep-tour-skip {
      border: none;
      background: transparent;
      color: #9aa4b2;
      text-decoration: underline;
      cursor: pointer;
      font-size: 11px;
      padding: 0;
    }
    .brep-tour-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 1px solid #364053;
      background: rgba(255,255,255,0.04);
      color: #e5e7eb;
      cursor: pointer;
      font-weight: 700;
      line-height: 1;
    }
    .brep-tour-close:hover { border-color: #6ea8fe; background: rgba(110,168,254,0.12); }
  `;
  document.head.appendChild(style);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getViewportRect() {
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function isDialogOpen() {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof window.isDialogOpen === 'function') return window.isDialogOpen();
    return !!window.__BREPDialogOpen;
  } catch {
    return false;
  }
}

async function waitForDialogsToClose(timeoutMs = 12000) {
  const start = Date.now();
  while (isDialogOpen()) {
    if (Date.now() - start > timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function getDefaultSteps() {
  return [
    {
      id: 'welcome',
      title: 'Welcome to BREP CAD',
      body: 'This quick tour highlights the main areas. Use Next/Back or the Left/Right arrow keys. Press Esc to exit.',
      target: null,
    },
    {
      id: 'toolbar',
      title: 'Main toolbar',
      body: 'Import, export, save, and view tools live here. Buttons update based on selection.',
      target: () => document.getElementById('main-toolbar'),
      padding: 6,
    },
    {
      id: 'sidebar',
      title: 'Sidebar panels',
      body: 'These panels hold History, Scene Manager, Display Settings, and other tools. Click a header to expand or collapse.',
      target: () => document.getElementById('sidebar'),
      padding: 6,
    },
    {
      id: 'history',
      title: 'History',
      body: 'Your feature history appears here. Use it to reorder, edit, or roll back steps.',
      onEnter: (viewer) => viewer?.accordion?.expandSection?.('History'),
      target: () =>
        document.querySelector('#accordion-content-History') ||
        document.querySelector('[name="accordion-title-History"]'),
      padding: 6,
    },
    {
      id: 'viewport',
      title: '3D viewport',
      body: 'Orbit with left-drag, pan with right-drag, zoom with the wheel. Click geometry to select.',
      target: () => document.getElementById('viewport'),
      padding: 2,
    },
    {
      id: 'done',
      title: 'All set',
      body: 'You are ready to model. Enjoy building.',
      target: null,
    },
  ];
}

export class StartupTour {
  constructor(viewer, { steps = null } = {}) {
    this.viewer = viewer || null;
    this.steps = Array.isArray(steps) && steps.length ? steps : getDefaultSteps();
    this.index = 0;
    this.active = false;
    this._overlay = null;
    this._highlight = null;
    this._card = null;
    this._titleEl = null;
    this._bodyEl = null;
    this._progressEl = null;
    this._skipNextRow = null;
    this._skipNextCheckbox = null;
    this._nextBtn = null;
    this._backBtn = null;
    this._skipBtn = null;
    this._closeBtn = null;
    this._onKeyDown = null;
    this._onReposition = null;
    this._onSkipNextChange = null;
    this._positionRaf = null;
    this._currentTarget = null;
    this._prevSidebarPinned = null;
    this._prevSidebarSuspended = null;
  }

  static isDone() {
    try {
      return readBrowserStorageValue(TOUR_STORAGE_KEY, {
        fallback: '',
      }) === TOUR_STORAGE_VALUE;
    } catch {
      return false;
    }
  }

  static markDone() {
    try { writeBrowserStorageValue(TOUR_STORAGE_KEY, TOUR_STORAGE_VALUE); } catch { }
  }

  async maybeStart() {
    if (StartupTour.isDone()) return false;
    await waitForDialogsToClose();
    this.start();
    return true;
  }

  start() {
    if (this.active) return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('startup-tour-overlay')) return;

    ensureTourStyles();
    this.active = true;
    this.index = 0;

    this._suspendSidebar();
    this._buildUI();
    this._attachEvents();
    this._showStep(this.index);
  }

  _suspendSidebar() {
    const v = this.viewer;
    if (!v) return;
    try {
      if (typeof v._sidebarPinned === 'boolean') this._prevSidebarPinned = v._sidebarPinned;
      if (typeof v._sidebarAutoHideSuspended === 'boolean') this._prevSidebarSuspended = v._sidebarAutoHideSuspended;
      if (typeof v._setSidebarPinned === 'function') v._setSidebarPinned(true);
      if (typeof v._setSidebarAutoHideSuspended === 'function') v._setSidebarAutoHideSuspended(true);
    } catch { }
  }

  _restoreSidebar() {
    const v = this.viewer;
    if (!v) return;
    try {
      if (typeof v._setSidebarPinned === 'function' && this._prevSidebarPinned !== null) {
        v._setSidebarPinned(!!this._prevSidebarPinned);
      }
      if (typeof v._setSidebarAutoHideSuspended === 'function' && this._prevSidebarSuspended !== null) {
        v._setSidebarAutoHideSuspended(!!this._prevSidebarSuspended);
      }
    } catch { }
  }

  _buildUI() {
    const overlay = document.createElement('div');
    overlay.id = 'startup-tour-overlay';
    overlay.className = 'brep-tour-overlay';

    const highlight = document.createElement('div');
    highlight.className = 'brep-tour-highlight';

    const card = document.createElement('div');
    card.className = 'brep-tour-card';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'brep-tour-close';
    closeBtn.type = 'button';
    closeBtn.textContent = 'x';

    const title = document.createElement('div');
    title.className = 'brep-tour-title';

    const body = document.createElement('div');
    body.className = 'brep-tour-body';

    const progress = document.createElement('div');
    progress.className = 'brep-tour-progress';

    const skipNextRow = document.createElement('label');
    skipNextRow.className = 'brep-tour-skipnext';
    const skipNextCheckbox = document.createElement('input');
    skipNextCheckbox.type = 'checkbox';
    skipNextCheckbox.checked = false;
    skipNextCheckbox.style.marginRight = '6px';
    const skipNextText = document.createElement('span');
    skipNextText.textContent = 'Skip tour next time';
    skipNextRow.appendChild(skipNextCheckbox);
    skipNextRow.appendChild(skipNextText);

    const actions = document.createElement('div');
    actions.className = 'brep-tour-actions';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'brep-tour-action-group';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'brep-tour-btn';
    backBtn.textContent = 'Back';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'brep-tour-btn primary';
    nextBtn.textContent = 'Next';

    leftGroup.appendChild(backBtn);
    leftGroup.appendChild(nextBtn);

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'brep-tour-skip';
    skipBtn.textContent = 'Skip tour';

    actions.appendChild(leftGroup);
    actions.appendChild(skipBtn);

    card.appendChild(closeBtn);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(progress);
    card.appendChild(skipNextRow);
    card.appendChild(actions);

    overlay.appendChild(highlight);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._highlight = highlight;
    this._card = card;
    this._titleEl = title;
    this._bodyEl = body;
    this._progressEl = progress;
    this._skipNextRow = skipNextRow;
    this._skipNextCheckbox = skipNextCheckbox;
    this._nextBtn = nextBtn;
    this._backBtn = backBtn;
    this._skipBtn = skipBtn;
    this._closeBtn = closeBtn;
  }

  _attachEvents() {
    if (!this._overlay) return;

    this._onKeyDown = (ev) => {
      if (!this.active) return;
      const key = ev.key;
      if (key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.exit();
        return;
      }
      if (key === 'ArrowRight' || key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        this.next();
        return;
      }
      if (key === 'ArrowLeft') {
        ev.preventDefault();
        ev.stopPropagation();
        this.prev();
      }
    };

    this._onReposition = () => this._schedulePosition();
    this._onSkipNextChange = () => {
      if (!this._skipNextCheckbox) return;
      if (this._skipNextCheckbox.checked) StartupTour.markDone();
      else resetStartupTourFlag();
    };

    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('resize', this._onReposition);
    window.addEventListener('scroll', this._onReposition, true);

    this._nextBtn?.addEventListener('click', () => this.next());
    this._backBtn?.addEventListener('click', () => this.prev());
    this._skipBtn?.addEventListener('click', () => this.exit());
    this._closeBtn?.addEventListener('click', () => this.exit());
    this._skipNextCheckbox?.addEventListener('change', this._onSkipNextChange);
  }

  _detachEvents() {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown, true);
    if (this._onReposition) {
      window.removeEventListener('resize', this._onReposition);
      window.removeEventListener('scroll', this._onReposition, true);
    }
    if (this._skipNextCheckbox && this._onSkipNextChange) {
      this._skipNextCheckbox.removeEventListener('change', this._onSkipNextChange);
    }
    this._onKeyDown = null;
    this._onReposition = null;
    this._onSkipNextChange = null;
  }

  _resolveTarget(step) {
    if (!step || !step.target) return null;
    try {
      if (typeof step.target === 'function') return step.target(this.viewer) || null;
      if (typeof step.target === 'string') return document.querySelector(step.target);
      if (step.target instanceof HTMLElement) return step.target;
    } catch { }
    return null;
  }

  _runStepEnter(step) {
    if (!step || typeof step.onEnter !== 'function') return null;
    try { return step.onEnter(this.viewer, step); } catch { return null; }
  }

  _scrollTargetIntoView(target) {
    if (!target || !target.scrollIntoView) return;
    try {
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch { }
  }

  _showStep(index) {
    if (!this.active) return;
    const step = this.steps[index];
    if (!step) return;
    this.index = index;

    if (this._titleEl) this._titleEl.textContent = step.title || '';
    if (this._bodyEl) this._bodyEl.textContent = step.body || '';
    if (this._progressEl) this._progressEl.textContent = `Step ${index + 1} of ${this.steps.length}`;

    if (this._backBtn) this._backBtn.disabled = index === 0;
    if (this._nextBtn) this._nextBtn.textContent = index === this.steps.length - 1 ? 'Finish' : 'Next';

    const finalize = () => {
      const target = this._resolveTarget(step);
      this._currentTarget = target;
      if (target) this._scrollTargetIntoView(target);
      this._schedulePosition(true);
    };

    const enterResult = this._runStepEnter(step);
    if (enterResult && typeof enterResult.then === 'function') {
      enterResult.then(() => requestAnimationFrame(finalize)).catch(() => requestAnimationFrame(finalize));
    } else {
      requestAnimationFrame(finalize);
    }
  }

  _schedulePosition(force = false) {
    if (!this.active) return;
    if (this._positionRaf && !force) return;
    if (this._positionRaf) cancelAnimationFrame(this._positionRaf);
    this._positionRaf = requestAnimationFrame(() => {
      this._positionRaf = null;
      this._positionCurrent();
    });
  }

  _positionCurrent() {
    if (!this.active || !this._card || !this._highlight) return;

    const step = this.steps[this.index];
    const target = this._currentTarget;
    const viewport = getViewportRect();
    const padding = Number(step?.padding);
    const pad = Number.isFinite(padding) ? padding : DEFAULT_PADDING;

    if (!target || !target.getBoundingClientRect) {
      this._highlight.style.opacity = '0';
      this._highlight.style.width = '0px';
      this._highlight.style.height = '0px';
      this._highlight.style.left = '0px';
      this._highlight.style.top = '0px';
      this._card.classList.add('is-center');
      this._card.style.left = '';
      this._card.style.top = '';
      this._card.style.transform = '';
      return;
    }

    const rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      this._highlight.style.opacity = '0';
      this._highlight.style.width = '0px';
      this._highlight.style.height = '0px';
      this._highlight.style.left = '0px';
      this._highlight.style.top = '0px';
      this._card.classList.add('is-center');
      this._card.style.left = '';
      this._card.style.top = '';
      this._card.style.transform = '';
      return;
    }

    const left = clamp(rect.left - pad, viewport.left + 6, viewport.right - 6);
    const top = clamp(rect.top - pad, viewport.top + 6, viewport.bottom - 6);
    const right = clamp(rect.right + pad, viewport.left + 6, viewport.right - 6);
    const bottom = clamp(rect.bottom + pad, viewport.top + 6, viewport.bottom - 6);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    this._highlight.style.opacity = '1';
    this._highlight.style.left = `${left}px`;
    this._highlight.style.top = `${top}px`;
    this._highlight.style.width = `${width}px`;
    this._highlight.style.height = `${height}px`;

    this._card.classList.remove('is-center');

    const cardRect = this._card.getBoundingClientRect();
    let cardLeft = left;
    let cardTop = bottom + MIN_CARD_GAP;

    if (cardTop + cardRect.height + CARD_MARGIN > viewport.bottom) {
      const above = top - cardRect.height - MIN_CARD_GAP;
      if (above >= CARD_MARGIN) {
        cardTop = above;
      } else {
        cardTop = clamp(viewport.bottom - cardRect.height - CARD_MARGIN, CARD_MARGIN, viewport.bottom - CARD_MARGIN);
      }
    }

    if (cardLeft + cardRect.width + CARD_MARGIN > viewport.right) {
      cardLeft = clamp(viewport.right - cardRect.width - CARD_MARGIN, CARD_MARGIN, viewport.right - CARD_MARGIN);
    }
    if (cardLeft < CARD_MARGIN) cardLeft = CARD_MARGIN;
    if (cardTop < CARD_MARGIN) cardTop = CARD_MARGIN;

    this._card.style.left = `${cardLeft}px`;
    this._card.style.top = `${cardTop}px`;
    this._card.style.transform = 'none';
  }

  next() {
    if (!this.active) return;
    if (this.index >= this.steps.length - 1) {
      this.complete();
      return;
    }
    this._showStep(this.index + 1);
  }

  prev() {
    if (!this.active) return;
    if (this.index <= 0) return;
    this._showStep(this.index - 1);
  }

  exit() {
    if (!this.active) return;
    if (this._skipNextCheckbox?.checked) StartupTour.markDone();
    else resetStartupTourFlag();
    this.destroy();
  }

  complete() {
    if (!this.active) return;
    if (this._skipNextCheckbox?.checked) StartupTour.markDone();
    else resetStartupTourFlag();
    this.destroy();
  }

  destroy() {
    if (!this.active) return;
    this.active = false;

    if (this._positionRaf) cancelAnimationFrame(this._positionRaf);
    this._positionRaf = null;

    this._detachEvents();

    try { this._overlay?.remove(); } catch { }
    this._overlay = null;
    this._highlight = null;
    this._card = null;
    this._titleEl = null;
    this._bodyEl = null;
    this._progressEl = null;
    this._skipNextRow = null;
    this._skipNextCheckbox = null;
    this._nextBtn = null;
    this._backBtn = null;
    this._skipBtn = null;
    this._closeBtn = null;

    this._restoreSidebar();
  }
}

export async function maybeStartStartupTour(viewer, options = {}) {
  const tour = new StartupTour(viewer, options);
  const started = await tour.maybeStart();
  if (!started) return null;
  return tour;
}

export function resetStartupTourFlag() {
  try { removeBrowserStorageValue(TOUR_STORAGE_KEY); } catch { }
}
