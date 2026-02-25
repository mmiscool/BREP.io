import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BREP } from '../../BREP/BREP.js';
import { segmentMeshPrimitives } from '../../BREP/Segmentation/primitiveSegmentation.js';

const IMPORT3D_CACHE_VERSION = 2;
const DEFAULT_DEFLECTION_ANGLE = 8;
const DEFAULT_DECIMATION_LEVEL_PERCENT = 100;
const DEFAULT_EXTRACT_PLANAR_FACES = true;
const DEFAULT_PLANAR_MIN_AREA_PERCENT = 1;
const DEFAULT_EXTRACT_MULTIPLE_SOLIDS = false;
const DEFAULT_SEGMENT_ANALYTIC_PRIMITIVES = false;
const DEFAULT_PRIMITIVE_DETECT_PLANES = true;
const DEFAULT_PRIMITIVE_DETECT_CYLINDERS = true;
const DEFAULT_PRIMITIVE_DETECT_CONES = true;
const DEFAULT_PRIMITIVE_SAMPLE_MULTIPLIER = 3;
const DEFAULT_PRIMITIVE_SAMPLE_MIN = 256;
const DEFAULT_PRIMITIVE_SAMPLE_MAX = 120000;
const DEFAULT_PRIMITIVE_MIN_INLIERS = 30;
const DEFAULT_PRIMITIVE_MIN_INLIER_RATIO = 0.01;
const DEFAULT_PRIMITIVE_MAX_MODELS = 24;
const DEFAULT_PRIMITIVE_MIN_VOTES_PER_TRIANGLE = 2;
const DEFAULT_PRIMITIVE_MIN_REGION_TRIANGLES = 8;
const DEFAULT_PRIMITIVE_MIN_REGION_RATIO = 0.03;
const DEFAULT_PRIMITIVE_ANGLE_TOLERANCE_DEG = 15;
const DEFAULT_PRIMITIVE_DISTANCE_TOLERANCE_SCALE = 0;
const DEFAULT_PRIMITIVE_STRICT_RETRY = true;
const DEFAULT_PRIMITIVE_STRICT_ANGLE_TOLERANCE_DEG = 8;
const DEFAULT_PRIMITIVE_STRICT_DISTANCE_TOLERANCE_SCALE = 0.0005;
const DEFAULT_PRIMITIVE_PLANE_RMS_RATIO = 0.0035;
const DEFAULT_PRIMITIVE_CURVED_RMS_RATIO = 0.003;
const DEFAULT_PRIMITIVE_CYL_RADIUS_RMS_RATIO = 0.015;
const DEFAULT_PRIMITIVE_STRICT_RETRY_RMS_RATIO = 0.0012;

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

function normalizePercent(value, fallback = 5, min = 1, max = 100) {
    const num = Number(value);
    const safe = Number.isFinite(num) ? num : fallback;
    return Math.min(max, Math.max(min, safe));
}

function normalizeDecimationLevel(value, fallback = DEFAULT_DECIMATION_LEVEL_PERCENT) {
    return normalizePercent(value, fallback, 1, 100);
}

function countGeometryTriangles(geometry) {
    if (!geometry || !geometry.isBufferGeometry) return 0;
    const index = geometry.getIndex();
    if (index && Number.isFinite(index.count)) return Math.max(0, Math.floor(index.count / 3));
    const position = geometry.getAttribute('position');
    if (!position || !Number.isFinite(position.count)) return 0;
    return Math.max(0, Math.floor(position.count / 3));
}

function decimateImportedGeometry(geometry, decimationLevelPercent) {
    if (!geometry || !geometry.isBufferGeometry) return geometry;
    const level = normalizeDecimationLevel(decimationLevelPercent, DEFAULT_DECIMATION_LEVEL_PERCENT);
    if (level >= 100) return geometry;

    let source = geometry.clone();
    try {
        if (!source.getIndex()) {
            source = BufferGeometryUtils.mergeVertices(source);
        }
    } catch (error) {
        console.warn('[Import3D] Failed to index geometry before decimation; keeping original mesh detail.', error);
        return geometry;
    }

    const position = source.getAttribute('position');
    const vertexCount = Number(position?.count) || 0;
    if (vertexCount < 8) return geometry;

    const keepRatio = Math.max(0.01, Math.min(1, level / 100));
    const targetVertexCount = Math.max(4, Math.floor(vertexCount * keepRatio));
    const removeVertexCount = Math.max(0, vertexCount - targetVertexCount);
    if (removeVertexCount <= 0) return geometry;

    try {
        const modifier = new SimplifyModifier();
        const decimated = modifier.modify(source, removeVertexCount);
        if (!decimated || !decimated.isBufferGeometry) return geometry;
        if (countGeometryTriangles(decimated) < 1) return geometry;
        // Ensure downstream face grouping uses geometric triangle normals.
        decimated.deleteAttribute('normal');
        return decimated;
    } catch (error) {
        console.warn('[Import3D] Decimation failed; keeping original mesh detail.', error);
        return geometry;
    }
}

function centerGeometryByBoundingBox(geometry) {
    if (!geometry || !geometry.isBufferGeometry) return geometry;
    const centered = geometry.clone();
    centered.computeBoundingBox();
    const bb = centered.boundingBox;
    if (!bb) return centered;
    const cx = (bb.min.x + bb.max.x) * 0.5;
    const cy = (bb.min.y + bb.max.y) * 0.5;
    const cz = (bb.min.z + bb.max.z) * 0.5;
    centered.translate(-cx, -cy, -cz);
    return centered;
}

function runImportMeshRepairPipeline(geometry, meshRepairLevel) {
    const level = normalizeRepairLevel(meshRepairLevel);
    if (!geometry || !geometry.isBufferGeometry || level === 'NONE') return geometry;

    const repairer = new BREP.MeshRepairer();
    let repairedGeometry = geometry;
    if (level === 'BASIC') {
        repairedGeometry = repairer.repairAll(repairedGeometry);
    } else if (level === 'AGGRESSIVE') {
        for (let i = 0; i < 5; i += 1) {
            repairedGeometry = repairer.repairAll(repairedGeometry);
        }
    }
    return repairedGeometry;
}

