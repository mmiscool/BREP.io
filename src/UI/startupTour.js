import * as THREE from 'three';
import {
  readBrowserStorageValue,
  writeBrowserStorageValue,
  removeBrowserStorageValue,
} from '../utils/browserStorage.js';
import { SelectionFilter } from './SelectionFilter.js';
import { SchemaForm } from './featureDialogs.js';

const TOUR_STORAGE_KEY = '__BREP_STARTUP_TOUR_DONE__';
const TOUR_STORAGE_VALUE = '1';

const DEFAULT_PADDING = 8;
const CARD_MARGIN = 14;
const MIN_CARD_GAP = 12;
const CURSOR_MOVE_MS = 320;
const CURSOR_CLICK_MS = 140;
const CURSOR_TYPE_MS = 70;
const TOUR_CANCELLED = '__BREP_STARTUP_TOUR_CANCELLED__';

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function shouldSkipStartupTourForRuntime() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    return isLoopbackHostname(window.location.hostname);
  } catch {
    return false;
  }
}

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
    .brep-tour-cursor {
      position: fixed;
      left: 0;
      top: 0;
      width: 24px;
      height: 24px;
      pointer-events: none;
      transform: translate(-2px, -2px) scale(0.9);
      opacity: 0;
      transition: opacity 0.16s ease;
      z-index: 20001;
    }
    .brep-tour-cursor.is-visible {
      opacity: 1;
    }
    .brep-tour-cursor.is-clicking {
      transform: translate(-2px, -2px) scale(0.82);
    }
    .brep-tour-cursor-pointer {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, #ffffff, #d7deeb);
      clip-path: polygon(0 0, 0 72%, 18% 58%, 29% 100%, 45% 93%, 33% 53%, 64% 53%);
      border: 1px solid rgba(15, 23, 42, 0.85);
      filter: drop-shadow(0 4px 10px rgba(0,0,0,0.48));
      border-radius: 3px;
    }
    .brep-tour-cursor-ring {
      position: absolute;
      left: 5px;
      top: 5px;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(110, 168, 254, 0.95);
      border-radius: 999px;
      opacity: 0;
      transform: scale(0.45);
    }
    .brep-tour-cursor.is-clicking .brep-tour-cursor-ring {
      animation: brep-tour-cursor-ring 0.32s ease-out;
    }
    .brep-tour-cursor-label {
      position: absolute;
      left: 26px;
      top: -4px;
      padding: 4px 7px;
      border-radius: 999px;
      border: 1px solid rgba(110, 168, 254, 0.38);
      background: rgba(11, 14, 20, 0.92);
      color: #dbe6ff;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.02em;
      white-space: nowrap;
      box-shadow: 0 10px 24px rgba(0,0,0,0.35);
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .brep-tour-cursor.has-label .brep-tour-cursor-label {
      opacity: 1;
    }
    @keyframes brep-tour-cursor-ring {
      0% { opacity: 0.92; transform: scale(0.45); }
      100% { opacity: 0; transform: scale(2.2); }
    }
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
      id: 'live-demo-cube',
      title: 'Demo: Add Cube',
      body: 'Click Next to reach this step and the tour creates a real Primitive Cube from the History add menu. This shows how feature-based CAD starts with a timeline entry instead of raw one-off geometry.',
      target: () =>
        document.querySelector('#accordion-content-History') ||
        document.querySelector('[name="accordion-title-History"]'),
      padding: 6,
      onEnter: (_viewer, _step, tour) => tour?.runLiveDemoAddCube?.(),
    },
    {
      id: 'live-demo-cube-resize',
      title: 'Demo: Resize Cube',
      body: 'On this step the tour edits the cube by dragging its viewport arrow grip. The drag updates the cube feature parameter and reruns the model live, so the history stays editable without typing into a size box.',
      target: () => document.getElementById('viewport'),
      padding: 2,
      onEnter: (_viewer, _step, tour) => tour?.runLiveDemoResizeCube?.(),
    },
    {
      id: 'live-demo-cylinder',
      title: 'Demo: Add Cylinder',
      body: 'This step adds a Primitive Cylinder as a second history feature. It becomes the tool body for the next operation, which is why the timeline matters: later features can depend on earlier ones.',
      target: () =>
        document.querySelector('#accordion-content-History') ||
        document.querySelector('[name="accordion-title-History"]'),
      padding: 6,
      onEnter: (_viewer, _step, tour) => tour?.runLiveDemoAddCylinder?.(),
    },
    {
      id: 'live-demo-cylinder-position',
      title: 'Demo: Position Cylinder',
      body: 'Now the tour repositions the cylinder with its transform controls so it passes through the cube. This separates the shape definition from placement, which keeps the design intent clear in the history.',
      target: () => document.getElementById('viewport'),
      padding: 2,
      onEnter: (_viewer, _step, tour) => tour?.runLiveDemoPositionCylinder?.(),
    },
    {
      id: 'live-demo-boolean',
      title: 'Demo: Boolean Subtract',
      body: 'This step creates a Boolean feature, chooses the cube as the target, and uses the cylinder as the subtract tool. Because everything is in history, changing the cube or cylinder later will propagate through this cut.',
      target: () => document.getElementById('viewport'),
      padding: 2,
      onEnter: (_viewer, _step, tour) => tour?.runLiveDemoBooleanSubtract?.(),
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
    this._cursor = null;
    this._cursorLabel = null;
    this._cursorPos = {
      x: Math.max(24, Math.round((typeof window !== 'undefined' ? window.innerWidth : 800) * 0.5)),
      y: Math.max(24, Math.round((typeof window !== 'undefined' ? window.innerHeight : 600) * 0.5)),
    };
    this._stepRunToken = 0;
    this._liveDemoPrepared = false;
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
    if (shouldSkipStartupTourForRuntime()) return false;
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

    const cursor = document.createElement('div');
    cursor.className = 'brep-tour-cursor';
    const cursorPointer = document.createElement('div');
    cursorPointer.className = 'brep-tour-cursor-pointer';
    const cursorRing = document.createElement('div');
    cursorRing.className = 'brep-tour-cursor-ring';
    const cursorLabel = document.createElement('div');
    cursorLabel.className = 'brep-tour-cursor-label';
    cursor.appendChild(cursorPointer);
    cursor.appendChild(cursorRing);
    cursor.appendChild(cursorLabel);

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
    overlay.appendChild(cursor);
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
    this._cursor = cursor;
    this._cursorLabel = cursorLabel;
    this._applyCursorPosition();
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
    try { return step.onEnter(this.viewer, step, this); } catch { return null; }
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
    this._cancelActiveStepWork();
    this.index = index;

    if (this._titleEl) this._titleEl.textContent = step.title || '';
    if (this._bodyEl) this._bodyEl.textContent = step.body || '';
    if (this._progressEl) this._progressEl.textContent = `Step ${index + 1} of ${this.steps.length}`;

    if (this._backBtn) this._backBtn.disabled = index === 0;
    if (this._nextBtn) this._nextBtn.textContent = index === this.steps.length - 1 ? 'Finish' : 'Next';

    const token = this._stepRunToken;
    const finalize = () => {
      if (!this._isStepTokenActive(token)) return;
      const target = this._resolveTarget(step);
      this._currentTarget = target;
      if (target) this._scrollTargetIntoView(target);
      this._schedulePosition(true);
    };

    requestAnimationFrame(finalize);

    const enterResult = this._runStepEnter(step);
    if (enterResult && typeof enterResult.then === 'function') {
      enterResult.then(() => requestAnimationFrame(finalize)).catch(() => requestAnimationFrame(finalize));
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
    this._cancelActiveStepWork();

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
    this._cursor = null;
    this._cursorLabel = null;

    this._restoreSidebar();
  }

  _cancelActiveStepWork() {
    this._stepRunToken += 1;
    this._setCursorVisible(false);
    this._setCursorLabel('');
  }

  _isStepTokenActive(token) {
    return this.active && token === this._stepRunToken;
  }

  _assertStepToken(token) {
    if (!this._isStepTokenActive(token)) {
      const error = new Error(TOUR_CANCELLED);
      error.code = TOUR_CANCELLED;
      throw error;
    }
  }

  async _sleep(ms, token = this._stepRunToken) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    this._assertStepToken(token);
  }

  async _waitFor(predicate, {
    timeoutMs = 8000,
    intervalMs = 50,
    token = this._stepRunToken,
  } = {}) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      this._assertStepToken(token);
      let value = null;
      try { value = predicate(); } catch { }
      if (value) return value;
      await this._sleep(intervalMs, token);
    }
    throw new Error('Startup tour timed out waiting for UI state.');
  }

  _setStepBody(text) {
    if (this._bodyEl) this._bodyEl.textContent = String(text || '');
  }

  _applyCursorPosition() {
    if (!this._cursor) return;
    this._cursor.style.left = `${Math.round(this._cursorPos.x)}px`;
    this._cursor.style.top = `${Math.round(this._cursorPos.y)}px`;
  }

  _setCursorVisible(visible) {
    if (!this._cursor) return;
    this._cursor.classList.toggle('is-visible', !!visible);
  }

  _setCursorLabel(text = '') {
    if (!this._cursor || !this._cursorLabel) return;
    const next = String(text || '').trim();
    this._cursor.classList.toggle('has-label', !!next);
    this._cursorLabel.textContent = next;
  }

  async _moveCursorTo(x, y, {
    duration = CURSOR_MOVE_MS,
    token = this._stepRunToken,
    label = '',
  } = {}) {
    this._assertStepToken(token);
    const nextX = Number(x);
    const nextY = Number(y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    this._setCursorLabel(label);
    this._setCursorVisible(true);
    const startX = Number(this._cursorPos.x) || 0;
    const startY = Number(this._cursorPos.y) || 0;
    const total = Math.max(80, Number(duration) || CURSOR_MOVE_MS);
    const started = performance.now();
    await new Promise((resolve, reject) => {
      const tick = (now) => {
        if (!this._isStepTokenActive(token)) {
          reject(Object.assign(new Error(TOUR_CANCELLED), { code: TOUR_CANCELLED }));
          return;
        }
        const elapsed = now - started;
        const t = Math.min(1, elapsed / total);
        const eased = 1 - ((1 - t) * (1 - t) * (1 - t));
        this._cursorPos.x = startX + ((nextX - startX) * eased);
        this._cursorPos.y = startY + ((nextY - startY) * eased);
        this._applyCursorPosition();
        if (t >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    this._assertStepToken(token);
  }

  _getElementPoint(element) {
    if (!element?.getBoundingClientRect) return null;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + (rect.width * 0.5),
      y: rect.top + (rect.height * 0.5),
      rect,
    };
  }

  async _waitForStableElementPoint(element, {
    token = this._stepRunToken,
    timeoutMs = 1200,
    intervalMs = 34,
  } = {}) {
    let previous = null;
    return this._waitFor(() => {
      const point = this._getElementPoint(element);
      if (!point) {
        previous = null;
        return null;
      }
      if (!previous) {
        previous = point;
        return null;
      }
      const dx = Math.abs(point.x - previous.x);
      const dy = Math.abs(point.y - previous.y);
      const dw = Math.abs((point.rect?.width || 0) - (previous.rect?.width || 0));
      const dh = Math.abs((point.rect?.height || 0) - (previous.rect?.height || 0));
      previous = point;
      if (dx <= 1 && dy <= 1 && dw <= 1 && dh <= 1) return point;
      return null;
    }, {
      timeoutMs,
      intervalMs,
      token,
    });
  }

  async _moveCursorToElement(element, options = {}) {
    const token = options?.token ?? this._stepRunToken;
    let point = null;
    try {
      point = await this._waitForStableElementPoint(element, { token });
    } catch {
      point = this._getElementPoint(element);
    }
    if (!point) return;
    await this._moveCursorTo(point.x, point.y, options);
    const settledPoint = this._getElementPoint(element);
    if (!settledPoint) return;
    const dx = Math.abs((Number(this._cursorPos.x) || 0) - settledPoint.x);
    const dy = Math.abs((Number(this._cursorPos.y) || 0) - settledPoint.y);
    if (dx > 2 || dy > 2) {
      await this._moveCursorTo(settledPoint.x, settledPoint.y, {
        ...options,
        duration: Math.min(180, Number(options?.duration) || CURSOR_MOVE_MS),
      });
    }
  }

  _dispatchPointerEvent(target, type, clientX, clientY) {
    if (!target?.dispatchEvent) return;
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
      buttons: type === 'pointerup' || type === 'mouseup' ? 0 : 1,
      view: window,
    };
    try {
      if (typeof PointerEvent === 'function' && type.startsWith('pointer')) {
        target.dispatchEvent(new PointerEvent(type, init));
        return;
      }
    } catch { }
    try {
      target.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), init));
    } catch { }
  }

  async _dragCursorTo(x, y, {
    duration = Math.max(CURSOR_MOVE_MS * 1.8, 560),
    token = this._stepRunToken,
    label = '',
    moveTarget = window,
  } = {}) {
    this._assertStepToken(token);
    const nextX = Number(x);
    const nextY = Number(y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    this._setCursorLabel(label);
    this._setCursorVisible(true);
    const startX = Number(this._cursorPos.x) || 0;
    const startY = Number(this._cursorPos.y) || 0;
    const total = Math.max(120, Number(duration) || CURSOR_MOVE_MS);
    const steps = Math.max(8, Math.round(total / 24));

    for (let index = 1; index <= steps; index += 1) {
      this._assertStepToken(token);
      const t = index / steps;
      const eased = 1 - ((1 - t) * (1 - t) * (1 - t));
      const currentX = startX + ((nextX - startX) * eased);
      const currentY = startY + ((nextY - startY) * eased);
      this._cursorPos.x = currentX;
      this._cursorPos.y = currentY;
      this._applyCursorPosition();
      this._dispatchPointerEvent(moveTarget, 'pointermove', currentX, currentY);
      await this._sleep(total / steps, token);
    }
  }

  async _pulseCursor(token = this._stepRunToken) {
    this._assertStepToken(token);
    if (this._cursor) this._cursor.classList.add('is-clicking');
    await this._sleep(CURSOR_CLICK_MS, token);
    if (this._cursor) this._cursor.classList.remove('is-clicking');
  }

  async _clickElement(element, {
    token = this._stepRunToken,
    label = 'Click',
    duration = CURSOR_MOVE_MS,
  } = {}) {
    if (!element) throw new Error('Tour click target is missing.');
    if (typeof element.scrollIntoView === 'function') {
      try { element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }); } catch { }
    }
    await this._sleep(80, token);
    await this._moveCursorToElement(element, { duration, token, label });
    let point = null;
    try {
      point = await this._waitForStableElementPoint(element, { token, timeoutMs: 800 });
    } catch {
      point = this._getElementPoint(element);
    }
    const x = point?.x ?? this._cursorPos.x;
    const y = point?.y ?? this._cursorPos.y;
    this._dispatchPointerEvent(element, 'pointerdown', x, y);
    await this._pulseCursor(token);
    this._dispatchPointerEvent(element, 'pointerup', x, y);
    try { element.focus?.(); } catch { }
    try { element.click?.(); } catch {
      try {
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          view: window,
        }));
      } catch { }
    }
    await this._sleep(120, token);
  }

  async _typeIntoInput(inputEl, value, {
    token = this._stepRunToken,
    label = 'Type',
  } = {}) {
    if (!inputEl) throw new Error('Tour input target is missing.');
    await this._clickElement(inputEl, { token, label });
    try { inputEl.focus?.(); } catch { }
    const text = String(value ?? '');
    try {
      inputEl.value = '';
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    } catch { }
    for (const char of text) {
      this._assertStepToken(token);
      try {
        inputEl.value = `${inputEl.value || ''}${char}`;
        inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      } catch { }
      await this._sleep(CURSOR_TYPE_MS, token);
    }
    try { inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch { }
    await this._sleep(140, token);
  }

  async _changeSelectValue(selectEl, value, {
    token = this._stepRunToken,
    label = 'Choose',
  } = {}) {
    if (!selectEl) throw new Error('Tour select target is missing.');
    await this._clickElement(selectEl, { token, label });
    selectEl.value = String(value);
    try { selectEl.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch { }
    try { selectEl.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch { }
    await this._sleep(180, token);
  }

  _getHistoryShadowRoot() {
    return this.viewer?.historyWidget?.uiElement?.shadowRoot || null;
  }

  async _waitForFeatureForm(entryId, token) {
    const historyWidget = this.viewer?.historyWidget || null;
    await this._waitFor(() => {
      historyWidget?.revealEntry?.(entryId, { focus: false, scroll: true, notify: false });
      return historyWidget?.getFormForEntry?.(entryId) || null;
    }, { timeoutMs: 12000, token });
    return historyWidget?.getFormForEntry?.(entryId) || null;
  }

  _getFormRow(form, key) {
    const root = form?.uiElement?.shadowRoot || form?._shadow || null;
    return root?.querySelector?.(`[data-key="${CSS.escape(String(key))}"]`) || null;
  }

  _getLatestFeature() {
    const features = Array.isArray(this.viewer?.partHistory?.features) ? this.viewer.partHistory.features : [];
    return features.length ? features[features.length - 1] : null;
  }

  _getFeatureEntryId(feature) {
    return feature?.inputParams?.id || feature?.id || null;
  }

  _findFeatureByShortName(shortName) {
    const wanted = String(shortName || '').trim().toUpperCase();
    if (!wanted) return null;
    const features = Array.isArray(this.viewer?.partHistory?.features) ? this.viewer.partHistory.features : [];
    return features.find((feature) => String(feature?.constructor?.shortName || feature?.type || '').trim().toUpperCase() === wanted) || null;
  }

  _isCloseToValue(value, expected, tolerance = 0.11) {
    const left = Number(value);
    const right = Number(expected);
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
  }

  async _createFeatureFromHistoryMenu(featureLabel, token) {
    const historyShadow = this._getHistoryShadowRoot();
    const partHistory = this.viewer?.partHistory;
    if (!historyShadow || !partHistory) throw new Error('History UI is not ready.');
    const beforeCount = Array.isArray(partHistory.features) ? partHistory.features.length : 0;
    const addBtn = historyShadow.querySelector('.hc-add-btn');
    if (!addBtn) throw new Error('History add button is missing.');
    await this._clickElement(addBtn, { token, label: 'Add feature' });
    const menuItem = await this._waitFor(() => {
      const items = Array.from(historyShadow.querySelectorAll('.hc-menu-item'));
      return items.find((item) => String(item.textContent || '').trim() === String(featureLabel).trim()) || null;
    }, { token });
    await this._clickElement(menuItem, { token, label: featureLabel });
    await this._waitFor(() => {
      const features = Array.isArray(partHistory.features) ? partHistory.features : [];
      return features.length > beforeCount ? features[features.length - 1] : null;
    }, { timeoutMs: 12000, token });
    const feature = this._getLatestFeature();
    const entryId = feature?.inputParams?.id || feature?.id || null;
    if (!entryId) throw new Error(`Failed to resolve ${featureLabel} entry id.`);
    await this._waitForFeatureForm(entryId, token);
    await this._sleep(200, token);
    return feature;
  }

  async _pickSceneReference(objectName, {
    token = this._stepRunToken,
    label = 'Select',
  } = {}) {
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene || null;
    const object = scene?.getObjectByName?.(String(objectName || '')) || null;
    if (!object) throw new Error(`Scene object "${objectName}" is not available.`);
    const point = this._projectObjectToScreen(object);
    try { SelectionFilter.ensureSelectionHandlers?.(object, { deep: true }); } catch { }
    try { SelectionFilter.setHoverObject?.(object, { ignoreFilter: true }); } catch { }
    await this._moveCursorTo(point.x, point.y, { duration: CURSOR_MOVE_MS, token, label });
    await this._pulseCursor(token);
    const pointerEvent = this._buildScenePointerEvent(point.x, point.y);
    try {
      if (typeof object.onClick === 'function') object.onClick(pointerEvent);
      else SelectionFilter.toggleSelection?.(object, { pointerEvent });
    } catch {
      SelectionFilter.toggleSelection?.(object, { pointerEvent });
    }
    try { this.viewer?.render?.(); } catch { }
    await this._sleep(160, token);
    try { SelectionFilter.clearHover?.(); } catch { }
  }

  _projectObjectToScreen(object) {
    const viewport = document.getElementById('viewport');
    const fallbackRect = viewport?.getBoundingClientRect?.() || getViewportRect();
    try {
      const camera = this.viewer?.camera;
      if (!camera || !object) {
        return {
          x: fallbackRect.left + (fallbackRect.width * 0.5),
          y: fallbackRect.top + (fallbackRect.height * 0.5),
        };
      }
      const box = new THREE.Box3().setFromObject(object);
      const center = new THREE.Vector3();
      if (!box.isEmpty()) box.getCenter(center);
      else {
        object.getWorldPosition?.(center);
      }
      center.project(camera);
      const x = fallbackRect.left + ((center.x + 1) * 0.5 * fallbackRect.width);
      const y = fallbackRect.top + ((1 - center.y) * 0.5 * fallbackRect.height);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } catch { }
    return {
      x: fallbackRect.left + (fallbackRect.width * 0.5),
      y: fallbackRect.top + (fallbackRect.height * 0.5),
    };
  }

  _buildScenePointerEvent(clientX, clientY) {
    const canvas = this.viewer?.renderer?.domElement || document.getElementById('viewport') || null;
    return {
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      target: canvas,
      currentTarget: canvas,
      preventDefault() { },
      stopPropagation() { },
    };
  }

  _getFeatureDimensionOverlay() {
    return this.viewer?.historyWidget?._featureDimensionOverlay || null;
  }

  _findHistoryFeatureEntry(entryId) {
    const wanted = entryId != null ? String(entryId) : '';
    if (!wanted) return null;
    const features = Array.isArray(this.viewer?.partHistory?.features) ? this.viewer.partHistory.features : [];
    return features.find((feature) => {
      const featureId = feature?.inputParams?.id ?? feature?.id ?? null;
      return featureId != null && String(featureId) === wanted;
    }) || null;
  }

  _projectWorldPointToScreen(worldPoint) {
    const viewport = document.getElementById('viewport');
    const fallbackRect = viewport?.getBoundingClientRect?.() || getViewportRect();
    const point = worldPoint?.clone?.() || null;
    try {
      const camera = this.viewer?.camera;
      if (!camera || !point) {
        return {
          x: fallbackRect.left + (fallbackRect.width * 0.5),
          y: fallbackRect.top + (fallbackRect.height * 0.5),
        };
      }
      point.project(camera);
      const x = fallbackRect.left + ((point.x + 1) * 0.5 * fallbackRect.width);
      const y = fallbackRect.top + ((1 - point.y) * 0.5 * fallbackRect.height);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } catch { }
    return {
      x: fallbackRect.left + (fallbackRect.width * 0.5),
      y: fallbackRect.top + (fallbackRect.height * 0.5),
    };
  }

  _getFeatureDimensionHandle(entryId, fieldKey, role = 'end') {
    const overlay = this._getFeatureDimensionOverlay();
    if (!overlay) return null;
    const annotationId = `${String(entryId)}:${String(fieldKey)}`;
    const record = overlay._labelRecords?.get?.(annotationId) || null;
    const mesh = (Array.isArray(overlay._arrowPickMeshes) ? overlay._arrowPickMeshes : []).find((candidate) => {
      const meta = candidate?.userData?.featureDimension || null;
      return meta?.annotationId === annotationId
        && meta?.role === role;
    }) || null;
    if (!record?.annotation || !mesh) return null;
    return {
      overlay,
      annotationId,
      annotation: record.annotation,
      mesh,
    };
  }

  async _waitForFeatureDimensionHandle(entryId, fieldKey, token, role = 'end') {
    await this._waitFor(() => {
      try { this.viewer?.historyWidget?.revealEntry?.(entryId, { focus: false, scroll: true, notify: false }); } catch { }
      try { this._getFeatureDimensionOverlay()?.refresh?.(); } catch { }
      try { this.viewer?.render?.(); } catch { }
      return this._getFeatureDimensionHandle(entryId, fieldKey, role);
    }, {
      timeoutMs: 10000,
      token,
    });
    return this._getFeatureDimensionHandle(entryId, fieldKey, role);
  }

  _activeTransformMatchesEntry(active, entryId) {
    if (!active?.controls || !active?.target) return false;
    if (active.viewer && active.viewer !== this.viewer) return false;
    const feature = this._findHistoryFeatureEntry(entryId);
    const expectedIds = [
      entryId,
      feature?.inputParams?.featureID,
      feature?.inputParams?.id,
      feature?.id,
    ]
      .filter((value) => value != null)
      .map((value) => String(value));
    if (!expectedIds.length) return true;
    if (active.entryId == null) return true;
    return expectedIds.includes(String(active.entryId));
  }

  _getActiveTransformState(entryId = null) {
    const active = SchemaForm?.getActiveTransformState?.() || SchemaForm?.__activeXform || null;
    if (!active?.controls || !active?.target) return null;
    if (entryId != null && !this._activeTransformMatchesEntry(active, entryId)) return null;
    return active;
  }

  _findTransformHandle(controls, kind, axis = null) {
    const root = controls?.gizmo?.root || controls?.gizmo || controls || null;
    if (!root?.traverse) return null;
    let found = null;
    root.traverse((child) => {
      if (found || !child?.isObject3D) return;
      const handle = child.userData?.handle || null;
      if (!handle || handle.kind !== kind) return;
      if (axis != null && handle.axis !== axis) return;
      found = child;
    });
    return found;
  }

  _buildRayFromScreenPoint(clientX, clientY) {
    const camera = this.viewer?.camera || null;
    const canvas = this.viewer?.renderer?.domElement || document.getElementById('viewport') || null;
    if (!camera || !canvas?.getBoundingClientRect) return null;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const raycaster = new THREE.Raycaster();
    try { camera.updateMatrixWorld?.(true); } catch { }
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const ray = raycaster.ray.clone();
    if (camera.isOrthographicCamera) {
      ray.origin.add(ray.direction.clone().multiplyScalar(-1000));
    } else if (camera.isPerspectiveCamera) {
      ray.origin.copy(camera.position);
    }
    return ray;
  }

  async _activateTransformFromFeatureDimensionHandle(entryId, fieldKey, token, role = 'start') {
    const handle = await this._waitForFeatureDimensionHandle(entryId, fieldKey, token, role);
    const canvas = this.viewer?.renderer?.domElement || document.getElementById('viewport') || null;
    if (!handle?.mesh || !canvas) {
      throw new Error(`Feature dimension handle for ${fieldKey}:${role} is not available.`);
    }

    const handleWorld = new THREE.Vector3();
    try { handle.mesh.getWorldPosition(handleWorld); } catch { }
    const handleScreen = this._projectWorldPointToScreen(handleWorld);
    await this._moveCursorTo(handleScreen.x, handleScreen.y, {
      duration: CURSOR_MOVE_MS,
      token,
      label: 'Center point',
    });

    this._dispatchPointerEvent(canvas, 'pointerdown', handleScreen.x, handleScreen.y);
    await this._pulseCursor(token);
    this._dispatchPointerEvent(window, 'pointerup', handleScreen.x, handleScreen.y);
    await this._sleep(180, token);

    return this._waitFor(() => this._getActiveTransformState(entryId), {
      timeoutMs: 5000,
      token,
    });
  }

  async _dragActiveTransformAxisToValue(entryId, axis, targetValue, {
    token = this._stepRunToken,
    label = 'Drag',
  } = {}) {
    const axisKey = String(axis || '').trim().toUpperCase();
    const axisIndex = axisKey === 'X' ? 0 : axisKey === 'Y' ? 1 : axisKey === 'Z' ? 2 : -1;
    if (axisIndex < 0) throw new Error(`Unsupported transform axis: ${axis}`);

    const active = await this._waitFor(() => this._getActiveTransformState(entryId), {
      timeoutMs: 5000,
      token,
    });
    const canvas = this.viewer?.renderer?.domElement || document.getElementById('viewport') || null;
    if (!canvas) throw new Error('Viewport canvas is not available for transform drag.');

    const currentValue = Number(active?.target?.position?.getComponent?.(axisIndex));
    if (Number.isFinite(currentValue) && Math.abs(currentValue - Number(targetValue)) <= 0.11) return;

    const handle = this._findTransformHandle(active.controls, 'translate', axisKey);
    if (!handle) throw new Error(`Translate handle for ${axisKey} is not available.`);

    const handleWorld = new THREE.Vector3();
    const targetWorld = new THREE.Vector3();
    try { handle.getWorldPosition(handleWorld); } catch { }
    try { active.target.getWorldPosition(targetWorld); } catch {
      targetWorld.copy(active.target.position || new THREE.Vector3());
    }

    const handleScreen = this._projectWorldPointToScreen(handleWorld);
    const cameraDir = this.viewer?.camera?.getWorldDirection?.(new THREE.Vector3()) || null;
    if (!cameraDir || cameraDir.lengthSq() <= 1e-12) {
      throw new Error(`Camera direction is not available for ${axisKey} transform drag.`);
    }
    cameraDir.normalize();

    const ray = this._buildRayFromScreenPoint(handleScreen.x, handleScreen.y);
    if (!ray) throw new Error(`Failed to build pointer ray for ${axisKey} transform drag.`);

    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDir, targetWorld);
    const dragStart = ray.intersectPlane(dragPlane, new THREE.Vector3());
    if (!dragStart) throw new Error(`Failed to resolve drag start plane for ${axisKey}.`);

    const axisWorld = typeof active.controls?._axisWorld === 'function'
      ? active.controls._axisWorld(axisKey)
      : new THREE.Vector3(
        axisKey === 'X' ? 1 : 0,
        axisKey === 'Y' ? 1 : 0,
        axisKey === 'Z' ? 1 : 0,
      ).applyQuaternion(active.controls?.quaternion || new THREE.Quaternion()).normalize();
    const planeDirection = axisWorld.clone().addScaledVector(
      cameraDir,
      -axisWorld.dot(cameraDir),
    );
    const planeDirectionSq = planeDirection.lengthSq();
    if (!(planeDirectionSq > 1e-9)) {
      throw new Error(`Transform drag plane for ${axisKey} is degenerate.`);
    }

    const delta = Number(targetValue) - (Number.isFinite(currentValue) ? currentValue : 0);
    const targetPoint = dragStart.clone().addScaledVector(planeDirection, delta / planeDirectionSq);
    const targetScreen = this._projectWorldPointToScreen(targetPoint);

    await this._moveCursorTo(handleScreen.x, handleScreen.y, {
      duration: CURSOR_MOVE_MS,
      token,
      label,
    });
    this._dispatchPointerEvent(canvas, 'pointerdown', handleScreen.x, handleScreen.y);
    await this._waitFor(() => this._getActiveTransformState(entryId)?.controls?.dragging, {
      timeoutMs: 2000,
      token,
    });
    await this._dragCursorTo(targetScreen.x, targetScreen.y, {
      duration: Math.max(CURSOR_MOVE_MS * 2, 720),
      token,
      label,
      moveTarget: window,
    });
    this._dispatchPointerEvent(window, 'pointerup', targetScreen.x, targetScreen.y);
    await this._sleep(260, token);
    await this._waitFor(() => {
      const feature = this._findHistoryFeatureEntry(entryId);
      const nextValue = Number(feature?.inputParams?.transform?.position?.[axisIndex]);
      return Math.abs(nextValue - Number(targetValue)) <= 0.11;
    }, {
      timeoutMs: 8000,
      token,
    });
  }

  async _dragLinearFeatureDimension(entryId, fieldKey, targetValue, {
    token = this._stepRunToken,
    label = 'Drag',
  } = {}) {
    const handle = await this._waitForFeatureDimensionHandle(entryId, fieldKey, token);
    const canvas = this.viewer?.renderer?.domElement || document.getElementById('viewport') || null;
    if (!handle?.mesh || !canvas) throw new Error(`Feature dimension handle for ${fieldKey} is not available.`);

    const handleWorld = new THREE.Vector3();
    try { handle.mesh.getWorldPosition(handleWorld); } catch { }
    const handleScreen = this._projectWorldPointToScreen(handleWorld);
    await this._moveCursorTo(handleScreen.x, handleScreen.y, {
      duration: CURSOR_MOVE_MS,
      token,
      label,
    });

    this._dispatchPointerEvent(canvas, 'pointerdown', handleScreen.x, handleScreen.y);
    await this._sleep(120, token);

    const overlay = handle.overlay;
    const dragState = await this._waitFor(() => {
      const state = overlay?._dragState || null;
      return state?.annotation?.fieldKey === fieldKey ? state : null;
    }, {
      timeoutMs: 1800,
      token,
    });

    const planeNormal = dragState?.plane?.normal?.clone?.() || null;
    const direction = dragState?.direction?.clone?.() || null;
    const startPoint = dragState?.startPoint?.clone?.() || null;
    const startValue = Number(dragState?.startValue);
    if (!planeNormal || !direction || !startPoint || !Number.isFinite(startValue)) {
      throw new Error(`Feature dimension drag state for ${fieldKey} is incomplete.`);
    }

    const planeDirection = direction.clone().addScaledVector(
      planeNormal,
      -direction.dot(planeNormal),
    );
    const planeDirectionSq = planeDirection.lengthSq();
    if (!(planeDirectionSq > 1e-9)) {
      throw new Error(`Feature dimension drag plane for ${fieldKey} is degenerate.`);
    }

    const delta = Number(targetValue) - startValue;
    const targetPoint = startPoint.clone().addScaledVector(planeDirection, delta / planeDirectionSq);
    const targetScreen = this._projectWorldPointToScreen(targetPoint);
    await this._dragCursorTo(targetScreen.x, targetScreen.y, {
      duration: Math.max(CURSOR_MOVE_MS * 2, 680),
      token,
      label,
      moveTarget: window,
    });

    this._dispatchPointerEvent(window, 'pointerup', targetScreen.x, targetScreen.y);
    await this._sleep(220, token);
    await this._waitFor(() => {
      const activeEntry = this._findHistoryFeatureEntry(entryId);
      const nextValue = Number(activeEntry?.inputParams?.[fieldKey]);
      return !overlay?._dragState && Number.isFinite(nextValue) && Math.abs(nextValue - Number(targetValue)) <= 0.11;
    }, {
      timeoutMs: 8000,
      token,
    });
  }

  async _editCubeFeature(feature, token) {
    const entryId = feature?.inputParams?.id || feature?.id;
    await this._waitForFeatureForm(entryId, token);
    try {
      this.viewer?.camera?.position?.set?.(28, 20, 28);
      this.viewer?.controls?.target?.set?.(8, 6, 8);
      this.viewer?.controls?.update?.();
    } catch { }
    try { this.viewer?.zoomToFit?.(1.18); } catch { }
    await this._sleep(220, token);
    await this._dragLinearFeatureDimension(entryId, 'sizeX', 16, {
      token,
      label: 'Drag X grip',
    });
  }

  async _configureCylinderFeature(feature, token) {
    const entryId = feature?.inputParams?.id || feature?.id;
    const form = await this._waitForFeatureForm(entryId, token);
    const radiusInput = this._getFormRow(form, 'radius')?.querySelector?.('input');
    const heightInput = this._getFormRow(form, 'height')?.querySelector?.('input');
    await this._typeIntoInput(radiusInput, '4', { token, label: 'Radius' });
    await this._typeIntoInput(heightInput, '16', { token, label: 'Height' });
  }

  async _positionCylinderFeature(feature, token) {
    const entryId = feature?.inputParams?.id || feature?.id;
    await this._waitForFeatureForm(entryId, token);
    try {
      this.viewer?.camera?.position?.set?.(28, 20, 28);
      this.viewer?.controls?.target?.set?.(8, 6, 8);
      this.viewer?.controls?.update?.();
    } catch { }
    try { this.viewer?.zoomToFit?.(1.18); } catch { }
    try { SchemaForm.__stopGlobalActiveXform?.(); } catch { }
    await this._sleep(180, token);
    await this._activateTransformFromFeatureDimensionHandle(entryId, 'radius', token, 'start');
    await this._dragActiveTransformAxisToValue(entryId, 'X', 8, {
      token,
      label: 'Drag X arrow',
    });
    await this._dragActiveTransformAxisToValue(entryId, 'Z', 8, {
      token,
      label: 'Drag Z arrow',
    });
    try { SchemaForm.__stopGlobalActiveXform?.(); } catch { }
    await this._sleep(160, token);
  }

  async _editBooleanFeature(feature, cubeName, cylinderName, token) {
    const entryId = feature?.inputParams?.id || feature?.id;
    const form = await this._waitForFeatureForm(entryId, token);
    const targetDisplay = this._getFormRow(form, 'targetSolid')?.querySelector?.('.ref-single-display');
    await this._clickElement(targetDisplay, { token, label: 'Pick target' });
    await this._pickSceneReference(cubeName, { token, label: 'Cube' });

    const boolRow = this._getFormRow(form, 'boolean');
    const opSelect = boolRow?.querySelector?.('select[data-role="bool-op"]');
    await this._changeSelectValue(opSelect, 'SUBTRACT', { token, label: 'Subtract' });
    await this._pickSceneReference(cylinderName, { token, label: 'Cylinder' });
  }

  async _prepareLiveModelingDemo(token) {
    if (this._liveDemoPrepared) return;
    const viewer = this.viewer;
    const partHistory = viewer?.partHistory;
    const historyWidget = viewer?.historyWidget;
    if (!viewer || !partHistory || !historyWidget) return;
    await partHistory.reset?.();
    try { await Promise.resolve(viewer.accordion?.expandSection?.('History')); } catch { }
    try { viewer.setActiveWorkbench?.('MODELING', { queueHistorySnapshot: false }); } catch { }
    try {
      viewer.camera?.position?.set?.(28, 20, 28);
      viewer.controls?.target?.set?.(8, 6, 8);
      viewer.controls?.update?.();
    } catch { }
    try { viewer.zoomToFit?.(1.2); } catch { }
    historyWidget.render?.();
    await this._sleep(250, token);
    this._liveDemoPrepared = true;
  }

  async _ensureLiveDemoCube(token) {
    await this._prepareLiveModelingDemo(token);
    let cubeFeature = this._findFeatureByShortName('P.CU');
    if (!cubeFeature) {
      cubeFeature = await this._createFeatureFromHistoryMenu('Primitive Cube', token);
    } else {
      const entryId = this._getFeatureEntryId(cubeFeature);
      if (entryId) await this._waitForFeatureForm(entryId, token);
    }
    return cubeFeature;
  }

  async _ensureLiveDemoCubeResized(token) {
    const cubeFeature = await this._ensureLiveDemoCube(token);
    const entryId = this._getFeatureEntryId(cubeFeature);
    if (!entryId) return cubeFeature;
    if (!this._isCloseToValue(cubeFeature?.inputParams?.sizeX, 16)) {
      await this._editCubeFeature(cubeFeature, token);
    }
    return cubeFeature;
  }

  async _ensureLiveDemoCylinder(token) {
    await this._ensureLiveDemoCubeResized(token);
    let cylinderFeature = this._findFeatureByShortName('P.CY');
    if (!cylinderFeature) {
      cylinderFeature = await this._createFeatureFromHistoryMenu('Primitive Cylinder', token);
    } else {
      const entryId = this._getFeatureEntryId(cylinderFeature);
      if (entryId) await this._waitForFeatureForm(entryId, token);
    }
    if (!this._isCloseToValue(cylinderFeature?.inputParams?.radius, 4) || !this._isCloseToValue(cylinderFeature?.inputParams?.height, 16)) {
      await this._configureCylinderFeature(cylinderFeature, token);
    }
    return cylinderFeature;
  }

  async _ensureLiveDemoCylinderPositioned(token) {
    const cylinderFeature = await this._ensureLiveDemoCylinder(token);
    const position = Array.isArray(cylinderFeature?.inputParams?.transform?.position)
      ? cylinderFeature.inputParams.transform.position
      : [];
    if (!this._isCloseToValue(position[0], 8) || !this._isCloseToValue(position[2], 8)) {
      await this._positionCylinderFeature(cylinderFeature, token);
    }
    return cylinderFeature;
  }

  async _ensureLiveDemoBoolean(token) {
    const cubeFeature = await this._ensureLiveDemoCubeResized(token);
    const cylinderFeature = await this._ensureLiveDemoCylinderPositioned(token);
    let booleanFeature = this._findFeatureByShortName('B');
    if (!booleanFeature) {
      booleanFeature = await this._createFeatureFromHistoryMenu('Boolean', token);
      await this._editBooleanFeature(
        booleanFeature,
        cubeFeature?.inputParams?.featureID || cubeFeature?.inputParams?.id,
        cylinderFeature?.inputParams?.featureID || cylinderFeature?.inputParams?.id,
        token,
      );
      return booleanFeature;
    }

    const operation = String(booleanFeature?.inputParams?.boolean?.operation || '').toUpperCase();
    const targetSolid = booleanFeature?.inputParams?.targetSolid;
    const targetName = Array.isArray(targetSolid)
      ? (targetSolid[0]?.name || targetSolid[0] || null)
      : (targetSolid?.name || targetSolid || null);
    const toolTargets = Array.isArray(booleanFeature?.inputParams?.boolean?.targets)
      ? booleanFeature.inputParams.boolean.targets.map((item) => item?.name || item)
      : [];
    const expectedCube = cubeFeature?.inputParams?.featureID || cubeFeature?.inputParams?.id;
    const expectedCylinder = cylinderFeature?.inputParams?.featureID || cylinderFeature?.inputParams?.id;
    if (operation !== 'SUBTRACT' || String(targetName || '') !== String(expectedCube || '') || !toolTargets.includes(expectedCylinder)) {
      await this._editBooleanFeature(
        booleanFeature,
        expectedCube,
        expectedCylinder,
        token,
      );
    }
    return booleanFeature;
  }

  async runLiveDemoAddCube() {
    const token = this._stepRunToken;
    try {
      await this._ensureLiveDemoCube(token);
    } catch (error) {
      if (error?.code === TOUR_CANCELLED || error?.message === TOUR_CANCELLED) return;
      console.warn('[StartupTour] Add cube demo step failed:', error);
    } finally {
      if (this._isStepTokenActive(token)) {
        this._setCursorLabel('');
        this._setCursorVisible(false);
      }
    }
  }

  async runLiveDemoResizeCube() {
    const token = this._stepRunToken;
    try {
      await this._ensureLiveDemoCubeResized(token);
    } catch (error) {
      if (error?.code === TOUR_CANCELLED || error?.message === TOUR_CANCELLED) return;
      console.warn('[StartupTour] Resize cube demo step failed:', error);
    } finally {
      if (this._isStepTokenActive(token)) {
        this._setCursorLabel('');
        this._setCursorVisible(false);
      }
    }
  }

  async runLiveDemoAddCylinder() {
    const token = this._stepRunToken;
    try {
      await this._ensureLiveDemoCylinder(token);
    } catch (error) {
      if (error?.code === TOUR_CANCELLED || error?.message === TOUR_CANCELLED) return;
      console.warn('[StartupTour] Add cylinder demo step failed:', error);
    } finally {
      if (this._isStepTokenActive(token)) {
        this._setCursorLabel('');
        this._setCursorVisible(false);
      }
    }
  }

  async runLiveDemoPositionCylinder() {
    const token = this._stepRunToken;
    try {
      await this._ensureLiveDemoCylinderPositioned(token);
    } catch (error) {
      if (error?.code === TOUR_CANCELLED || error?.message === TOUR_CANCELLED) return;
      console.warn('[StartupTour] Position cylinder demo step failed:', error);
    } finally {
      if (this._isStepTokenActive(token)) {
        this._setCursorLabel('');
        this._setCursorVisible(false);
      }
    }
  }

  async runLiveDemoBooleanSubtract() {
    const token = this._stepRunToken;
    try {
      const viewer = this.viewer;
      const booleanFeature = await this._ensureLiveDemoBoolean(token);
      try {
        viewer?.historyWidget?.revealEntry?.(booleanFeature?.inputParams?.id || booleanFeature?.id, {
          focus: false,
          scroll: true,
          notify: false,
        });
      } catch { }
      try {
        viewer?.camera?.position?.set?.(30, 18, 28);
        viewer?.controls?.target?.set?.(8, 6, 8);
        viewer?.controls?.update?.();
      } catch { }
      try { viewer?.zoomToFit?.(1.14); } catch { }
      await this._sleep(250, token);
    } catch (error) {
      if (error?.code === TOUR_CANCELLED || error?.message === TOUR_CANCELLED) return;
      console.warn('[StartupTour] Boolean demo step failed:', error);
    } finally {
      if (this._isStepTokenActive(token)) {
        this._setCursorLabel('');
        this._setCursorVisible(false);
      }
    }
  }
}

export async function maybeStartStartupTour(viewer, options = {}) {
  const tour = new StartupTour(viewer, options);
  const started = await tour.maybeStart();
  if (!started) return null;
  return tour;
}

export async function startStartupTour(viewer, options = {}) {
  if (!viewer) return null;
  const tour = new StartupTour(viewer, options);
  await waitForDialogsToClose();
  tour.start();
  return tour.active ? tour : null;
}

export function resetStartupTourFlag() {
  try { removeBrowserStorageValue(TOUR_STORAGE_KEY); } catch { }
}
