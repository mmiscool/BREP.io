import { deepClone } from '../utils/deepClone.js';
import {
    createEmptyConfiguratorState,
    isConfiguratorFieldNameValid,
    normalizeConfiguratorState,
    normalizeConfiguratorValue,
    parseConfiguratorOptions,
    prettyConfiguratorLabel,
} from '../utils/configuratorUtils.js';

const CONFIGURATOR_APPLY_DEBOUNCE_MS = 140;

type AnyRecord = Record<string, any>;

function clearElement(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function readFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function bindCommitOnBlurOrEnter(input, commit) {
    if (!(input instanceof HTMLElement) || typeof commit !== 'function') return;
    input.addEventListener('change', () => commit());
    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
        try { input.blur(); } catch { /* ignore */ }
    });
}

function buildEditorField(name, value) {
    const wrap = document.createElement('label');
    wrap.className = 'configurator-editor-field';

    const label = document.createElement('span');
    label.className = 'configurator-editor-label';
    label.textContent = name;
    wrap.appendChild(label);

    wrap.appendChild(value);
    return wrap;
}

export class expressionsManager {
    [key: string]: any;

    constructor(viewer) {
        this.viewer = viewer;
        this.uiElement = document.createElement('div');
        this.expressionCode = '';
        this.editorVisible = false;
        this.editorDraft = createEmptyConfiguratorState();
        this._configuratorApplyTimer = null;
        this._configuratorApplyInFlight = false;
        this._configuratorApplyPending = false;
        this.generateUI();
        this.refreshFromPartHistory();
    }

    getPartHistory() {
        return this.viewer?.partHistory || null;
    }

    _ensureConfiguratorState() {
        const partHistory = this.getPartHistory();
        if (!partHistory) return createEmptyConfiguratorState();
        partHistory.configurator = normalizeConfiguratorState(partHistory.configurator);
        return partHistory.configurator;
    }

    _setStatus(message, color = 'green') {
        if (!this.resultDiv) return;
        this.resultDiv.textContent = String(message || '');
        this.resultDiv.style.color = color;
    }

    _renderDraftConfiguratorPreview() {
        if (!this.editorVisible) return;
        this.renderConfigurator();
    }

