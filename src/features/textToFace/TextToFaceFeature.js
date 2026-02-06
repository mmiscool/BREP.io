import { BREP } from "../../BREP/BREP.js";
import { LineGeometry } from 'three/examples/jsm/Addons.js';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { combineBaseWithDeltaDeg } from '../../utils/xformMath.js';
import { renderTransformField } from '../../UI/featureDialogWidgets/transformField.js';
import { GOOGLE_OFL_FONTS } from '../../assets/fonts/google-ofl/catalog.js';
import { SelectionState } from '../../UI/SelectionState.js';
import NotoSansUrl from '../../assets/fonts/noto/NotoSans-Regular.ttf?url';
import NotoSerifUrl from '../../assets/fonts/noto/NotoSerif-Regular.ttf?url';
import NotoSansMonoUrl from '../../assets/fonts/noto/NotoSansMono-Regular.ttf?url';
import NotoSansDisplayUrl from '../../assets/fonts/noto/NotoSansDisplay-Regular.ttf?url';
import NotoSerifDisplayUrl from '../../assets/fonts/noto/NotoSerifDisplay-Regular.ttf?url';
import NotoSansBoldUrl from '../../assets/fonts/noto/NotoSans-Bold.ttf?url';
import NotoSansItalicUrl from '../../assets/fonts/noto/NotoSans-Italic.ttf?url';
import NotoSansBoldItalicUrl from '../../assets/fonts/noto/NotoSans-BoldItalic.ttf?url';
import NotoSerifBoldUrl from '../../assets/fonts/noto/NotoSerif-Bold.ttf?url';
import NotoSerifItalicUrl from '../../assets/fonts/noto/NotoSerif-Italic.ttf?url';
import NotoSerifBoldItalicUrl from '../../assets/fonts/noto/NotoSerif-BoldItalic.ttf?url';
import NotoSansMonoBoldUrl from '../../assets/fonts/noto/NotoSansMono-Bold.ttf?url';
import DejaVuSansUrl from '../../assets/fonts/dejavu/DejaVuSans.ttf?url';
import DejaVuSansBoldUrl from '../../assets/fonts/dejavu/DejaVuSans-Bold.ttf?url';
import DejaVuSerifUrl from '../../assets/fonts/dejavu/DejaVuSerif.ttf?url';
import DejaVuSerifBoldUrl from '../../assets/fonts/dejavu/DejaVuSerif-Bold.ttf?url';
import DejaVuSansMonoUrl from '../../assets/fonts/dejavu/DejaVuSansMono.ttf?url';
import DejaVuSansMonoBoldUrl from '../../assets/fonts/dejavu/DejaVuSansMono-Bold.ttf?url';
import DejaVuSansMonoObliqueUrl from '../../assets/fonts/dejavu/DejaVuSansMono-Oblique.ttf?url';
import DejaVuSansMonoBoldObliqueUrl from '../../assets/fonts/dejavu/DejaVuSansMono-BoldOblique.ttf?url';
import LiberationSansUrl from '../../assets/fonts/liberation/LiberationSans-Regular.ttf?url';
import LiberationSansBoldUrl from '../../assets/fonts/liberation/LiberationSans-Bold.ttf?url';
import LiberationSansItalicUrl from '../../assets/fonts/liberation/LiberationSans-Italic.ttf?url';
import LiberationSansBoldItalicUrl from '../../assets/fonts/liberation/LiberationSans-BoldItalic.ttf?url';
import LiberationSansNarrowUrl from '../../assets/fonts/liberation/LiberationSansNarrow-Regular.ttf?url';
import LiberationSansNarrowBoldUrl from '../../assets/fonts/liberation/LiberationSansNarrow-Bold.ttf?url';
import LiberationSerifUrl from '../../assets/fonts/liberation/LiberationSerif-Regular.ttf?url';
import LiberationSerifBoldUrl from '../../assets/fonts/liberation/LiberationSerif-Bold.ttf?url';
import LiberationSerifItalicUrl from '../../assets/fonts/liberation/LiberationSerif-Italic.ttf?url';
import LiberationSerifBoldItalicUrl from '../../assets/fonts/liberation/LiberationSerif-BoldItalic.ttf?url';
import LiberationMonoUrl from '../../assets/fonts/liberation/LiberationMono-Regular.ttf?url';
import LiberationMonoBoldUrl from '../../assets/fonts/liberation/LiberationMono-Bold.ttf?url';
import LiberationMonoItalicUrl from '../../assets/fonts/liberation/LiberationMono-Italic.ttf?url';
import LiberationMonoBoldItalicUrl from '../../assets/fonts/liberation/LiberationMono-BoldItalic.ttf?url';
import IbmPlexSansUrl from '../../assets/fonts/ibm-plex/IBMPlexSans-Regular.ttf?url';
import IbmPlexSansBoldUrl from '../../assets/fonts/ibm-plex/IBMPlexSans-Bold.ttf?url';
import IbmPlexSansItalicUrl from '../../assets/fonts/ibm-plex/IBMPlexSans-Italic.ttf?url';
import IbmPlexSansBoldItalicUrl from '../../assets/fonts/ibm-plex/IBMPlexSans-BoldItalic.ttf?url';
import IbmPlexSansCondensedUrl from '../../assets/fonts/ibm-plex/IBMPlexSansCondensed-Regular.ttf?url';
import IbmPlexSansCondensedBoldUrl from '../../assets/fonts/ibm-plex/IBMPlexSansCondensed-Bold.ttf?url';
import IbmPlexSerifUrl from '../../assets/fonts/ibm-plex/IBMPlexSerif-Regular.ttf?url';
import IbmPlexSerifBoldUrl from '../../assets/fonts/ibm-plex/IBMPlexSerif-Bold.ttf?url';
import IbmPlexSerifItalicUrl from '../../assets/fonts/ibm-plex/IBMPlexSerif-Italic.ttf?url';
import IbmPlexSerifBoldItalicUrl from '../../assets/fonts/ibm-plex/IBMPlexSerif-BoldItalic.ttf?url';
import IbmPlexMonoUrl from '../../assets/fonts/ibm-plex/IBMPlexMono-Regular.ttf?url';
import IbmPlexMonoBoldUrl from '../../assets/fonts/ibm-plex/IBMPlexMono-Bold.ttf?url';
import IbmPlexMonoItalicUrl from '../../assets/fonts/ibm-plex/IBMPlexMono-Italic.ttf?url';
import IbmPlexMonoBoldItalicUrl from '../../assets/fonts/ibm-plex/IBMPlexMono-BoldItalic.ttf?url';
import HackUrl from '../../assets/fonts/hack/Hack-Regular.ttf?url';
import HackBoldUrl from '../../assets/fonts/hack/Hack-Bold.ttf?url';
import HackItalicUrl from '../../assets/fonts/hack/Hack-Italic.ttf?url';
import HackBoldItalicUrl from '../../assets/fonts/hack/Hack-BoldItalic.ttf?url';
import UbuntuSansUrl from '../../assets/fonts/ubuntu/Ubuntu-R.ttf?url';
import UbuntuBoldUrl from '../../assets/fonts/ubuntu/Ubuntu-B.ttf?url';
import UbuntuLightUrl from '../../assets/fonts/ubuntu/Ubuntu-L.ttf?url';
import UbuntuBoldItalicUrl from '../../assets/fonts/ubuntu/Ubuntu-BI.ttf?url';
import UbuntuLightItalicUrl from '../../assets/fonts/ubuntu/Ubuntu-LI.ttf?url';
import UbuntuMediumUrl from '../../assets/fonts/ubuntu/Ubuntu-M.ttf?url';
import UbuntuMediumItalicUrl from '../../assets/fonts/ubuntu/Ubuntu-MI.ttf?url';
import UbuntuRegularItalicUrl from '../../assets/fonts/ubuntu/Ubuntu-RI.ttf?url';
import UbuntuThinUrl from '../../assets/fonts/ubuntu/Ubuntu-Th.ttf?url';
import UbuntuCondensedUrl from '../../assets/fonts/ubuntu/Ubuntu-C.ttf?url';
import UbuntuMonoUrl from '../../assets/fonts/ubuntu/UbuntuMono-R.ttf?url';
import UbuntuMonoBoldUrl from '../../assets/fonts/ubuntu/UbuntuMono-B.ttf?url';
import UbuntuMonoBoldItalicUrl from '../../assets/fonts/ubuntu/UbuntuMono-BI.ttf?url';
import UbuntuMonoItalicUrl from '../../assets/fonts/ubuntu/UbuntuMono-RI.ttf?url';
import LibreBarcode39ExtendedUrl from '../../assets/fonts/libre-barcode/LibreBarcode39Extended-Regular.ttf?url';
import LibreBarcode39ExtendedTextUrl from '../../assets/fonts/libre-barcode/LibreBarcode39ExtendedText-Regular.ttf?url';
import LibreBarcode39Url from '../../assets/fonts/libre-barcode/LibreBarcode39-Regular.ttf?url';
import LibreBarcode39TextUrl from '../../assets/fonts/libre-barcode/LibreBarcode39Text-Regular.ttf?url';
import LibreBarcode128Url from '../../assets/fonts/libre-barcode/LibreBarcode128-Regular.ttf?url';
import LibreBarcode128TextUrl from '../../assets/fonts/libre-barcode/LibreBarcode128Text-Regular.ttf?url';
import LibreBarcodeEan13TextUrl from '../../assets/fonts/libre-barcode/LibreBarcodeEAN13Text-Regular.ttf?url';

