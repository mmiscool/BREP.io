const DEFAULT_MOVE_DURATION = 700;
const DEFAULT_CLICK_HOLD_DURATION = 60;
const DEFAULT_TYPING_DELAY = 60;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - (Math.pow((-2 * t) + 2, 3) / 2);
}

function maskForButton(button = 0) {
  if (button === 1) return 4;
  if (button === 2) return 2;
  return 1;
}

function canBubble(type) {
  return !(
    type === 'mouseenter'
    || type === 'mouseleave'
    || type === 'pointerenter'
    || type === 'pointerleave'
  );
}

function isTextInput(element) {
  return element instanceof HTMLTextAreaElement
    || (
      element instanceof HTMLInputElement
      && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(element.type)
    );
}

function insertTextAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const next = start + text.length;
  try { input.setSelectionRange(next, next); } catch { /* ignore */ }
}

function keyToCode(key) {
  if (typeof key === 'string' && key.length === 1) {
    if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/[0-9]/.test(key)) return `Digit${key}`;
  }

  const map = {
    Enter: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Shift: 'ShiftLeft',
    Alt: 'AltLeft',
    Control: 'ControlLeft',
    Meta: 'MetaLeft',
    ' ': 'Space',
  };

  return map[key] || key;
}

function findFocusable(element) {
  if (!element) return null;
  if (
    element.matches?.('input, textarea, select, button, a[href], [contenteditable="true"], [tabindex]')
  ) {
    return element;
  }
  return element.closest?.('input, textarea, select, button, a[href], [contenteditable="true"], [tabindex]') || element;
}

export class ScriptedDemoMouse {
  [key: string]: any;

  constructor(options: any = {}) {
    this.options = {
      moveDuration: DEFAULT_MOVE_DURATION,
      clickHoldDuration: DEFAULT_CLICK_HOLD_DURATION,
      typingDelay: DEFAULT_TYPING_DELAY,
      alwaysKeepInViewport: true,
      onPositionChange: null,
      ...options,
    };

    this.x = Number.isFinite(options.initialX) ? Number(options.initialX) : 80;
    this.y = Number.isFinite(options.initialY) ? Number(options.initialY) : 80;
    this.buttons = 0;
    this.shiftKey = false;
    this.altKey = false;
    this.ctrlKey = false;
    this.metaKey = false;
    this.pointerId = 1;
    this.pointerType = 'mouse';
    this.cursorEl = null;
    this.labelEl = null;
    this.hoverPath = [];
  }

  attachCursor({ cursorEl = null, labelEl = null }: any = {}) {
    this.cursorEl = cursorEl || null;
    this.labelEl = labelEl || null;
    this.renderCursor();
    return this;
  }

  detachCursor() {
    this.cursorEl = null;
    this.labelEl = null;
    this.hoverPath = [];
    return this;
  }

  renderCursor() {
    if (!this.cursorEl) return;
    this.cursorEl.style.left = `${Math.round(this.x)}px`;
    this.cursorEl.style.top = `${Math.round(this.y)}px`;
  }

  setVisible(visible) {
    if (!this.cursorEl) return this;
    this.cursorEl.classList.toggle('is-visible', !!visible);
    return this;
  }

  setLabel(text = '') {
    if (!this.cursorEl || !this.labelEl) return this;
    const next = String(text || '').trim();
    this.cursorEl.classList.toggle('has-label', !!next);
    this.labelEl.textContent = next;
    return this;
  }

  animateCursorDown() {
    this.cursorEl?.classList?.add('is-clicking');
    return this;
  }

  animateCursorUp() {
    this.cursorEl?.classList?.remove('is-clicking');
    return this;
  }

  reset() {
    this.buttons = 0;
    this.shiftKey = false;
    this.altKey = false;
    this.ctrlKey = false;
    this.metaKey = false;
    this.animateCursorUp();
    this.setLabel('');
    this.setVisible(false);
    return this;
  }

  _assertContinue(shouldContinue: any = null, onCancel: any = null) {
    if (!shouldContinue) return;
    if (shouldContinue()) return;
    if (typeof onCancel === 'function') throw onCancel();
    throw new Error('Scripted demo mouse cancelled.');
  }

