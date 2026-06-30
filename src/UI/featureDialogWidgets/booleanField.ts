export function renderBooleanField({ ui, key, def, id, controlWrap, row }) {
    const inputEl = document.createElement('input');
    inputEl.type = 'checkbox';
    inputEl.id = id;
    inputEl.className = 'checkbox';

    const labelText = String((def && def.label) ? def.label : ui._prettyLabel(key));

    if (row instanceof HTMLElement) {
        row.classList.add('field-row-boolean');
        const rowLabel = row.querySelector('.label');
        if (rowLabel instanceof HTMLElement) {
            rowLabel.classList.add('label-inline-hidden');
            rowLabel.setAttribute('aria-hidden', 'true');
        }
    }

    if (controlWrap instanceof HTMLElement) {
        controlWrap.classList.add('control-wrap-boolean');
        const inlineLabel = document.createElement('label');
        inlineLabel.className = 'checkbox-inline-label';
        inlineLabel.setAttribute('for', id);
        const textEl = document.createElement('span');
        textEl.className = 'checkbox-inline-text';
        textEl.textContent = labelText;
        inlineLabel.appendChild(inputEl);
        inlineLabel.appendChild(textEl);
        controlWrap.appendChild(inlineLabel);
    }

    ui._setInputValue(inputEl, 'boolean', ui._pickInitialValue(key, def));
    inputEl.setAttribute('aria-label', labelText);

    inputEl.addEventListener('change', () => {
        const v = Boolean(inputEl.checked);
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
            return Boolean(inputEl.checked);
        },
    };
}