function normalizePrimitiveSegmentationSettings(params = {}) {
    void params;
    const settings = {
        enablePlane: DEFAULT_PRIMITIVE_DETECT_PLANES,
        enableCylinder: DEFAULT_PRIMITIVE_DETECT_CYLINDERS,
        enableCone: DEFAULT_PRIMITIVE_DETECT_CONES,
        sampleMultiplier: DEFAULT_PRIMITIVE_SAMPLE_MULTIPLIER,
        sampleCountMin: DEFAULT_PRIMITIVE_SAMPLE_MIN,
        sampleCountMax: DEFAULT_PRIMITIVE_SAMPLE_MAX,
        minInliers: DEFAULT_PRIMITIVE_MIN_INLIERS,
        minInlierRatio: DEFAULT_PRIMITIVE_MIN_INLIER_RATIO,
        maxModels: DEFAULT_PRIMITIVE_MAX_MODELS,
        minVotesPerTriangle: DEFAULT_PRIMITIVE_MIN_VOTES_PER_TRIANGLE,
        minRegionTriangles: DEFAULT_PRIMITIVE_MIN_REGION_TRIANGLES,
        minRegionRatio: DEFAULT_PRIMITIVE_MIN_REGION_RATIO,
        angleToleranceDeg: DEFAULT_PRIMITIVE_ANGLE_TOLERANCE_DEG,
        distanceToleranceScale: DEFAULT_PRIMITIVE_DISTANCE_TOLERANCE_SCALE,
        strictRetry: DEFAULT_PRIMITIVE_STRICT_RETRY,
        strictAngleToleranceDeg: DEFAULT_PRIMITIVE_STRICT_ANGLE_TOLERANCE_DEG,
        strictDistanceToleranceScale: DEFAULT_PRIMITIVE_STRICT_DISTANCE_TOLERANCE_SCALE,
        planeRmsRatio: DEFAULT_PRIMITIVE_PLANE_RMS_RATIO,
        curvedRmsRatio: DEFAULT_PRIMITIVE_CURVED_RMS_RATIO,
        cylinderRadiusRmsRatio: DEFAULT_PRIMITIVE_CYL_RADIUS_RMS_RATIO,
        strictRetryRmsRatio: DEFAULT_PRIMITIVE_STRICT_RETRY_RMS_RATIO,
    };
    if (settings.sampleCountMax < settings.sampleCountMin) {
        settings.sampleCountMax = settings.sampleCountMin;
    }
    if (!settings.enablePlane && !settings.enableCylinder && !settings.enableCone) {
        settings.enableCylinder = true;
    }
    return settings;
}

function cleanString(value, fallback = '') {
    const out = String(value || '').trim();
    return out || String(fallback || '');
}

function sanitizeToken(value, fallback = 'IMPORT3D') {
    const base = cleanString(value, fallback);
    const token = base
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return token || fallback;
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

function serializeImportedMeshSnapshot(geometry) {
    if (!geometry || !geometry.isBufferGeometry) return null;
    const posAttr = geometry.getAttribute('position');
    if (!posAttr || !Number.isFinite(posAttr.count) || posAttr.count < 3) return null;

    const position = new Array((posAttr.count | 0) * 3);
    for (let i = 0; i < (posAttr.count | 0); i += 1) {
        position[(i * 3) + 0] = Number(posAttr.getX(i)) || 0;
        position[(i * 3) + 1] = Number(posAttr.getY(i)) || 0;
        position[(i * 3) + 2] = Number(posAttr.getZ(i)) || 0;
    }

    const snapshot = { position };

    const normalAttr = geometry.getAttribute('normal');
    if (normalAttr && Number.isFinite(normalAttr.count) && normalAttr.count === posAttr.count) {
        const normal = new Array((normalAttr.count | 0) * 3);
        for (let i = 0; i < (normalAttr.count | 0); i += 1) {
            normal[(i * 3) + 0] = Number(normalAttr.getX(i)) || 0;
            normal[(i * 3) + 1] = Number(normalAttr.getY(i)) || 0;
            normal[(i * 3) + 2] = Number(normalAttr.getZ(i)) || 0;
        }
        snapshot.normal = normal;
    }

    const indexAttr = geometry.getIndex();
    if (indexAttr && Number.isFinite(indexAttr.count) && indexAttr.count >= 3) {
        const index = new Array(indexAttr.count | 0);
        for (let i = 0; i < (indexAttr.count | 0); i += 1) {
            index[i] = Math.max(0, Number(indexAttr.getX(i)) | 0);
        }
        snapshot.index = index;
    }

    return snapshot;
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

function geometryFromImportedMeshSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const positionList = Array.isArray(snapshot.position) ? snapshot.position : null;
    if (!positionList || positionList.length < 9 || (positionList.length % 3) !== 0) return null;

    const vertCount = (positionList.length / 3) | 0;
    if (vertCount <= 0) return null;

    const position = new Float32Array(positionList.length);
    for (let i = 0; i < positionList.length; i += 1) {
        position[i] = Number(positionList[i]) || 0;
    }

    const geometry = new BREP.THREE.BufferGeometry();
    geometry.setAttribute('position', new BREP.THREE.Float32BufferAttribute(position, 3));

    const normalList = Array.isArray(snapshot.normal) ? snapshot.normal : null;
    if (normalList && normalList.length === positionList.length) {
        const normal = new Float32Array(normalList.length);
        for (let i = 0; i < normalList.length; i += 1) {
            normal[i] = Number(normalList[i]) || 0;
        }
        geometry.setAttribute('normal', new BREP.THREE.Float32BufferAttribute(normal, 3));
    }

    const indexList = Array.isArray(snapshot.index) ? snapshot.index : null;
    if (indexList && indexList.length >= 3 && (indexList.length % 3) === 0) {
        const index = new Uint32Array(indexList.length);
        for (let i = 0; i < indexList.length; i += 1) {
            const idx = Number(indexList[i]) | 0;
            if (idx < 0 || idx >= vertCount) return null;
            index[i] = idx >>> 0;
        }
        geometry.setIndex(new BREP.THREE.Uint32BufferAttribute(index, 1));
    }

    return geometry;
}

function geometryFromSolidSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const numProp = Math.max(3, Number(snapshot.numProp) || 3);
    const vertProperties = Array.isArray(snapshot.vertProperties) ? snapshot.vertProperties : [];
    const triVerts = Array.isArray(snapshot.triVerts) ? snapshot.triVerts : [];
    if (!vertProperties.length || !triVerts.length || triVerts.length % 3 !== 0) return null;

    const vertCount = Math.floor(vertProperties.length / numProp);
    if (vertCount <= 0) return null;

    const position = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i += 1) {
        const base = i * numProp;
        position[(i * 3) + 0] = Number(vertProperties[base + 0]) || 0;
        position[(i * 3) + 1] = Number(vertProperties[base + 1]) || 0;
        position[(i * 3) + 2] = Number(vertProperties[base + 2]) || 0;
    }

    const index = new Uint32Array(triVerts.length);
    for (let i = 0; i < triVerts.length; i += 1) {
        const idx = Number(triVerts[i]) | 0;
        if (idx < 0 || idx >= vertCount) return null;
        index[i] = idx >>> 0;
    }

    const geometry = new BREP.THREE.BufferGeometry();
    geometry.setAttribute('position', new BREP.THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(new BREP.THREE.Uint32BufferAttribute(index, 1));
    return geometry;
}

function getCacheSolidSnapshotList(cache) {
    if (!cache || typeof cache !== 'object') return [];
    const snapshots = Array.isArray(cache.snapshots)
        ? cache.snapshots.filter((entry) => !!entry && typeof entry === 'object')
        : [];
    if (snapshots.length > 0) return snapshots;
    if (cache.snapshot && typeof cache.snapshot === 'object') return [cache.snapshot];
    return [];
}