const THREE = BREP.THREE;

const dedupeFonts = (fonts) => {
  const seen = new Set();
  return fonts.filter((font) => {
    const id = font?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const BASE_FONT_CATALOG = [
  { id: 'Noto Sans', url: NotoSansUrl },
  { id: 'Noto Sans Bold', url: NotoSansBoldUrl },
  { id: 'Noto Sans Italic', url: NotoSansItalicUrl },
  { id: 'Noto Sans Bold Italic', url: NotoSansBoldItalicUrl },
  { id: 'Noto Serif', url: NotoSerifUrl },
  { id: 'Noto Serif Bold', url: NotoSerifBoldUrl },
  { id: 'Noto Serif Italic', url: NotoSerifItalicUrl },
  { id: 'Noto Serif Bold Italic', url: NotoSerifBoldItalicUrl },
  { id: 'Noto Sans Mono', url: NotoSansMonoUrl },
  { id: 'Noto Sans Mono Bold', url: NotoSansMonoBoldUrl },
  { id: 'Noto Sans Display', url: NotoSansDisplayUrl },
  { id: 'Noto Serif Display', url: NotoSerifDisplayUrl },
  { id: 'DejaVu Sans', url: DejaVuSansUrl },
  { id: 'DejaVu Sans Bold', url: DejaVuSansBoldUrl },
  { id: 'DejaVu Serif', url: DejaVuSerifUrl },
  { id: 'DejaVu Serif Bold', url: DejaVuSerifBoldUrl },
  { id: 'DejaVu Sans Mono', url: DejaVuSansMonoUrl },
  { id: 'DejaVu Sans Mono Bold', url: DejaVuSansMonoBoldUrl },
  { id: 'DejaVu Sans Mono Oblique', url: DejaVuSansMonoObliqueUrl },
  { id: 'DejaVu Sans Mono Bold Oblique', url: DejaVuSansMonoBoldObliqueUrl },
  { id: 'Liberation Sans', url: LiberationSansUrl },
  { id: 'Liberation Sans Bold', url: LiberationSansBoldUrl },
  { id: 'Liberation Sans Italic', url: LiberationSansItalicUrl },
  { id: 'Liberation Sans Bold Italic', url: LiberationSansBoldItalicUrl },
  { id: 'Liberation Sans Narrow', url: LiberationSansNarrowUrl },
  { id: 'Liberation Sans Narrow Bold', url: LiberationSansNarrowBoldUrl },
  { id: 'Liberation Serif', url: LiberationSerifUrl },
  { id: 'Liberation Serif Bold', url: LiberationSerifBoldUrl },
  { id: 'Liberation Serif Italic', url: LiberationSerifItalicUrl },
  { id: 'Liberation Serif Bold Italic', url: LiberationSerifBoldItalicUrl },
  { id: 'Liberation Mono', url: LiberationMonoUrl },
  { id: 'Liberation Mono Bold', url: LiberationMonoBoldUrl },
  { id: 'Liberation Mono Italic', url: LiberationMonoItalicUrl },
  { id: 'Liberation Mono Bold Italic', url: LiberationMonoBoldItalicUrl },
  { id: 'IBM Plex Sans', url: IbmPlexSansUrl },
  { id: 'IBM Plex Sans Bold', url: IbmPlexSansBoldUrl },
  { id: 'IBM Plex Sans Italic', url: IbmPlexSansItalicUrl },
  { id: 'IBM Plex Sans Bold Italic', url: IbmPlexSansBoldItalicUrl },
  { id: 'IBM Plex Sans Condensed', url: IbmPlexSansCondensedUrl },
  { id: 'IBM Plex Sans Condensed Bold', url: IbmPlexSansCondensedBoldUrl },
  { id: 'IBM Plex Serif', url: IbmPlexSerifUrl },
  { id: 'IBM Plex Serif Bold', url: IbmPlexSerifBoldUrl },
  { id: 'IBM Plex Serif Italic', url: IbmPlexSerifItalicUrl },
  { id: 'IBM Plex Serif Bold Italic', url: IbmPlexSerifBoldItalicUrl },
  { id: 'IBM Plex Mono', url: IbmPlexMonoUrl },
  { id: 'IBM Plex Mono Bold', url: IbmPlexMonoBoldUrl },
  { id: 'IBM Plex Mono Italic', url: IbmPlexMonoItalicUrl },
  { id: 'IBM Plex Mono Bold Italic', url: IbmPlexMonoBoldItalicUrl },
  { id: 'Hack', url: HackUrl },
  { id: 'Hack Bold', url: HackBoldUrl },
  { id: 'Hack Italic', url: HackItalicUrl },
  { id: 'Hack Bold Italic', url: HackBoldItalicUrl },
  { id: 'Ubuntu', url: UbuntuSansUrl },
  { id: 'Ubuntu Italic', url: UbuntuRegularItalicUrl },
  { id: 'Ubuntu Bold', url: UbuntuBoldUrl },
  { id: 'Ubuntu Bold Italic', url: UbuntuBoldItalicUrl },
  { id: 'Ubuntu Light', url: UbuntuLightUrl },
  { id: 'Ubuntu Light Italic', url: UbuntuLightItalicUrl },
  { id: 'Ubuntu Medium', url: UbuntuMediumUrl },
  { id: 'Ubuntu Medium Italic', url: UbuntuMediumItalicUrl },
  { id: 'Ubuntu Thin', url: UbuntuThinUrl },
  { id: 'Ubuntu Condensed', url: UbuntuCondensedUrl },
  { id: 'Ubuntu Mono', url: UbuntuMonoUrl },
  { id: 'Ubuntu Mono Italic', url: UbuntuMonoItalicUrl },
  { id: 'Ubuntu Mono Bold', url: UbuntuMonoBoldUrl },
  { id: 'Ubuntu Mono Bold Italic', url: UbuntuMonoBoldItalicUrl },
  { id: 'Libre Barcode 39', url: LibreBarcode39Url },
  { id: 'Libre Barcode 39 Text', url: LibreBarcode39TextUrl },
  { id: 'Libre Barcode 39 Extended', url: LibreBarcode39ExtendedUrl },
  { id: 'Libre Barcode 39 Extended Text', url: LibreBarcode39ExtendedTextUrl },
  { id: 'Libre Barcode 128', url: LibreBarcode128Url },
  { id: 'Libre Barcode 128 Text', url: LibreBarcode128TextUrl },
  { id: 'Libre Barcode EAN13 Text', url: LibreBarcodeEan13TextUrl },
];

const FONT_CATALOG = dedupeFonts([...BASE_FONT_CATALOG, ...GOOGLE_OFL_FONTS]);

const DEFAULT_TRANSFORM = {
  position: [0, 0, 0],
  rotationEuler: [0, 0, 0],
  scale: [1, 1, 1],
};

function renderPlacementTransformField({ ui, key, def, id, controlWrap }) {
  const valueAdapter = {
    activationKey: key,
    stepId: (ui?.params?.featureID != null) ? String(ui.params.featureID) : (ui?.params?.id != null ? String(ui.params.id) : null),
    get: () => {
      const current = ui?.params?.[key];
      return sanitizeTransform(current || def?.default_value || DEFAULT_TRANSFORM);
    },
    set: (next) => {
      if (!ui || !ui.params) return;
      ui.params[key] = sanitizeTransform(next);
    },
    emit: (value) => {
      if (!ui) return;
      ui._emitParamsChange(key, value);
    },
    getBase: () => {
      const ph = ui?.options?.partHistory || ui?.options?.viewer?.partHistory || null;
      const basis = getPlacementBasis(ui?.params?.placementPlane, ph);
      return basisToBaseTransform(basis);
    },
  };

  return renderTransformField({ ui, key, def, id, controlWrap, valueAdapter });
}

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "unique identifier for the text feature",
  },
  text: {
    type: "string",
    default_value: "TEXT",
    hint: "Text string to convert into a face",
  },
  font: {
    type: "options",
    options: FONT_CATALOG.map((f) => f.id),
    default_value: FONT_CATALOG[0]?.id || "Noto Sans",
    hint: "Select a built-in font",
  },
  fontFile: {
    type: "file",
    default_value: "",
    label: "Custom Font (TTF/OTF)",
    accept: ".ttf,.otf,font/ttf,font/otf",
    hint: "Optional: upload a font to override the built-in selection",
  },
  textHeight: {
    type: "number",
    default_value: 10,
    hint: "Text height in world units",
  },
  flipDirectionVertical: {
    type: "boolean",
    default_value: false,
    label: "Flip direction vertical",
    hint: "Flip the text vertically within the sketch plane",
  },
  flipDirectionHorizontal: {
    type: "boolean",
    default_value: false,
    label: "Flip direction horizontal",
    hint: "Flip the text horizontally within the sketch plane",
  },
  curveResolution: {
    type: "number",
    default_value: 12,
    hint: "Curve resolution (segments per curve)",
  },
  placementPlane: {
    type: "reference_selection",
    selectionFilter: ["PLANE", "FACE"],
    multiple: false,
    default_value: null,
    hint: "Select a plane or face to place the text",
  },
  transform: {
    type: "transform",
    default_value: DEFAULT_TRANSFORM,
    label: "Placement (use gizmo)",
    hint: "Use the gizmo to position/rotate the text relative to the selected face/plane",
    renderWidget: renderPlacementTransformField,
  },
};

const fontCache = new Map();
const ttfLoader = new TTFLoader();

export class TextToFaceFeature {
  static shortName = "TEXT";
  static longName = "Text to Face";
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const rawText = (this.inputParams?.text != null) ? String(this.inputParams.text) : '';
    const text = rawText.trim();
    if (!text) return { added: [], removed: [] };

    const heightRaw = Number(this.inputParams?.textHeight ?? 10);
    const textHeight = Number.isFinite(heightRaw) ? Math.abs(heightRaw) : 10;
    if (!(textHeight > 0)) return { added: [], removed: [] };

    const curveRes = Math.max(4, Math.floor(Number(this.inputParams?.curveResolution) || 12));

    let font;
    try {
      font = await resolveFont(this.inputParams || {});
    } catch (e) {
      console.warn('[TEXT] Failed to load font:', e?.message || e);
      return { added: [], removed: [] };
    }
    if (!font) return { added: [], removed: [] };

    const shapes = font.generateShapes(text, 1);
    if (!Array.isArray(shapes) || !shapes.length) return { added: [], removed: [] };

    const { groups, bounds } = shapesToGroups(shapes, curveRes);
    if (!groups.length || !bounds) return { added: [], removed: [] };

    const height = bounds.maxY - bounds.minY;
    if (!(height > 0)) return { added: [], removed: [] };

    const scale = textHeight / height;
    const cx = 0.5 * (bounds.minX + bounds.maxX);
    const cy = 0.5 * (bounds.minY + bounds.maxY);

    const flipVertical = !!(this.inputParams?.flipDirectionVertical ?? this.inputParams?.flipDirection ?? false);
    const flipHorizontal = !!this.inputParams?.flipDirectionHorizontal;

    const scaledGroups = groups
      .map((g) => scaleGroup(g, scale, cx, cy))
      .filter((g) => g && g.outer && g.outer.length >= 3)
      .map((g) => (flipVertical || flipHorizontal) ? flipGroup(g, flipHorizontal, flipVertical) : g);

    if (!scaledGroups.length) return { added: [], removed: [] };

    const basis = getPlacementBasis(this.inputParams?.placementPlane, partHistory);
    const base = basisToBaseTransform(basis);
    const delta = sanitizeTransform(this.inputParams?.transform);
    const M = combineBaseWithDeltaDeg(base, delta, THREE);

    const sketchBasis = computeSketchBasis(base, delta);
    const edgeBias = (() => {
      const zb = new THREE.Vector3().fromArray(sketchBasis?.z || [0, 0, 1]);
      if (zb.lengthSq() < 1e-12) zb.set(0, 0, 1);
      return zb.normalize().multiplyScalar(1e-4);
    })();
    const applySketchEdgeStyle = (edge) => {
      if (!edge) return;
      edge.renderOrder = 2;
      try {
        const baseMat = edge.material;
        const sketchMat = (baseMat && typeof baseMat.clone === 'function') ? baseMat.clone() : null;
        if (sketchMat) {
          sketchMat.depthTest = false;
          sketchMat.depthWrite = false;
          sketchMat.needsUpdate = true;
          SelectionState.setBaseMaterial(edge, sketchMat);
        }
      } catch { }
    };

    const sceneGroup = new THREE.Group();
    const featureId = (this.inputParams?.featureID != null && String(this.inputParams.featureID).length)
      ? String(this.inputParams.featureID)
      : 'TEXT_Sketch';
    const edgeNamePrefix = featureId ? `${featureId}:` : '';
    sceneGroup.name = featureId;
    sceneGroup.type = 'SKETCH';
    sceneGroup.onClick = () => { };
    sceneGroup.userData = sceneGroup.userData || {};
    sceneGroup.userData.sketchBasis = sketchBasis;

    const triPositions = [];
    const boundaryLoopsWorld = [];
    const profileGroups = [];
    const edges = [];

    const Q = 1e-6;
    const q = (n) => (Math.abs(n) < Q ? 0 : Math.round(n / Q) * Q);
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, 0).applyMatrix4(M);
      return [q(v.x), q(v.y), q(v.z)];
    };

    let edgeIdx = 0;
    let loopIdx = 0;

    for (const group of scaledGroups) {
      let contour = ensureOpen(group.outer);
      if (contour.length < 3) continue;
      let holes = (group.holes || []).map((h) => ensureOpen(h)).filter((h) => h.length >= 3);

      // Orient for triangulation (outer CW, holes CCW) to match image-to-face behavior.
      if (signedArea(closeLoop(contour)) > 0) contour = contour.slice().reverse();
      holes = holes.map((h) => (signedArea(closeLoop(h)) < 0 ? h.slice().reverse() : h));

      const contourV2 = contour.map((p) => new THREE.Vector2(p[0], p[1]));
      const holesV2 = holes.map((arr) => arr.map((p) => new THREE.Vector2(p[0], p[1])));
      const tris = THREE.ShapeUtils.triangulateShape(contourV2, holesV2);

      const allPts = contour.concat(...holes);
      for (const t of tris) {
        const a = allPts[t[0]]; const b = allPts[t[1]]; const c = allPts[t[2]];
        triPositions.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0);
      }

      const contourClosed = closeLoop(contour);
      const contourClosedW = contourClosed.map(([x, y]) => toW(x, y));
      boundaryLoopsWorld.push({ pts: contourClosedW, isHole: false });
      const holesClosed = holes.map((h) => closeLoop(h));
      const holesClosedW = holesClosed.map((h) => h.map(([x, y]) => toW(x, y)));
      for (const hw of holesClosedW) boundaryLoopsWorld.push({ pts: hw, isHole: true });

      profileGroups.push({
        contour2D: contourClosed.slice(0, -1),
        holes2D: holesClosed.map((h) => h.slice(0, -1)),
        contourW: contourClosedW.slice(0, -1),
        holesW: holesClosedW.map((h) => h.slice(0, -1)),
      });

      addEdgeFromLoop(edges, contourClosedW, edgeNamePrefix, edgeIdx++, loopIdx++, false, edgeBias, applySketchEdgeStyle);
      for (const hw of holesClosedW) {
        addEdgeFromLoop(edges, hw, edgeNamePrefix, edgeIdx++, loopIdx++, true, edgeBias, applySketchEdgeStyle);
      }
    }

    if (!triPositions.length) return { added: [], removed: [] };

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(triPositions, 3));
    geom.applyMatrix4(M);
    const posAttr = geom.getAttribute('position');
    if (posAttr && posAttr.itemSize === 3) {
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(i, q(posAttr.getX(i)), q(posAttr.getY(i)), q(posAttr.getZ(i)));
      }
      posAttr.needsUpdate = true;
    }
    geom.computeVertexNormals();
    geom.computeBoundingSphere();

    const face = new BREP.Face(geom);
    face.type = 'FACE';
    face.name = `${edgeNamePrefix}PROFILE`;
    face.userData.faceName = face.name;
    face.userData.boundaryLoopsWorld = boundaryLoopsWorld;
    face.userData.profileGroups = profileGroups;
    try { face.edges = edges.slice(); } catch { }
    try {
      const baseMat = face.material;
      const sketchMat = (baseMat && typeof baseMat.clone === 'function') ? baseMat.clone() : null;
      if (sketchMat) {
        sketchMat.side = THREE.DoubleSide;
        sketchMat.polygonOffset = true;
        sketchMat.polygonOffsetFactor = -2;
        sketchMat.polygonOffsetUnits = 1;
        sketchMat.needsUpdate = true;
        SelectionState.setBaseMaterial(face, sketchMat);
      }
    } catch { }

    sceneGroup.add(face);
    for (const e of edges) sceneGroup.add(e);

    return { added: [sceneGroup], removed: [] };
  }
}