    generateUI() {
        const style = document.createElement('style');
        style.textContent = `
            .expressions-manager {
                --expr-bg: #0f1117;
                --expr-bg-elev: #12141b;
                --expr-border: #262b36;
                --expr-text: #e6e6e6;
                --expr-muted: #9aa4b2;
                --expr-focus: #3b82f6;
                --expr-danger: #ef4444;
                --expr-input-bg: #0b0e14;
                --expr-radius: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                color-scheme: dark;
            }
            .expressions-panel,
            .configurator-panel,
            .configurator-editor-panel {
                border: 1px solid var(--expr-border);
                border-radius: var(--expr-radius);
                background: var(--expr-bg-elev);
                padding: 10px;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
            }
            .configurator-panel,
            .configurator-editor-panel {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .configurator-panel-header,
            .configurator-editor-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .configurator-editor-header {
                justify-content: flex-start;
            }
            .configurator-panel-title,
            .configurator-editor-title {
                font-weight: 700;
                color: var(--expr-text);
            }
            .configurator-fields {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .configurator-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
                border: 1px solid var(--expr-border);
                border-radius: 10px;
                padding: 10px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01));
            }
            .configurator-field-label {
                font-size: 12px;
                color: var(--expr-text);
                font-weight: 600;
            }
            .configurator-control,
            .configurator-select,
            .configurator-editor-input,
            .configurator-editor-select,
            .configurator-editor-textarea,
            .expressions-textarea {
                width: 100%;
                box-sizing: border-box;
                border-radius: 10px;
                border: 1px solid var(--expr-border);
                background: var(--expr-input-bg);
                color: var(--expr-text);
                padding: 8px 10px;
                font-family: inherit;
            }
            .configurator-control::placeholder,
            .configurator-editor-input::placeholder,
            .configurator-editor-textarea::placeholder,
            .expressions-textarea::placeholder {
                color: var(--expr-muted);
            }
            .configurator-control:focus,
            .configurator-select:focus,
            .configurator-editor-input:focus,
            .configurator-editor-select:focus,
            .configurator-editor-textarea:focus,
            .expressions-textarea:focus {
                outline: none;
                border-color: var(--expr-focus);
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);
            }
            .configurator-control[type="range"] {
                padding: 0;
                border: none;
                background: transparent;
                box-shadow: none;
            }
            .configurator-slider-row {
                display: grid;
                grid-template-columns: 1fr 110px;
                gap: 8px;
                align-items: center;
            }
            .expressions-textarea {
                min-height: 200px;
                font-family: monospace;
                resize: vertical;
            }
            .expressions-actions,
            .configurator-editor-actions,
            .configurator-editor-toolbar {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
            }
            .test-expressions-button,
            .configurator-button {
                background: var(--expr-bg);
                color: var(--expr-text);
                border: 1px solid var(--expr-border);
                padding: 6px 10px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 700;
                outline: none;
                transition: border-color 120ms, transform 60ms, box-shadow 120ms;
                user-select: none;
                box-shadow: none;
                transform: none;
            }
            .test-expressions-button:hover,
            .configurator-button:hover {
                border-color: var(--expr-focus);
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);
            }
            .configurator-button.secondary {
                background: var(--expr-bg);
            }
            .configurator-button.danger {
                border-color: var(--expr-danger);
                color: #fecaca;
            }
            .configurator-button.danger:hover {
                border-color: var(--expr-danger);
                box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
            }
            .configurator-editor-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .configurator-editor-footer {
                display: flex;
                justify-content: center;
            }
            .configurator-editor-card {
                border: 1px solid var(--expr-border);
                border-radius: 10px;
                padding: 10px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01));
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .configurator-editor-card-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .configurator-editor-card-title {
                font-size: 12px;
                font-weight: 700;
                color: var(--expr-text);
            }
            .configurator-editor-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                gap: 10px;
            }
            .configurator-editor-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .configurator-editor-label {
                font-size: 12px;
                color: var(--expr-muted);
            }
            .configurator-editor-textarea {
                min-height: 78px;
                resize: vertical;
            }
            .expressions-results {
                margin-top: 2px;
                font-weight: 600;
                min-height: 18px;
                color: var(--expr-muted);
            }
        `;
        document.head.appendChild(style);

        this.uiElement.classList.add('expressions-manager');

        this.configuratorPanel = document.createElement('div');
        this.configuratorPanel.className = 'configurator-panel';
        this.uiElement.appendChild(this.configuratorPanel);

        const expressionsPanel = document.createElement('div');
        expressionsPanel.className = 'expressions-panel';
        this.uiElement.appendChild(expressionsPanel);

        const textArea = document.createElement('textarea');
        textArea.placeholder = `// example Javascript math syntax . . .\nx = 30;\ny = 2 * x;`;
        this.textArea = textArea;
        this.textArea.classList.add('expressions-textarea');
        this.textArea.addEventListener('change', () => this.saveAndTest());
        expressionsPanel.appendChild(this.textArea);

        const actions = document.createElement('div');
        actions.className = 'expressions-actions';
        expressionsPanel.appendChild(actions);

        this.saveButton = document.createElement('button');
        this.saveButton.textContent = 'Test Expressions';
        this.saveButton.classList.add('test-expressions-button');
        this.saveButton.addEventListener('click', () => this.saveAndTest());
        actions.appendChild(this.saveButton);

        this.editConfiguratorButton = document.createElement('button');
        this.editConfiguratorButton.type = 'button';
        this.editConfiguratorButton.textContent = 'Edit Configurator';
        this.editConfiguratorButton.className = 'configurator-button secondary';
        this.editConfiguratorButton.addEventListener('click', () => {
            void this.handleEditConfiguratorButtonClick();
        });
        actions.appendChild(this.editConfiguratorButton);

        this.editorPanel = document.createElement('div');
        this.editorPanel.className = 'configurator-editor-panel';
        this.editorPanel.style.display = 'none';
        expressionsPanel.appendChild(this.editorPanel);

        this.resultDiv = document.createElement('div');
        this.resultDiv.classList.add('expressions-results');
        expressionsPanel.appendChild(this.resultDiv);
    }