function restoreSolidsFromCache(cache) {
    const snapshots = getCacheSolidSnapshotList(cache);
    if (!snapshots.length) return [];
    const solids = [];
    for (const snapshot of snapshots) {
        const solid = restoreSolidFromSnapshot(snapshot);
        if (solid) solids.push(solid);
    }
    return solids;
}

function serializeSolidSnapshotList(solids) {
    const snapshots = [];
    for (const solid of (Array.isArray(solids) ? solids : [])) {
        const snapshot = serializeSolidSnapshot(solid);
        if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
}

function assignImportedSolidNames(solids, featureName) {
    const list = Array.isArray(solids)
        ? solids.filter((solid) => !!solid && typeof solid === 'object')
        : [];
    if (!list.length) return [];
    if (list.length === 1) {
        list[0].name = featureName;
        return list;
    }
    const digits = Math.max(2, String(list.length).length);
    for (let i = 0; i < list.length; i += 1) {
        list[i].name = `${featureName}_SOLID_${String(i + 1).padStart(digits, '0')}`;
    }
    return list;
}

function splitGeometryIntoDisconnectedIslands(geometry) {
    if (!geometry || !geometry.isBufferGeometry) return [];

    const sourcePosition = geometry.getAttribute('position');
    if (!sourcePosition || !Number.isFinite(sourcePosition.count) || sourcePosition.count < 3) {
        return [];
    }

    let indexedGeometry = new BREP.THREE.BufferGeometry();
    indexedGeometry.setAttribute('position', sourcePosition.clone());
    const sourceIndex = geometry.getIndex();
    if (sourceIndex) indexedGeometry.setIndex(sourceIndex.clone());
    try {
        // Weld by position only (ignore normals/UVs/colors) so adjacency reflects triangle connectivity.
        indexedGeometry = BufferGeometryUtils.mergeVertices(indexedGeometry);
    } catch (error) {
        console.warn('[Import3D] Failed to index geometry for multi-solid extraction; using single solid.', error);
        return [geometry];
    }

    const position = indexedGeometry.getAttribute('position');
    const index = indexedGeometry.getIndex();
    if (!position || !index) return [indexedGeometry];

    const triCount = Math.floor(index.count / 3);
    if (triCount <= 1) return [indexedGeometry];

    const vertexCount = Number(position.count) | 0;
    if (vertexCount <= 0) return [indexedGeometry];

    const vertexToTriangles = Array.from({ length: vertexCount }, () => []);
    for (let tri = 0; tri < triCount; tri += 1) {
        const base = tri * 3;
        for (let k = 0; k < 3; k += 1) {
            const vi = Number(index.getX(base + k)) | 0;
            if (vi < 0 || vi >= vertexCount) continue;
            vertexToTriangles[vi].push(tri);
        }
    }

    const visited = new Uint8Array(triCount);
    const components = [];
    const queue = [];

    for (let seed = 0; seed < triCount; seed += 1) {
        if (visited[seed]) continue;
        visited[seed] = 1;
        queue.push(seed);
        const component = [];

        while (queue.length > 0) {
            const tri = queue.pop();
            component.push(tri);
            const base = tri * 3;
            for (let k = 0; k < 3; k += 1) {
                const vi = Number(index.getX(base + k)) | 0;
                if (vi < 0 || vi >= vertexCount) continue;
                const incident = vertexToTriangles[vi];
                for (let i = 0; i < incident.length; i += 1) {
                    const triNeighbor = incident[i] | 0;
                    if (triNeighbor < 0 || triNeighbor >= triCount || visited[triNeighbor]) continue;
                    visited[triNeighbor] = 1;
                    queue.push(triNeighbor);
                }
            }
        }

        if (component.length > 0) components.push(component);
    }

    if (components.length <= 1) return [indexedGeometry];

    const islands = [];
    for (const component of components) {
        const oldToNew = new Map();
        const componentIndex = new Uint32Array(component.length * 3);
        const componentPositions = [];
        let outCursor = 0;
        for (let i = 0; i < component.length; i += 1) {
            const tri = component[i] | 0;
            const base = tri * 3;
            for (let k = 0; k < 3; k += 1) {
                const oldVi = Number(index.getX(base + k)) | 0;
                if (oldVi < 0 || oldVi >= vertexCount) continue;
                let newVi = oldToNew.get(oldVi);
                if (newVi === undefined) {
                    newVi = oldToNew.size;
                    oldToNew.set(oldVi, newVi);
                    componentPositions.push(
                        Number(position.getX(oldVi)) || 0,
                        Number(position.getY(oldVi)) || 0,
                        Number(position.getZ(oldVi)) || 0,
                    );
                }
                componentIndex[outCursor] = newVi >>> 0;
                outCursor += 1;
            }
        }

        if (outCursor < 3) continue;
        const island = new BREP.THREE.BufferGeometry();
        const trimmedIndex = (outCursor === componentIndex.length)
            ? componentIndex
            : componentIndex.slice(0, outCursor);
        island.setAttribute(
            'position',
            new BREP.THREE.Float32BufferAttribute(new Float32Array(componentPositions), 3),
        );
        island.setIndex(new BREP.THREE.Uint32BufferAttribute(trimmedIndex, 1));
        islands.push(island);
    }

    return islands.length ? islands : [indexedGeometry];
}

function buildImportSolidsFromGeometry(geometry, options = {}) {
    if (!geometry || !geometry.isBufferGeometry) return [];
    const extractMultipleSolids = normalizeBoolean(options.extractMultipleSolids, DEFAULT_EXTRACT_MULTIPLE_SOLIDS);
    const sourceGeometries = extractMultipleSolids
        ? splitGeometryIntoDisconnectedIslands(geometry)
        : [geometry];

    const solids = [];
    for (const sourceGeometry of sourceGeometries) {
        if (!sourceGeometry || !sourceGeometry.isBufferGeometry) continue;
        if (countGeometryTriangles(sourceGeometry) < 1) continue;
        const solid = new BREP.MeshToBrep(
            sourceGeometry,
            options.deflectionAngle,
            1e-5,
            {
                extractPlanarFaces: !!options.extractPlanarFaces,
                planarMinAreaPercent: options.planarFaceMinAreaPercent,
            },
        );
        if (options.segmentAnalyticPrimitives) {
            applyPrimitiveSegmentationToSolid(solid, options.featureName, options.primitiveSettings);
        }
        solids.push(solid);
    }

    return assignImportedSolidNames(solids, cleanString(options.featureName || 'Imported3D', 'Imported3D'));
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
    const deflection = normalizeNumber(params.deflectionAngle, DEFAULT_DEFLECTION_ANGLE);
    const decimation = normalizeDecimationLevel(params.decimationLevel, DEFAULT_DECIMATION_LEVEL_PERCENT);
    const repair = normalizeRepairLevel(params.meshRepairLevel);
    const center = normalizeBoolean(params.centerMesh, true) ? 1 : 0;
    const extractMultipleSolids = normalizeBoolean(
        params.extractMultipleSolids,
        DEFAULT_EXTRACT_MULTIPLE_SOLIDS,
    ) ? 1 : 0;
    const extractPlanarFaces = normalizeBoolean(params.extractPlanarFaces, DEFAULT_EXTRACT_PLANAR_FACES) ? 1 : 0;
    const planarFaceMinAreaPercent = normalizePercent(params.planarFaceMinAreaPercent, DEFAULT_PLANAR_MIN_AREA_PERCENT, 1, 100);
    const planarThreshold = extractPlanarFaces ? planarFaceMinAreaPercent : 0;
    const primitiveSegmentation = normalizeBoolean(
        params.segmentAnalyticPrimitives,
        DEFAULT_SEGMENT_ANALYTIC_PRIMITIVES,
    ) ? 1 : 0;
    return `v${IMPORT3D_CACHE_VERSION}|deflection=${deflection}|decimation=${decimation}|repair=${repair}|center=${center}|splitSolids=${extractMultipleSolids}|planar=${extractPlanarFaces}|planarPct=${planarThreshold}|primitiveSeg=${primitiveSegmentation}`;
}

function buildInputSignature(raw, params = {}) {
    const paramSig = buildParameterSignature(params);
    const sourceSig = buildSourceSignature(raw);
    return `${paramSig}|src=${sourceSig}`;
}

function toFiniteTriplet(source, fallback = [0, 0, 0]) {
    if (!Array.isArray(source) || source.length < 3) return fallback.slice();
    const x = Number(source[0]);
    const y = Number(source[1]);
    const z = Number(source[2]);
    return [
        Number.isFinite(x) ? x : fallback[0],
        Number.isFinite(y) ? y : fallback[1],
        Number.isFinite(z) ? z : fallback[2],
    ];
}

function buildPrimitiveTypeCounts(regions) {
    const counts = {};
    const src = Array.isArray(regions) ? regions : [];
    for (const region of src) {
        const type = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
        counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
}

function computeBoundsDiagonal(bounds, fallback = 0) {
    if (!bounds || typeof bounds !== 'object') return Number(fallback) || 0;
    const min = Array.isArray(bounds.min) ? bounds.min : null;
    const max = Array.isArray(bounds.max) ? bounds.max : null;
    if (!min || !max || min.length < 3 || max.length < 3) return Number(fallback) || 0;
    const dx = Number(max[0]) - Number(min[0]);
    const dy = Number(max[1]) - Number(min[1]);
    const dz = Number(max[2]) - Number(min[2]);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return Number(fallback) || 0;
    const diag = Math.hypot(dx, dy, dz);
    return Number.isFinite(diag) && diag > 0 ? diag : (Number(fallback) || 0);
}

function computeMeshDiagonal(mesh) {
    const vp = mesh?.vertProperties;
    if (!(vp && vp.length >= 3)) return 0;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i + 2 < vp.length; i += 3) {
        const x = Number(vp[i + 0]);
        const y = Number(vp[i + 1]);
        const z = Number(vp[i + 2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return 0;
    return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

function countNonOtherRegions(regions) {
    return (Array.isArray(regions) ? regions : []).reduce((count, region) => {
        const type = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
        return type === 'OTHER' ? count : (count + 1);
    }, 0);
}

function isPrimitiveRegionFitAcceptable(region, faceDiag, primitiveSettings) {
    const settings = primitiveSettings || normalizePrimitiveSegmentationSettings({});
    const type = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
    if (type !== 'PLANE' && type !== 'CYLINDER' && type !== 'CONE') return true;
    const rms = Number(region?.rms);
    if (!Number.isFinite(rms)) return false;
    const regionDiag = computeBoundsDiagonal(region?.bbox, faceDiag);
    const diagScale = Math.max(1e-8, regionDiag || faceDiag || 0);
    let maxRms = (type === 'PLANE')
        ? (diagScale * settings.planeRmsRatio)
        : (diagScale * settings.curvedRmsRatio);
    if (type === 'CYLINDER') {
        const radius = Math.abs(Number(region?.params?.radius));
        if (Number.isFinite(radius) && radius > 1e-8) {
            maxRms = Math.min(maxRms, radius * settings.cylinderRadiusRmsRatio);
        }
    }
    maxRms = Math.max(1e-5, maxRms);
    return rms <= maxRms;
}

function downgradePrimitiveRegionToOther(region, type, reason) {
    return {
        ...region,
        type: 'OTHER',
        params: {},
        axis: undefined,
        apex: undefined,
        downgradedPrimitiveType: type,
        downgradedReason: reason,
    };
}

function normalizeSegmentationRegionsForImport(regions, faceDiag, primitiveSettings) {
    const settings = primitiveSettings || normalizePrimitiveSegmentationSettings({});
    const src = Array.isArray(regions) ? regions : [];
    const out = [];
    for (const region of src) {
        const type = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
        if (type === 'OTHER') {
            out.push(region);
            continue;
        }

        const typeEnabled = (
            (type === 'PLANE' && settings.enablePlane) ||
            (type === 'CYLINDER' && settings.enableCylinder) ||
            (type === 'CONE' && settings.enableCone)
        );
        if (!typeEnabled) {
            out.push(downgradePrimitiveRegionToOther(region, type, 'TYPE_DISABLED'));
            continue;
        }

        if (isPrimitiveRegionFitAcceptable(region, faceDiag, settings)) {
            out.push(region);
            continue;
        }
        out.push(downgradePrimitiveRegionToOther(region, type, 'HIGH_RMS'));
    }
    return out;
}

function shouldRetryWithStrictSegmentation(regions, selectedTriCount, faceDiag, primitiveSettings) {
    const settings = primitiveSettings || normalizePrimitiveSegmentationSettings({});
    if (!settings.strictRetry) return false;
    if (!Array.isArray(regions) || regions.length < 1) return false;
    if (selectedTriCount < 16) return false;
    const lowQualityThreshold = Math.max(1e-5, Number(faceDiag) * settings.strictRetryRmsRatio);

    if (regions.length === 1) {
        const region = regions[0];
        const type = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
        if (type === 'OTHER') return true;
        if (type === 'CYLINDER' || type === 'CONE') {
            const rms = Number(region?.rms);
            return Number.isFinite(rms) && rms > lowQualityThreshold;
        }
        return false;
    }

    let totalTriangles = 0;
    let dominantPrimitive = null;
    let dominantCount = 0;
    for (const region of regions) {
        const triCount = Array.isArray(region?.triIndices)
            ? region.triIndices.length
            : (Number(region?.triIndices?.length) || 0);
        if (triCount <= 0) continue;
        totalTriangles += triCount;
        const type = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
        if (type === 'OTHER') continue;
        if (triCount > dominantCount) {
            dominantCount = triCount;
            dominantPrimitive = region;
        }
    }
    if (!dominantPrimitive || totalTriangles <= 0) return false;
    const dominance = dominantCount / totalTriangles;
    if (!(dominance >= 0.9)) return false;
    const rms = Number(dominantPrimitive?.rms);
    return Number.isFinite(rms) && rms > lowQualityThreshold;
}

function collectAutoPlanarFaceIDs(solid) {
    const ids = new Set();
    const faceMetadata = (solid && solid._faceMetadata instanceof Map) ? solid._faceMetadata : null;
    const faceNameToID = (solid && solid._faceNameToID instanceof Map) ? solid._faceNameToID : null;
    if (!faceMetadata || !faceNameToID) return ids;

    for (const [faceName, metadata] of faceMetadata.entries()) {
        if (!metadata || typeof metadata !== 'object') continue;
        const isAutoPlanar = (
            metadata.importAutoPlanarGroup === true ||
            metadata.autoPlanarGroup === true
        );
        if (!isAutoPlanar) continue;
        const id = faceNameToID.get(faceName);
        if (id === undefined || id === null) continue;
        ids.add(Number(id) | 0);
    }
    return ids;
}

function buildFaceTriangleGroups(triIDs) {
    const groups = new Map();
    const triCount = Array.isArray(triIDs) ? triIDs.length : 0;
    for (let t = 0; t < triCount; t += 1) {
        const faceID = Number(triIDs[t]) | 0;
        let list = groups.get(faceID);
        if (!list) {
            list = [];
            groups.set(faceID, list);
        }
        list.push(t);
    }
    return groups;
}

function buildSubMeshFromTriangleList(vp, tv, triIndices) {
    const triCount = (tv.length / 3) | 0;
    const vertCount = (vp.length / 3) | 0;
    const selectedTriCount = Array.isArray(triIndices) ? triIndices.length : 0;
    if (selectedTriCount <= 0) return null;

    const localToOrigTri = new Uint32Array(selectedTriCount);
    const oldToNewVert = new Map();
    const subVerts = [];
    const subTriVerts = new Uint32Array(selectedTriCount * 3);

    for (let outTri = 0; outTri < selectedTriCount; outTri += 1) {
        const sourceTri = Number(triIndices[outTri]) | 0;
        if (sourceTri < 0 || sourceTri >= triCount) return null;
        const triBase = sourceTri * 3;
        const outBase = outTri * 3;
        localToOrigTri[outTri] = sourceTri >>> 0;
        for (let k = 0; k < 3; k += 1) {
            const oldVi = Number(tv[triBase + k]) | 0;
            if (oldVi < 0 || oldVi >= vertCount) return null;
            let newVi = oldToNewVert.get(oldVi);
            if (newVi === undefined) {
                newVi = oldToNewVert.size;
                oldToNewVert.set(oldVi, newVi);
                const vb = oldVi * 3;
                subVerts.push(
                    Number(vp[vb + 0]) || 0,
                    Number(vp[vb + 1]) || 0,
                    Number(vp[vb + 2]) || 0,
                );
            }
            subTriVerts[outBase + k] = newVi >>> 0;
        }
    }

    return {
        mesh: {
            vertProperties: new Float32Array(subVerts),
            triVerts: subTriVerts,
        },
        localToOrigTri,
        selectedTriCount,
    };
}

function buildFaceSegmentationOptions(faceTriCount, faceID, primitiveSettings, faceDiag) {
    void faceID;
    const settings = primitiveSettings || normalizePrimitiveSegmentationSettings({});
    const safeFaceTriCount = Math.max(1, Number(faceTriCount) | 0);
    const sampleCount = Math.min(
        settings.sampleCountMax,
        Math.max(settings.sampleCountMin, Math.floor(safeFaceTriCount * settings.sampleMultiplier)),
    );
    const minInliers = Math.max(
        settings.minInliers,
        Math.floor(sampleCount * settings.minInlierRatio),
    );
    const minRegionTriangles = Math.max(
        1,
        Math.max(settings.minRegionTriangles, Math.floor(safeFaceTriCount * settings.minRegionRatio)),
    );
    const safeFaceDiag = Math.max(0, Number(faceDiag) || 0);
    const distEps = (settings.distanceToleranceScale > 0 && safeFaceDiag > 0)
        ? Math.max(1e-10, safeFaceDiag * settings.distanceToleranceScale)
        : undefined;
    return {
        sampleCount,
        minInliers: Math.min(sampleCount, Math.max(1, minInliers)),
        maxModels: settings.maxModels,
        minVotesPerTriangle: settings.minVotesPerTriangle,
        minRegionTriangles: Math.min(safeFaceTriCount, minRegionTriangles),
        randomSeed: (1337 ^ ((safeFaceTriCount * 2654435761) >>> 0)) >>> 0,
        angleEpsDeg: settings.angleToleranceDeg,
        ...(distEps !== undefined ? { distEps } : {}),
        enablePlane: settings.enablePlane,
        enableCylinder: settings.enableCylinder,
        enableCone: settings.enableCone,
    };
}

function buildStrictFallbackFaceSegmentationOptions(faceTriCount, faceID, faceDiag, primitiveSettings) {
    const settings = primitiveSettings || normalizePrimitiveSegmentationSettings({});
    const safeFaceTriCount = Math.max(1, Number(faceTriCount) | 0);
    const base = buildFaceSegmentationOptions(safeFaceTriCount, faceID, settings, faceDiag);
    const strictDistScale = Number(settings.strictDistanceToleranceScale);
    const safeFaceDiag = Math.max(0, Number(faceDiag) || 0);
    const distEps = (strictDistScale > 0 && safeFaceDiag > 0)
        ? Math.max(1e-10, safeFaceDiag * strictDistScale)
        : undefined;
    return {
        ...base,
        sampleCount: Math.min(
            settings.sampleCountMax,
            Math.max(base.sampleCount, Math.floor(safeFaceTriCount * (settings.sampleMultiplier + 1))),
        ),
        minInliers: Math.max(12, Math.min(base.minInliers, Math.floor(safeFaceTriCount * 0.4))),
        maxModels: Math.max(base.maxModels, settings.maxModels + 8),
        minVotesPerTriangle: 1,
        minRegionTriangles: Math.min(safeFaceTriCount, Math.max(2, Math.floor(safeFaceTriCount * 0.01))),
        angleEpsDeg: settings.strictAngleToleranceDeg,
        ...(distEps !== undefined ? { distEps } : {}),
        randomSeed: (base.randomSeed ^ 0x9e3779b9) >>> 0,
    };
}

function chooseLargestRegionFaceID(regionFaceID) {
    const counts = new Map();
    let bestID = 0;
    let bestCount = -1;
    const count = (regionFaceID && regionFaceID.length) ? regionFaceID.length : 0;
    for (let i = 0; i < count; i += 1) {
        const localID = regionFaceID[i] >>> 0;
        const next = (counts.get(localID) || 0) + 1;
        counts.set(localID, next);
        if (next > bestCount || (next === bestCount && localID < bestID)) {
            bestCount = next;
            bestID = localID;
        }
    }
    return bestID;
}

function makeUniqueFaceName(baseName, faceNameToID) {
    const base = cleanString(baseName, 'FACE_SEG');
    if (!faceNameToID.has(base)) return base;
    let idx = 1;
    while (idx < 1000000) {
        const candidate = `${base}_${idx}`;
        if (!faceNameToID.has(candidate)) return candidate;
        idx += 1;
    }
    return `${base}_${Date.now()}`;
}

function buildRegionMetadata(region, parentFaceName, parentFaceID, localFaceID) {
    const primitiveType = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
    const metadata = {
        source: 'IMPORT3D_PRIMITIVE_SEGMENTATION',
        segmentationScope: 'NON_PLANAR_FACE_REFINEMENT',
        parentFaceName,
        parentFaceID,
        regionId: region ? (Number(region?.id) | 0) : ((localFaceID | 0) - 1),
        primitiveType,
        primitiveParams: cloneJsonSafe(region?.params || {}, {}),
        primitiveRms: Number(region?.rms) || 0,
        triangleCount: Array.isArray(region?.triIndices)
            ? region.triIndices.length
            : (region?.triIndices?.length || 0),
        bbox: cloneJsonSafe(region?.bbox || null, null),
    };
    if (Array.isArray(region?.axis) && region.axis.length >= 3) {
        metadata.axis = toFiniteTriplet(region.axis, [0, 1, 0]);
    }
    if (Array.isArray(region?.apex) && region.apex.length >= 3) {
        metadata.apex = toFiniteTriplet(region.apex, [0, 0, 0]);
    }
    return metadata;
}

function maybeRenameParentFaceForPrimitive(solid, faceName, faceID, localFaceID, primitiveType, primitiveSettings) {
    const settings = primitiveSettings || normalizePrimitiveSegmentationSettings({});
    const type = cleanString(primitiveType || 'OTHER', 'OTHER').toUpperCase();
    const canRename = (
        (type === 'CYLINDER' && settings.enableCylinder) ||
        (type === 'CONE' && settings.enableCone)
    );
    if (!canRename) return faceName;
    const proposed = `${faceName}_SEG_${String(localFaceID).padStart(3, '0')}_${type}`;
    const existingFaceID = solid?._faceNameToID?.get(proposed);
    const uniqueName = (existingFaceID === undefined || existingFaceID === faceID)
        ? proposed
        : makeUniqueFaceName(proposed, solid._faceNameToID);
    solid._faceNameToID.set(uniqueName, faceID);
    solid._idToFaceName.set(faceID, uniqueName);
    return uniqueName;
}

function applyPrimitiveSegmentationToSolid(solid, featureName, primitiveSettingsInput) {
    if (!solid || typeof solid !== 'object') return false;
    const primitiveSettings = normalizePrimitiveSegmentationSettings(primitiveSettingsInput || {});
    const vp = Array.isArray(solid._vertProperties) ? solid._vertProperties : null;
    const tv = Array.isArray(solid._triVerts) ? solid._triVerts : null;
    if (!vp || !tv || vp.length < 9 || tv.length < 3 || (tv.length % 3) !== 0) return false;

    const triCount = (tv.length / 3) | 0;
    const existingTriIDs = (Array.isArray(solid._triIDs) && solid._triIDs.length === triCount)
        ? solid._triIDs
        : new Array(triCount).fill(0);

    const faceGroups = buildFaceTriangleGroups(existingTriIDs);
    const autoPlanarFaceIDs = collectAutoPlanarFaceIDs(solid);
    const prevFaceNameToID = (solid._faceNameToID instanceof Map) ? solid._faceNameToID : new Map();
    const prevIDToFaceName = (solid._idToFaceName instanceof Map) ? solid._idToFaceName : new Map();
    const prevFaceMetadata = (solid._faceMetadata instanceof Map) ? solid._faceMetadata : new Map();

    const triIDs = existingTriIDs.slice();
    solid._faceNameToID = new Map(prevFaceNameToID);
    solid._idToFaceName = new Map(prevIDToFaceName);
    const nextFaceMetadata = new Map(prevFaceMetadata);

    let processedFaceCount = 0;
    let splitFaceCount = 0;
    let createdFaceCount = 0;
    let classifiedFaceCount = 0;
    let segmentedTriangleCount = 0;
    let boundaryEdgeCount = 0;
    let renamedParentFaceCount = 0;
    const mergedTypeCounts = {};

    const sortedFaceIDs = Array.from(faceGroups.keys()).sort((a, b) => a - b);
    for (const faceID of sortedFaceIDs) {
        if (autoPlanarFaceIDs.has(faceID)) continue;
        const triIndices = faceGroups.get(faceID) || [];
        if (triIndices.length < 6) continue;

        const faceNameRaw = solid._idToFaceName.get(faceID);
        const faceName = cleanString(faceNameRaw || `FACE_${faceID}`, `FACE_${faceID}`);
        if (!solid._faceNameToID.has(faceName)) solid._faceNameToID.set(faceName, faceID);
        solid._idToFaceName.set(faceID, faceName);

        const subMeshData = buildSubMeshFromTriangleList(vp, tv, triIndices);
        if (!subMeshData || !subMeshData.mesh || subMeshData.selectedTriCount <= 0) continue;
        const faceDiag = computeMeshDiagonal(subMeshData.mesh);

        processedFaceCount += 1;
        let segmentation;
        try {
            const options = buildFaceSegmentationOptions(
                subMeshData.selectedTriCount,
                faceID,
                primitiveSettings,
                faceDiag,
            );
            segmentation = segmentMeshPrimitives(
                subMeshData.mesh,
                options,
            );
        } catch (error) {
            console.warn('[Import3D] Primitive segmentation failed for face:', faceName, error);
            continue;
        }

        let regionFaceID = segmentation?.regionFaceID;
        let regions = normalizeSegmentationRegionsForImport(
            Array.isArray(segmentation?.regions) ? segmentation.regions : [],
            faceDiag,
            primitiveSettings,
        );
        if (!regionFaceID || regionFaceID.length !== subMeshData.selectedTriCount) continue;
        let usedStrictSegmentation = false;

        if (shouldRetryWithStrictSegmentation(regions, subMeshData.selectedTriCount, faceDiag, primitiveSettings)) {
            try {
                const strictSegmentation = segmentMeshPrimitives(
                    subMeshData.mesh,
                    buildStrictFallbackFaceSegmentationOptions(
                        subMeshData.selectedTriCount,
                        faceID,
                        faceDiag,
                        primitiveSettings,
                    ),
                );
                const strictRegionFaceID = strictSegmentation?.regionFaceID;
                const strictRegions = normalizeSegmentationRegionsForImport(
                    Array.isArray(strictSegmentation?.regions) ? strictSegmentation.regions : [],
                    faceDiag,
                    primitiveSettings,
                );
                const primaryNonOther = countNonOtherRegions(regions);
                const strictNonOther = countNonOtherRegions(strictRegions);
                if (
                    strictRegionFaceID &&
                    strictRegionFaceID.length === subMeshData.selectedTriCount &&
                    strictRegions.length > regions.length &&
                    (
                        strictNonOther > primaryNonOther ||
                        strictRegions.length >= (regions.length + 2) ||
                        primaryNonOther <= 0
                    )
                ) {
                    segmentation = strictSegmentation;
                    regionFaceID = strictRegionFaceID;
                    regions = strictRegions;
                    usedStrictSegmentation = true;
                }
            } catch (error) {
                console.warn('[Import3D] Strict primitive segmentation retry failed for face:', faceName, error);
            }
        }

        const nonOtherRegionCount = countNonOtherRegions(regions);
        if (nonOtherRegionCount <= 0 && !(usedStrictSegmentation && regions.length > 1)) continue;

        const baseLocalFaceID = chooseLargestRegionFaceID(regionFaceID);
        if (!(baseLocalFaceID > 0)) continue;

        const regionByLocalFaceID = new Map();
        for (const region of regions) {
            const localFaceID = ((Number(region?.id) | 0) + 1) >>> 0;
            if (localFaceID > 0) regionByLocalFaceID.set(localFaceID, region);
        }
        const baseRegion = regionByLocalFaceID.get(baseLocalFaceID) || null;
        const baseType = cleanString(baseRegion?.type || 'OTHER', 'OTHER').toUpperCase();
        const shouldClassifyParentPrimitive = (
            (baseType === 'CYLINDER' && primitiveSettings.enableCylinder) ||
            (baseType === 'CONE' && primitiveSettings.enableCone)
        );
        const hasMultipleRegions = regions.length > 1;
        if (!hasMultipleRegions && !shouldClassifyParentPrimitive) continue;

        const localFaceToGlobal = new Map([[baseLocalFaceID, faceID]]);
        let splitThisFace = false;
        if (hasMultipleRegions) {
            for (let localTri = 0; localTri < subMeshData.selectedTriCount; localTri += 1) {
                const originalTri = subMeshData.localToOrigTri[localTri] >>> 0;
                const localFaceID = regionFaceID[localTri] >>> 0;
                let targetFaceID = localFaceToGlobal.get(localFaceID);
                if (targetFaceID === undefined) {
                    const region = regionByLocalFaceID.get(localFaceID);
                    const type = cleanString(region?.type || 'OTHER', 'OTHER').toUpperCase();
                    const proposedName = `${faceName}_SEG_${String(localFaceID).padStart(3, '0')}_${type}`;
                    const uniqueName = makeUniqueFaceName(proposedName, solid._faceNameToID);
                    targetFaceID = solid._getOrCreateID(uniqueName);
                    localFaceToGlobal.set(localFaceID, targetFaceID);
                    createdFaceCount += 1;
                    nextFaceMetadata.set(uniqueName, buildRegionMetadata(region, faceName, faceID, localFaceID));
                }
                triIDs[originalTri] = targetFaceID;
                if (targetFaceID !== faceID) splitThisFace = true;
            }
        }

        const typeCounts = buildPrimitiveTypeCounts(regions);
        for (const [type, count] of Object.entries(typeCounts)) {
            mergedTypeCounts[type] = (mergedTypeCounts[type] || 0) + count;
        }

        const typedParentFaceName = maybeRenameParentFaceForPrimitive(
            solid,
            faceName,
            faceID,
            baseLocalFaceID,
            baseType,
            primitiveSettings,
        );
        if (typedParentFaceName !== faceName) renamedParentFaceCount += 1;

        const parentMetadata = cloneJsonSafe(nextFaceMetadata.get(faceName) || {}, {});
        if (shouldClassifyParentPrimitive) {
            Object.assign(parentMetadata, buildRegionMetadata(baseRegion, faceName, faceID, baseLocalFaceID));
            parentMetadata.isParentPrimitiveRegion = true;
            classifiedFaceCount += 1;
        }
        parentMetadata.refinedByPrimitiveSegmentation = !!splitThisFace;
        parentMetadata.refinementScope = 'NON_PLANAR_FACE_REFINEMENT';
        parentMetadata.refinedRegionCount = regions.length;
        nextFaceMetadata.set(typedParentFaceName, parentMetadata);
        if (typedParentFaceName !== faceName) {
            nextFaceMetadata.set(faceName, cloneJsonSafe(parentMetadata, {}));
        }

        if (!splitThisFace) continue;
        splitFaceCount += 1;
        segmentedTriangleCount += subMeshData.selectedTriCount;
        boundaryEdgeCount += Array.isArray(segmentation?.boundaryEdges) ? segmentation.boundaryEdges.length : 0;
    }

    solid._triIDs = triIDs;
    solid._faceMetadata = nextFaceMetadata;
    solid._faceIndex = null;
    solid._dirty = true;
    solid._manifold = null;

    const userData = (solid.userData && typeof solid.userData === 'object') ? solid.userData : {};
    solid.userData = {
        ...userData,
        importPrimitiveSegmentation: {
            enabled: true,
            scope: 'PER_FACE_NON_PLANAR_REFINEMENT',
            processedFaceCount,
            splitFaceCount,
            createdFaceCount,
            classifiedFaceCount,
            segmentedTriangleCount,
            preservedPlanarFaceCount: autoPlanarFaceIDs.size,
            boundaryEdgeCount,
            renamedParentFaceCount,
            typeCounts: mergedTypeCounts,
            settings: cloneJsonSafe(primitiveSettings, {}),
        },
    };

    return true;
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
        default_value: DEFAULT_DEFLECTION_ANGLE,
        hint: 'The angle (in degrees) between face normals at which to split faces when constructing the BREP solid',
    },
    decimationLevel: {
        type: 'number',
        default_value: DEFAULT_DECIMATION_LEVEL_PERCENT,
        min: 1,
        max: 100,
        step: 1,
        hint: 'Percent of mesh detail to keep before grouping triangles into faces (100 keeps the original mesh)',
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
    extractMultipleSolids: {
        type: 'boolean',
        default_value: DEFAULT_EXTRACT_MULTIPLE_SOLIDS,
        hint: 'Split disconnected triangle islands into separate solids',
    },
    extractPlanarFaces: {
        type: 'boolean',
        default_value: DEFAULT_EXTRACT_PLANAR_FACES,
        hint: 'Extract large planar regions into faces before angle-based grouping',
    },
    planarFaceMinAreaPercent: {
        type: 'number',
        default_value: DEFAULT_PLANAR_MIN_AREA_PERCENT,
        min: 1,
        max: 100,
        step: 1,
        hint: 'Minimum planar region area as a percentage of total imported mesh area (used when planar extraction is enabled)',
    },
    segmentAnalyticPrimitives: {
        type: 'boolean',
        default_value: DEFAULT_SEGMENT_ANALYTIC_PRIMITIVES,
        hint: 'Keep existing face splits and only refine non-planar faces by subdividing each face independently with primitive segmentation',
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
        const centerMesh = normalizeBoolean(this.inputParams.centerMesh, true);
        const meshRepairLevel = normalizeRepairLevel(this.inputParams.meshRepairLevel);
        const extractMultipleSolids = normalizeBoolean(
            this.inputParams.extractMultipleSolids,
            DEFAULT_EXTRACT_MULTIPLE_SOLIDS,
        );
        const extractPlanarFaces = normalizeBoolean(this.inputParams.extractPlanarFaces, DEFAULT_EXTRACT_PLANAR_FACES);
        const planarFaceMinAreaPercent = normalizePercent(this.inputParams.planarFaceMinAreaPercent, DEFAULT_PLANAR_MIN_AREA_PERCENT, 1, 100);
        const segmentAnalyticPrimitives = normalizeBoolean(
            this.inputParams.segmentAnalyticPrimitives,
            DEFAULT_SEGMENT_ANALYTIC_PRIMITIVES,
        );
        const primitiveSettings = normalizePrimitiveSegmentationSettings();
        const deflectionAngle = normalizeNumber(this.inputParams.deflectionAngle, DEFAULT_DEFLECTION_ANGLE);
        const decimationLevel = normalizeDecimationLevel(this.inputParams.decimationLevel, DEFAULT_DECIMATION_LEVEL_PERCENT);

        if (!hasRaw || !supportedRaw) {
            const cacheSnapshots = getCacheSolidSnapshotList(cache);
            if (cache && cacheSnapshots.length > 0) {
                const cacheParamsMatch = !!(cache.paramSignature && cache.paramSignature === paramSignature);
                if (cacheParamsMatch) {
                    const cachedSolids = assignImportedSolidNames(restoreSolidsFromCache(cache), featureName);
                    if (cachedSolids.length > 0) {
                        for (const cachedSolid of cachedSolids) cachedSolid.visualize();
                        this.persistentData.consumeFileInput = true;
                        return { added: cachedSolids, removed: [] };
                    }
                }

                // No source file payload is available, so re-group from cached mesh triangles.
                const cachedSourceGeometry = geometryFromImportedMeshSnapshot(cache.sourceMeshSnapshot);
                const fallbackSnapshot = cacheSnapshots[0] || null;
                const fallbackGeometry = cachedSourceGeometry ? null : geometryFromSolidSnapshot(fallbackSnapshot);
                const sourceGeometryForPipeline = cachedSourceGeometry || fallbackGeometry;
                if (sourceGeometryForPipeline) {
                    // Keep the original imported mesh snapshot by reference to avoid JSON stringify/parse
                    // failures on large meshes (which would drop the source snapshot and cause cumulative
                    // decimation from already-decimated cache snapshots).
                    const sourceMeshSnapshotForCache = cachedSourceGeometry
                        ? ((cache.sourceMeshSnapshot && typeof cache.sourceMeshSnapshot === 'object')
                            ? cache.sourceMeshSnapshot
                            : null)
                        : serializeImportedMeshSnapshot(sourceGeometryForPipeline);

                    let regroupedGeometry = sourceGeometryForPipeline;
                    if (centerMesh) {
                        regroupedGeometry = centerGeometryByBoundingBox(regroupedGeometry);
                    }
                    regroupedGeometry = decimateImportedGeometry(regroupedGeometry, decimationLevel);
                    regroupedGeometry = runImportMeshRepairPipeline(regroupedGeometry, meshRepairLevel);
                    const regroupedSolids = buildImportSolidsFromGeometry(
                        regroupedGeometry,
                        {
                            featureName,
                            deflectionAngle,
                            extractMultipleSolids,
                            extractPlanarFaces,
                            planarFaceMinAreaPercent,
                            segmentAnalyticPrimitives,
                            primitiveSettings,
                        },
                    );
                    if (regroupedSolids.length > 0) {
                        for (const regroupedSolid of regroupedSolids) regroupedSolid.visualize();
                    } else {
                        console.warn('[Import3D] Failed to rebuild solids from cached source geometry.');
                        return { added: [], removed: [] };
                    }

                    const regroupedSnapshots = serializeSolidSnapshotList(regroupedSolids);
                    if (regroupedSnapshots.length > 0) {
                        const sourceSignature = cleanString(cache.sourceSignature || '', '') || 'cached-snapshot';
                        this.persistentData.importCache = {
                            version: IMPORT3D_CACHE_VERSION,
                            signature: `${paramSignature}|src=${sourceSignature}`,
                            sourceSignature,
                            paramSignature,
                            ...(sourceMeshSnapshotForCache ? { sourceMeshSnapshot: sourceMeshSnapshotForCache } : {}),
                            snapshot: regroupedSnapshots[0],
                            snapshots: regroupedSnapshots,
                            updatedAt: new Date().toISOString(),
                        };
                    }
                    this.persistentData.consumeFileInput = true;
                    return { added: regroupedSolids, removed: [] };
                }
            }

            if (!hasRaw) console.warn('[Import3D] No model data provided');
            else console.warn('[Import3D] Unsupported input type for fileToImport');
            return { added: [], removed: [] };
        }

        const inputSignature = buildInputSignature(raw, this.inputParams);
        const cacheSnapshots = getCacheSolidSnapshotList(cache);
        if (cache && cache.signature === inputSignature && cacheSnapshots.length > 0) {
            const cachedSolids = assignImportedSolidNames(restoreSolidsFromCache(cache), featureName);
            if (cachedSolids.length > 0) {
                for (const cachedSolid of cachedSolids) cachedSolid.visualize();
                this.persistentData.consumeFileInput = true;
                return { added: cachedSolids, removed: [] };
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

        const sourceMeshSnapshot = serializeImportedMeshSnapshot(geometry);

        // Optionally center the geometry by its bounding box center
        if (centerMesh) geometry = centerGeometryByBoundingBox(geometry);

        // Optional decimation pass before repair and face grouping.
        const decimatedGeometry = decimateImportedGeometry(geometry, decimationLevel);

        // Run mesh repair pipeline per selected level to produce a BufferGeometry
        const repairedGeometry = runImportMeshRepairPipeline(decimatedGeometry, meshRepairLevel);

        // Build one or more BREP solids by grouping triangles into faces via deflection angle.
        const solids = buildImportSolidsFromGeometry(
            repairedGeometry,
            {
                featureName,
                deflectionAngle,
                extractMultipleSolids,
                extractPlanarFaces,
                planarFaceMinAreaPercent,
                segmentAnalyticPrimitives,
                primitiveSettings,
            },
        );
        if (solids.length > 0) {
            for (const solid of solids) solid.visualize();
        } else {
            console.warn('[Import3D] Failed to convert imported geometry into solids.');
            return { added: [], removed: [] };
        }

        const snapshots = serializeSolidSnapshotList(solids);
        if (snapshots.length > 0) {
            this.persistentData.importCache = {
                version: IMPORT3D_CACHE_VERSION,
                signature: inputSignature,
                sourceSignature: buildSourceSignature(raw),
                paramSignature,
                ...(sourceMeshSnapshot ? { sourceMeshSnapshot } : {}),
                snapshot: snapshots[0],
                snapshots,
                updatedAt: new Date().toISOString(),
            };
            this.persistentData.consumeFileInput = true;
        }

        return { added: solids, removed: [] };
    }
}
