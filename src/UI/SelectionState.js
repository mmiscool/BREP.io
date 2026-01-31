import { CADmaterials } from "./CADmaterials.js";

const debugMode = false;

export class SelectionState {
    static hoverColor = '#fbff00';

    static attach(obj, { deep = false } = {}) {
        if (!obj || typeof obj !== 'object') return false;
        let changed = false;

        const attachOne = (target) => {
            if (!target || typeof target !== 'object') return;
            const state = SelectionState._ensureState(target);
            if (!state) return;
            const wasAttached = !!state._attached;

            const selectedDesc = Object.getOwnPropertyDescriptor(target, 'selected');
            if (!selectedDesc || !selectedDesc.get || !selectedDesc.get.__selectionState) {
                const getter = function () { return state.selected; };
                getter.__selectionState = true;
                const setter = function (v) {
                    const nv = !!v;
                    if (state.selected === nv) return;
                    if (debugMode) {
                        try {
                            console.log('[SelectionState] selected changed', {
                                name: target?.name,
                                type: target?.type,
                                prev: state.selected,
                                next: nv,
                                target,
                            });
                            console.trace('[SelectionState] selected stack');
                        } catch { }
                    }
                    state.selected = nv;
                    SelectionState.apply(target);
                };
                setter.__selectionState = true;
                Object.defineProperty(target, 'selected', {
                    get: getter,
                    set: setter,
                    configurable: true,
                    enumerable: true,
                });
                changed = true;
            }

            const hoveredDesc = Object.getOwnPropertyDescriptor(target, 'hovered');
            if (!hoveredDesc || !hoveredDesc.get || !hoveredDesc.get.__selectionState) {
                const getter = function () { return state.hovered; };
                getter.__selectionState = true;
                const setter = function (v) {
                    const nv = !!v;
                    if (state.hovered === nv) return;
                    if (debugMode) {
                        try {
                            console.log('[SelectionState] hovered changed', {
                                name: target?.name,
                                type: target?.type,
                                prev: state.hovered,
                                next: nv,
                                target,
                            });
                            console.trace('[SelectionState] hovered stack');
                        } catch { }
                    }
                    state.hovered = nv;
                    SelectionState.apply(target);
                };
                setter.__selectionState = true;
                Object.defineProperty(target, 'hovered', {
                    get: getter,
                    set: setter,
                    configurable: true,
                    enumerable: true,
                });
                changed = true;
            }

            SelectionState._seedBaseMaterials(target);
            if (!wasAttached) state._attached = true;

            if (!wasAttached && (state.selected || state.hovered)) {
                SelectionState.apply(target);
            }
        };

        if (!deep) {
            attachOne(obj);
            return changed;
        }

        const stack = [obj];
        while (stack.length) {
            const current = stack.pop();
            attachOne(current);
            const kids = Array.isArray(current?.children) ? current.children : [];
            for (const child of kids) {
                if (child) stack.push(child);
            }
        }
        return changed;
    }

    static setHoverColor(color) {
        if (!color) return;
        try { SelectionState.hoverColor = String(color); } catch { }
    }

    static apply(obj, { force = false } = {}) {
        if (!obj || typeof obj !== 'object') return;
        SelectionState.attach(obj);
        const state = SelectionState._getState(obj);
        if (!state) return;

        const type = obj.type || '';
        if (type === 'SOLID' || type === 'COMPONENT') {
            SelectionState._applyToSolid(obj, state, { force });
            return;
        }

        SelectionState._applyForObject(obj, {
            selected: state.selected,
            hovered: state.hovered,
            force,
        });
    }

    static setBaseMaterial(obj, material, { force = true } = {}) {
        if (!obj || !material) return;
        SelectionState.attach(obj);
        const targets = SelectionState._getDrawableTargets(obj);
        for (const target of targets) {
            if (!target) continue;
            target.userData = target.userData || {};
            target.userData.__baseMaterial = material;
        }
        SelectionState.apply(obj, { force: !!force });
    }

    static getBaseMaterial(obj, rootType = obj?.type) {
        if (!obj) return null;
        const ud = obj.userData || {};
        if (ud.__baseMaterial) return ud.__baseMaterial;
        if (ud.__defaultMaterial) return ud.__defaultMaterial;

        const type = rootType || obj.type || '';
        if (type === 'FACE') return CADmaterials.FACE?.BASE ?? obj.material;
        if (type === 'PLANE') return CADmaterials.PLANE?.BASE ?? CADmaterials.FACE?.BASE ?? obj.material;
        if (type === 'EDGE') return CADmaterials.EDGE?.BASE ?? obj.material;
        if (type === 'VERTEX') return CADmaterials.VERTEX?.BASE ?? obj.material;
        return obj.material ?? null;
    }