    refreshFromPartHistory() {
        const partHistory = this.getPartHistory();
        if (!partHistory) return;
        const configurator = this._ensureConfiguratorState();
        this.textArea.value = partHistory.expressions || '';
        this.editorVisible = false;
        this.editorDraft = this._createEditorDraft(configurator);
        this.editConfiguratorButton.textContent = 'Edit Configurator';
        this.renderConfigurator();
        this.renderEditor();
    }

    _createEditorDraft(state) {
        const normalized = normalizeConfiguratorState(state);
        return {
            fields: normalized.fields.map((field) => ({
                ...deepClone(field),
                __originalName: field.name,
                optionsText: Array.isArray(field.options) ? field.options.join(', ') : '',
            })),
        };
    }

    _buildConfiguratorPreviewState() {
        const previous = this._ensureConfiguratorState();
        const previousValues = previous?.values && typeof previous.values === 'object'
            ? previous.values
            : {};
        const fields = Array.isArray(this.editorDraft?.fields) ? this.editorDraft.fields : [];
        const rawFields = [];
        const rawValues = {};

        for (let index = 0; index < fields.length; index += 1) {
            const field = fields[index] || {};
            const fallbackName = `field${index + 1}`;
            const name = String(field.name ?? '').trim() || fallbackName;
            const rawField: AnyRecord = {
                name,
                label: field.label,
                type: field.type,
                defaultValue: field.defaultValue,
            };
            if (field.type === 'slider' || field.type === 'number') {
                rawField.min = field.min;
                rawField.max = field.max;
                rawField.step = field.step;
            }
            if (field.type === 'select') {
                rawField.options = parseConfiguratorOptions(field.optionsText);
            }
            rawFields.push(rawField);

            const sourceName = field.__originalName || name;
            if (Object.prototype.hasOwnProperty.call(previousValues, sourceName)) {
                rawValues[name] = previousValues[sourceName];
            } else {
                rawValues[name] = field.defaultValue;
            }
        }

        return normalizeConfiguratorState({
            fields: rawFields,
            values: rawValues,
        });
    }

    _addDraftField() {
        const fields = Array.isArray(this.editorDraft?.fields) ? this.editorDraft.fields : [];
        const index = fields.length;
        let nextNumber = index + 1;
        let nextName = `field${nextNumber}`;
        while (fields.some((field) => String(field?.name ?? '').trim() === nextName)) {
            nextNumber += 1;
            nextName = `field${nextNumber}`;
        }
        if (!this.editorDraft || !Array.isArray(this.editorDraft.fields)) {
            this.editorDraft = { fields: [] };
        }
        this.editorDraft.fields.push({
            name: nextName,
            label: prettyConfiguratorLabel(nextName),
            type: 'number',
            defaultValue: '0',
            min: '',
            max: '',
            step: '1',
            optionsText: '',
            __originalName: '',
        });
        this.renderEditor();
    }

    toggleEditor(forceVisible = null) {
        const nextVisible = (typeof forceVisible === 'boolean') ? forceVisible : !this.editorVisible;
        this.editorVisible = nextVisible;
        if (nextVisible) {
            this.editorDraft = this._createEditorDraft(this._ensureConfiguratorState());
        }
        this.editConfiguratorButton.textContent = nextVisible ? 'Close Configurator Editor' : 'Edit Configurator';
        this.renderEditor();
    }

    async handleEditConfiguratorButtonClick() {
        if (!this.editorVisible) {
            this.toggleEditor(true);
            return;
        }
        await this.saveConfiguratorEditor();
    }

