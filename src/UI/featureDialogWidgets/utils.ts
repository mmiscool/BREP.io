export function normalizeReferenceName(value) {
    if (value == null) return null;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
                const parsedName = typeof parsed.name === 'string' ? parsed.name.trim() : '';
                if (parsedName) return parsedName;
                const parsedId = typeof parsed.id === 'string' ? parsed.id.trim() : '';
                if (parsedId) return parsedId;
            }
        } catch (_) { /* not JSON */ }
        return trimmed;
    }

    if (typeof value === 'object') {
        if (typeof value.name === 'string' && value.name.trim()) return value.name.trim();
        if (typeof value.id === 'string' && value.id.trim()) return value.id.trim();
        if (Array.isArray(value.path)) {
            const joined = value.path.filter(Boolean).map(String).join(' › ');
            if (joined) return joined;
        }
        if (typeof value.faceName === 'string' && value.faceName.trim()) return value.faceName.trim();
        if (typeof value.userData?.faceName === 'string' && value.userData.faceName.trim()) return value.userData.faceName.trim();
    }

    const asString = String(value);
    return asString.trim() || null;
}

function cloneReferenceMetadata(value) {
    if (value == null || typeof value !== 'object') return null;
    if (value.isObject3D || value.geometry || value.material) return null;
    if (Array.isArray(value)) return null;
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
        const item = value[key];
        if (item == null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
            out[key] = item;
        } else if (Array.isArray(item)) {
            out[key] = item
                .filter((entry) => entry == null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')
                .map((entry) => entry);
        } else if (item && typeof item === 'object' && !item.isObject3D && !item.geometry && !item.material) {
            const nested = cloneReferenceMetadata(item);
            if (nested) out[key] = nested;
        }
    }
    return out;
}

export function normalizeReferenceSelectionValue(value) {
    const name = normalizeReferenceName(value);
    if (!name) return null;
    const meta = cloneReferenceMetadata(value);
    if (!meta) return name;
    meta.name = name;
    return meta;
}

export function referenceSelectionKey(value) {
    const name = normalizeReferenceName(value);
    if (!name) return '';
    const source = value && typeof value === 'object' ? value : {};
    const userData = source.userData && typeof source.userData === 'object' ? source.userData : {};
    const faceName = source.faceName || userData.faceName || '';
    const owner = source.solidName
        || source.solid?.name
        || source.parent?.name
        || source.targetSolid
        || source.targetSolidName
        || source.objectName
        || source.parentName
        || source.target
        || source.reference
        || userData.solidName
        || userData.solid?.name
        || userData.parent?.name
        || userData.targetSolid
        || userData.targetSolidName
        || userData.objectName
        || userData.parentName
        || userData.target
        || userData.reference
        || '';
    const faceIdentity = faceName ? `${name}::${faceName}` : name;
    return owner ? `${faceIdentity}::${owner}` : faceIdentity;
}

export function normalizeReferenceList(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const out = [];
    for (const item of values) {
        const normalized = normalizeReferenceName(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

export function normalizeReferenceSelectionList(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const out = [];
    for (const item of values) {
        const normalized = normalizeReferenceSelectionValue(item);
        const key = referenceSelectionKey(normalized);
        if (!normalized || !key || seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}