    static getHoverTargets(target) {
        if (!target) return [];
        const type = target.type || '';
        if (type === 'SOLID' || type === 'COMPONENT') {
            const out = [];
            const kids = Array.isArray(target.children) ? target.children : [];
            for (const child of kids) {
                if (!child) continue;
                if (child.type === 'SOLID' || child.type === 'COMPONENT') {
                    const nested = Array.isArray(child.children) ? child.children : [];
                    for (const nestedChild of nested) {
                        if (nestedChild && (nestedChild.type === 'FACE' || nestedChild.type === 'EDGE')) out.push(nestedChild);
                    }
                } else if (child.type === 'FACE' || child.type === 'EDGE') {
                    out.push(child);
                }
            }
            return out;
        }
        return [target];
    }

    static _ensureState(obj) {
        if (!obj || typeof obj !== 'object') return null;
        let state = obj.__selectionState;
        if (!state) {
            const existingSelected = !!obj.selected;
            const existingHovered = !!obj.hovered;
            state = { selected: existingSelected, hovered: existingHovered };
            try {
                Object.defineProperty(obj, '__selectionState', {
                    value: state,
                    writable: true,
                    configurable: true,
                    enumerable: false,
                });
            } catch {
                obj.__selectionState = state;
            }
        }
        return state;
    }

    static _getState(obj) {
        return obj?.__selectionState || null;
    }

    static _seedBaseMaterials(obj) {
        const targets = SelectionState._getDrawableTargets(obj);
        for (const target of targets) {
            if (!target) continue;
            target.userData = target.userData || {};
            if (!target.userData.__baseMaterial) {
                if (target.userData.__defaultMaterial) {
                    target.userData.__baseMaterial = target.userData.__defaultMaterial;
                } else if (target.material) {
                    target.userData.__baseMaterial = target.material;
                }
            }
        }
    }

    static _getDrawableTargets(obj) {
        if (!obj) return [];
        if (obj.type === 'VERTEX') {
            const targets = [];
            if (obj._point && obj._point.material) targets.push(obj._point);
            const kids = Array.isArray(obj.children) ? obj.children : [];
            for (const child of kids) {
                if (child && child.material && !targets.includes(child)) targets.push(child);
            }
            return targets.length ? targets : [obj];
        }
        if (obj.material) return [obj];
        return [obj];
    }

    static _applyToSolid(obj, state, { force = false } = {}) {
        const children = Array.isArray(obj.children) ? obj.children : [];
        if (state.hovered) {
            for (const child of children) {
                if (!child) continue;
                if (child.type === 'SOLID' || child.type === 'COMPONENT') {
                    const nested = Array.isArray(child.children) ? child.children : [];
                    for (const nestedChild of nested) {
                        if (nestedChild && (nestedChild.type === 'FACE' || nestedChild.type === 'EDGE')) {
                            SelectionState._applyForObject(nestedChild, { hovered: true, force });
                        }
                    }
                } else if (child.type === 'FACE' || child.type === 'EDGE') {
                    SelectionState._applyForObject(child, { hovered: true, force });
                }
            }
            return;
        }

        if (state.selected) {
            for (const child of children) {
                if (!child) continue;
                if (child.type === 'FACE' || child.type === 'EDGE' || child.type === 'PLANE') {
                    SelectionState._applyForObject(child, { selected: true, force });
                }
            }
            return;
        }

        for (const child of children) {
            if (!child) continue;
            if (child.type === 'FACE' || child.type === 'EDGE' || child.type === 'PLANE') {
                SelectionState.attach(child);
                const childState = SelectionState._getState(child);
                SelectionState._applyForObject(child, {
                    selected: !!childState?.selected,
                    hovered: !!childState?.hovered,
                    force,
                });
            }
        }
    }

    static _applyForObject(obj, { selected = false, hovered = false, force = false } = {}) {
        if (!obj) return;
        SelectionState._seedBaseMaterials(obj);
        const rootType = obj.type || '';
        const targets = SelectionState._getDrawableTargets(obj);
        for (const target of targets) {
            if (!target) continue;
            if (hovered) {
                SelectionState._applyHover(target, rootType, { force });
                continue;
            }
            SelectionState._clearHover(target);
            if (selected) {
                SelectionState._applySelected(target, rootType);
            } else {
                SelectionState._applyBase(target, rootType);
            }
        }
    }

    static _applyBase(target, rootType) {
        const base = SelectionState.getBaseMaterial(target, rootType);
        try {
            const ud = target.userData || {};
            if (ud.__selectedMat && ud.__selectedMat !== base) {
                if (Array.isArray(ud.__selectedMat)) {
                    for (const m of ud.__selectedMat) {
                        try { if (m && typeof m.dispose === 'function') m.dispose(); } catch { }
                    }
                } else if (typeof ud.__selectedMat.dispose === 'function') {
                    ud.__selectedMat.dispose();
                }
            }
            try { delete ud.__selectedMat; } catch { }
            try { delete ud.__selectedMatBase; } catch { }
            try { delete ud.__selectedColor; } catch { }
        } catch { }
        if (base) SelectionState._assignMaterial(target, base);
    }