    renderConfigurator() {
        clearElement(this.configuratorPanel);
        this.configuratorPanel.style.display = 'none';

        const state = this.editorVisible
            ? this._buildConfiguratorPreviewState()
            : this._ensureConfiguratorState();
        if (!Array.isArray(state.fields) || !state.fields.length) {
            return;
        }

        this.configuratorPanel.style.display = '';
        const disableControls = this.editorVisible;

        const header = document.createElement('div');
        header.className = 'configurator-panel-header';
        this.configuratorPanel.appendChild(header);

        const title = document.createElement('div');
        title.className = 'configurator-panel-title';
        title.textContent = 'Configurator';
        header.appendChild(title);

        const fieldsEl = document.createElement('div');
        fieldsEl.className = 'configurator-fields';
        this.configuratorPanel.appendChild(fieldsEl);

        for (const field of state.fields) {
            const row = document.createElement('div');
            row.className = 'configurator-field';

            const label = document.createElement('label');
            label.className = 'configurator-field-label';
            label.textContent = field.label || field.name;
            row.appendChild(label);

            const value = Object.prototype.hasOwnProperty.call(state.values, field.name)
                ? state.values[field.name]
                : field.defaultValue;

            if (field.type === 'slider') {
                const sliderRow = document.createElement('div');
                sliderRow.className = 'configurator-slider-row';

                const rangeInput = document.createElement('input');
                rangeInput.type = 'range';
                rangeInput.className = 'configurator-control';
                rangeInput.min = String(Number.isFinite(Number(field.min)) ? Number(field.min) : 0);
                rangeInput.max = String(Number.isFinite(Number(field.max)) ? Number(field.max) : 100);
                rangeInput.step = String(Number.isFinite(Number(field.step)) ? Number(field.step) : 1);
                rangeInput.value = String(normalizeConfiguratorValue(field, value));
                rangeInput.disabled = disableControls;

                const numberInput = document.createElement('input');
                numberInput.type = 'number';
                numberInput.className = 'configurator-control';
                numberInput.min = rangeInput.min;
                numberInput.max = rangeInput.max;
                numberInput.step = rangeInput.step;
                numberInput.value = rangeInput.value;
                numberInput.disabled = disableControls;

                const setPreviewValue = (rawValue) => {
                    const next = normalizeConfiguratorValue(field, rawValue);
                    rangeInput.value = String(next);
                    numberInput.value = String(next);
                    return next;
                };

                rangeInput.addEventListener('input', () => {
                    setPreviewValue(rangeInput.value);
                });
                rangeInput.addEventListener('change', () => {
                    const next = setPreviewValue(rangeInput.value);
                    this._updateConfiguratorValue(field, next, true);
                });
                bindCommitOnBlurOrEnter(numberInput, () => {
                    const next = setPreviewValue(numberInput.value);
                    this._updateConfiguratorValue(field, next, true);
                });

                sliderRow.appendChild(rangeInput);
                sliderRow.appendChild(numberInput);
                row.appendChild(sliderRow);
            } else if (field.type === 'select') {
                const select = document.createElement('select');
                select.className = 'configurator-select';
                const options = Array.isArray(field.options) ? field.options : [];
                options.forEach((optionValue) => {
                    const option = document.createElement('option');
                    option.value = optionValue;
                    option.textContent = optionValue;
                    select.appendChild(option);
                });
                select.value = String(normalizeConfiguratorValue(field, value));
                select.disabled = disableControls;
                select.addEventListener('change', () => {
                    this._updateConfiguratorValue(field, select.value, true);
                });
                row.appendChild(select);
            } else {
                const input = document.createElement('input');
                input.type = field.type === 'number' ? 'number' : 'text';
                input.className = 'configurator-control';
                input.disabled = disableControls;
                if (field.type === 'number') {
                    if (Number.isFinite(Number(field.min))) input.min = String(field.min);
                    if (Number.isFinite(Number(field.max))) input.max = String(field.max);
                    if (Number.isFinite(Number(field.step))) input.step = String(field.step);
                    input.value = String(normalizeConfiguratorValue(field, value));
                    bindCommitOnBlurOrEnter(input, () => {
                        this._updateConfiguratorValue(field, input.value, true);
                        input.value = String(this._ensureConfiguratorState().values[field.name]);
                    });
                } else {
                    input.value = String(normalizeConfiguratorValue(field, value));
                    bindCommitOnBlurOrEnter(input, () => {
                        this._updateConfiguratorValue(field, input.value, true);
                    });
                }
                row.appendChild(input);
            }

            fieldsEl.appendChild(row);
        }
    }

