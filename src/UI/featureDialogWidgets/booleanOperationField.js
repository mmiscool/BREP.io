import { renderReferenceSelectionField } from './referenceSelectionField.js';

export function renderBooleanOperationField({ ui, key, def, controlWrap }) {
    if (!ui.params[key] || typeof ui.params[key] !== 'object') {
        ui.params[key] = { targets: [], operation: 'NONE' };
    } else {
        if (!Array.isArray(ui.params[key].targets)) ui.params[key].targets = [];
        if (!ui.params[key].operation) ui.params[key].operation = 'NONE';
    }

    const wrap = document.createElement('div');
    wrap.className = 'bool-op-wrap';

    const sel = document.createElement('select');
    sel.className = 'select';
    sel.dataset.role = 'bool-op';
    const ops = Array.isArray(def.options) && def.options.length ? def.options : ['NONE', 'UNION', 'SUBTRACT', 'INTERSECT'];
    for (const op of ops) {
        const opt = document.createElement('option');
        opt.value = String(op);
        opt.textContent = String(op);
        sel.appendChild(opt);
    }
    sel.value = String(ui.params[key].operation || 'NONE');
    sel.addEventListener('change', () => {
        if (!ui.params[key] || typeof ui.params[key] !== 'object') ui.params[key] = { targets: [], operation: 'NONE' };
        ui.params[key].operation = sel.value;
        ui._emitParamsChange(key, ui.params[key]);
    });
    wrap.appendChild(sel);

    const refMount = document.createElement('div');
    const targetsDef = {
        type: 'reference_selection',
        multiple: true,
        selectionFilter: ['SOLID'],
    };
    const valueAdapter = {
        read: () => {
            const current = ui.params[key];
            if (!current || typeof current !== 'object') return [];
            return Array.isArray(current.targets) ? current.targets : [];
        },
        write: (next) => {
            if (!ui.params[key] || typeof ui.params[key] !== 'object') ui.params[key] = { targets: [], operation: sel.value || 'NONE' };
            ui.params[key].targets = Array.isArray(next) ? next : [];
        },
        emit: () => {
            ui._emitParamsChange(key, ui.params[key]);
        },
    };
    const refField = renderReferenceSelectionField({
        ui,
        key,
        def: targetsDef,
        id: `${key}-targets`,
        controlWrap: refMount,
        valueAdapter,
    });
    wrap.appendChild(refMount);

    controlWrap.appendChild(wrap);

    return {
        inputEl: refField.inputEl,
        activate: refField.activate,
        readValue() {
            const current = ui.params[key];
            if (!current || typeof current !== 'object') {
                return { targets: [], operation: 'NONE' };
            }
            return {
                targets: Array.isArray(current.targets) ? current.targets.slice() : [],
                operation: current.operation || 'NONE',
            };
        },
    };
}