function addEdgeFromLoop(edges, loopWorld, edgeNamePrefix, edgeIdx, loopIndex, isHole, edgeBias, applySketchEdgeStyle) {
  if (!Array.isArray(loopWorld) || loopWorld.length < 2) return;
  const positions = [];
  const worldPts = [];
  for (const p of loopWorld) {
    if (!Array.isArray(p) || p.length < 3) continue;
    positions.push(
      p[0] + (edgeBias?.x || 0),
      p[1] + (edgeBias?.y || 0),
      p[2] + (edgeBias?.z || 0)
    );
    worldPts.push([p[0], p[1], p[2]]);
  }
  if (positions.length < 6) return;
  const lg = new LineGeometry();
  lg.setPositions(positions);
  try { lg.computeBoundingSphere(); } catch { }
  const e = new BREP.Edge(lg);
  e.type = 'EDGE';
  e.name = `${edgeNamePrefix}L${edgeIdx}`;
  e.closedLoop = false;
  e.userData = {
    polylineLocal: worldPts,
    polylineWorld: true,
    isHole: !!isHole,
    loopIndex,
    segmentIndex: 0,
  };
  if (typeof applySketchEdgeStyle === 'function') applySketchEdgeStyle(e);
  edges.push(e);
}

function sanitizeTransform(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};
  const clone3 = (arr, fallback) => {
    const out = Array.isArray(arr) ? arr.slice(0, 3) : [];
    while (out.length < 3) out.push(fallback);
    return out.map((v) => (Number.isFinite(Number(v)) ? Number(v) : fallback));
  };
  return {
    position: clone3(obj.position, 0),
    rotationEuler: clone3(obj.rotationEuler, 0),
    scale: clone3(obj.scale, 1),
  };
}