    renderEditor() {
        if (!this.editorVisible) {
            this.editorPanel.style.display = 'none';
            clearElement(this.editorPanel);
            return;
        }

        this.editorPanel.style.display = '';
        clearElement(this.editorPanel);
        this.renderConfigurator();

        const header = document.createElement('div');
        header.className = 'configurator-editor-header';
        this.editorPanel.appendChild(header);

        const titleWrap = document.createElement('div');
        header.appendChild(titleWrap);

        const title = document.createElement('div');
        title.className = 'configurator-editor-title';
        title.textContent = 'Edit Configurator';
        titleWrap.appendChild(title);

        const list = document.createElement('div');
        list.className = 'configurator-editor-list';
        this.editorPanel.appendChild(list);

        const fields = Array.isArray(this.editorDraft?.fields) ? this.editorDraft.fields : [];
        fields.forEach((field, index) => {
            const card = document.createElement('div');
            card.className = 'configurator-editor-card';
            list.appendChild(card);

            const cardHeader = document.createElement('div');
            cardHeader.className = 'configurator-editor-card-header';
            card.appendChild(cardHeader);

            const cardTitle = document.createElement('div');
            cardTitle.className = 'configurator-editor-card-title';
            cardTitle.textContent = `Widget ${index + 1}`;
            cardHeader.appendChild(cardTitle);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'configurator-button danger';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => {
                fields.splice(index, 1);
                this.renderEditor();
            });
            cardHeader.appendChild(removeButton);

            const grid = document.createElement('div');
            grid.className = 'configurator-editor-grid';
            card.appendChild(grid);

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'configurator-editor-input';
            nameInput.value = String(field.name ?? '');
            nameInput.addEventListener('input', () => {
                field.name = nameInput.value;
                this._renderDraftConfiguratorPreview();
            });
            grid.appendChild(buildEditorField('Field Name', nameInput));

            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.className = 'configurator-editor-input';
            labelInput.value = String(field.label ?? '');
            labelInput.addEventListener('input', () => {
                field.label = labelInput.value;
                this._renderDraftConfiguratorPreview();
            });
            grid.appendChild(buildEditorField('Label', labelInput));

            const typeSelect = document.createElement('select');
            typeSelect.className = 'configurator-editor-select';
            ['slider', 'number', 'select', 'string'].forEach((typeValue) => {
                const option = document.createElement('option');
                option.value = typeValue;
                option.textContent = typeValue;
                typeSelect.appendChild(option);
            });
            typeSelect.value = String(field.type || 'number');
            typeSelect.addEventListener('change', () => {
                field.type = typeSelect.value;
                if (field.type === 'slider') {
                    if (field.min == null || field.min === '') field.min = '0';
                    if (field.max == null || field.max === '') field.max = '100';
                    if (field.step == null || field.step === '') field.step = '1';
                    if (field.defaultValue == null || field.defaultValue === '') field.defaultValue = '0';
                } else if (field.type === 'number') {
                    if (field.step == null || field.step === '') field.step = '1';
                    if (field.defaultValue == null || field.defaultValue === '') field.defaultValue = '0';
                } else if (field.type === 'select') {
                    if (!field.optionsText) field.optionsText = 'Option';
                } else {
                    if (field.defaultValue == null) field.defaultValue = '';
                }
                this.renderEditor();
            });
            grid.appendChild(buildEditorField('Type', typeSelect));

            const defaultInput = document.createElement('input');
            defaultInput.type = (field.type === 'slider' || field.type === 'number') ? 'number' : 'text';
            defaultInput.className = 'configurator-editor-input';
            defaultInput.value = String(field.defaultValue ?? '');
            defaultInput.addEventListener('input', () => {
                field.defaultValue = defaultInput.value;
                this._renderDraftConfiguratorPreview();
            });
            grid.appendChild(buildEditorField('Default Value', defaultInput));

            if (field.type === 'slider' || field.type === 'number') {
                const minInput = document.createElement('input');
                minInput.type = 'number';
                minInput.className = 'configurator-editor-input';
                minInput.value = String(field.min ?? '');
                minInput.addEventListener('input', () => {
                    field.min = minInput.value;
                    this._renderDraftConfiguratorPreview();
                });
                grid.appendChild(buildEditorField('Min', minInput));

                const maxInput = document.createElement('input');
                maxInput.type = 'number';
                maxInput.className = 'configurator-editor-input';
                maxInput.value = String(field.max ?? '');
                maxInput.addEventListener('input', () => {
                    field.max = maxInput.value;
                    this._renderDraftConfiguratorPreview();
                });
                grid.appendChild(buildEditorField('Max', maxInput));

                const stepInput = document.createElement('input');
                stepInput.type = 'number';
                stepInput.className = 'configurator-editor-input';
                stepInput.value = String(field.step ?? '1');
                stepInput.addEventListener('input', () => {
                    field.step = stepInput.value;
                    this._renderDraftConfiguratorPreview();
                });
                grid.appendChild(buildEditorField('Step', stepInput));
            }

            if (field.type === 'select') {
                const optionsInput = document.createElement('textarea');
                optionsInput.className = 'configurator-editor-textarea';
                optionsInput.value = String(field.optionsText ?? '');
                optionsInput.placeholder = 'Option A, Option B or one option per line';
                optionsInput.addEventListener('input', () => {
                    field.optionsText = optionsInput.value;
                    this._renderDraftConfiguratorPreview();
                });
                card.appendChild(buildEditorField('Options', optionsInput));
            }
        });

