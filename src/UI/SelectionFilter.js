import { CADmaterials } from "./CADmaterials.js";
import {BREP} from '../BREP/BREP.js';
export class SelectionFilter {
    static SOLID = "SOLID";
    static COMPONENT = "COMPONENT";
    static FACE = "FACE";
    static PLANE = "PLANE";
    static SKETCH = "SKETCH";
    static EDGE = "EDGE";
    static LOOP = "LOOP";
    static VERTEX = "VERTEX";
    static ALL = "ALL";

    // The set (or ALL) of types available in the current context
    static allowedSelectionTypes = SelectionFilter.ALL;
    static viewer = null;
    static previouseAllowedSelectionTypes = null;
    static _hovered = new Set(); // objects currently hover-highlighted
    static hoverColor = '#fbff00'; // default hover tint
    static _selectionActions = new Map();
    static _selectionActionOrder = [];
    static _selectionActionSeq = 1;
    static _selectionActionListenerBound = false;
    static _selectionActionsPending = false;
    static _selectionActionBar = null;
    static _historyContextActions = new Map();
    static _selectionActionSeparator = null;
    static _contextSuppressReasons = new Set();
    static _selectionFilterIndicator = null;
    static _selectionFilterIndicatorToggle = null;
    static _selectionFilterIndicatorPanel = null;
    static _selectionFilterCheckboxes = new Map();
    static _selectionFilterTypes = null;
    static _selectionFilterOutsideBound = false;
    static _selectionFilterTintBtn = null;
    static _selectableTintState = {
        active: false,
        activeColor: null,
        colorIndex: 0,
        colors: ['#34d399', '#f97316', '#60a5fa', '#f43f5e'],
        materials: new Map(),
    };

    constructor() {
        throw new Error("SelectionFilter is static and cannot be instantiated.");
    }

    static get TYPES() { return [this.SOLID, this.COMPONENT, this.FACE, this.PLANE, this.SKETCH, this.EDGE, this.LOOP, this.VERTEX, this.ALL]; }

    // Convenience: return the list of selectable types for the dropdown (excludes ALL)
    static getAvailableTypes() {
        if (SelectionFilter.allowedSelectionTypes === SelectionFilter.ALL) {
            return SelectionFilter.TYPES.filter(t => t !== SelectionFilter.ALL);
        }
        const arr = Array.from(SelectionFilter.allowedSelectionTypes || []);
        return arr.filter(t => t && t !== SelectionFilter.ALL);
    }

    static getCurrentType() {
        // Current type tracking has been removed; keep method for compatibility.
        return null;
    }

    static setCurrentType(_type) {
        // No-op: current type is no longer tracked.
        void _type;
    }

    static SetSelectionTypes(types) {

        this.viewer.endSplineMode();
        if (types === SelectionFilter.ALL) {
            SelectionFilter.allowedSelectionTypes = SelectionFilter.ALL;
            SelectionFilter.triggerUI();
            SelectionFilter._ensureSceneSelectionHandlers();
            SelectionFilter.#logAllowedTypesChange(SelectionFilter.allowedSelectionTypes, 'SetSelectionTypes');
            return;
        }
        const list = Array.isArray(types) ? types : [types];
        const invalid = list.filter(t => !SelectionFilter.TYPES.includes(t) || t === SelectionFilter.ALL);
        if (invalid.length) throw new Error(`Unknown selection type(s): ${invalid.join(", ")}`);
        SelectionFilter.allowedSelectionTypes = new Set(list);
        SelectionFilter.triggerUI();
        SelectionFilter._ensureSceneSelectionHandlers();
        SelectionFilter.#logAllowedTypesChange(SelectionFilter.allowedSelectionTypes, 'SetSelectionTypes');
    }

    static stashAllowedSelectionTypes() {
        SelectionFilter.previouseAllowedSelectionTypes = SelectionFilter.allowedSelectionTypes;
    }

    static restoreAllowedSelectionTypes() {
        if (SelectionFilter.previouseAllowedSelectionTypes !== null) {
            SelectionFilter.allowedSelectionTypes = SelectionFilter.previouseAllowedSelectionTypes;
            SelectionFilter.previouseAllowedSelectionTypes = null;
            SelectionFilter.triggerUI();
            SelectionFilter._ensureSceneSelectionHandlers();
            SelectionFilter.#logAllowedTypesChange(SelectionFilter.allowedSelectionTypes, 'RestoreSelectionTypes');
        }
    }

    static ensureSelectionHandlers(obj, { deep = false } = {}) {
        if (!obj || typeof obj !== 'object') return false;
        let changed = false;
        const attach = (target) => {
            if (!target || typeof target !== 'object') return;
            if (typeof target.onClick === 'function') return;
            target.onClick = () => {
                try {
                    if (target.type === SelectionFilter.SOLID && target.parent && target.parent.type === SelectionFilter.COMPONENT) {
                        const handledByParent = SelectionFilter.toggleSelection(target.parent);
                        if (!handledByParent) SelectionFilter.toggleSelection(target);
                        return;
                    }
                    SelectionFilter.toggleSelection(target);
                } catch (error) {
                    try { console.warn('[SelectionFilter] toggleSelection failed:', error); } catch (_) { /* ignore */ }
                }
            };
            try { target.onClick.__brepSelectionHandler = true; } catch (_) { /* ignore */ }
            changed = true;
        };

        if (!deep) {
            attach(obj);
            return changed;
        }

        const stack = [obj];
        while (stack.length) {
            const current = stack.pop();
            attach(current);
            const kids = Array.isArray(current?.children) ? current.children : [];
            for (const child of kids) {
                if (child) stack.push(child);
            }
        }
        return changed;
    }

    static _ensureSceneSelectionHandlers() {
        try {
            const scene = SelectionFilter.viewer?.partHistory?.scene
                || SelectionFilter.viewer?.scene
                || null;
            if (!scene || !Array.isArray(scene.children)) return;
            for (const child of scene.children) {
                if (!child || child.type !== SelectionFilter.SOLID) continue;
                SelectionFilter.ensureSelectionHandlers(child, { deep: true });
            }
        } catch { }
    }



    static allowType(type) {
        // Legacy support: expand available set; does not change currentType
        if (type === SelectionFilter.ALL) { SelectionFilter.allowedSelectionTypes = SelectionFilter.ALL; SelectionFilter.triggerUI(); return; }
        if (SelectionFilter.TYPES.includes(type)) {
            if (SelectionFilter.allowedSelectionTypes === SelectionFilter.ALL) { SelectionFilter.triggerUI(); return; }
            SelectionFilter.allowedSelectionTypes.add(type);
        } else throw new Error(`Unknown selection type: ${type}`);
        SelectionFilter.triggerUI();
        SelectionFilter.#logAllowedTypesChange(SelectionFilter.allowedSelectionTypes, 'allowType');
    }

    static disallowType(type) {
        // Legacy support: shrink available set; does not change currentType (may become invalid until next SetSelectionTypes)
        if (SelectionFilter.allowedSelectionTypes === SelectionFilter.ALL) SelectionFilter.allowedSelectionTypes = new Set();
        if (SelectionFilter.TYPES.includes(type)) SelectionFilter.allowedSelectionTypes.delete(type);
        else throw new Error(`Unknown selection type: ${type}`);
        SelectionFilter.triggerUI();
        SelectionFilter.#logAllowedTypesChange(SelectionFilter.allowedSelectionTypes, 'disallowType');
    }

    static GetSelectionTypes() {
        const v = SelectionFilter.allowedSelectionTypes;
        return v === SelectionFilter.ALL ? SelectionFilter.ALL : Array.from(v);
    }

    // Check against the allowed set only (ignores currentType)
    static matchesAllowedType(type) {
        if (!type) return false;
        if (SelectionFilter.allowedSelectionTypes === SelectionFilter.ALL) return true;
        return SelectionFilter.allowedSelectionTypes?.has?.(type) || false;
    }