  async wait(ms = 0, { shouldContinue = null, onCancel = null }: any = {}) {
    if (!(Number(ms) > 0)) return this;
    await new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
    this._assertContinue(shouldContinue, onCancel);
    return this;
  }

  setPosition(x, y, {
    silent = false,
    moveTarget = null,
  }: any = {}) {
    const nextX = Number(x);
    const nextY = Number(y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return this;

    this.x = this.options.alwaysKeepInViewport
      ? clamp(nextX, 1, Math.max(1, window.innerWidth - 1))
      : nextX;
    this.y = this.options.alwaysKeepInViewport
      ? clamp(nextY, 1, Math.max(1, window.innerHeight - 1))
      : nextY;

    this.renderCursor();
    try { this.options.onPositionChange?.({ x: this.x, y: this.y }); } catch { /* ignore */ }

    if (!silent) this.dispatchMove({ moveTarget });
    return this;
  }

  async moveTo(x, y, {
    duration = this.options.moveDuration,
    easing = easeInOutCubic,
    label = '',
    visible = true,
    moveTarget = null,
    shouldContinue = null,
    onCancel = null,
  }: any = {}) {
    this._assertContinue(shouldContinue, onCancel);
    this.setLabel(label);
    this.setVisible(visible);

    const nextX = Number(x);
    const nextY = Number(y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return this;

    const startX = this.x;
    const startY = this.y;
    const dx = nextX - startX;
    const dy = nextY - startY;
    const total = Math.max(0, Number(duration) || 0);

    if (total <= 0) {
      this.setPosition(nextX, nextY, { moveTarget });
      this._assertContinue(shouldContinue, onCancel);
      return this;
    }

    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const tick = (now) => {
        try {
          this._assertContinue(shouldContinue, onCancel);
        } catch (error) {
          reject(error);
          return;
        }

        const elapsed = now - started;
        const t = Math.min(1, elapsed / total);
        const eased = easing(t);
        this.setPosition(startX + (dx * eased), startY + (dy * eased), { moveTarget });
        if (t >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    this._assertContinue(shouldContinue, onCancel);
    return this;
  }

  resolveTarget(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    if (target instanceof Element) return target;
    return target?.nodeType === 1 ? target : null;
  }

  getElementPoint(element) {
    const target = this.resolveTarget(element);
    if (!target?.getBoundingClientRect) return null;
    const rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + (rect.width * 0.5),
      y: rect.top + (rect.height * 0.5),
      rect,
    };
  }

  getFallbackElementPoint(element) {
    let current = this.resolveTarget(element);
    while (current) {
      const point = this.getElementPoint(current);
      if (point) return point;
      current = current.parentElement || current.parentNode || null;
    }
    return {
      x: this.x,
      y: this.y,
      rect: null,
    };
  }

  async waitForStableElementPoint(element, {
    timeoutMs = 1200,
    intervalMs = 34,
    shouldContinue = null,
    onCancel = null,
  }: any = {}) {
    const started = Date.now();
    let previous = null;
    let lastPoint = null;

    while ((Date.now() - started) <= timeoutMs) {
      this._assertContinue(shouldContinue, onCancel);
      const point = this.getElementPoint(element);
      if (!point) {
        previous = null;
      } else if (!previous) {
        previous = point;
        lastPoint = point;
      } else {
        const dx = Math.abs(point.x - previous.x);
        const dy = Math.abs(point.y - previous.y);
        const dw = Math.abs((point.rect?.width || 0) - (previous.rect?.width || 0));
        const dh = Math.abs((point.rect?.height || 0) - (previous.rect?.height || 0));
        previous = point;
        lastPoint = point;
        if (dx <= 2 && dy <= 2 && dw <= 2 && dh <= 2) return point;
      }
      await this.wait(intervalMs, { shouldContinue, onCancel });
    }

    const fallback = this.getElementPoint(element);
    if (fallback) return fallback;
    if (lastPoint) return lastPoint;
    throw new Error('Timed out waiting for stable element point.');
  }

  async moveToElement(target, options: any = {}) {
    const element = this.resolveTarget(target);
    if (!element) throw new Error('Demo mouse target is missing.');

    let point = null;
    try {
      point = await this.waitForStableElementPoint(element, options);
    } catch (error) {
      if (error?.code) throw error;
      try { element.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'auto' }); } catch { /* ignore */ }
      point = this.getElementPoint(element) || this.getFallbackElementPoint(element);
    }
    if (!point) point = this.getFallbackElementPoint(element);
    await this.moveTo(point.x, point.y, options);

    const settled = this.getElementPoint(element) || this.getFallbackElementPoint(element);
    if (!settled) return this;
    const dx = Math.abs(this.x - settled.x);
    const dy = Math.abs(this.y - settled.y);
    if (dx > 2 || dy > 2) {
      await this.moveTo(settled.x, settled.y, {
        ...options,
        duration: Math.min(180, Number(options?.duration) || this.options.moveDuration),
      });
    }
    return this;
  }

  hover(target, options: any = {}) {
    return this.moveToElement(target, options);
  }

  getElementsUnderPointer() {
    const elements = document.elementsFromPoint(this.x, this.y) || [];
    return elements.filter((element) => element && element !== this.cursorEl);
  }

  getTopElement() {
    return this.getElementsUnderPointer()[0] || null;
  }

  buildMouseInit(type, extra: any = {}) {
    return {
      bubbles: Object.prototype.hasOwnProperty.call(extra, 'bubbles') ? !!extra.bubbles : canBubble(type),
      cancelable: Object.prototype.hasOwnProperty.call(extra, 'cancelable') ? !!extra.cancelable : true,
      composed: Object.prototype.hasOwnProperty.call(extra, 'composed') ? !!extra.composed : true,
      view: window,
      detail: extra.detail ?? 0,
      clientX: extra.clientX ?? this.x,
      clientY: extra.clientY ?? this.y,
      screenX: extra.screenX ?? (extra.clientX ?? this.x),
      screenY: extra.screenY ?? (extra.clientY ?? this.y),
      pageX: extra.pageX ?? ((extra.clientX ?? this.x) + window.scrollX),
      pageY: extra.pageY ?? ((extra.clientY ?? this.y) + window.scrollY),
      button: extra.button ?? 0,
      buttons: extra.buttons ?? this.buttons,
      relatedTarget: extra.relatedTarget ?? null,
      shiftKey: Object.prototype.hasOwnProperty.call(extra, 'shiftKey') ? !!extra.shiftKey : this.shiftKey,
      altKey: Object.prototype.hasOwnProperty.call(extra, 'altKey') ? !!extra.altKey : this.altKey,
      ctrlKey: Object.prototype.hasOwnProperty.call(extra, 'ctrlKey') ? !!extra.ctrlKey : this.ctrlKey,
      metaKey: Object.prototype.hasOwnProperty.call(extra, 'metaKey') ? !!extra.metaKey : this.metaKey,
    };
  }

  dispatchEventLike(target, type, extra: any = {}) {
    if (!target?.dispatchEvent) return false;
    const init = this.buildMouseInit(type, extra);

    if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
      target.dispatchEvent(new PointerEvent(type, {
        ...init,
        pointerId: extra.pointerId ?? this.pointerId,
        pointerType: extra.pointerType ?? this.pointerType,
        isPrimary: Object.prototype.hasOwnProperty.call(extra, 'isPrimary') ? !!extra.isPrimary : true,
      }));
      return true;
    }

    if (
      type.startsWith('mouse')
      || type === 'click'
      || type === 'dblclick'
      || type === 'contextmenu'
      || type === 'auxclick'
      || type === 'mouseenter'
      || type === 'mouseleave'
      || type === 'mouseover'
      || type === 'mouseout'
    ) {
      target.dispatchEvent(new MouseEvent(type, init));
      return true;
    }

    return false;
  }

