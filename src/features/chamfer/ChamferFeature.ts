import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
    resolveSingleSolidFromEdges,
} from "../edgeFeatureUtils.js";
import { BREP } from "../../BREP/BREP.js";
import { SelectionState } from "../../UI/SelectionState.js";

const CHAMFER_DEBUG_NONE = "NONE";
const CHAMFER_DEBUG_ADVANCED_OPTIONS = "ADVANCED OPTIONS";
const CHAMFER_DEBUG_TRIANGLE_CROSS_SECTIONS = "TRIANGLE CROSS SECTIONS ONLY";
const CHAMFER_DEBUG_SOLID_ONLY = "CHAMFER SOLID ONLY";
const CHAMFER_DEBUG_SOLID_AND_CROSS_SECTIONS = "CHAMFER SOLID AND CROSS SECTIONS";

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the chamfer feature",
    },
    edges: {
        type: "reference_selection",
        selectionFilter: ["EDGE", "FACE"],
        timestampDependency: "parentSolid",
        multiple: true,
        default_value: null,
        hint: "Select edges or faces to apply the chamfer",
    },
    distance: {
        type: "number",
        step: 0.1,
        default_value: 1,
        hint: "Chamfer distance (equal offset along both faces)",
    },
    inflate: {
        type: "number",
        default_value: 0.1,
        step: 0.1,
        hint: "Grow the cutting solid by this amount (units). Very small values (e.g., 0.0005) help avoid residual slivers after CSG.",
    },
    direction: {
        type: "options",
        options: ["AUTO", "INSET", "OUTSET"],
        default_value: "AUTO",
        hint: "Choose chamfer side automatically (AUTO) or force INSET/OUTSET",
    },
    debug: {
        type: "options",
        options: [
            CHAMFER_DEBUG_NONE,
            CHAMFER_DEBUG_ADVANCED_OPTIONS,
            CHAMFER_DEBUG_TRIANGLE_CROSS_SECTIONS,
            CHAMFER_DEBUG_SOLID_ONLY,
            CHAMFER_DEBUG_SOLID_AND_CROSS_SECTIONS,
        ],
        default_value: CHAMFER_DEBUG_NONE,
        hint: "Choose which chamfer debug geometry to draw",
    }
};

function normalizeChamferDebugMode(rawValue) {
    if (rawValue === true) return CHAMFER_DEBUG_SOLID_AND_CROSS_SECTIONS;
    if (rawValue === false || rawValue == null) return CHAMFER_DEBUG_NONE;
    const value = String(rawValue).trim().toLowerCase();
    if (value === CHAMFER_DEBUG_ADVANCED_OPTIONS.toLowerCase()) return CHAMFER_DEBUG_ADVANCED_OPTIONS;
    if (value === CHAMFER_DEBUG_TRIANGLE_CROSS_SECTIONS.toLowerCase()) return CHAMFER_DEBUG_TRIANGLE_CROSS_SECTIONS;
    if (value === CHAMFER_DEBUG_SOLID_ONLY.toLowerCase()) return CHAMFER_DEBUG_SOLID_ONLY;
    if (value === CHAMFER_DEBUG_SOLID_AND_CROSS_SECTIONS.toLowerCase()) return CHAMFER_DEBUG_SOLID_AND_CROSS_SECTIONS;
    if (value === CHAMFER_DEBUG_NONE.toLowerCase()) return CHAMFER_DEBUG_NONE;
    return CHAMFER_DEBUG_NONE;
}

function isSectionDebugSolid(debugSolid) {
    return /_SECTION_\d+$/.test(String(debugSolid?.name || ""))
        || String(debugSolid?.__debugChamferKind || "") === "chamferCrossSection";
}

function shouldIncludeChamferDebugSolid(debugMode, debugSolid) {
    const isSection = isSectionDebugSolid(debugSolid);
    switch (debugMode) {
        case CHAMFER_DEBUG_TRIANGLE_CROSS_SECTIONS:
            return isSection;
        case CHAMFER_DEBUG_SOLID_ONLY:
            return !isSection;
        case CHAMFER_DEBUG_SOLID_AND_CROSS_SECTIONS:
            return true;
        case CHAMFER_DEBUG_NONE:
        default:
            return false;
    }
}

