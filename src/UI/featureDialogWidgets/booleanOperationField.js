import { renderReferenceSelectionField } from './referenceSelectionField.js';

export function renderBooleanOperationField({ ui, key, def, controlWrap }) {
    if (!ui.params[key] || typeof ui.params[key] !== 'object') {
        ui.params[key] = { targets: [], operation: 'NONE', overlapConditioningEnabled: true };
    } else {
        if (!Array.isArray(ui.params[key].targets)) ui.params[key].targets = [];
        if (!ui.params[key].operation) ui.params[key].operation = 'NONE';
        if (typeof ui.params[key].overlapConditioningEnabled !== 'boolean') ui.params[key].overlapConditioningEnabled = true;
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
        if (!ui.params[key] || typeof ui.params[key] !== 'object') ui.params[key] = {
            targets: [],
            operation: 'NONE',
            overlapConditioningEnabled: true,
        };
        const nextOperation = String(sel.value || 'NONE').toUpperCase();
        ui.params[key].operation = nextOperation;
        ui._emitParamsChange(key, ui.params[key]);
        if (nextOperation === 'NONE') return;

        const activateTargets = () => {
            try { refField?.activate?.(); } catch (_) { }
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => activateTargets());
        else setTimeout(activateTargets, 0);
    });
    wrap.appendChild(sel);

    const conditioningRow = document.createElement('label');
    conditioningRow.style.display = 'flex';
    conditioningRow.style.alignItems = 'center';
    conditioningRow.style.gap = '8px';
    conditioningRow.style.margin = '8px 0 6px';
    conditioningRow.style.color = 'var(--text-color, #e6edf3)';
    conditioningRow.style.fontSize = '12px';

    const conditioningToggle = document.createElement('input');
    conditioningToggle.type = 'checkbox';
    conditioningToggle.checked = ui.params[key].overlapConditioningEnabled !== false;
    conditioningToggle.addEventListener('change', () => {
        if (!ui.params[key] || typeof ui.params[key] !== 'object') ui.params[key] = { targets: [], operation: 'NONE', overlapConditioningEnabled: true };
        ui.params[key].overlapConditioningEnabled = conditioningToggle.checked;
        ui._emitParamsChange(key, ui.params[key]);
    });

    const conditioningLabel = document.createElement('span');
    conditioningLabel.textContent = 'Condition near-touching faces';

    conditioningRow.appendChild(conditioningToggle);
    conditioningRow.appendChild(conditioningLabel);
    wrap.appendChild(conditioningRow);

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
            if (!ui.params[key] || typeof ui.params[key] !== 'object') ui.params[key] = {
                targets: [],
                operation: sel.value || 'NONE',
                overlapConditioningEnabled: conditioningToggle.checked,
            };
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
                return { targets: [], operation: 'NONE', overlapConditioningEnabled: true };
            }
            return {
                targets: Array.isArray(current.targets) ? current.targets.slice() : [],
                operation: current.operation || 'NONE',
                overlapConditioningEnabled: current.overlapConditioningEnabled !== false,
            };
        },
    };
}