    static IsAllowed(type) {
        if (!type) return false;
        return SelectionFilter.matchesAllowedType(type);
    }

    static Reset() {
        SelectionFilter.allowedSelectionTypes = SelectionFilter.ALL;
        SelectionFilter.triggerUI();
        SelectionFilter.#logAllowedTypesChange(SelectionFilter.allowedSelectionTypes, 'Reset');
    }

    static #getBaseMaterial(obj) {
        if (!obj) return null;
        const ud = obj.userData || {};
        if (ud.__baseMaterial) return ud.__baseMaterial;
        if (obj.type === SelectionFilter.FACE) return CADmaterials.FACE?.BASE ?? CADmaterials.FACE ?? obj.material;
        if (obj.type === SelectionFilter.PLANE) return CADmaterials.PLANE?.BASE ?? CADmaterials.FACE?.BASE ?? obj.material;
        if (obj.type === SelectionFilter.EDGE) return CADmaterials.EDGE?.BASE ?? CADmaterials.EDGE ?? obj.material;
        if (obj.type === SelectionFilter.SOLID || obj.type === SelectionFilter.COMPONENT) return obj.material;
        return obj.material;
    }

    // ---------------- Hover Highlighting ----------------
    static getHoverColor() { return SelectionFilter.hoverColor; }
    static setHoverColor(hex) {
        if (!hex) return;
        try { SelectionFilter.hoverColor = String(hex); } catch (_) { }
        // Update current hovered objects live
        for (const o of Array.from(SelectionFilter._hovered)) {
            if (o && o.material && o.material.color && typeof o.material.color.set === 'function') {
                try { o.material.color.set(SelectionFilter.hoverColor); } catch (_) { }
            }
        }
    }

    static setHoverObject(obj, options = {}) {
        const { ignoreFilter = false } = options;
        // Clear existing hover first
        SelectionFilter.clearHover();
        if (!obj) return;
        // Highlight depending on type
        SelectionFilter.#applyHover(obj, { ignoreFilter });
    }

    static setHoverByName(scene, name) {
        if (!scene || !name) { SelectionFilter.clearHover(); return; }
        const obj = scene.getObjectByName(name);
        if (!obj) { SelectionFilter.clearHover(); return; }
        SelectionFilter.setHoverObject(obj);
    }

    static clearHover() {
        if (!SelectionFilter._hovered || SelectionFilter._hovered.size === 0) return;
        for (const o of Array.from(SelectionFilter._hovered)) {
            SelectionFilter.#restoreHover(o);
        }
        SelectionFilter._hovered.clear();
    }

    static #applyHover(obj, options = {}) {
        const { ignoreFilter = false } = options;
        if (!obj) return;
        // Respect selection filter: skip if disallowed
        const allowed = ignoreFilter
            || SelectionFilter.IsAllowed(obj.type)
            || SelectionFilter.matchesAllowedType(obj.type);
        if (!allowed) return;

        // Only ever highlight one object: the exact object provided, if it has a color
        const target = obj;
        if (!target) return;

        const applyToOne = (t) => {
            if (!t) return;
            if (!t.userData) t.userData = {};
            const origMat = t.material;
            if (!origMat) return;
            if (t.userData.__hoverMatApplied) { SelectionFilter._hovered.add(t); return; }
            let clone;
            try { clone = typeof origMat.clone === 'function' ? origMat.clone() : origMat; } catch { clone = origMat; }
            try { if (clone && clone.color && typeof clone.color.set === 'function') clone.color.set(SelectionFilter.hoverColor); } catch { }
            try {
                if (origMat && clone && origMat.resolution && clone.resolution && typeof clone.resolution.copy === 'function') {
                    clone.resolution.copy(origMat.resolution);
                }
            } catch { }
            try {
                if (origMat && clone && typeof origMat.dashed !== 'undefined' && typeof clone.dashed !== 'undefined') {
                    clone.dashed = origMat.dashed;
                }
                if (origMat && clone && typeof origMat.dashSize !== 'undefined' && typeof clone.dashSize !== 'undefined') {
                    clone.dashSize = origMat.dashSize;
                }
                if (origMat && clone && typeof origMat.gapSize !== 'undefined' && typeof clone.gapSize !== 'undefined') {
                    clone.gapSize = origMat.gapSize;
                }
                if (origMat && clone && typeof origMat.dashScale !== 'undefined' && typeof clone.dashScale !== 'undefined') {
                    clone.dashScale = origMat.dashScale;
                }
            } catch { }
            try {
                t.userData.__hoverOrigMat = origMat;
                t.userData.__hoverMatApplied = true;
                if (clone !== origMat) t.material = clone;
                t.userData.__hoverMat = clone;
            } catch { }
            SelectionFilter._hovered.add(t);
        };

        if (target.type === SelectionFilter.SOLID || target.type === SelectionFilter.COMPONENT) {
            // Highlight all immediate child faces/edges for SOLID or COMPONENT children
            if (Array.isArray(target.children)) {
                for (const ch of target.children) {
                    if (!ch) continue;
                    if (ch.type === SelectionFilter.SOLID || ch.type === SelectionFilter.COMPONENT) {
                        if (Array.isArray(ch.children)) {
                            for (const nested of ch.children) {
                                if (nested && (nested.type === SelectionFilter.FACE || nested.type === SelectionFilter.EDGE)) applyToOne(nested);
                            }
                        }
                    } else if (ch.type === SelectionFilter.FACE || ch.type === SelectionFilter.EDGE) {
                        applyToOne(ch);
                    }
                }
            }
            // Track the solid as a logical hovered root to clear later
            SelectionFilter._hovered.add(target);
            return;
        }

        if (target.type === SelectionFilter.VERTEX) {
            // Apply to the vertex object and any drawable children (e.g., Points)
            applyToOne(target);
            if (Array.isArray(target.children)) {
                for (const ch of target.children) {
                    applyToOne(ch);
                }
            }
            return;
        }

        applyToOne(target);
    }

    static #restoreHover(obj) {
        if (!obj) return;
        const restoreOne = (t) => {
            if (!t) return;
            const ud = t.userData || {};
            if (!ud.__hoverMatApplied) return;
            const cloneWithColor = (mat, colorHex) => {
                if (!mat) return mat;
                let c = mat;
                try {
                    c = typeof mat.clone === 'function' ? mat.clone() : mat;
                    if (c && c.color && typeof c.color.set === 'function' && colorHex) c.color.set(colorHex);
                } catch { c = mat; }
                return c;
            };
            const applySelectionMaterial = () => {
                if (t.type === SelectionFilter.FACE) return CADmaterials.FACE?.SELECTED ?? CADmaterials.FACE ?? ud.__hoverOrigMat ?? t.material;
                if (t.type === SelectionFilter.PLANE) return CADmaterials.PLANE?.SELECTED ?? CADmaterials.FACE?.SELECTED ?? ud.__hoverOrigMat ?? t.material;
                if (t.type === SelectionFilter.EDGE) {
                    const base = ud.__hoverOrigMat ?? t.material;
                    const selColor = CADmaterials.EDGE?.SELECTED?.color || CADmaterials.EDGE?.SELECTED?.color?.getHexString?.();
                    return cloneWithColor(base, selColor || '#ff00ff');
                }
                if (t.type === SelectionFilter.SOLID || t.type === SelectionFilter.COMPONENT) return CADmaterials.SOLID?.SELECTED ?? ud.__hoverOrigMat ?? t.material;
                return ud.__hoverOrigMat ?? t.material;
            };
            const applyDeselectedMaterial = () => {
                if (t.type === SelectionFilter.FACE) return ud.__hoverOrigMat ?? SelectionFilter.#getBaseMaterial(t) ?? t.material;
                if (t.type === SelectionFilter.PLANE) return ud.__hoverOrigMat ?? SelectionFilter.#getBaseMaterial(t) ?? t.material;
                if (t.type === SelectionFilter.EDGE) return ud.__hoverOrigMat ?? SelectionFilter.#getBaseMaterial(t) ?? t.material;
                if (t.type === SelectionFilter.SOLID || t.type === SelectionFilter.COMPONENT) return ud.__hoverOrigMat ?? t.material;
                return ud.__hoverOrigMat ?? t.material;
            };
            try {
                if (t.selected) {
                    const selMat = applySelectionMaterial();
                    if (selMat) t.material = selMat;
                } else {
                    const baseMat = applyDeselectedMaterial();
                    if (baseMat) t.material = baseMat;
                }
                if (ud.__hoverMat && ud.__hoverMat !== ud.__hoverOrigMat && typeof ud.__hoverMat.dispose === 'function') ud.__hoverMat.dispose();
            } catch { }
            try { delete t.userData.__hoverMatApplied; } catch { }
            try { delete t.userData.__hoverOrigMat; } catch { }
            try { delete t.userData.__hoverMat; } catch { }
        };

        if (obj.type === SelectionFilter.SOLID || obj.type === SelectionFilter.COMPONENT) {
            if (Array.isArray(obj.children)) {
                for (const ch of obj.children) restoreOne(ch);
            }
        }
        if (obj.type === SelectionFilter.VERTEX) {
            if (Array.isArray(obj.children)) {
                for (const ch of obj.children) restoreOne(ch);
            }
        }
        restoreOne(obj);
    }

    static #isInputUsable(el) {
        // Use the closest visible wrapper as the visibility anchor; hidden inputs themselves render display:none
        const anchor = (el && typeof el.closest === 'function')
            ? (el.closest('.ref-single-wrap, .ref-multi-wrap') || el)
            : el;
        if (!anchor || !anchor.isConnected) return false;
        const seen = new Set();
        let node = anchor;
        while (node && !seen.has(node)) {
            seen.add(node);
            if (node.hidden === true) return false;
            try {
                const style = window.getComputedStyle(node);
                if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
            } catch (_) { /* ignore */ }
            const root = (typeof node.getRootNode === 'function') ? node.getRootNode() : null;
            if (root && root.host && root !== node) {
                node = root.host;
                continue;
            }
            node = node.parentElement;
        }
        return true;
    }

    static toggleSelection(objectToToggleSelectionOn) {
        // get the type of the object
        const type = objectToToggleSelectionOn.type;
        if (!type) throw new Error("Object to toggle selection on must have a type.");

        // Check if a reference selection is active
        try {
            let activeRefInput = document.querySelector('[active-reference-selection="true"],[active-reference-selection=true]');
            if (!activeRefInput) {
                try { activeRefInput = window.__BREP_activeRefInput || null; } catch (_) { /* ignore */ }
            }
            if (activeRefInput) {
                const usable = SelectionFilter.#isInputUsable(activeRefInput);
                if (!usable) {
                    try { activeRefInput.removeAttribute('active-reference-selection'); } catch (_) { }
                    try { activeRefInput.style.filter = 'none'; } catch (_) { }
                    try { if (window.__BREP_activeRefInput === activeRefInput) window.__BREP_activeRefInput = null; } catch (_) { }
                    SelectionFilter.restoreAllowedSelectionTypes();
                    return false;
                }

                const dataset = activeRefInput.dataset || {};
                const isMultiRef = dataset.multiple === 'true';
                const maxSelections = Number(dataset.maxSelections);
                const hasMax = Number.isFinite(maxSelections) && maxSelections > 0;
                if (isMultiRef) {
                    let currentCount = 0;
                    try {
                        if (typeof activeRefInput.__getSelectionList === 'function') {
                            const list = activeRefInput.__getSelectionList();
                            if (Array.isArray(list)) currentCount = list.length;
                        } else if (dataset.selectedCount !== undefined) {
                            const parsed = Number(dataset.selectedCount);
                            if (Number.isFinite(parsed)) currentCount = parsed;
                        }
                    } catch (_) { /* ignore */ }
                    if (hasMax && currentCount >= maxSelections) {
                        try {
                            const wrap = activeRefInput.closest('.ref-single-wrap, .ref-multi-wrap');
                            if (wrap) {
                                wrap.classList.add('ref-limit-reached');
                                setTimeout(() => {
                                    try { wrap.classList.remove('ref-limit-reached'); } catch (_) { }
                                }, 480);
                            }
                        } catch (_) { }
                        return true;
                    }
                }
                const allowed = SelectionFilter.allowedSelectionTypes;
                const allowAll = allowed === SelectionFilter.ALL;
                const priorityOrder = [
                    SelectionFilter.VERTEX,
                    SelectionFilter.EDGE,
                    SelectionFilter.FACE,
                    SelectionFilter.PLANE,
                    SelectionFilter.SOLID,
                    SelectionFilter.COMPONENT,
                ];
                const allowedHas = (t) => !!(allowed && typeof allowed.has === 'function' && allowed.has(t));
                const allowedPriority = allowAll ? priorityOrder : priorityOrder.filter(t => allowedHas(t));

                // Helper: find first descendant matching a type
                const findDescendantOfType = (root, desired) => {
                    if (!root || !desired) return null;
                    let found = null;
                    try {
                        root.traverse?.((ch) => {
                            if (!found && ch && ch.type === desired) found = ch;
                        });
                    } catch (_) { /* ignore */ }
                    return found;
                };

                const findAncestorOfType = (obj, desired) => {
                    let cur = obj;
                    while (cur && cur.parent) {
                        if (cur.type === desired) return cur;
                        cur = cur.parent;
                    }
                    return null;
                };
                const pickByTypeList = (typeList) => {
                    if (!Array.isArray(typeList)) return null;
                    for (const desired of typeList) {
                        if (!desired) continue;
                        if (objectToToggleSelectionOn?.type === desired) return objectToToggleSelectionOn;
                        let picked = findDescendantOfType(objectToToggleSelectionOn, desired);
                        if (!picked) picked = findAncestorOfType(objectToToggleSelectionOn, desired);
                        if (picked) return picked;
                    }
                    return null;
                };

                let targetObj = null;
                // Prefer the exact object the user clicked if it is allowed.
                if (allowAll || allowedHas(objectToToggleSelectionOn?.type)) {
                    targetObj = objectToToggleSelectionOn;
                }
                if (!targetObj) {
                    targetObj = pickByTypeList(allowedPriority);
                }
                if (!targetObj && !allowAll && allowed && typeof allowed[Symbol.iterator] === 'function') {
                    targetObj = pickByTypeList(Array.from(allowed));
                }
                if (!targetObj && allowAll) {
                    targetObj = objectToToggleSelectionOn;
                }
                if (!targetObj) return false;

                // Update the reference input with the chosen object
                try {
                    if (activeRefInput && typeof activeRefInput.__captureReferencePreview === 'function') {
                        activeRefInput.__captureReferencePreview(targetObj);
                    }
                } catch (_) { /* ignore preview capture errors */ }
                const objType = targetObj.type;
                const objectName = targetObj.name || `${objType}(${targetObj.position?.x || 0},${targetObj.position?.y || 0},${targetObj.position?.z || 0})`;

                const snapshotSelections = (inputEl) => {
                    const data = inputEl?.dataset || {};
                    let values = null;
                    if (data.selectedValues) {
                        try {
                            const parsed = JSON.parse(data.selectedValues);
                            if (Array.isArray(parsed)) values = parsed;
                        } catch (_) { /* ignore */ }
                    }
                    if (!Array.isArray(values) && typeof inputEl?.__getSelectionList === 'function') {
                        try {
                            const list = inputEl.__getSelectionList();
                            if (Array.isArray(list)) values = list.slice();
                        } catch (_) { /* ignore */ }
                    }
                    let count = 0;
                    if (Array.isArray(values)) {
                        count = values.length;
                    } else if (data.selectedCount !== undefined) {
                        const parsed = Number(data.selectedCount);
                        if (Number.isFinite(parsed) && parsed >= 0) count = parsed;
                    }
                    return count;
                };

                activeRefInput.value = objectName;
                activeRefInput.dispatchEvent(new Event('change'));
                const afterSelectionCount = snapshotSelections(activeRefInput);

                const didReachLimit = isMultiRef && hasMax && afterSelectionCount >= maxSelections;
                const keepActive = isMultiRef && !didReachLimit;

                if (!keepActive) {
                    // Clean up the reference selection state
                    activeRefInput.removeAttribute('active-reference-selection');
                    activeRefInput.style.filter = 'none';
                    try {
                        const wrap = activeRefInput.closest('.ref-single-wrap, .ref-multi-wrap');
                        if (wrap) wrap.classList.remove('ref-active');
                    } catch (_) { }
                    // Restore selection filter
                    SelectionFilter.restoreAllowedSelectionTypes();
                    try { if (window.__BREP_activeRefInput === activeRefInput) window.__BREP_activeRefInput = null; } catch (_) { }
                } else {
                    activeRefInput.setAttribute('active-reference-selection', 'true');
                    activeRefInput.style.filter = 'invert(1)';
                    try {
                        const wrap = activeRefInput.closest('.ref-single-wrap, .ref-multi-wrap');
                        if (wrap) wrap.classList.add('ref-active');
                    } catch (_) { }
                    try { window.__BREP_activeRefInput = activeRefInput; } catch (_) { }
                }
                return true; // handled as a reference selection
            }
        } catch (error) {
            console.warn("Error handling reference selection:", error);
        }

        let parentSelectedAction = false;
        // check if the object is selectable and if it is toggle the .selected atribute on the object. 
        // Allow toggling off even if type is currently disallowed; only block new selections
        if (SelectionFilter.IsAllowed(type) || objectToToggleSelectionOn.selected === true) {
            objectToToggleSelectionOn.selected = !objectToToggleSelectionOn.selected;
            // change the material on the object to indicate it is selected or not.
            if (objectToToggleSelectionOn.selected) {
                if (objectToToggleSelectionOn.type === SelectionFilter.FACE) {
                    objectToToggleSelectionOn.material = CADmaterials.FACE?.SELECTED ?? CADmaterials.FACE;
                } else if (objectToToggleSelectionOn.type === SelectionFilter.PLANE) {
                    objectToToggleSelectionOn.material = CADmaterials.PLANE?.SELECTED ?? CADmaterials.FACE?.SELECTED ?? objectToToggleSelectionOn.material;
                } else if (objectToToggleSelectionOn.type === SelectionFilter.EDGE) {
                    objectToToggleSelectionOn.material = CADmaterials.EDGE?.SELECTED ?? CADmaterials.EDGE;
                } else if (objectToToggleSelectionOn.type === SelectionFilter.VERTEX) {
                    // Vertex visuals are handled by its selected accessor (point + sphere)
                } else if (objectToToggleSelectionOn.type === SelectionFilter.SOLID || objectToToggleSelectionOn.type === SelectionFilter.COMPONENT) {
                    parentSelectedAction = true;
                    objectToToggleSelectionOn.children.forEach(child => {
                        // apply selected material based on object type for faces and edges
                        if (child.type === SelectionFilter.FACE) child.material = CADmaterials.FACE?.SELECTED ?? CADmaterials.FACE;
                        if (child.type === SelectionFilter.PLANE) child.material = CADmaterials.PLANE?.SELECTED ?? CADmaterials.FACE?.SELECTED ?? child.material;
                        if (child.type === SelectionFilter.EDGE) child.material = CADmaterials.EDGE?.SELECTED ?? CADmaterials.EDGE;
                    });
                }

            } else {
                if (objectToToggleSelectionOn.type === SelectionFilter.FACE) {
                    objectToToggleSelectionOn.material = SelectionFilter.#getBaseMaterial(objectToToggleSelectionOn) ?? objectToToggleSelectionOn.material;
                } else if (objectToToggleSelectionOn.type === SelectionFilter.PLANE) {
                    objectToToggleSelectionOn.material = SelectionFilter.#getBaseMaterial(objectToToggleSelectionOn) ?? objectToToggleSelectionOn.material;
                } else if (objectToToggleSelectionOn.type === SelectionFilter.EDGE) {
                    objectToToggleSelectionOn.material = SelectionFilter.#getBaseMaterial(objectToToggleSelectionOn) ?? objectToToggleSelectionOn.material;
                } else if (objectToToggleSelectionOn.type === SelectionFilter.VERTEX) {
                    // Vertex accessor handles its own visual reset
                } else if (objectToToggleSelectionOn.type === SelectionFilter.SOLID || objectToToggleSelectionOn.type === SelectionFilter.COMPONENT) {
                    parentSelectedAction = true;
                    objectToToggleSelectionOn.children.forEach(child => {
                        // apply selected material based on object type for faces and edges
                        if (child.type === SelectionFilter.FACE) child.material = child.selected ? CADmaterials.FACE?.SELECTED ?? CADmaterials.FACE : (SelectionFilter.#getBaseMaterial(child) ?? child.material);
                        if (child.type === SelectionFilter.PLANE) child.material = child.selected ? (CADmaterials.PLANE?.SELECTED ?? CADmaterials.FACE?.SELECTED ?? child.material) : (SelectionFilter.#getBaseMaterial(child) ?? child.material);
                        if (child.type === SelectionFilter.EDGE) child.material = child.selected ? CADmaterials.EDGE?.SELECTED ?? CADmaterials.EDGE : (SelectionFilter.#getBaseMaterial(child) ?? child.material);
                    });
                }
            }
            SelectionFilter._emitSelectionChanged();
        }

        return parentSelectedAction;
    }

    static unselectAll(scene) {
        // itterate over all children and nested children of the scene and set the .selected atribute to false. 
        scene.traverse((child) => {
            child.selected = false;
            // reset material to base
            if (child.type === SelectionFilter.FACE) {
                child.material = SelectionFilter.#getBaseMaterial(child) ?? child.material;
            } else if (child.type === SelectionFilter.PLANE) {
                child.material = SelectionFilter.#getBaseMaterial(child) ?? child.material;
            } else if (child.type === SelectionFilter.EDGE) {
                child.material = SelectionFilter.#getBaseMaterial(child) ?? child.material;
            }

        });
        SelectionFilter._emitSelectionChanged();
    }

    static selectItem(scene, itemName) {
        scene.traverse((child) => {
            if (child && child.name === itemName) {
                child.selected = true;
                // change material to selected
                if (child.type === SelectionFilter.FACE) {
                    child.material = CADmaterials.FACE?.SELECTED ?? CADmaterials.FACE;
                } else if (child.type === SelectionFilter.PLANE) {
                    child.material = CADmaterials.PLANE?.SELECTED ?? CADmaterials.FACE?.SELECTED ?? child.material;
                } else if (child.type === SelectionFilter.EDGE) {
                    child.material = CADmaterials.EDGE?.SELECTED ?? CADmaterials.EDGE;
                } else if (child.type === SelectionFilter.SOLID || child.type === SelectionFilter.COMPONENT) {
                    child.material = CADmaterials.SOLID?.SELECTED ?? CADmaterials.SOLID;
                }
            }
        });
        SelectionFilter._emitSelectionChanged();
    }

    static deselectItem(scene, itemName) {
        // Traverse scene and deselect a single item by name, updating materials appropriately
        scene.traverse((child) => {
            if (child.name === itemName) {
                child.selected = false;
                if (child.type === SelectionFilter.FACE) {
                    child.material = SelectionFilter.#getBaseMaterial(child) ?? child.material;
                } else if (child.type === SelectionFilter.PLANE) {
                    child.material = SelectionFilter.#getBaseMaterial(child) ?? child.material;
                } else if (child.type === SelectionFilter.EDGE) {
                    child.material = SelectionFilter.#getBaseMaterial(child) ?? child.material;
                } else if (child.type === SelectionFilter.SOLID || child.type === SelectionFilter.COMPONENT) {
                    // For solids, keep children materials consistent with their own selected flags
                    child.children.forEach(grandchild => {
                        if (grandchild.type === SelectionFilter.FACE) {
                            grandchild.material = grandchild.selected ? (CADmaterials.FACE?.SELECTED ?? CADmaterials.FACE) : (SelectionFilter.#getBaseMaterial(grandchild) ?? grandchild.material);
                        }
                        if (grandchild.type === SelectionFilter.PLANE) {
                            grandchild.material = grandchild.selected ? (CADmaterials.PLANE?.SELECTED ?? CADmaterials.FACE?.SELECTED ?? grandchild.material) : (SelectionFilter.#getBaseMaterial(grandchild) ?? grandchild.material);
                        }
                        if (grandchild.type === SelectionFilter.EDGE) {
                            grandchild.material = grandchild.selected ? (CADmaterials.EDGE?.SELECTED ?? CADmaterials.EDGE) : (SelectionFilter.#getBaseMaterial(grandchild) ?? grandchild.material);
                        }
                    });
                }
            }
        });
        SelectionFilter._emitSelectionChanged();
    }

    static set uiCallback(callback) { SelectionFilter._uiCallback = callback; }
    static triggerUI() {
        if (SelectionFilter._uiCallback) SelectionFilter._uiCallback();
        try { SelectionFilter._updateSelectionFilterIndicator(); } catch (_) { }
    }

    // Emit a global event so UI can react without polling
    static _emitSelectionChanged() {
        try {
            const ev = new CustomEvent('selection-changed');
            window.dispatchEvent(ev);
        } catch (_) { /* noop */ }
    }

    static getSelectedObjects(options = {}) {
        const scene = options.scene
            || SelectionFilter.viewer?.partHistory?.scene
            || SelectionFilter.viewer?.scene
            || null;
        const selected = [];
        if (!scene || typeof scene.traverse !== 'function') return selected;
        scene.traverse((obj) => {
            if (obj && obj.selected) selected.push(obj);
        });
        return selected;
    }

    static registerSelectionAction(spec = {}) {
        if (!spec) return null;
        const id = String(spec.id || `selection-action-${SelectionFilter._selectionActionSeq++}`);
        const entry = SelectionFilter._selectionActions.get(id) || { id };
        entry.label = spec.label ?? entry.label ?? '';
        entry.title = spec.title ?? entry.title ?? entry.label ?? '';
        entry.onClick = spec.onClick ?? entry.onClick ?? null;
        entry.shouldShow = typeof spec.shouldShow === 'function' ? spec.shouldShow : (entry.shouldShow || null);
        SelectionFilter._selectionActions.set(id, entry);
        if (!SelectionFilter._selectionActionOrder.includes(id)) {
            SelectionFilter._selectionActionOrder.push(id);
        }
        SelectionFilter._ensureSelectionActionListener();
        SelectionFilter._syncSelectionActions();
        return id;
    }

    static unregisterSelectionAction(id) {
        if (!id) return;
        const entry = SelectionFilter._selectionActions.get(id);
        if (entry?.btn && entry.btn.parentNode) {
            try { entry.btn.parentNode.removeChild(entry.btn); } catch { }
        }
        SelectionFilter._selectionActions.delete(id);
        SelectionFilter._selectionActionOrder = SelectionFilter._selectionActionOrder.filter((k) => k !== id);
        SelectionFilter._syncSelectionActions();
    }

    static refreshSelectionActions() {
        SelectionFilter._syncSelectionActions();
    }

    static _ensureSelectionActionListener() {
        if (SelectionFilter._selectionActionListenerBound) return;
        if (typeof window === 'undefined') return;
        SelectionFilter._selectionActionListenerBound = true;
        window.addEventListener('selection-changed', () => SelectionFilter._syncSelectionActions());
    }

    static _syncSelectionActions() {
        const viewer = SelectionFilter.viewer;
        const bar = SelectionFilter._ensureSelectionActionBar(viewer);
        if (!bar) {
            SelectionFilter._selectionActionsPending = true;
            return;
        }
        SelectionFilter._selectionActionsPending = false;
        const suppressed = SelectionFilter._contextSuppressReasons?.size > 0;
        if (suppressed) {
            try { bar.style.display = 'none'; } catch { }
            return;
        }
        const selection = SelectionFilter.getSelectedObjects();
        const hideAll = !!viewer?._sketchMode;
        const utilityButtons = [];
        const actions = SelectionFilter._selectionActions;

        for (const id of SelectionFilter._selectionActionOrder) {
            const entry = actions.get(id);
            if (!entry) continue;
            if (!entry.btn) {
                entry.btn = SelectionFilter._createSelectionActionButton(entry);
            }
            if (!entry.btn) continue;
            try {
                entry.btn.textContent = String(entry.label ?? '');
                entry.btn.title = String(entry.title ?? entry.label ?? '');
                entry.btn.__sabOnClick = entry.onClick;
                const isIcon = String(entry.label || '').length <= 2;
                entry.btn.classList.toggle('sab-icon', isIcon);
            } catch { }
            let show = !hideAll;
            if (show) {
                if (typeof entry.shouldShow === 'function') {
                    try { show = !!entry.shouldShow(selection, viewer); } catch { show = false; }
                } else {
                    show = selection.length > 0;
                }
            }
            if (show) utilityButtons.push(entry.btn);
        }

        const historySpecs = SelectionFilter._getHistoryContextActionSpecs(selection, viewer);
        const contextButtons = [];
        const desiredIds = new Set();
        for (const spec of historySpecs) {
            if (!spec || !spec.id) continue;
            desiredIds.add(spec.id);
            const existing = SelectionFilter._historyContextActions.get(spec.id) || { id: spec.id };
            existing.label = spec.label ?? existing.label ?? '';
            existing.title = spec.title ?? existing.title ?? existing.label ?? '';
            existing.onClick = spec.onClick ?? existing.onClick ?? null;
            existing.shouldShow = typeof spec.shouldShow === 'function' ? spec.shouldShow : null;
            if (!existing.btn) {
                existing.btn = SelectionFilter._createSelectionActionButton(existing);
            }
            if (!existing.btn) continue;
            try {
                existing.btn.textContent = String(existing.label ?? '');
                existing.btn.title = String(existing.title ?? existing.label ?? '');
                existing.btn.__sabOnClick = existing.onClick;
                const isIcon = String(existing.label || '').length <= 2;
                existing.btn.classList.toggle('sab-icon', isIcon);
            } catch { }
            let show = !hideAll;
            if (show && typeof existing.shouldShow === 'function') {
                try { show = !!existing.shouldShow(selection, viewer); } catch { show = false; }
            } else if (!existing.shouldShow) {
                show = show && selection.length > 0;
            }
            if (show) contextButtons.push(existing.btn);
            SelectionFilter._historyContextActions.set(spec.id, existing);
        }

        for (const [id, entry] of SelectionFilter._historyContextActions.entries()) {
            if (desiredIds.has(id)) continue;
            try { entry.btn?.remove?.(); } catch { }
            SelectionFilter._historyContextActions.delete(id);
        }

        try { bar.textContent = ''; } catch { }
        for (const btn of utilityButtons) {
            try { bar.appendChild(btn); } catch { }
        }
        if (utilityButtons.length && contextButtons.length) {
            const sep = SelectionFilter._ensureSelectionActionSeparator();
            if (sep) {
                try { bar.appendChild(sep); } catch { }
            }
        }
        for (const btn of contextButtons) {
            try { bar.appendChild(btn); } catch { }
        }
        try { bar.style.display = (utilityButtons.length + contextButtons.length) > 0 ? 'flex' : 'none'; } catch { }
    }

    static _getHistoryContextActionSpecs(selection, viewer) {
        const out = [];
        const items = Array.isArray(selection) ? selection : [];
        const safeId = (prefix, key) => {
            const raw = String(key || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
            return `${prefix}-${raw || 'item'}`;
        };
        const addSpec = (spec) => {
            if (spec && spec.id) out.push(spec);
        };

        const pmimode = viewer?._pmiMode || null;
        const pmiActive = !!pmimode;
        if (!pmiActive) {
            const featureRegistry = viewer?.partHistory?.featureRegistry || null;
            const features = Array.isArray(featureRegistry?.features) ? featureRegistry.features : [];
            for (const FeatureClass of features) {
                if (!FeatureClass) continue;
                let result = null;
                try { result = FeatureClass.showContexButton?.(items); } catch { result = null; }
                if (!result) continue;
                if (result && typeof result === 'object' && result.show === false) continue;
                const label = (result && typeof result === 'object' && result.label) || FeatureClass.longName || FeatureClass.shortName || FeatureClass.name || 'Feature';
                const typeKey = FeatureClass.shortName || FeatureClass.type || FeatureClass.name || label;
                const params = SelectionFilter._extractContextParams(result);
                addSpec({
                    id: safeId('ctx-feature', typeKey),
                    label,
                    title: `Create ${label}`,
                    onClick: () => SelectionFilter._createFeatureFromContext(viewer, typeKey, params),
                });
            }

            const constraintRegistry = viewer?.partHistory?.assemblyConstraintRegistry || null;
            const constraintClasses = typeof constraintRegistry?.listAvailable === 'function'
                ? constraintRegistry.listAvailable()
                : (typeof constraintRegistry?.list === 'function' ? constraintRegistry.list() : []);
            if (Array.isArray(constraintClasses)) {
                for (const ConstraintClass of constraintClasses) {
                    if (!ConstraintClass) continue;
                    let result = null;
                    try { result = ConstraintClass.showContexButton?.(items); } catch { result = null; }
                    if (!result) continue;
                    if (result && typeof result === 'object' && result.show === false) continue;
                    const label = (result && typeof result === 'object' && result.label) || ConstraintClass.longName || ConstraintClass.shortName || ConstraintClass.name || 'Constraint';
                    const typeKey = ConstraintClass.constraintType || ConstraintClass.shortName || ConstraintClass.name || label;
                    const params = SelectionFilter._extractContextParams(result);
                    addSpec({
                        id: safeId('ctx-constraint', typeKey),
                        label,
                        title: `Create ${label}`,
                        onClick: () => SelectionFilter._createConstraintFromContext(viewer, typeKey, params),
                    });
                }
            }
        }

        const annotationRegistry = viewer?.annotationRegistry || null;
        if (pmimode && annotationRegistry && typeof annotationRegistry.list === 'function') {
            const annClasses = annotationRegistry.list();
            for (const AnnClass of annClasses) {
                if (!AnnClass) continue;
                let result = null;
                try { result = AnnClass.showContexButton?.(items); } catch { result = null; }
                if (!result) continue;
                if (result && typeof result === 'object' && result.show === false) continue;
                const label = (result && typeof result === 'object' && result.label) || AnnClass.longName || AnnClass.shortName || AnnClass.name || 'Annotation';
                const typeKey = AnnClass.type || AnnClass.entityType || AnnClass.shortName || AnnClass.name || label;
                const params = SelectionFilter._extractContextParams(result);
                addSpec({
                    id: safeId('ctx-annotation', typeKey),
                    label,
                    title: `Create ${label}`,
                    onClick: () => SelectionFilter._createAnnotationFromContext(viewer, typeKey, params),
                });
            }
        }

        return out;
    }

    static async _createFeatureFromContext(viewer, typeKey, params = null) {
        if (!viewer || !typeKey) return;
        SelectionFilter.setContextBarSuppressed('context-create', true);
        setTimeout(() => SelectionFilter.setContextBarSuppressed('context-create', false), 0);
        let entry = null;
        if (viewer.historyWidget && typeof viewer.historyWidget._handleAddEntry === 'function') {
            try { entry = await viewer.historyWidget._handleAddEntry(typeKey); } catch { }
        } else {
            try { entry = await viewer.partHistory?.newFeature?.(typeKey); } catch { }
        }
        if (entry && params && typeof params === 'object') {
            SelectionFilter._applyContextParamsToEntry(viewer, entry, params);
        }
        return entry;
    }

    static _createConstraintFromContext(viewer, typeKey, params = null) {
        if (!viewer || !typeKey) return;
        SelectionFilter.setContextBarSuppressed('context-create', true);
        setTimeout(() => SelectionFilter.setContextBarSuppressed('context-create', false), 0);
        try { viewer.partHistory?.assemblyConstraintHistory?.addConstraint?.(typeKey, params || null); } catch { }
    }

    static _createAnnotationFromContext(viewer, typeKey, params = null) {
        if (!viewer || !typeKey) return;
        SelectionFilter.setContextBarSuppressed('context-create', true);
        setTimeout(() => SelectionFilter.setContextBarSuppressed('context-create', false), 0);
        try { viewer._pmiMode?._annotationHistory?.createAnnotation?.(typeKey, params || null); } catch { }
    }

    static _extractContextParams(result) {
        if (!result || result === true) return null;
        if (typeof result !== 'object') return null;
        if (result.params && typeof result.params === 'object') return result.params;
        if (result.field) {
            return { [result.field]: result.value };
        }
        return null;
    }

    static _applyContextParamsToEntry(viewer, entry, params = {}) {
        if (!entry || !params || typeof params !== 'object') return;
        try {
            for (const [key, value] of Object.entries(params)) {
                entry.inputParams = entry.inputParams || {};
                entry.inputParams[key] = value;
            }
        } catch { }
        const historyWidget = viewer?.historyWidget || null;
        if (!historyWidget || typeof historyWidget._handleSchemaChange !== 'function') return;
        try {
            const id = entry?.inputParams?.id ?? entry?.id ?? null;
            const entryId = String(id ?? '');
            historyWidget._handleSchemaChange(entryId, entry, { key: '__context', value: params });
            const refresh = () => {
                try {
                    const form = historyWidget.getFormForEntry?.(entryId);
                    if (form && typeof form.refreshFromParams === 'function') {
                        form.refreshFromParams();
                        return true;
                    }
                } catch { }
                return false;
            };
            if (!refresh()) {
                setTimeout(() => { try { refresh(); } catch { } }, 0);
            }
        } catch { }
    }

    static setContextBarSuppressed(key, active) {
        if (!key) return;
        const reasons = SelectionFilter._contextSuppressReasons || new Set();
        SelectionFilter._contextSuppressReasons = reasons;
        const had = reasons.has(key);
        if (active) {
            reasons.add(key);
        } else {
            reasons.delete(key);
        }
        if (had !== reasons.has(key)) {
            SelectionFilter._syncSelectionActions();
        }
    }

    static _ensureSelectionActionSeparator() {
        if (SelectionFilter._selectionActionSeparator && SelectionFilter._selectionActionSeparator.isConnected) {
            return SelectionFilter._selectionActionSeparator;
        }
        if (typeof document === 'undefined') return null;
        const el = document.createElement('div');
        el.className = 'selection-action-sep';
        SelectionFilter._selectionActionSeparator = el;
        return el;
    }

    static _ensureSelectionActionBar(viewer) {
        if (SelectionFilter._selectionActionBar && SelectionFilter._selectionActionBar.isConnected) {
            return SelectionFilter._selectionActionBar;
        }
        if (typeof document === 'undefined') return null;
        const host = viewer?.container || document.body || null;
        if (!host) return null;
        try {
            if (!document.getElementById('selection-action-bar-styles')) {
                const style = document.createElement('style');
                style.id = 'selection-action-bar-styles';
                style.textContent = `
                  .selection-action-bar {
                    position: absolute;
                    top: 100px;
                    right: 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    align-items: stretch;
                    background: rgba(20,24,30,.85);
                    border: 1px solid #262b36;
                    border-radius: 8px;
                    padding: 6px;
                    color: #ddd;
                    min-width: 40px;
                    max-width: 150px;
                    z-index: 12;
                    user-select: none;
                  }
                  .selection-action-bar .sab-btn {
                    background: transparent;
                    border-radius: 6px;
                    padding: 4px 8px;
                    width: 100%;
                    min-height: 34px;
                    box-sizing: border-box;
                    color: #ddd;
                    border: 1px solid #364053;
                    cursor: pointer;
                  }
                  .selection-action-bar .sab-btn:hover { filter: brightness(1.08); }
                  .selection-action-bar .sab-btn:active { filter: brightness(1.15); }
                  .selection-action-bar .sab-btn.sab-icon {
                    font-size: 16px;
                    min-width: 36px;
                  }
                  .selection-action-bar .selection-action-sep {
                    height: 1px;
                    width: 100%;
                    background: #2c3443;
                    opacity: 0.9;
                    margin: 4px 0;
                  }
                `;
                document.head.appendChild(style);
            }
        } catch { }
        const bar = document.createElement('div');
        bar.className = 'selection-action-bar';
        host.appendChild(bar);
        SelectionFilter._selectionActionBar = bar;
        return bar;
    }

    static _getSelectionFilterTypeList() {
        if (!SelectionFilter._selectionFilterTypes) {
            SelectionFilter._selectionFilterTypes = SelectionFilter.TYPES.filter((t) => t !== SelectionFilter.ALL);
        }
        return SelectionFilter._selectionFilterTypes;
    }

    static _getSelectionFilterLabel(type) {
        const labels = {
            SOLID: 'Solid',
            COMPONENT: 'Component',
            FACE: 'Face',
            PLANE: 'Plane',
            SKETCH: 'Sketch',
            EDGE: 'Edge',
            LOOP: 'Loop',
            VERTEX: 'Vertex',
        };
        return labels[type] || type;
    }

    static _summarizeSelectionFilter(types) {
        const list = Array.isArray(types) ? types : [];
        const allTypes = SelectionFilter._getSelectionFilterTypeList();
        if (list.length === 0) return 'None';
        if (list.length === allTypes.length) return 'All';
        return list.map((t) => SelectionFilter._getSelectionFilterLabel(t)).join(', ');
    }

    static _getAllowedTypeList() {
        const allTypes = SelectionFilter._getSelectionFilterTypeList();
        if (SelectionFilter.allowedSelectionTypes === SelectionFilter.ALL) return allTypes.slice();
        const allowed = new Set(Array.from(SelectionFilter.allowedSelectionTypes || []));
        return allTypes.filter((t) => allowed.has(t));
    }

    static _updateSelectionFilterIndicator() {
        const wrap = SelectionFilter._selectionFilterIndicator;
        if (!wrap) return;
        const toggle = SelectionFilter._selectionFilterIndicatorToggle;
        const types = SelectionFilter._getAllowedTypeList();
        if (SelectionFilter._selectionFilterCheckboxes && SelectionFilter._selectionFilterCheckboxes.size) {
            const set = new Set(types);
            for (const [type, cb] of SelectionFilter._selectionFilterCheckboxes.entries()) {
                if (cb) cb.checked = set.has(type);
            }
        }
        if (toggle) {
            toggle.textContent = `Selection filter: ${SelectionFilter._summarizeSelectionFilter(types)}`;
        }
        SelectionFilter._updateSelectableTintButton();
    }

    static _getSelectableTintTargets() {
        const allowed = SelectionFilter.allowedSelectionTypes;
        const allowAll = allowed === SelectionFilter.ALL;
        const allowFace = allowAll || (allowed && typeof allowed.has === 'function' && allowed.has(SelectionFilter.FACE));
        const allowEdge = allowAll || (allowed && typeof allowed.has === 'function' && allowed.has(SelectionFilter.EDGE));
        return { allowFace, allowEdge };
    }

    static _updateSelectableTintButton() {
        const btn = SelectionFilter._selectionFilterTintBtn;
        if (!btn) return;
        const state = SelectionFilter._selectableTintState;
        const active = !!state?.active;
        const { allowFace, allowEdge } = SelectionFilter._getSelectableTintTargets();
        const hasTargets = allowFace || allowEdge;
        const colors = Array.isArray(state?.colors) && state.colors.length ? state.colors : ['#60a5fa'];
        const nextColor = colors[(state?.colorIndex ?? 0) % colors.length] || '#60a5fa';
        const displayColor = active ? (state?.activeColor || nextColor) : nextColor;
        btn.classList.toggle('is-active', active);
        btn.style.setProperty('--sfi-tint', displayColor);
        btn.textContent = active ? 'Reset selectable tint' : 'Tint selectable';
        btn.disabled = !active && !hasTargets;
        btn.title = active
            ? 'Restore original face/edge colors'
            : (hasTargets ? 'Tint selectable faces and edges' : 'Enable Face or Edge selection to tint');
    }

    static _applySelectableTint(scene, { allowFace, allowEdge, faceColor, edgeColor }) {
        if (!scene || (!allowFace && !allowEdge)) return;
        const state = SelectionFilter._selectableTintState;
        const storeColor = (mat) => {
            if (!mat || !mat.color || typeof mat.color.getHexString !== 'function') return;
            if (state.materials.has(mat)) return;
            try { state.materials.set(mat, `#${mat.color.getHexString()}`); } catch { }
        };
        const tintMaterial = (mat, color) => {
            if (!mat || !mat.color || typeof mat.color.set !== 'function') return;
            storeColor(mat);
            try { mat.color.set(color); } catch { }
            try { mat.needsUpdate = true; } catch { }
        };
        const tintObject = (obj, color) => {
            if (!obj || obj.visible === false) return;
            if (obj.selected === true) return;
            const mat = obj.material;
            if (Array.isArray(mat)) {
                for (const m of mat) tintMaterial(m, color);
            } else {
                tintMaterial(mat, color);
            }
        };
        const isPreview = (obj) => {
            if (!obj) return true;
            if (obj.userData?.refPreview) return true;
            const name = typeof obj.name === 'string' ? obj.name : '';
            const type = typeof obj.type === 'string' ? obj.type : '';
            if (name.startsWith('__refPreview__')) return true;
            if (type.startsWith('REF_PREVIEW')) return true;
            return false;
        };
        scene.traverse((obj) => {
            if (!obj || isPreview(obj)) return;
            if (allowFace && obj.type === SelectionFilter.FACE) {
                tintObject(obj, faceColor);
            } else if (allowEdge && obj.type === SelectionFilter.EDGE) {
                tintObject(obj, edgeColor);
            }
        });
    }

    static _restoreSelectableTint() {
        const state = SelectionFilter._selectableTintState;
        if (!state || !state.materials) return;
        for (const [mat, color] of state.materials.entries()) {
            if (!mat || !mat.color || typeof mat.color.set !== 'function') continue;
            if (!color) continue;
            try { mat.color.set(color); } catch { }
            try { mat.needsUpdate = true; } catch { }
        }
        state.materials.clear();
        state.active = false;
        state.activeColor = null;
        SelectionFilter._updateSelectableTintButton();
        try { SelectionFilter.viewer?.render?.(); } catch { }
    }

    static _toggleSelectableTint(viewer) {
        const state = SelectionFilter._selectableTintState;
        if (!state) return;
        if (state.active) {
            SelectionFilter._restoreSelectableTint();
            return;
        }
        const { allowFace, allowEdge } = SelectionFilter._getSelectableTintTargets();
        if (!allowFace && !allowEdge) return;
        const scene = viewer?.partHistory?.scene || viewer?.scene || SelectionFilter.viewer?.partHistory?.scene || SelectionFilter.viewer?.scene || null;
        if (!scene) return;
        const colors = Array.isArray(state.colors) && state.colors.length ? state.colors : ['#60a5fa'];
        const color = colors[state.colorIndex % colors.length] || '#60a5fa';
        state.colorIndex = (state.colorIndex + 1) % colors.length;
        SelectionFilter._applySelectableTint(scene, {
            allowFace,
            allowEdge,
            faceColor: color,
            edgeColor: color,
        });
        state.active = true;
        state.activeColor = color;
        SelectionFilter._updateSelectableTintButton();
        try { (viewer || SelectionFilter.viewer)?.render?.(); } catch { }
    }

    static _ensureSelectionFilterIndicator(viewer) {
        if (SelectionFilter._selectionFilterIndicator && SelectionFilter._selectionFilterIndicator.isConnected) {
            SelectionFilter._updateSelectionFilterIndicator();
            return SelectionFilter._selectionFilterIndicator;
        }
        if (typeof document === 'undefined') return null;
        const host = viewer?.container || document.body || null;
        if (!host) return null;
        try {
            if (!document.getElementById('selection-filter-indicator-styles')) {
                const style = document.createElement('style');
                style.id = 'selection-filter-indicator-styles';
                style.textContent = `
                  .selection-filter-indicator {
                    position: fixed;
                    bottom: 8px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    background: rgba(20,24,30,.85);
                    border: 1px solid #262b36;
                    border-radius: 10px;
                    padding: 6px;
                    color: #ddd;
                    z-index: 12;
                    user-select: none;
                    min-width: 220px;
                    max-width: min(440px, calc(100vw - 16px));
                    box-shadow: 0 6px 18px rgba(0,0,0,.35);
                  }
                  .selection-filter-indicator .sfi-toggle {
                    background: transparent;
                    border-radius: 8px;
                    padding: 6px 10px;
                    width: 100%;
                    min-height: 32px;
                    box-sizing: border-box;
                    color: #ddd;
                    border: 1px solid #364053;
                    cursor: pointer;
                    text-align: left;
                  }
                  .selection-filter-indicator .sfi-toggle:hover { filter: brightness(1.08); }
                  .selection-filter-indicator .sfi-toggle:active { filter: brightness(1.15); }
                  .selection-filter-indicator .sfi-panel {
                    border: 1px solid #2b3240;
                    border-radius: 8px;
                    padding: 8px 10px;
                    background: rgba(17,22,31,.95);
                  }
                  .selection-filter-indicator .sfi-panel[hidden] { display: none; }
                  .selection-filter-indicator .sfi-list {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 6px 10px;
                  }
                  .selection-filter-indicator .sfi-option {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    color: #cbd5e1;
                  }
                  .selection-filter-indicator input[type="checkbox"] {
                    width: 16px;
                    height: 16px;
                    accent-color: #60a5fa;
                  }
                  .selection-filter-indicator .sfi-actions {
                    display: flex;
                    gap: 6px;
                    margin-top: 8px;
                  }
                  .selection-filter-indicator .sfi-btn {
                    flex: 1;
                    background: rgba(255,255,255,.04);
                    border: 1px solid #364053;
                    border-radius: 8px;
                    color: #e2e8f0;
                    padding: 6px 10px;
                    font-size: 12px;
                    cursor: pointer;
                    text-align: center;
                    min-height: 28px;
                  }
                  .selection-filter-indicator .sfi-btn:hover { filter: brightness(1.08); }
                  .selection-filter-indicator .sfi-btn:active { filter: brightness(1.15); }
                  .selection-filter-indicator .sfi-btn.is-active {
                    border-color: var(--sfi-tint, #60a5fa);
                    color: var(--sfi-tint, #60a5fa);
                  }
                `;
                document.head.appendChild(style);
            }
        } catch { }

        const wrap = document.createElement('div');
        wrap.className = 'selection-filter-indicator';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sfi-toggle';
        const panelId = `selection-filter-panel-${Math.random().toString(36).slice(2, 8)}`;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', panelId);
        wrap.appendChild(toggle);

        const panel = document.createElement('div');
        panel.className = 'sfi-panel';
        panel.id = panelId;
        panel.hidden = true;

        const list = document.createElement('div');
        list.className = 'sfi-list';
        panel.appendChild(list);

        const checkboxByType = new Map();
        const types = SelectionFilter._getSelectionFilterTypeList();
        for (const type of types) {
            const option = document.createElement('label');
            option.className = 'sfi-option';

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.dataset.type = type;
            box.addEventListener('click', (ev) => ev.stopPropagation());
            box.addEventListener('change', (ev) => {
                ev.stopPropagation();
                const next = [];
                for (const t of types) {
                    const cb = checkboxByType.get(t);
                    if (cb && cb.checked) next.push(t);
                }
                const nextValue = next.length === types.length ? SelectionFilter.ALL : next;
                try { SelectionFilter.SetSelectionTypes(nextValue); } catch { }
                if (SelectionFilter.previouseAllowedSelectionTypes !== null) {
                    SelectionFilter.previouseAllowedSelectionTypes = SelectionFilter.allowedSelectionTypes;
                }
                SelectionFilter._updateSelectionFilterIndicator();
            });

            const label = document.createElement('span');
            label.textContent = SelectionFilter._getSelectionFilterLabel(type);

            option.appendChild(box);
            option.appendChild(label);
            list.appendChild(option);
            checkboxByType.set(type, box);
        }

        const actions = document.createElement('div');
        actions.className = 'sfi-actions';
        const tintBtn = document.createElement('button');
        tintBtn.type = 'button';
        tintBtn.className = 'sfi-btn';
        tintBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            SelectionFilter._toggleSelectableTint(viewer);
        });
        actions.appendChild(tintBtn);
        panel.appendChild(actions);

        toggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const nextOpen = panel.hidden;
            panel.hidden = !nextOpen;
            toggle.setAttribute('aria-expanded', String(nextOpen));
            if (nextOpen) SelectionFilter._updateSelectionFilterIndicator();
        });
        panel.addEventListener('click', (ev) => ev.stopPropagation());

        if (!SelectionFilter._selectionFilterOutsideBound) {
            SelectionFilter._selectionFilterOutsideBound = true;
            document.addEventListener('mousedown', (ev) => {
                const panelEl = SelectionFilter._selectionFilterIndicatorPanel;
                const toggleEl = SelectionFilter._selectionFilterIndicatorToggle;
                const wrapEl = SelectionFilter._selectionFilterIndicator;
                if (wrapEl && ev && wrapEl.contains(ev.target)) return;
                if (!panelEl || panelEl.hidden) return;
                panelEl.hidden = true;
                if (toggleEl) toggleEl.setAttribute('aria-expanded', 'false');
            });
        }

        wrap.appendChild(panel);
        host.appendChild(wrap);

        SelectionFilter._selectionFilterIndicator = wrap;
        SelectionFilter._selectionFilterIndicatorToggle = toggle;
        SelectionFilter._selectionFilterIndicatorPanel = panel;
        SelectionFilter._selectionFilterCheckboxes = checkboxByType;
        SelectionFilter._selectionFilterTintBtn = tintBtn;
        SelectionFilter._updateSelectionFilterIndicator();
        return wrap;
    }

    static _createSelectionActionButton(entry) {
        try {
            const btn = document.createElement('button');
            btn.className = 'sab-btn';
            btn.textContent = String(entry?.label ?? '');
            btn.title = String(entry?.title ?? entry?.label ?? '');
            btn.__sabOnClick = entry?.onClick ?? null;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                try { btn.__sabOnClick && btn.__sabOnClick(); } catch { }
            });
            const isIcon = String(entry?.label || '').length <= 2;
            if (isIcon) btn.classList.add('sab-icon');
            return btn;
        } catch { return null; }
    }

    static #logAllowedTypesChange(next, reason = '') {
        try {
            const desc = next === SelectionFilter.ALL
                ? 'ALL'
                : JSON.stringify(Array.from(next || []));
            const prefix = reason ? `[SelectionFilter:${reason}]` : '[SelectionFilter]';
            console.log(`${prefix} Allowed types -> ${desc}`);
        } catch { /* ignore logging errors */ }
    }
}