function buildSketchBasisFromFace(face) {
    const pos = face?.geometry?.getAttribute?.("position");
    if (!pos || pos.count < 3) return null;
    const THREE = BREP.THREE;
    const origin = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
    const px = new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1)).sub(origin);
    const py = new THREE.Vector3(pos.getX(2), pos.getY(2), pos.getZ(2)).sub(origin);
    const x = px.clone().normalize();
    if (x.lengthSq() < 1e-20) return null;
    const normal = x.clone().cross(py).normalize();
    if (normal.lengthSq() < 1e-20) return null;
    const y = new THREE.Vector3().crossVectors(normal, x).normalize();
    if (y.lengthSq() < 1e-20) return null;
    return {
        origin: [origin.x, origin.y, origin.z],
        x: [x.x, x.y, x.z],
        y: [y.x, y.y, y.z],
        z: [normal.x, normal.y, normal.z],
    };
}

function applySketchProfileFaceStyle(face) {
    if (!face) return;
    try {
        const sketchMat = (face.material && typeof face.material.clone === "function")
            ? face.material.clone()
            : null;
        if (!sketchMat) return;
        sketchMat.side = BREP.THREE.DoubleSide;
        sketchMat.polygonOffset = true;
        sketchMat.polygonOffsetFactor = -2;
        sketchMat.polygonOffsetUnits = 1;
        sketchMat.needsUpdate = true;
        SelectionState.setBaseMaterial(face, sketchMat, { force: false });
    } catch { /* ignore style overrides for debug sketch faces */ }
}

function buildDebugSketchGroupFromSectionSolid(sectionSolid) {
    if (!sectionSolid || typeof sectionSolid.visualize !== "function") return null;
    try { sectionSolid.visualize({ showEdges: true, authoringOnly: true }); } catch { return null; }

    const faceNames = (typeof sectionSolid.getFaceNames === "function") ? sectionSolid.getFaceNames() : [];
    if (!Array.isArray(faceNames) || faceNames.length !== 1) return null;
    const sourceFaceName = String(faceNames[0] || "");
    if (!sourceFaceName) return null;

    let faceMetadata = null;
    try {
        faceMetadata = (typeof sectionSolid.getFaceMetadata === "function")
            ? (sectionSolid.getFaceMetadata(sourceFaceName) || null)
            : null;
    } catch {
        faceMetadata = null;
    }
    if (!faceMetadata || faceMetadata.debugSketchFace !== true) return null;

    const children = Array.isArray(sectionSolid.children) ? [...sectionSolid.children] : [];
    const profileFace = children.find((child) => child?.type === "FACE" && String(child?.name || "") === sourceFaceName);
    if (!profileFace) return null;

    const group = new BREP.THREE.Group();
    group.name = sectionSolid.name || sourceFaceName;
    group.type = "SKETCH";
    group.onClick = () => {};
    group.userData = group.userData || {};

    const profileFaceName = `${group.name}:PROFILE`;
    profileFace.name = profileFaceName;
    profileFace.parentSolid = null;
    profileFace.userData = {
        ...(profileFace.userData || {}),
        faceName: profileFaceName,
        sketchFeatureId: group.name,
        sourceFaceName,
    };
    applySketchProfileFaceStyle(profileFace);
    const basis = buildSketchBasisFromFace(profileFace);
    if (basis) group.userData.sketchBasis = basis;

    const childEdges = [];
    const childVertices = [];
    for (const child of children) {
        if (!child) continue;
        if (child.type === "EDGE") {
            child.parentSolid = null;
            child.userData = child.userData || {};
            if (child.userData.faceA === sourceFaceName) child.userData.faceA = profileFaceName;
            if (child.userData.faceB === sourceFaceName) child.userData.faceB = profileFaceName;
            child.userData.sketchFeatureId = group.name;
            childEdges.push(child);
        } else if (child.type === "VERTEX") {
            child.parentSolid = null;
            child.userData = child.userData || {};
            child.userData.sketchFeatureId = group.name;
            childVertices.push(child);
        }
    }
    profileFace.edges = childEdges;
    for (const edge of childEdges) {
        if (Array.isArray(edge.faces)) {
            edge.faces = edge.faces.map((face) => (face === profileFace || String(face?.name || "") === sourceFaceName) ? profileFace : face)
                .filter(Boolean);
        } else {
            edge.faces = [profileFace];
        }
    }

    group.add(profileFace);
    for (const edge of childEdges) group.add(edge);
    for (const vertex of childVertices) group.add(vertex);
    return group;
}