function shapesToGroups(shapes, curveSegments) {
  const groups = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const updateBounds = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
  };

  for (const shape of shapes) {
    if (!shape) continue;
    const outerRaw = shape.getPoints(curveSegments) || [];
    const outer = toPointArray(outerRaw);
    if (outer.length < 2) continue;
    const holes = (shape.holes || [])
      .map((h) => toPointArray(h.getPoints(curveSegments) || []))
      .filter((h) => h.length >= 2);

    for (const p of outer) updateBounds(p[0], p[1]);
    for (const h of holes) for (const p of h) updateBounds(p[0], p[1]);

    groups.push({ outer, holes });
  }

  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
    return { groups: [], bounds: null };
  }

  return { groups, bounds };
}

function toPointArray(points) {
  const out = [];
  for (const p of points) {
    if (!p) continue;
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push([x, y]);
  }
  return dedupeConsecutive(out);
}

function scaleGroup(group, scale, cx, cy) {
  if (!group || !Array.isArray(group.outer)) return null;
  const scaleLoop = (loop) => loop.map((p) => [(p[0] - cx) * scale, (p[1] - cy) * scale]);
  return {
    outer: scaleLoop(group.outer),
    holes: Array.isArray(group.holes) ? group.holes.map(scaleLoop) : [],
  };
}

