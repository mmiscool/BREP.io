export function renderOptionsField({ ui, key, def, id }) {
    const inputEl = document.createElement('select');
    inputEl.id = id;
    inputEl.className = 'select';

    const normalizeOption = (option) => {
        if (option && typeof option === 'object') {
            const value = option.value ?? option.id ?? option.key ?? option.label ?? '';
            const label = option.label ?? option.name ?? value;
            return { value: String(value), label: String(label) };
        }
        const value = String(option);
        return { value, label: value };
    };

    const opts = Array.isArray(def.options) ? def.options : [];
    for (let i = 0; i < opts.length; i++) {
        const opt = normalizeOption(opts[i]);
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        inputEl.appendChild(o);
    }

    ui._setInputValue(inputEl, 'options', ui._pickInitialValue(key, def));

    inputEl.addEventListener('change', () => {
        const v = inputEl.value;
        ui.params[key] = v;
        ui._emitParamsChange(key, v);
        ui._stopActiveReferenceSelection();
    });

    return {
        inputEl,
        activate() {
            inputEl.focus();
        },
        readValue() {
            return inputEl.value;
        },
    };
}