export class ChamferFeature {
    [key: string]: any;

    static shortName = "CH";
    static longName = "Chamfer";
    static inputParamsSchema = inputParamsSchema;
    static showContexButton(selectedItems) {
        const items = Array.isArray(selectedItems) ? selectedItems : [];
        const edges = items
            .filter((it) => {
                const type = String(it?.type || '').toUpperCase();
                return type === 'EDGE' || type === 'FACE';
            })
            .map((it) => it?.name || it?.userData?.edgeName || it?.userData?.faceName)
            .filter((name) => !!name);
        if (!edges.length) return false;
        return { params: { edges } };
    }

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    uiFieldsTest(context) {
        const params = this.inputParams && Object.keys(this.inputParams).length > 0
            ? this.inputParams
            : context?.params || {};
        const debugMode = normalizeChamferDebugMode(params?.debug);
        const inflate = Number(params?.inflate) || 0;
        if (debugMode === CHAMFER_DEBUG_NONE && inflate === 0) {
            return ["inflate"];
        }
        return [];
    }

    async run(_partHistory) {
        const inputObjects = Array.isArray(this.inputParams.edges) ? this.inputParams.edges.filter(Boolean) : [];
        const edgeObjs = collectEdgesFromSelection(inputObjects);

        if (edgeObjs.length === 0) {
            console.warn("No edges selected for chamfer");
            return { added: [], removed: [] };
        }

        const { solid: targetSolid, solids } = resolveSingleSolidFromEdges(edgeObjs);
        if (!targetSolid) {
            if (solids.size === 0) {
                console.warn("Selected edges do not belong to any solid");
            } else {
                console.warn("Selected edges belong to multiple solids");
            }
            return { added: [], removed: [] };
        }
        const direction = String(this.inputParams.direction || "AUTO").toUpperCase();
        const distance = Number(this.inputParams.distance);
        if (!Number.isFinite(distance) || !(distance > 0)) {
            console.warn("Invalid chamfer distance supplied; aborting.", { distance: this.inputParams.distance });
            return { added: [], removed: [] };
        }

        const fid = this.inputParams.featureID;
        const debugMode = normalizeChamferDebugMode(this.inputParams.debug);
        const debugEnabled = debugMode !== CHAMFER_DEBUG_NONE && debugMode !== CHAMFER_DEBUG_ADVANCED_OPTIONS;
        const result = await targetSolid.chamfer({
            distance,
            edges: edgeObjs,
            direction,
            inflate: Number(this.inputParams.inflate),
            debug: debugEnabled,
            featureID: fid,
        });

        const { triCount, vertCount } = getSolidGeometryCounts(result);
        if (!result || triCount === 0 || vertCount === 0) {
            console.error("[ChamferFeature] Chamfer produced an empty result; skipping scene replacement.", {
                featureID: fid,
                triangleCount: triCount,
                vertexCount: vertCount,
                direction,
                distance,
                inflate: this.inputParams.inflate,
            });
            return { added: [], removed: [] };
        }

        try { result.name = targetSolid.name; } catch { /* ignore result rename failure */ }
        try { targetSolid.__removeFlag = true; } catch { /* ignore source removal flag failure */ }
        result.visualize();

        const added = [result];
        if (debugEnabled && Array.isArray(result.__debugChamferSolids)) {
            for (const dbg of result.__debugChamferSolids) {
                if (!dbg) continue;
                if (!shouldIncludeChamferDebugSolid(debugMode, dbg)) continue;
                try { dbg.name = `${fid || "CHAMFER"}_${dbg.name || "DEBUG"}`; } catch { /* ignore debug solid rename failure */ }
                const debugSketch = buildDebugSketchGroupFromSectionSolid(dbg);
                if (debugSketch) {
                    added.push(debugSketch);
                    continue;
                }
                try { dbg.visualize({ showEdges: true, authoringOnly: true }); } catch { /* ignore debug visualization failure */ }
                added.push(dbg);
            }
        }
        return { added, removed: [targetSolid] };
    }
}