  dispatchWheel(target, extra: any = {}) {
    if (!target?.dispatchEvent || typeof WheelEvent !== 'function') return false;
    target.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: extra.clientX ?? this.x,
      clientY: extra.clientY ?? this.y,
      screenX: extra.screenX ?? this.x,
      screenY: extra.screenY ?? this.y,
      pageX: extra.pageX ?? (this.x + window.scrollX),
      pageY: extra.pageY ?? (this.y + window.scrollY),
      deltaX: extra.deltaX ?? 0,
      deltaY: extra.deltaY ?? 0,
      deltaMode: extra.deltaMode ?? 0,
      shiftKey: this.shiftKey,
      altKey: this.altKey,
      ctrlKey: this.ctrlKey,
      metaKey: this.metaKey,
    } as any));
    return true;
  }

  syncHover(forcedList: any = null) {
    const currentPath = Array.isArray(forcedList) ? forcedList : this.getElementsUnderPointer();
    const previousTop = this.hoverPath[0] || null;
    const currentTop = currentPath[0] || null;

    const leaving = this.hoverPath.filter((element) => !currentPath.includes(element));
    const entering = currentPath.filter((element) => !this.hoverPath.includes(element));

    for (const element of leaving) {
      this.dispatchEventLike(element, 'pointerout', { relatedTarget: currentTop });
      this.dispatchEventLike(element, 'pointerleave', { relatedTarget: currentTop, bubbles: false });
      this.dispatchEventLike(element, 'mouseout', { relatedTarget: currentTop });
      this.dispatchEventLike(element, 'mouseleave', { relatedTarget: currentTop, bubbles: false });
    }

    for (const element of entering) {
      this.dispatchEventLike(element, 'pointerover', { relatedTarget: previousTop });
      this.dispatchEventLike(element, 'pointerenter', { relatedTarget: previousTop, bubbles: false });
      this.dispatchEventLike(element, 'mouseover', { relatedTarget: previousTop });
      this.dispatchEventLike(element, 'mouseenter', { relatedTarget: previousTop, bubbles: false });
    }

    this.hoverPath = currentPath;
  }

  dispatchMove({ moveTarget = null }: any = {}) {
    const hitList = this.getElementsUnderPointer();
    this.syncHover(hitList);
    const target = moveTarget || hitList[0] || null;
    if (!target) return false;
    this.dispatchEventLike(target, 'pointermove', { buttons: this.buttons });
    this.dispatchEventLike(target, 'mousemove', { buttons: this.buttons });
    return true;
  }

  focusTarget(target) {
    const focusable = findFocusable(target);
    try { focusable?.focus?.(); } catch { /* ignore */ }
    return focusable || null;
  }

  async pressButton(target, {
    button = 0,
    x = this.x,
    y = this.y,
    focus = false,
  }: any = {}) {
    this.setPosition(x, y, { silent: true });
    if (focus) this.focusTarget(target);
    this.buttons = maskForButton(button);
    this.animateCursorDown();
    this.dispatchEventLike(target, 'pointerdown', { button, buttons: this.buttons });
    this.dispatchEventLike(target, 'mousedown', { button, buttons: this.buttons });
    return this;
  }

  async releaseButton(target, {
    button = 0,
    x = this.x,
    y = this.y,
    emitClick = false,
    clickCount = 1,
    emitContextMenu = false,
  }: any = {}) {
    this.setPosition(x, y, { silent: true });
    this.dispatchEventLike(target, 'pointerup', { button, buttons: 0 });
    this.dispatchEventLike(target, 'mouseup', { button, buttons: 0 });
    this.buttons = 0;
    if (emitContextMenu) {
      this.dispatchEventLike(target, 'contextmenu', { button, buttons: 0 });
      this.dispatchEventLike(target, 'auxclick', { button, buttons: 0 });
    } else if (emitClick) {
      this.dispatchEventLike(target, 'click', { button, buttons: 0, detail: clickCount });
      if (clickCount === 2) this.dispatchEventLike(target, 'dblclick', { button, buttons: 0, detail: 2 });
    }
    this.animateCursorUp();
    return this;
  }

  async click(target, {
    button = 0,
    count = 1,
    duration = this.options.moveDuration,
    holdDuration = this.options.clickHoldDuration,
    focus = true,
    label = '',
    visible = true,
    shouldContinue = null,
    onCancel = null,
  }: any = {}) {
    const explicitTarget = this.resolveTarget(target);
    if (target) {
      await this.moveToElement(target, {
        duration,
        label,
        visible,
        shouldContinue,
        onCancel,
      });
    }

    const hit = explicitTarget || this.getTopElement();
    if (!hit) return this;
    if (focus) this.focusTarget(hit);

    const emitContextMenu = button === 2;
    await this.pressButton(hit, { button, focus: false });
    await this.wait(holdDuration, { shouldContinue, onCancel });
    await this.releaseButton(hit, {
      button,
      emitClick: !emitContextMenu,
      emitContextMenu,
      clickCount: 1,
    });

    if (count === 2 && button === 0) {
      await this.wait(80, { shouldContinue, onCancel });
      await this.pressButton(hit, { button, focus: false });
      await this.wait(Math.max(30, holdDuration / 2), { shouldContinue, onCancel });
      await this.releaseButton(hit, {
        button,
        emitClick: true,
        clickCount: 2,
      });
    }

    return this;
  }

  doubleClick(target, options: any = {}) {
    return this.click(target, { ...options, count: 2 });
  }

  rightClick(target, options: any = {}) {
    return this.click(target, { ...options, button: 2, focus: false });
  }

  async dragToPoint(x, y, {
    duration = Math.max(this.options.moveDuration * 1.8, 560),
    label = '',
    moveTarget = window,
    shouldContinue = null,
    onCancel = null,
  }: any = {}) {
    await this.moveTo(x, y, {
      duration,
      label,
      moveTarget,
      shouldContinue,
      onCancel,
    });
    return this;
  }

  async drag(fromTarget, toTarget, options: any = {}) {
    const button = options.button ?? 0;
    const holdDuration = options.holdDuration ?? this.options.clickHoldDuration;
    const explicitFromTarget = this.resolveTarget(fromTarget);
    const explicitToTarget = this.resolveTarget(toTarget);
    if (fromTarget) {
      await this.moveToElement(fromTarget, options);
    }

    let hit = explicitFromTarget || this.getTopElement();
    if (!hit) return this;
    this.focusTarget(hit);
    await this.pressButton(hit, { button, focus: false });
    await this.wait(holdDuration, options);

    if (toTarget && typeof toTarget === 'object' && Number.isFinite(toTarget.x) && Number.isFinite(toTarget.y)) {
      await this.dragToPoint(toTarget.x, toTarget.y, options);
    } else if (toTarget) {
      await this.moveToElement(toTarget, {
        ...options,
        moveTarget: options.moveTarget || window,
      });
    }

    hit = explicitToTarget || this.getTopElement();
    if (hit) {
      await this.releaseButton(hit, {
        button,
        emitContextMenu: button === 2,
        emitClick: false,
      });
    } else {
      this.buttons = 0;
      this.animateCursorUp();
    }
    return this;
  }

  async scrollBy(dx = 0, dy = 0, options: any = {}) {
    const duration = Math.max(0, Number(options.duration) || 350);
    const dispatchWheel = options.dispatchWheel !== false;
    const steps = Math.max(1, Math.round(duration / 16));
    const startScrollX = window.scrollX;
    const startScrollY = window.scrollY;
    const targetScrollX = startScrollX + Number(dx || 0);
    const targetScrollY = startScrollY + Number(dy || 0);
    const hit = this.getTopElement();

    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const eased = easeInOutCubic(t);
      const currentX = startScrollX + ((targetScrollX - startScrollX) * eased);
      const currentY = startScrollY + ((targetScrollY - startScrollY) * eased);
      window.scrollTo(currentX, currentY);
      if (dispatchWheel && hit) {
        this.dispatchWheel(hit, {
          deltaX: Number(dx || 0) / steps,
          deltaY: Number(dy || 0) / steps,
        });
      }
      await this.wait(Math.max(0, duration / steps), options);
    }

    this.syncHover();
    return this;
  }

  setModifierKeyState(key, isDown) {
    if (key === 'Shift') this.shiftKey = isDown;
    if (key === 'Alt') this.altKey = isDown;
    if (key === 'Control') this.ctrlKey = isDown;
    if (key === 'Meta') this.metaKey = isDown;
  }

  dispatchKeyboard(type, key, options: any = {}) {
    const explicitTarget = this.resolveTarget(options.target);
    const target = explicitTarget || document.activeElement || this.getTopElement() || document.body;
    if (!target?.dispatchEvent || typeof KeyboardEvent !== 'function') return false;

    target.dispatchEvent(new KeyboardEvent(type, {
      key,
      code: options.code ?? keyToCode(key),
      location: options.location ?? 0,
      repeat: !!options.repeat,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: this.shiftKey,
      altKey: this.altKey,
      ctrlKey: this.ctrlKey,
      metaKey: this.metaKey,
    }));
    return true;
  }

  maybeApplyTextInput(key, options: any = {}) {
    const explicitTarget = this.resolveTarget(options.target);
    const target = explicitTarget || document.activeElement || this.getTopElement();
    if (!target) return;

    if (isTextInput(target)) {
      if (key === 'Backspace') {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        if (start !== end) {
          target.value = `${target.value.slice(0, start)}${target.value.slice(end)}`;
          try { target.setSelectionRange(start, start); } catch { /* ignore */ }
        } else if (start > 0) {
          target.value = `${target.value.slice(0, start - 1)}${target.value.slice(end)}`;
          try { target.setSelectionRange(start - 1, start - 1); } catch { /* ignore */ }
        }
      } else if (key === 'Enter') {
        if (target instanceof HTMLTextAreaElement) insertTextAtCursor(target, '\n');
      } else if (typeof key === 'string' && key.length === 1) {
        insertTextAtCursor(target, key);
      }

      const inputType = key === 'Backspace' ? 'deleteContentBackward' : 'insertText';
      try {
        if (typeof InputEvent === 'function') {
          target.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: false,
            composed: true,
            data: typeof key === 'string' && key.length === 1 ? key : null,
            inputType,
          }));
        } else {
          target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
      } catch { /* ignore */ }
    }
  }

  async keyDown(key, options: any = {}) {
    this.setModifierKeyState(key, true);
    this.dispatchKeyboard('keydown', key, options);
    return this;
  }

  async keyUp(key, options: any = {}) {
    this.dispatchKeyboard('keyup', key, options);
    this.setModifierKeyState(key, false);
    return this;
  }

  async press(key, options: any = {}) {
    await this.keyDown(key, options);
    this.maybeApplyTextInput(key, options);
    await this.wait(options.holdDuration ?? 25, options);
    await this.keyUp(key, options);
    return this;
  }

  async type(text, options: any = {}) {
    const delay = options.delay ?? this.options.typingDelay;
    for (const char of String(text || '')) {
      await this.press(char, options);
      await this.wait(delay, options);
    }
    return this;
  }

  async run(steps: any[] = []) {
    for (const step of Array.isArray(steps) ? steps : []) {
      switch (step?.action) {
        case 'move':
          await this.moveTo(step.x, step.y, step);
          break;
        case 'moveTo':
          await this.moveToElement(step.target, step);
          break;
        case 'hover':
          await this.hover(step.target, step);
          break;
        case 'click':
          await this.click(step.target, step);
          break;
        case 'doubleClick':
          await this.doubleClick(step.target, step);
          break;
        case 'rightClick':
          await this.rightClick(step.target, step);
          break;
        case 'drag':
          await this.drag(step.from, step.to, step);
          break;
        case 'scrollBy':
          await this.scrollBy(step.dx ?? 0, step.dy ?? 0, step);
          break;
        case 'keyDown':
          await this.keyDown(step.key, step);
          break;
        case 'keyUp':
          await this.keyUp(step.key, step);
          break;
        case 'press':
          await this.press(step.key, step);
          break;
        case 'type':
          await this.type(step.text ?? '', step);
          break;
        case 'wait':
          await this.wait(step.ms ?? 0, step);
          break;
        default:
          throw new Error(`Unknown scripted demo action: ${step?.action}`);
      }
    }
    return this;
  }
}
