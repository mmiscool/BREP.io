import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BREP } from '../../BREP/BREP.js';

const IMPORT3D_CACHE_VERSION = 1;

function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null) return !!fallback;
    return !!value;
}

function normalizeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function normalizeRepairLevel(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'BASIC' || raw === 'AGGRESSIVE') return raw;
    return 'NONE';
}

function cleanString(value, fallback = '') {
    const out = String(value || '').trim();
    return out || String(fallback || '');
}

function toArrayBuffer(input) {
    if (input instanceof ArrayBuffer) return input;
    if (ArrayBuffer.isView(input)) {
        const view = input;
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    return null;
}

function cloneJsonSafe(value, fallback = null) {
    if (value === undefined) return fallback;
    if (value === null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

function fnv1aBytes(bytes) {
    let hash = 0x811c9dc5 >>> 0;
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
    for (let i = 0; i < source.length; i += 1) {
        hash ^= source[i];
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function fnv1aString(text) {
    let hash = 0x811c9dc5 >>> 0;
    const source = String(text || '');
    for (let i = 0; i < source.length; i += 1) {
        const code = source.charCodeAt(i);
        hash ^= code & 0xff;
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= (code >>> 8) & 0xff;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function hex32(value) {
    return (value >>> 0).toString(16).padStart(8, '0');
}

function sanitizeAuxEdges(auxEdges) {
    const source = Array.isArray(auxEdges) ? auxEdges : [];
    const out = [];
    for (const aux of source) {
        const points = Array.isArray(aux?.points)
            ? aux.points
                .map((point) => {
                    if (!Array.isArray(point) || point.length < 3) return null;
                    const x = Number(point[0]);
                    const y = Number(point[1]);
                    const z = Number(point[2]);
                    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
                    return [x, y, z];
                })
                .filter(Boolean)
            : [];
        if (points.length < 2) continue;
        const entry = {
            name: cleanString(aux?.name || 'EDGE', 'EDGE'),
            points,
            closedLoop: !!aux?.closedLoop,
            polylineWorld: !!aux?.polylineWorld,
            centerline: !!aux?.centerline,
        };
        const materialKey = cleanString(aux?.materialKey || '', '');
        if (materialKey) entry.materialKey = materialKey;
        const faceA = cleanString(aux?.faceA || '', '');
        const faceB = cleanString(aux?.faceB || '', '');
        if (faceA) entry.faceA = faceA;
        if (faceB) entry.faceB = faceB;
        out.push(entry);
    }
    return out;
}

function serializeSolidSnapshot(solid) {
    if (!solid || typeof solid !== 'object') return null;
    const vertProperties = Array.isArray(solid._vertProperties) ? solid._vertProperties.slice() : [];
    const triVerts = Array.isArray(solid._triVerts) ? solid._triVerts.slice() : [];
    const triIDs = Array.isArray(solid._triIDs) ? solid._triIDs.slice() : [];
    const triCount = (triVerts.length / 3) | 0;
    if (!vertProperties.length || triCount <= 0 || triIDs.length !== triCount) return null;

    const idToFaceNameEntries = (solid._idToFaceName instanceof Map)
        ? Array.from(solid._idToFaceName.entries()).map(([id, name]) => [
            Number(id) | 0,
            cleanString(name || '', ''),
        ])
        : [];
    const faceMetadataEntries = (solid._faceMetadata instanceof Map)
        ? Array.from(solid._faceMetadata.entries())
            .map(([name, metadata]) => [
                cleanString(name || '', ''),
                cloneJsonSafe(metadata, {}),
            ])
            .filter(([name, metadata]) => !!name && metadata && typeof metadata === 'object')
        : [];
    const edgeMetadataEntries = (solid._edgeMetadata instanceof Map)
        ? Array.from(solid._edgeMetadata.entries())
            .map(([name, metadata]) => [
                cleanString(name || '', ''),
                cloneJsonSafe(metadata, {}),
            ])
            .filter(([name, metadata]) => !!name && metadata && typeof metadata === 'object')
        : [];

    return {
        version: IMPORT3D_CACHE_VERSION,
        numProp: Number(solid._numProp) || 3,
        name: cleanString(solid?.name || 'Imported3D', 'Imported3D'),
        vertProperties: vertProperties.map((value) => Number(value) || 0),
        triVerts: triVerts.map((value) => Number(value) | 0),
        triIDs: triIDs.map((value) => Number(value) | 0),
        idToFaceName: idToFaceNameEntries,
        faceMetadata: faceMetadataEntries,
        edgeMetadata: edgeMetadataEntries,
        auxEdges: sanitizeAuxEdges(solid._auxEdges),
        userData: cloneJsonSafe(solid.userData || {}, {}),
        epsilon: Number.isFinite(solid._epsilon) ? Number(solid._epsilon) : 0,
    };
}

function restoreSolidFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const vertProperties = Array.isArray(snapshot.vertProperties) ? snapshot.vertProperties : [];
    const triVerts = Array.isArray(snapshot.triVerts) ? snapshot.triVerts : [];
    const triIDs = Array.isArray(snapshot.triIDs) ? snapshot.triIDs : [];
    const triCount = (triVerts.length / 3) | 0;
    if (!vertProperties.length || triCount <= 0) return null;

    const solid = new BREP.Solid();
    solid.name = cleanString(snapshot.name || 'Imported3D', 'Imported3D');
    solid._numProp = Number(snapshot.numProp) || 3;
    solid._vertProperties = vertProperties.map((value) => Number(value) || 0);
    solid._triVerts = triVerts.map((value) => Math.max(0, Number(value) | 0));
    solid._triIDs = (triIDs.length === triCount)
        ? triIDs.map((value) => Math.max(0, Number(value) | 0))
        : new Array(triCount).fill(0);

    solid._vertKeyToIndex = new Map();
    for (let i = 0; i < solid._vertProperties.length; i += 3) {
        const x = solid._vertProperties[i + 0];
        const y = solid._vertProperties[i + 1];
        const z = solid._vertProperties[i + 2];
        solid._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
    }

    const idToFaceName = new Map();
    const entries = Array.isArray(snapshot.idToFaceName) ? snapshot.idToFaceName : [];
    for (const pair of entries) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const id = Math.max(0, Number(pair[0]) | 0);
        const name = cleanString(pair[1] || `STL_FACE_${id}`, `STL_FACE_${id}`);
        idToFaceName.set(id, name);
    }
    for (const id of solid._triIDs) {
        if (!idToFaceName.has(id)) idToFaceName.set(id, `STL_FACE_${id}`);
    }
    solid._idToFaceName = idToFaceName;
    solid._faceNameToID = new Map(Array.from(idToFaceName.entries()).map(([id, name]) => [name, id]));

    const faceMetadataMap = new Map();
    const faceEntries = Array.isArray(snapshot.faceMetadata) ? snapshot.faceMetadata : [];
    for (const pair of faceEntries) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const name = cleanString(pair[0] || '', '');
        if (!name) continue;
        const metadata = cloneJsonSafe(pair[1], {});
        if (!metadata || typeof metadata !== 'object') continue;
        faceMetadataMap.set(name, metadata);
    }
    solid._faceMetadata = faceMetadataMap;

    const edgeMetadataMap = new Map();
    const edgeEntries = Array.isArray(snapshot.edgeMetadata) ? snapshot.edgeMetadata : [];
    for (const pair of edgeEntries) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const name = cleanString(pair[0] || '', '');
        if (!name) continue;
        const metadata = cloneJsonSafe(pair[1], {});
        if (!metadata || typeof metadata !== 'object') continue;
        edgeMetadataMap.set(name, metadata);
    }
    solid._edgeMetadata = edgeMetadataMap;

    solid._auxEdges = sanitizeAuxEdges(snapshot.auxEdges);
    solid.userData = cloneJsonSafe(snapshot.userData, {}) || {};
    solid._epsilon = Number.isFinite(snapshot.epsilon) ? Number(snapshot.epsilon) : 0;
    solid._dirty = true;
    solid._manifold = null;
    solid._faceIndex = null;
    solid.type = 'SOLID';
    solid.renderOrder = 1;
    return solid;
}

function parseDataUrlBase64(input) {
    const raw = String(input || '');
    if (!raw.startsWith('data:') || !raw.includes(';base64,')) return null;
    const b64 = raw.split(',')[1] || '';
    try {
        const binary = (typeof atob === 'function')
            ? atob(b64)
            : (typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('binary') : '');
        const len = binary.length | 0;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
        return bytes.buffer;
    } catch (error) {
        console.warn('[Import3D] Failed to decode base64 data URL:', error);
        return null;
    }
}

function normalizeImportSource(raw) {
    if (typeof raw === 'string') {
        if (raw.startsWith('data:') && raw.includes(';base64,')) {
            const decoded = parseDataUrlBase64(raw);
            if (decoded) return decoded;
        }
        return raw;
    }
    return toArrayBuffer(raw);
}

function buildSourceSignature(raw) {
    if (typeof raw === 'string') return `string:${raw.length}:${hex32(fnv1aString(raw))}`;
    const buffer = toArrayBuffer(raw);
    if (buffer) {
        const bytes = new Uint8Array(buffer);
        return `bytes:${bytes.byteLength}:${hex32(fnv1aBytes(bytes))}`;
    }
    return 'invalid';
}

function buildParameterSignature(params = {}) {
    const deflection = normalizeNumber(params.deflectionAngle, 15);
    const repair = normalizeRepairLevel(params.meshRepairLevel);
    const center = normalizeBoolean(params.centerMesh, true) ? 1 : 0;
    return `v${IMPORT3D_CACHE_VERSION}|deflection=${deflection}|repair=${repair}|center=${center}`;
}

function buildInputSignature(raw, params = {}) {
    const paramSig = buildParameterSignature(params);
    const sourceSig = buildSourceSignature(raw);
    return `${paramSig}|src=${sourceSig}`;
}

const inputParamsSchema = {
    id: {
        type: 'string',
        default_value: null,
        hint: 'unique identifier for the import feature',
    },
    fileToImport: {
        type: 'file',
        default_value: '',
        accept: '.stl,.STL,.3mf,.3MF,model/stl,model/3mf,application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
        hint: 'Contents of an STL or 3MF file (click to choose a file)',
    },
    deflectionAngle: {
        type: 'number',
        default_value: 15,
        hint: 'The angle (in degrees) between face normals at which to split faces when constructing the BREP solid',
    },
    meshRepairLevel: {
        type: 'options',
        options: ['NONE', 'BASIC', 'AGGRESSIVE'],
        default_value: 'NONE',
        hint: 'Mesh repair level to apply before BREP conversion',
    },
    centerMesh: {
        type: 'boolean',
        default_value: true,
        hint: 'Center the mesh by its bounding box',
    },
};

export class Import3dModelFeature {
    static shortName = 'IMPORT3D';
    static longName = 'Import 3D Model';
    static inputParamsSchema = inputParamsSchema;

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    async run(partHistory) {
        void partHistory;
        this.persistentData = (this.persistentData && typeof this.persistentData === 'object')
            ? this.persistentData
            : {};

        const featureName = cleanString(
            this.inputParams.featureID || this.inputParams.id || Import3dModelFeature.shortName,
            Import3dModelFeature.shortName,
        );

        // Import STL or 3MF data (ASCII string, base64 data URL, or ArrayBuffer) and create a THREE.BufferGeometry
        const raw = this.inputParams.fileToImport;
        const hasRaw = !!raw;
        const supportedRaw = (typeof raw === 'string') || !!toArrayBuffer(raw);
        const paramSignature = buildParameterSignature(this.inputParams);
        const cache = (this.persistentData.importCache && typeof this.persistentData.importCache === 'object')
            ? this.persistentData.importCache
            : null;

        if (!hasRaw || !supportedRaw) {
            if (cache && cache.snapshot) {
                const cachedSolid = restoreSolidFromSnapshot(cache.snapshot);
                if (cachedSolid) {
                    if (cache.paramSignature && cache.paramSignature !== paramSignature) {
                        console.warn('[Import3D] Parameters changed but source file is unavailable; reusing cached geometry');
                    }
                    cachedSolid.name = featureName;
                    cachedSolid.visualize();
                    return { added: [cachedSolid], removed: [] };
                }
            }

            if (!hasRaw) console.warn('[Import3D] No model data provided');
            else console.warn('[Import3D] Unsupported input type for fileToImport');
            return { added: [], removed: [] };
        }

        const inputSignature = buildInputSignature(raw, this.inputParams);
        if (cache && cache.signature === inputSignature && cache.snapshot) {
            const cachedSolid = restoreSolidFromSnapshot(cache.snapshot);
            if (cachedSolid) {
                cachedSolid.name = featureName;
                cachedSolid.visualize();
                this.persistentData.consumeFileInput = true;
                return { added: [cachedSolid], removed: [] };
            }
        }

        // Accept either:
        // - ASCII STL text
        // - data URL with base64 (e.g., 'data:application/octet-stream;base64,...')
        // - ArrayBuffer (or TypedArray)
        let dataForLoader = normalizeImportSource(raw);
        if (!dataForLoader) dataForLoader = raw;

        const stlLoader = new STLLoader();
        const threeMFLoader = new ThreeMFLoader();

        // Detect type and parse accordingly
        let geometry;
        try {
            if (typeof dataForLoader === 'string') {
                // Treat plain strings as ASCII STL text
                geometry = await stlLoader.parse(dataForLoader);
            } else {
                const dataBuffer = toArrayBuffer(dataForLoader);
                if (!dataBuffer) {
                    console.warn('[Import3D] Unsupported input type for fileToImport');
                    return { added: [], removed: [] };
                }
                const u8 = new Uint8Array(dataBuffer);
                const isZip = u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b; // 'PK' -> 3MF zip
                if (isZip) {
                    // 3MF: parse into a Group, then merge meshes into a single BufferGeometry
                    const group = await threeMFLoader.parse(dataBuffer);
                    group.updateMatrixWorld(true);
                    const geometries = [];
                    group.traverse((obj) => {
                        if (obj.isMesh && obj.geometry && obj.geometry.isBufferGeometry) {
                            const g = obj.geometry.clone();
                            if (obj.matrixWorld) g.applyMatrix4(obj.matrixWorld);
                            geometries.push(g);
                        }
                    });
                    if (geometries.length === 0) {
                        console.warn('[Import3D] 3MF file contained no meshes');
                        return { added: [], removed: [] };
                    }
                    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
                    geometry = merged || geometries[0];
                } else {
                    // Assume binary STL
                    geometry = await stlLoader.parse(dataBuffer);
                }
            }
        } catch (error) {
            console.warn('[Import3D] Failed to parse input as STL/3MF:', error);
            return { added: [], removed: [] };
        }

        // Optionally center the geometry by its bounding box center
        if (normalizeBoolean(this.inputParams.centerMesh, true)) {
            geometry.computeBoundingBox();
            const bb = geometry.boundingBox;
            if (bb) {
                const cx = (bb.min.x + bb.max.x) * 0.5;
                const cy = (bb.min.y + bb.max.y) * 0.5;
                const cz = (bb.min.z + bb.max.z) * 0.5;
                geometry.translate(-cx, -cy, -cz);
            }
        }

        // Run mesh repair pipeline per selected level to produce a BufferGeometry
        const repairer = new BREP.MeshRepairer();
        let repairedGeometry = geometry;
        const meshRepairLevel = normalizeRepairLevel(this.inputParams.meshRepairLevel);
        if (meshRepairLevel === 'BASIC') {
            repairedGeometry = repairer.repairAll(repairedGeometry);
        } else if (meshRepairLevel === 'AGGRESSIVE') {
            for (let i = 0; i < 5; i += 1) {
                repairedGeometry = repairer.repairAll(repairedGeometry);
            }
        }

        // Build a BREP solid by grouping triangles into faces via deflection angle
        const solid = new BREP.MeshToBrep(
            repairedGeometry,
            normalizeNumber(this.inputParams.deflectionAngle, 15),
        );
        solid.name = featureName;
        solid.visualize();

        const snapshot = serializeSolidSnapshot(solid);
        if (snapshot) {
            this.persistentData.importCache = {
                version: IMPORT3D_CACHE_VERSION,
                signature: inputSignature,
                sourceSignature: buildSourceSignature(raw),
                paramSignature,
                snapshot,
                updatedAt: new Date().toISOString(),
            };
            this.persistentData.consumeFileInput = true;
        }

        return { added: [solid], removed: [] };
    }
}