function flipGroup(group, flipX, flipY) {
  if (!group || !Array.isArray(group.outer)) return group;
  const fx = !!flipX;
  const fy = !!flipY;
  const flipLoop = (loop) => loop.map((p) => [fx ? -p[0] : p[0], fy ? -p[1] : p[1]]);
  return {
    outer: flipLoop(group.outer),
    holes: Array.isArray(group.holes) ? group.holes.map(flipLoop) : [],
  };
}

function closeLoop(loop) {
  const arr = ensureOpen(loop);
  if (arr.length < 2) return arr;
  const f = arr[0];
  const l = arr[arr.length - 1];
  if (!closePt(f, l)) arr.push([f[0], f[1]]);
  return arr;
}

function ensureOpen(loop) {
  const arr = dedupeConsecutive(Array.isArray(loop) ? loop.map((p) => [p[0], p[1]]) : []);
  if (arr.length < 2) return arr;
  const f = arr[0];
  const l = arr[arr.length - 1];
  if (closePt(f, l)) arr.pop();
  return arr;
}

function dedupeConsecutive(arr) {
  const out = [];
  let prev = null;
  for (const p of arr || []) {
    if (!prev || !closePt(prev, p)) {
      out.push([p[0], p[1]]);
      prev = p;
    }
  }
  return out;
}