        const footer = document.createElement('div');
        footer.className = 'configurator-editor-footer';
        this.editorPanel.appendChild(footer);

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'configurator-button';
        addButton.textContent = 'Add Widget';
        addButton.addEventListener('click', () => this._addDraftField());
        footer.appendChild(addButton);

        const actions = document.createElement('div');
        actions.className = 'configurator-editor-actions';
        this.editorPanel.appendChild(actions);

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'configurator-button';
        saveButton.textContent = 'Save Configurator';
        saveButton.addEventListener('click', () => this.saveConfiguratorEditor());
        actions.appendChild(saveButton);
    }

    _buildConfiguratorFromDraft() {
        const previous = this._ensureConfiguratorState();
        const previousValues = previous?.values && typeof previous.values === 'object'
            ? previous.values
            : {};
        const rawFields = [];
        const rawValues = {};
        const seenNames = new Set();
        const fields = Array.isArray(this.editorDraft?.fields) ? this.editorDraft.fields : [];

        for (let index = 0; index < fields.length; index += 1) {
            const field = fields[index] || {};
            const name = String(field.name ?? '').trim();
            const label = String(field.label ?? '').trim();
            const type = String(field.type ?? '').trim().toLowerCase() || 'number';

            if (!name) {
                throw new Error(`Widget ${index + 1} is missing a field name.`);
            }
            if (!isConfiguratorFieldNameValid(name)) {
                throw new Error(`"${name}" is not a valid field name. Use letters, numbers, _, or $, and do not start with a number.`);
            }
            if (seenNames.has(name)) {
                throw new Error(`Field name "${name}" is duplicated.`);
            }
            seenNames.add(name);

            const rawField: AnyRecord = {
                name,
                label,
                type,
                defaultValue: field.defaultValue,
            };

            if (type === 'slider' || type === 'number') {
                const defaultValue = readFiniteNumber(field.defaultValue);
                if (defaultValue == null) {
                    throw new Error(`"${name}" needs a numeric default value.`);
                }
                const stepValue = readFiniteNumber(field.step);
                if (stepValue == null || stepValue <= 0) {
                    throw new Error(`"${name}" needs a step greater than 0.`);
                }
                rawField.min = field.min;
                rawField.max = field.max;
                rawField.step = field.step;
            }

            if (type === 'slider') {
                const minValue = readFiniteNumber(field.min);
                const maxValue = readFiniteNumber(field.max);
                if (minValue == null || maxValue == null) {
                    throw new Error(`"${name}" slider needs numeric min and max values.`);
                }
                if (minValue > maxValue) {
                    throw new Error(`"${name}" slider min cannot be greater than max.`);
                }
            }

            if (type === 'select') {
                const options = parseConfiguratorOptions(field.optionsText);
                if (!options.length) {
                    throw new Error(`"${name}" select needs at least one option.`);
                }
                rawField.options = options;
            }

            rawFields.push(rawField);

            const sourceName = field.__originalName || name;
            if (Object.prototype.hasOwnProperty.call(previousValues, sourceName)) {
                rawValues[name] = previousValues[sourceName];
            } else {
                rawValues[name] = field.defaultValue;
            }
        }

        return normalizeConfiguratorState({
            fields: rawFields,
            values: rawValues,
        });
    }

    async saveConfiguratorEditor() {
        try {
            const partHistory = this.getPartHistory();
            if (!partHistory) throw new Error('Configurator editing requires viewer.partHistory.');
            partHistory.configurator = this._buildConfiguratorFromDraft();
            this.editorVisible = false;
            this.editConfiguratorButton.textContent = 'Edit Configurator';
            this.renderConfigurator();
            this.renderEditor();
            const applied = await this._applyConfiguratorChanges();
            if (applied) {
                this._setStatus('Configurator saved.', 'green');
            }
        } catch (error) {
            this._setStatus(error?.message || 'Failed to save configurator.', 'red');
        }
    }

    _updateConfiguratorValue(field, rawValue, commit = false) {
        const partHistory = this.getPartHistory();
        if (!partHistory) return;
        partHistory.configurator = normalizeConfiguratorState(partHistory.configurator);
        partHistory.configurator.values[field.name] = normalizeConfiguratorValue(field, rawValue);
        this._scheduleConfiguratorApply(commit);
    }

    _scheduleConfiguratorApply(immediate = false) {
        if (this._configuratorApplyTimer) {
            clearTimeout(this._configuratorApplyTimer);
            this._configuratorApplyTimer = null;
        }
        if (immediate) {
            void this._applyConfiguratorChanges();
            return;
        }
        this._configuratorApplyTimer = setTimeout(() => {
            this._configuratorApplyTimer = null;
            void this._applyConfiguratorChanges();
        }, CONFIGURATOR_APPLY_DEBOUNCE_MS);
    }

    async _applyConfiguratorChanges() {
        const partHistory = this.getPartHistory();
        if (!partHistory) return false;
        if (this._configuratorApplyInFlight) {
            this._configuratorApplyPending = true;
            return false;
        }
        this._configuratorApplyInFlight = true;
        try {
            await partHistory.runHistory();
            partHistory.queueHistorySnapshot?.({ reason: 'configurator' });
            return true;
        } catch (error) {
            this._setStatus(error?.message || 'Failed to apply configurator.', 'red');
            return false;
        } finally {
            this._configuratorApplyInFlight = false;
            if (this._configuratorApplyPending) {
                this._configuratorApplyPending = false;
                void this._applyConfiguratorChanges();
            }
        }
    }

    saveAndTest() {
        this._setStatus('Expressions evaluated successfully.', 'green');
        let succeeded = false;
        try {
            const partHistory = this.getPartHistory();
            if (!partHistory || typeof partHistory.buildExpressionSource !== 'function') {
                throw new Error('expressionsManager requires viewer.partHistory.buildExpressionSource().');
            }
            const source = partHistory.buildExpressionSource(this.textArea.value);
            Function(`${source}\nreturn true;`)();
            partHistory.expressions = this.textArea.value;
            succeeded = true;
        } catch (error) {
            this._setStatus(`Error occurred while testing expressions. ${error?.message || error}`, 'red');
            succeeded = false;
        }

        if (succeeded) {
            this._setStatus('Expressions evaluated successfully.', 'green');
            const runPromise = this.getPartHistory()?.runHistory?.();
            if (runPromise && typeof runPromise.then === 'function') {
                runPromise.then(() => {
                    this.getPartHistory()?.queueHistorySnapshot?.({ reason: 'expressions' });
                });
            } else {
                this.getPartHistory()?.queueHistorySnapshot?.({ reason: 'expressions' });
            }
        }
    }
}