    static _applySelected(target, rootType) {
        const base = SelectionState.getBaseMaterial(target, rootType);
        let mat = base;
        if (rootType === 'FACE') {
            mat = CADmaterials.FACE?.SELECTED ?? base;
        } else if (rootType === 'PLANE') {
            mat = CADmaterials.PLANE?.SELECTED ?? CADmaterials.FACE?.SELECTED ?? base;
        } else if (rootType === 'EDGE') {
            const selMat = CADmaterials.EDGE?.SELECTED ?? CADmaterials.EDGE?.BASE ?? base;
            const selColor = SelectionState._resolveColor(selMat?.color ?? selMat?.color?.getHexString?.());
            if (selColor && base) {
                const ud = target.userData || (target.userData = {});
                const prevMat = ud.__selectedMat;
                const sameBase = ud.__selectedMatBase === base;
                const sameColor = ud.__selectedColor === selColor;
                if (prevMat && sameBase && sameColor) {
                    mat = prevMat;
                } else {
                    if (prevMat && prevMat !== base) {
                        try {
                            if (Array.isArray(prevMat)) {
                                for (const m of prevMat) {
                                    try { if (m && typeof m.dispose === 'function') m.dispose(); } catch { }
                                }
                            } else if (typeof prevMat.dispose === 'function') {
                                prevMat.dispose();
                            }
                        } catch { }
                    }
                    mat = SelectionState._cloneMaterialWithColor(base, selColor);
                    ud.__selectedMat = mat;
                    ud.__selectedMatBase = base;
                    ud.__selectedColor = selColor;
                }
            } else {
                mat = selMat ?? base;
            }
        } else if (rootType === 'VERTEX') {
            mat = CADmaterials.VERTEX?.SELECTED ?? base;
        }
        if (mat) SelectionState._assignMaterial(target, mat);
    }

    static _applyHover(target, rootType, { force = false } = {}) {
        const ud = target.userData || (target.userData = {});
        if (ud.__hoverMatApplied) {
            if (!force) return;
            SelectionState._clearHover(target);
        }
        const base = SelectionState.getBaseMaterial(target, rootType);
        if (!base) return;
        const hoverColor = SelectionState.hoverColor;
        const hoverMat = SelectionState._cloneMaterialWithColor(base, hoverColor);
        ud.__hoverOrigMat = base;
        ud.__hoverMatApplied = true;
        ud.__hoverMat = hoverMat;
        if (hoverMat) SelectionState._assignMaterial(target, hoverMat);
    }

    static _clearHover(target) {
        const ud = target.userData || {};
        if (!ud.__hoverMatApplied) return;
        try {
            if (ud.__hoverMat && ud.__hoverMat !== ud.__hoverOrigMat) {
                if (Array.isArray(ud.__hoverMat)) {
                    for (const m of ud.__hoverMat) {
                        try { if (m && typeof m.dispose === 'function') m.dispose(); } catch { }
                    }
                } else if (typeof ud.__hoverMat.dispose === 'function') {
                    ud.__hoverMat.dispose();
                }
            }
        } catch { }
        try { delete ud.__hoverMatApplied; } catch { }
        try { delete ud.__hoverOrigMat; } catch { }
        try { delete ud.__hoverMat; } catch { }
    }

    static _assignMaterial(target, material) {
        try {
            const prev = target?.material;
            if (prev !== material && debugMode) {
                console.log('[SelectionState] material changed', {
                    name: target?.name,
                    type: target?.type,
                    prev,
                    next: material,
                    target,
                });
                console.trace('[SelectionState] material stack');
            }
        } catch { }
        try { target.material = material; } catch { }
    }

    static _cloneMaterialWithColor(material, color) {
        if (!material) return material;
        if (Array.isArray(material)) {
            return material.map((m) => SelectionState._cloneMaterialWithColor(m, color));
        }
        let clone = material;
        try {
            if (material && typeof material.clone === 'function') clone = material.clone();
        } catch {
            clone = material;
        }
        try {
            if (clone && clone.color && typeof clone.color.set === 'function' && color) {
                clone.color.set(color);
            }
        } catch { }
        try {
            if (material && clone && material.resolution && clone.resolution && typeof clone.resolution.copy === 'function') {
                clone.resolution.copy(material.resolution);
            }
        } catch { }
        try {
            if (material && clone && typeof material.dashed !== 'undefined' && typeof clone.dashed !== 'undefined') {
                clone.dashed = material.dashed;
            }
            if (material && clone && typeof material.dashSize !== 'undefined' && typeof clone.dashSize !== 'undefined') {
                clone.dashSize = material.dashSize;
            }
            if (material && clone && typeof material.gapSize !== 'undefined' && typeof clone.gapSize !== 'undefined') {
                clone.gapSize = material.gapSize;
            }
            if (material && clone && typeof material.dashScale !== 'undefined' && typeof clone.dashScale !== 'undefined') {
                clone.dashScale = material.dashScale;
            }
        } catch { }
        return clone;
    }

    static _resolveColor(value) {
        if (!value) return null;
        if (value?.isColor) return value;
        if (typeof value === 'string') {
            const v = value.trim();
            if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
            return v;
        }
        if (typeof value === 'number') return value;
        if (typeof value?.getHexString === 'function') {
            try { return `#${value.getHexString()}`; } catch { }
        }
        return null;
    }
}