function closePt(a, b, eps = 1e-7) {
  return a && b && Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length - 1; i++) {
    const p = loop[i];
    const q = loop[i + 1];
    a += (p[0] * q[1] - q[0] * p[1]);
  }
  return 0.5 * a;
}

function getPlacementBasis(ref, partHistory) {
  const x = new THREE.Vector3(1, 0, 0);
  const y = new THREE.Vector3(0, 1, 0);
  const z = new THREE.Vector3(0, 0, 1);
  const origin = new THREE.Vector3(0, 0, 0);

  let refObj = null;
  try {
    if (Array.isArray(ref)) refObj = ref[0] || null;
    else if (ref && typeof ref === 'object') refObj = ref;
    else if (ref) refObj = partHistory?.scene?.getObjectByName(ref);
  } catch { }

  if (refObj) {
    try { refObj.updateWorldMatrix(true, true); } catch { }
    try {
      const g = refObj.geometry;
      if (g) {
        const bs = g.boundingSphere || (g.computeBoundingSphere(), g.boundingSphere);
        if (bs) origin.copy(refObj.localToWorld(bs.center.clone()));
        else origin.copy(refObj.getWorldPosition(new THREE.Vector3()));
      } else origin.copy(refObj.getWorldPosition(new THREE.Vector3()));
    } catch { origin.copy(refObj.getWorldPosition(new THREE.Vector3())); }

    let n = null;
    if (refObj.type === 'FACE' && typeof refObj.getAverageNormal === 'function') {
      try { n = refObj.getAverageNormal().normalize(); } catch { n = null; }
    }
    if (!n) {
      try { n = new THREE.Vector3(0, 0, 1).applyQuaternion(refObj.getWorldQuaternion(new THREE.Quaternion())).normalize(); } catch { n = new THREE.Vector3(0, 0, 1); }
    }
    const worldUp = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Vector3();
    const zx = Math.abs(n.dot(worldUp)) > 0.9 ? new THREE.Vector3(1, 0, 0) : worldUp;
    x.copy(tmp.crossVectors(zx, n).normalize());
    y.copy(tmp.crossVectors(n, x).normalize());
    z.copy(n);
  }

  return { origin: [origin.x, origin.y, origin.z], x: [x.x, x.y, x.z], y: [y.x, y.y, y.z], z: [z.x, z.y, z.z] };
}

