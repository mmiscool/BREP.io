import { normalizeReferenceList, normalizeReferenceName } from './utils.js';

type AnyRecord = Record<string, any>;
type ReferenceInputElement = HTMLInputElement & AnyRecord;
type ReferenceSelectionExtra = {
    pickMeta?: any;
    pointerEvent?: any;
};

export function renderReferenceSelectionField({ ui, key, def, id, controlWrap, valueAdapter = null }) {
    const inputEl = document.createElement('input') as ReferenceInputElement;
    inputEl.type = 'hidden';
    inputEl.id = id;
    try {
        inputEl.dataset.key = String(key);
    } catch (_) {
        // best effort
    }
    try {
        inputEl.__refSelectionDef = def;
    } catch (_) {
        // best effort
    }

    const isMulti = !!def.multiple;
    if (isMulti) inputEl.dataset.multiple = 'true';

    const parseBound = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return null;
        const coerced = Math.max(0, Math.floor(num));
        return coerced >= 0 ? coerced : null;
    };

    const minSelections = isMulti ? parseBound(def.minSelections) : null;
    let maxSelections = isMulti ? parseBound(def.maxSelections) : null;
    if (isMulti && maxSelections !== null && minSelections !== null && maxSelections < minSelections) {
        maxSelections = minSelections;
    }

    if (isMulti && minSelections !== null) inputEl.dataset.minSelections = String(minSelections);
    if (isMulti && maxSelections !== null) inputEl.dataset.maxSelections = String(maxSelections);

    const placeholderText = (typeof def.placeholder === 'string' && def.placeholder.trim())
        ? def.placeholder.trim()
        : 'Click then select in scene…';

    const adapter = (valueAdapter && typeof valueAdapter === 'object') ? valueAdapter as AnyRecord : null;
    const readRawValue = () => {
        if (adapter && typeof adapter.read === 'function') {
            try { return adapter.read(); } catch (_) { return null; }
        }
        return ui._pickInitialValue(key, def);
    };
    const writeRawValue = (next) => {
        if (adapter && typeof adapter.write === 'function') {
            try { adapter.write(next); return; } catch (_) { return; }
        }
        ui.params[key] = next;
    };
    const emitChange = (value) => {
        if (adapter && typeof adapter.emit === 'function') {
            try { adapter.emit(value); return; } catch (_) { return; }
        }
        ui._emitParamsChange(key, value);
    };
    const resolveCurrentSelectionNames = () => {
        const raw = readRawValue();
        if (Array.isArray(raw)) return normalizeReferenceList(raw);
        const single = normalizeReferenceName(raw);
        return single ? [single] : [];
    };
    const resolveCurrentSelectionObjects = () => {
        const scene = ui?.options?.partHistory?.scene || ui?.options?.viewer?.partHistory?.scene || ui?.options?.viewer?.scene || null;
        const names = resolveCurrentSelectionNames();
        if (!scene || typeof scene.getObjectByName !== 'function') return [];
        const out = [];
        for (const name of names) {
            if (!name) continue;
            const obj = scene.getObjectByName(name);
            if (obj) out.push(obj);
        }
        return out;
    };

    inputEl.__validateReferenceSelection = (candidate, extra: ReferenceSelectionExtra = {}) => {
        const validator = def?.selectionValidator;
        if (typeof validator !== 'function') return { allowed: true, message: null };

        const featureID = (ui?.params && Object.prototype.hasOwnProperty.call(ui.params, 'featureID'))
            ? ui.params.featureID
            : (ui?.params?.id ?? null);
        const ctx = {
            ui,
            key,
            def,
            id,
            inputEl,
            params: ui?.params || null,
            featureID,
            viewer: ui?.options?.viewer || null,
            partHistory: ui?.options?.partHistory || ui?.options?.viewer?.partHistory || null,
            currentValue: readRawValue(),
            currentSelectionNames: resolveCurrentSelectionNames(),
            currentSelections: resolveCurrentSelectionObjects(),
            pointerEvent: extra?.pointerEvent,
            pickMeta: extra?.pickMeta || null,
        };

        let allowed = true;
        try {
            allowed = validator(candidate, ctx) !== false;
        } catch (error) {
            console.warn('[ReferenceSelection] selectionValidator threw; blocking selection.', error);
            allowed = false;
        }
        if (allowed) return { allowed: true, message: null };

        let message = null;
        const messageSource = def?.selectionValidationMessage;
        if (typeof messageSource === 'function') {
            try {
                const resolved = messageSource(candidate, ctx);
                if (typeof resolved === 'string' && resolved.trim()) message = resolved.trim();
            } catch (_) { /* ignore */ }
        } else if (typeof messageSource === 'string' && messageSource.trim()) {
            message = messageSource.trim();
        }

        return {
            allowed: false,
            message: message || 'Selection not allowed for this field.',
        };
    };

    const refWrap = document.createElement('div');
    refWrap.className = isMulti ? 'ref-multi-wrap' : 'ref-single-wrap';

    let chipsWrap = null;
    const updateSelectionMetadata = (list) => {
        if (!isMulti) return;
        const normalized = normalizeReferenceList(Array.isArray(list) ? list : []);
        try {
            inputEl.dataset.selectedCount = String(normalized.length);
        } catch (_) {
            // best effort
        }
        try {
            inputEl.dataset.selectedValues = JSON.stringify(normalized);
        } catch (_) {
            // best effort
        }
    };

    if (isMulti) {
        inputEl.__getSelectionList = () => {
            try {
                const raw = readRawValue();
                if (!Array.isArray(raw)) return [];
                return normalizeReferenceList(raw);
            } catch (_) {
                return [];
            }
        };
        inputEl.__updateSelectionMetadata = updateSelectionMetadata;
    }
    if (isMulti) {
        chipsWrap = document.createElement('div');
        chipsWrap.className = 'ref-chips';
        chipsWrap.addEventListener('click', () => ui._activateReferenceSelection(inputEl, def));
        refWrap.appendChild(chipsWrap);
        try {
            const initial = readRawValue();
            const current = normalizeReferenceList(Array.isArray(initial) ? initial : []);
            writeRawValue(current);
            ui._renderChips(chipsWrap, key, current);
            updateSelectionMetadata(current);
        } catch (_) {
            // best effort
        }
    } else {
        const valueWrap = document.createElement('button');
        valueWrap.type = 'button';
        valueWrap.className = 'ref-single-display';
        valueWrap.title = placeholderText;
        valueWrap.dataset.placeholder = placeholderText;

        const label = document.createElement('span');
        label.className = 'ref-single-label';
        valueWrap.appendChild(label);

        const clearBtn = document.createElement('span');
        clearBtn.className = 'ref-chip-remove';
        clearBtn.role = 'button';
        clearBtn.tabIndex = 0;
        clearBtn.title = 'Clear selection';
        clearBtn.textContent = '✕';

        const clearSelection = (ev) => {
            ev.stopPropagation();
            ev.preventDefault?.();
            writeRawValue(null);
            inputEl.value = '';
            try {
                inputEl.__lastReferenceSelectionMeta = null;
            } catch (_) {
                // best effort
            }
            updateSingleDisplay(null);
            emitChange(null);
            try {
                ui._syncActiveReferenceSelectionHighlight(inputEl, def);
            } catch (_) {
                // best effort
            }
        };

        clearBtn.addEventListener('click', clearSelection);
        clearBtn.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                clearSelection(ev);
            }
        });
        valueWrap.appendChild(clearBtn);

        const updateSingleDisplay = (val) => {
            const normalized = normalizeReferenceName(val);
            label.textContent = normalized || placeholderText;
            clearBtn.style.visibility = normalized ? 'visible' : 'hidden';
        };

        const initial = normalizeReferenceName(readRawValue());
        writeRawValue(initial);
        updateSingleDisplay(initial);
        inputEl.value = initial ?? '';

        valueWrap.addEventListener('click', () => ui._activateReferenceSelection(inputEl, def));
        valueWrap.addEventListener('mouseenter', () => {
            const normalized = normalizeReferenceName(inputEl.value || readRawValue());
            if (normalized) {
                try {
                    ui._hoverReferenceSelectionItem?.(inputEl, def, normalized);
                } catch (_) {
                    // best effort
                }
            }
        });
        valueWrap.addEventListener('mouseleave', () => {
            try {
                ui._clearReferenceSelectionHover?.(inputEl);
            } catch (_) {
                // best effort
            }
        });
        refWrap.appendChild(valueWrap);

        inputEl.addEventListener('change', () => {
            updateSingleDisplay(inputEl.value);
            const normalized = normalizeReferenceName(inputEl.value);
            let nextValue = normalized;
            try {
                const meta = inputEl.__lastReferenceSelectionMeta;
                if (meta && typeof meta === 'object') {
                    const metaName = normalizeReferenceName(meta);
                    if (metaName && metaName === normalized) {
                        const next = { ...meta, name: metaName };
                        if (Array.isArray(next.pickPoint) && next.pickPoint.length >= 3) {
                            next.pickPoint = [
                                Number(next.pickPoint[0]) || 0,
                                Number(next.pickPoint[1]) || 0,
                                Number(next.pickPoint[2]) || 0,
                            ];
                        } else {
                            delete next.pickPoint;
                        }
                        if (Number.isFinite(next.faceIndex) && Number(next.faceIndex) >= 0) {
                            next.faceIndex = Math.floor(Number(next.faceIndex));
                        } else {
                            delete next.faceIndex;
                        }
                        nextValue = next;
                    } else {
                        inputEl.__lastReferenceSelectionMeta = null;
                    }
                }
            } catch (_) { /* ignore metadata conversion errors */ }
            writeRawValue(nextValue);
            emitChange(nextValue);
            try {
                ui._syncActiveReferenceSelectionHighlight(inputEl, def);
            } catch (_) {
                // best effort
            }
        });
    }

    ui._setInputValue(inputEl, def.type, readRawValue());

    inputEl.addEventListener('change', () => {
        const raw = inputEl.value;
        if (isMulti) {
            if (inputEl.dataset && inputEl.dataset.forceClear === 'true') {
                writeRawValue([]);
                if (chipsWrap) {
                    ui._renderChips(chipsWrap, key, []);
                    updateSelectionMetadata([]);
                }
                inputEl.value = '';
                delete inputEl.dataset.forceClear;
                emitChange(adapter ? readRawValue() : []);
                return;
            }
            let incoming = [];
            let parsedArray = false;
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) { incoming = parsed; parsedArray = true; }
            } catch (_) {
                // not JSON
            }
            if (!parsedArray && raw != null && String(raw).trim() !== '') incoming = [String(raw).trim()];

            const existingRaw = readRawValue();
            const current = Array.isArray(existingRaw) ? existingRaw : [];
            const next = current.slice();
            for (const name of incoming) {
                const normalized = normalizeReferenceName(name);
                if (!normalized) continue;
                if (!next.includes(normalized)) next.push(normalized);
            }
            const normalizedList = normalizeReferenceList(next);
            if (isMulti && maxSelections !== null && normalizedList.length > maxSelections) {
                normalizedList.length = maxSelections;
            }
            writeRawValue(normalizedList);
            if (chipsWrap) {
                ui._renderChips(chipsWrap, key, normalizedList);
                updateSelectionMetadata(normalizedList);
            }
            inputEl.value = '';
            emitChange(adapter ? readRawValue() : normalizedList);
        } else {
            const normalized = normalizeReferenceName(raw);
            inputEl.value = normalized ?? '';
            writeRawValue(normalized);
            emitChange(normalized);
            try {
                ui._syncActiveReferenceSelectionHighlight(inputEl, def);
            } catch (_) {
                // best effort
            }
        }
    });

    refWrap.appendChild(inputEl);
    controlWrap.appendChild(refWrap);

    const activate = () => ui._activateReferenceSelection(inputEl, def);

    return {
        inputEl,
        activate,
        readValue() {
            const value = readRawValue();
            if (Array.isArray(value)) return normalizeReferenceList(value);
            return normalizeReferenceName(value);
        },
    };
}