function basisToBaseTransform(basis) {
  const origin = Array.isArray(basis?.origin) ? basis.origin : [0, 0, 0];
  const x = new THREE.Vector3().fromArray(basis?.x || [1, 0, 0]);
  const y = new THREE.Vector3().fromArray(basis?.y || [0, 1, 0]);
  const z = new THREE.Vector3().fromArray(basis?.z || [0, 0, 1]);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return {
    position: [origin[0] || 0, origin[1] || 0, origin[2] || 0],
    quaternion: [q.x, q.y, q.z, q.w],
    scale: [1, 1, 1],
  };
}

function computeSketchBasis(base, delta) {
  const basePos = new THREE.Vector3(
    Number(base?.position?.[0] || 0),
    Number(base?.position?.[1] || 0),
    Number(base?.position?.[2] || 0),
  );
  const deltaPos = new THREE.Vector3(
    Number(delta?.position?.[0] || 0),
    Number(delta?.position?.[1] || 0),
    Number(delta?.position?.[2] || 0),
  );
  const baseQuat = new THREE.Quaternion().fromArray(base?.quaternion || [0, 0, 0, 1]);
  const deltaQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(Number(delta?.rotationEuler?.[0] || 0)),
    THREE.MathUtils.degToRad(Number(delta?.rotationEuler?.[1] || 0)),
    THREE.MathUtils.degToRad(Number(delta?.rotationEuler?.[2] || 0)),
    'XYZ'
  ));
  const absQuat = baseQuat.clone().multiply(deltaQuat);
  const origin = basePos.add(deltaPos);
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(absQuat);
  const y = new THREE.Vector3(0, 1, 0).applyQuaternion(absQuat);
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(absQuat);

  return {
    origin: [origin.x, origin.y, origin.z],
    x: [x.x, x.y, x.z],
    y: [y.x, y.y, y.z],
    z: [z.x, z.y, z.z],
  };
}

async function resolveFont(params) {
  const fontFile = (params && typeof params.fontFile === 'string') ? params.fontFile.trim() : '';
  if (fontFile) {
    return loadFontFromSource(fontFile, { type: 'data' });
  }

  const fontId = (params && typeof params.font === 'string') ? params.font : null;
  const entry = FONT_CATALOG.find((f) => f.id === fontId) || FONT_CATALOG[0];
  if (!entry || !entry.url) throw new Error('No font available');
  return loadFontFromSource(entry.url, { type: 'url' });
}

async function loadFontFromSource(source, { type }) {
  const key = `${type}:${source}`;
  if (fontCache.has(key)) return fontCache.get(key);

  const promise = (async () => {
    let buffer = null;
    if (type === 'data') {
      buffer = dataUrlToArrayBuffer(source);
    } else {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading font`);
      buffer = await res.arrayBuffer();
    }
    if (!buffer) throw new Error('Font buffer unavailable');
    const json = ttfLoader.parse(buffer);
    return new Font(json);
  })();

  fontCache.set(key, promise);
  try {
    return await promise;
  } catch (e) {
    fontCache.delete(key);
    throw e;
  }
}

function dataUrlToArrayBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1);
  try {
    if (typeof atob === 'function') {
      const binary = atob(b64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
      return bytes.buffer;
    }
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(b64, 'base64');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  } catch { }
  return null;
}
