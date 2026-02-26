// ViewCube.js
// Minimal view cube overlay rendered with scissor viewport.
// - Syncs orientation with a target camera
// - Click faces to reorient target camera to axis-aligned views

import * as THREE from 'three';

export class ViewCube {
  /**
   * @param {Object} opts
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {THREE.Camera} opts.targetCamera
   * @param {Object} [opts.controls] - ArcballControls (optional)
   * @param {number} [opts.size=110] - widget size in pixels
   * @param {number} [opts.margin=10] - margin from bottom-right
   */
  constructor({ renderer, targetCamera, controls = null, size = 110, margin = 10, colors = null } = {}) {
    if (!renderer || !targetCamera) throw new Error('ViewCube requires { renderer, targetCamera }');
    this.renderer = renderer;
    this.targetCamera = targetCamera;
    this.controls = controls;
    this.size = size;
    this.margin = margin;

    // Scene + camera for the cube
    this.scene = new THREE.Scene();
    this.scene.autoUpdate = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    // Root that mirrors target camera orientation
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // Sub-group for picking faces
    this.pickGroup = new THREE.Group();
    this.root.add(this.pickGroup);

    // Small helpers for color + label texture
    const hexToRgb = (hex) => ({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 });
    // Convert a CSS color or hex-int to a normalized css hex string and hex-int
    const toCssAndHex = (input) => {
      let css = '#ffffff';
      if (typeof input === 'number') {
        css = `#${input.toString(16).padStart(6, '0')}`;
      } else if (typeof input === 'string') {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 1;
          const ctx2 = c.getContext('2d');
          ctx2.fillStyle = '#000';
          ctx2.fillStyle = input; // lets canvas parse CSS colors
          const val = ctx2.fillStyle; // canonical string
          if (typeof val === 'string') {
            if (val.startsWith('#')) {
              // #rgb, #rrggbb, or #rrggbbaa
              let hex = val.replace('#', '');
              if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
              else if (hex.length === 8) hex = hex.slice(0, 6);
              css = `#${hex.toLowerCase()}`;
            } else {
              // rgb/rgba(r,g,b[,a])
              const m = val.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\)/i);
              if (m) {
                const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
                const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
                const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
                const hex = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
                css = `#${hex}`;
              }
            }
          }
        } catch { }
      }
      const hex = parseInt(css.slice(1), 16) & 0xffffff;
      return { css, hex };
    };
    const mixColors = (a, b, t = 0.5) => {
      const A = hexToRgb(toCssAndHex(a).hex);
      const B = hexToRgb(toCssAndHex(b).hex);
      const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5));
      const r = Math.round(A.r + (B.r - A.r) * u);
      const g = Math.round(A.g + (B.g - A.g) * u);
      const b2 = Math.round(A.b + (B.b - A.b) * u);
      const hex = ((r << 16) | (g << 8) | b2).toString(16).padStart(6, '0');
      return `#${hex}`;
    };
    const readCssVar = (name, fallback) => {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
        const root = window.getComputedStyle(document.documentElement);
        const value = root && root.getPropertyValue ? root.getPropertyValue(name) : '';
        const clean = typeof value === 'string' ? value.trim() : '';
        return clean || fallback;
      } catch {
        return fallback;
      }
    };

    // Shared UI tokens so the cube blends into the CAD interface.
    const THEME_BG_ELEV = readCssVar('--bg-elev', '#12141b');
    const THEME_BORDER = readCssVar('--border', '#262b36');
    const THEME_TEXT = readCssVar('--text', '#e6e6e6');
    const THEME_ACCENT = readCssVar('--accent', '#6ea8fe');
    const FACE_HOVER_ACCENT = (colors && colors.hoverFace) || mixColors(THEME_ACCENT, '#ffffff', 0.62);

    // Create a texture with the face color and imprinted label
    const makeFaceTexture = (text, faceColor, hovered = false) => {
      const size = 512; // square to avoid distortion on a square plane
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Background fill
      const { css: faceCss } = toCssAndHex(faceColor);
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, hovered ? mixColors(faceCss, '#ffffff', 0.14) : mixColors(faceCss, '#ffffff', 0.06));
      grad.addColorStop(1, hovered ? mixColors(faceCss, THEME_BG_ELEV, 0.20) : mixColors(faceCss, THEME_BG_ELEV, 0.26));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = hovered ? mixColors(FACE_HOVER_ACCENT, faceCss, 0.24) : mixColors(faceCss, THEME_BORDER, 0.45);
      ctx.lineWidth = 18;
      ctx.strokeRect(9, 9, size - 18, size - 18);
      // Imprinted text effect: shadow + highlight to look engraved
      const fontSize = 118;
      ctx.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx = size / 2, cy = size / 2;
      // Soft text depth for readability at small sizes
      ctx.fillStyle = 'rgba(0,0,0,0.52)';
      ctx.fillText(text, cx + 2, cy + 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, cx, cy);
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    };

    // Helper: distance from origin so a plane with normal from {0,±1}^3 passes through cube boundary
    const planeOffsetForMask = (maskVec) => {
      const k = Math.abs(maskVec.x) + Math.abs(maskVec.y) + Math.abs(maskVec.z); // 1, 2 or 3
      return 0.5 * Math.sqrt(k);
    };
    const FACE_SURFACE_EPSILON = 0.008;
    const CORNER_SURFACE_EPSILON = 0.03;
    const CORNER_TUBE_RADIUS = Math.max(
      0.01,
      Number.isFinite(colors?.cornerTubeRadius) ? Number(colors.cornerTubeRadius) : 0.08,
    );
    const CORNER_SPHERE_RADIUS = CORNER_TUBE_RADIUS * 1.5;

    // Face planes for picking + labels (main 6 faces)
    const mkFace = (dir, color, name, label = name) => {
      const g = new THREE.PlaneGeometry(0.98, 0.98);
      const normalMap = makeFaceTexture(label, color, false);
      const hoverMap = makeFaceTexture(label, color, true);
      const m = new THREE.MeshBasicMaterial({
        map: normalMap,
        side: THREE.FrontSide,
      });
      const p = new THREE.Mesh(g, m);
      // place at distance where face coincides with cube side (0.5)
      const off = planeOffsetForMask(dir);
      const n = dir.clone().normalize();
      p.position.copy(n.multiplyScalar(off + FACE_SURFACE_EPSILON));
      // orient plane to face outward
      const q = new THREE.Quaternion();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
      p.quaternion.copy(q);
      p.userData = {
        dir: dir.clone().normalize(),
        name,
        highlightKind: 'face-map',
        normalMap,
        hoverMap,
      };
      p.renderOrder = 1; // draw on top of base box
      this.pickGroup.add(p);

      return p;
    };

    // Dark defaults with a subtle nod to the original per-face hues.
    // Accept any CSS color string or hex. You can override via constructor
    // with { colors: { faces: { RIGHT: 'tomato', ... }, edge: '...', corner: '...' } }
    const ORIGINAL_FACE_TINGE = {
      RIGHT: '#ff4d4d',
      LEFT: '#005eff',
      TOP: '#55ff00',
      BOTTOM: '#ffea00',
      FRONT: '#ff0084',
      BACK: '#00e5ff',
    };
    const DARK_FACE_BLEND = 0.0;
    const darkFace = (hue) => mixColors(hue, THEME_BG_ELEV, DARK_FACE_BLEND);
    const FACE_DEFAULTS = {
      RIGHT: darkFace(ORIGINAL_FACE_TINGE.RIGHT),
      LEFT: darkFace(ORIGINAL_FACE_TINGE.LEFT),
      TOP: darkFace(ORIGINAL_FACE_TINGE.TOP),
      BOTTOM: darkFace(ORIGINAL_FACE_TINGE.BOTTOM),
      FRONT: darkFace(ORIGINAL_FACE_TINGE.FRONT),
      BACK: darkFace(ORIGINAL_FACE_TINGE.BACK),
    };
    const FACE_LABELS = { RIGHT: 'R', LEFT: 'L', TOP: 'T', BOTTOM: 'B', FRONT: 'F', BACK: 'BK' };
    let faceOverrides = {};
    if (colors) {
      if (colors.faces) faceOverrides = colors.faces;
      else if (colors.RIGHT || colors.LEFT || colors.TOP || colors.BOTTOM || colors.FRONT || colors.BACK) faceOverrides = colors;
    }
    const FACE = Object.assign({}, FACE_DEFAULTS, faceOverrides);

    // Edge/corner colors (define before creating materials)
    const EDGE_COLOR = (colors && colors.edge) || mixColors(THEME_BORDER, THEME_TEXT, 0.14);
    const CORNER_COLOR = (colors && colors.corner) || mixColors(THEME_ACCENT, THEME_BORDER, 0.45);
    const EDGE_COLOR_CSS = toCssAndHex(EDGE_COLOR).css;
    const EDGE_HOVER_COLOR_CSS = mixColors(EDGE_COLOR_CSS, '#ffffff', 0.58);
    const CORNER_COLOR_CSS = toCssAndHex(CORNER_COLOR).css;
    const CORNER_HOVER_COLOR_CSS = mixColors(CORNER_COLOR_CSS, '#ffffff', 0.58);

    mkFace(new THREE.Vector3(1, 0, 0), FACE.RIGHT, 'RIGHT', FACE_LABELS.RIGHT);
    mkFace(new THREE.Vector3(-1, 0, 0), FACE.LEFT, 'LEFT', FACE_LABELS.LEFT);
    mkFace(new THREE.Vector3(0, 1, 0), FACE.TOP, 'TOP', FACE_LABELS.TOP);
    mkFace(new THREE.Vector3(0, -1, 0), FACE.BOTTOM, 'BOTTOM', FACE_LABELS.BOTTOM);
    mkFace(new THREE.Vector3(0, 0, 1), FACE.FRONT, 'FRONT', FACE_LABELS.FRONT);
    mkFace(new THREE.Vector3(0, 0, -1), FACE.BACK, 'BACK', FACE_LABELS.BACK);

    // Corner spheres + edge tubes share the same exact corner-center points.
    // This keeps tube endpoints and sphere centers perfectly aligned.
    const mkCorner = (dirMask, color, name) => {
      const n = dirMask.clone().normalize();
      const off = planeOffsetForMask(dirMask) + CORNER_SURFACE_EPSILON;
      const center = n.clone().multiplyScalar(off);
      const g = new THREE.SphereGeometry(CORNER_SPHERE_RADIUS, 14, 10);
      const m = new THREE.MeshBasicMaterial({
        color: toCssAndHex(color).css,
        side: THREE.FrontSide,
      });
      const sphere = new THREE.Mesh(g, m);
      sphere.position.copy(center);
      sphere.userData = {
        dir: n.clone(),
        name,
        highlightKind: 'solid-color',
        baseColor: CORNER_COLOR_CSS,
        hoverColor: CORNER_HOVER_COLOR_CSS,
      };
      sphere.renderOrder = 3;
      this.pickGroup.add(sphere);
      return { center, dir: n.clone(), mesh: sphere };
    };
    const mkEdgeTube = (cornerA, cornerB, name) => {
      if (!cornerA || !cornerB) return null;
      const p0 = cornerA.center;
      const p1 = cornerB.center;
      const delta = p1.clone().sub(p0);
      const len = delta.length();
      if (!(len > 1e-8)) return null;

      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(CORNER_TUBE_RADIUS, CORNER_TUBE_RADIUS, len, 12, 1, false),
        new THREE.MeshBasicMaterial({ color: EDGE_COLOR_CSS, side: THREE.FrontSide }),
      );
      tube.position.copy(p0).add(p1).multiplyScalar(0.5);
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      const dir = p0.clone().add(p1);
      if (dir.lengthSq() > 1e-12) dir.normalize();
      else dir.set(0, 0, 1);
      tube.userData = {
        dir,
        name,
        highlightKind: 'solid-color',
        baseColor: EDGE_COLOR_CSS,
        hoverColor: EDGE_HOVER_COLOR_CSS,
      };
      tube.renderOrder = 2;
      this.pickGroup.add(tube);
      return tube;
    };

    // Define all 8 corners with readable names
    const C = (x, y, z) => new THREE.Vector3(x, y, z);
    const corners = {
      TFR: mkCorner(C(1, 1, 1), CORNER_COLOR, 'TOP FRONT RIGHT'),
      TFL: mkCorner(C(-1, 1, 1), CORNER_COLOR, 'TOP FRONT LEFT'),
      TBR: mkCorner(C(1, 1, -1), CORNER_COLOR, 'TOP BACK RIGHT'),
      TBL: mkCorner(C(-1, 1, -1), CORNER_COLOR, 'TOP BACK LEFT'),
      BFR: mkCorner(C(1, -1, 1), CORNER_COLOR, 'BOTTOM FRONT RIGHT'),
      BFL: mkCorner(C(-1, -1, 1), CORNER_COLOR, 'BOTTOM FRONT LEFT'),
      BBR: mkCorner(C(1, -1, -1), CORNER_COLOR, 'BOTTOM BACK RIGHT'),
      BBL: mkCorner(C(-1, -1, -1), CORNER_COLOR, 'BOTTOM BACK LEFT'),
    };

    // 12 cube edges as true tubes whose endpoints are corner-sphere centers.
    mkEdgeTube(corners.TFR, corners.TBR, 'TOP RIGHT EDGE');
    mkEdgeTube(corners.TFL, corners.TBL, 'TOP LEFT EDGE');
    mkEdgeTube(corners.BFR, corners.BBR, 'BOTTOM RIGHT EDGE');
    mkEdgeTube(corners.BFL, corners.BBL, 'BOTTOM LEFT EDGE');

    mkEdgeTube(corners.TFR, corners.BFR, 'FRONT RIGHT EDGE');
    mkEdgeTube(corners.TFL, corners.BFL, 'FRONT LEFT EDGE');
    mkEdgeTube(corners.TBR, corners.BBR, 'BACK RIGHT EDGE');
    mkEdgeTube(corners.TBL, corners.BBL, 'BACK LEFT EDGE');

    mkEdgeTube(corners.TFR, corners.TFL, 'TOP FRONT EDGE');
    mkEdgeTube(corners.BFR, corners.BFL, 'BOTTOM FRONT EDGE');
    mkEdgeTube(corners.TBR, corners.TBL, 'TOP BACK EDGE');
    mkEdgeTube(corners.BBR, corners.BBL, 'BOTTOM BACK EDGE');

    // Soft ambient to ensure steady colors regardless of renderer state
    const amb = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(amb);

    // Raycaster for cube picking
    this._raycaster = new THREE.Raycaster();
    this._hoveredObject = null;
  }

  // Keep cube orientation in sync with target camera
  syncWithCamera() {
    if (!this.targetCamera) return;
    // Use the inverse of the target camera's rotation so the widget
    // represents world orientation as seen from the camera (avoids mirroring).
    this.root.quaternion.copy(this.targetCamera.quaternion).invert();
  }

  // Compute viewport rectangle (bottom-right). Returns both CSS(top-left) and GL(bottom-left) coords.
  _viewportRect() {
    const el = this.renderer.domElement;
    const width = el.clientWidth || 1;
    const height = el.clientHeight || 1;
    const w = Math.min(this.size, width);
    const h = Math.min(this.size, height);
    const xCss = width - w - this.margin;   // from top-left
    const yCss = height - h - this.margin;  // bottom-right in CSS coords
    const xGL = xCss;                        // same horizontally
    const yGL = this.margin;                 // bottom margin in GL coords
    return { xCss, yCss, xGL, yGL, w, h, width, height };
  }

  // Render the view cube using scissor in the bottom-right corner
  render() {
    const { xGL, yGL, w, h, width, height } = this._viewportRect();
    const r = this.renderer;
    const prev = {
      scissorTest: r.getScissorTest && r.getScissorTest(),
      autoClear: r.autoClear,
    };

    // Update camera for aspect
    const aspect = w / h || 1;
    this.camera.left = -1 * aspect;
    this.camera.right = 1 * aspect;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();

    // Render cube without clearing color to keep background transparent
    r.setScissorTest(true);
    r.autoClear = false;
    r.setScissor(xGL, yGL, w, h);
    r.setViewport(xGL, yGL, w, h);
    r.clearDepth();
    this.syncWithCamera();
    r.render(this.scene, this.camera);

    // Restore viewport/scissor for main renderer
    r.setViewport(0, 0, width, height);
    r.setScissor(0, 0, width, height);
    r.setScissorTest(!!prev.scissorTest);
    r.autoClear = prev.autoClear;
  }

  // Check if a DOM pointer event is inside the cube viewport
  isEventInside(event) {
    const rect = this._viewportRect();
    const elRect = this.renderer.domElement.getBoundingClientRect();
    const px = event.clientX - elRect.left;
    const py = event.clientY - elRect.top;
    return (px >= rect.xCss && px <= rect.xCss + rect.w &&
      py >= rect.yCss && py <= rect.yCss + rect.h);
  }

  _pickObjectAtEvent(event) {
    if (!this.isEventInside(event)) return null;
    const { xCss, yCss, w, h } = this._viewportRect();
    const elRect = this.renderer.domElement.getBoundingClientRect();
    const cx = event.clientX - elRect.left;
    const cy = event.clientY - elRect.top;
    const nx = ((cx - xCss) / w) * 2 - 1;
    const ny = -((cy - yCss) / h) * 2 + 1;
    const ndc = new THREE.Vector2(nx, ny);

    this._raycaster.setFromCamera(ndc, this.camera);
    const intersects = this._raycaster.intersectObjects(this.pickGroup.children, false);
    return (intersects && intersects.length) ? intersects[0].object : null;
  }

  _applyHoverState(obj, active) {
    if (!obj || !obj.material) return;
    const ud = obj.userData || {};
    if (ud.highlightKind === 'face-map') {
      const nextMap = active ? ud.hoverMap : ud.normalMap;
      if (nextMap && obj.material.map !== nextMap) {
        obj.material.map = nextMap;
        obj.material.needsUpdate = true;
      }
      return;
    }
    if (ud.highlightKind === 'solid-color' && obj.material.color) {
      obj.material.color.setStyle(active ? (ud.hoverColor || '#ffffff') : (ud.baseColor || '#ffffff'));
    }
  }

  _setHoveredObject(nextObj) {
    if (this._hoveredObject === nextObj) return false;
    if (this._hoveredObject) this._applyHoverState(this._hoveredObject, false);
    this._hoveredObject = nextObj || null;
    if (this._hoveredObject) this._applyHoverState(this._hoveredObject, true);
    return true;
  }

  // Update hover highlight from pointer move; faces/edges/corners all respond.
  handlePointerMove(event) {
    const hit = this._pickObjectAtEvent(event);
    this._setHoveredObject(hit);
    return !!hit;
  }

  clearHover() {
    this._setHoveredObject(null);
  }

  // Attempt to handle a click; returns true if consumed
  handleClick(event) {
    const face = this._pickObjectAtEvent(event);
    if (face) {
      const dir = face?.userData?.dir;
      const name = face?.userData?.name || '';
      if (dir) this._reorientCamera(dir, name);
      return true;
    }
    return false;
  }

  _reorientCamera(dir, _faceName = '') {
    const cam = this.targetCamera;
    if (!cam) return;

    // Determine current pivot (ArcballControls center) and keep distance to it
    const pivot = (this.controls && this.controls._gizmos && this.controls._gizmos.position)
      ? this.controls._gizmos.position.clone()
      : new THREE.Vector3(0, 0, 0);
    const dist = cam.position.distanceTo(pivot) || cam.position.length() || 10;
    const viewDir = dir.clone().normalize(); // from pivot -> camera
    const toPos = pivot.clone().add(viewDir.clone().multiplyScalar(dist));
    const newForward = pivot.clone().sub(toPos).normalize(); // from camera -> pivot

    const projectToViewPlane = (v, normal) => {
      const p = v.clone().sub(normal.clone().multiplyScalar(v.dot(normal)));
      const len = p.length();
      return len > 1e-8 ? p.multiplyScalar(1 / len) : null;
    };

    // Current camera basis in world space.
    const oldForward = pivot.clone().sub(cam.position).normalize();
    const oldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).normalize();

    // Transport old up by the minimal forward-alignment rotation so we keep perceived roll stable.
    const alignQ = new THREE.Quaternion().setFromUnitVectors(oldForward, newForward);
    let desiredUp = oldUp.clone().applyQuaternion(alignQ);
    desiredUp = projectToViewPlane(desiredUp, newForward);
    if (!desiredUp) {
      desiredUp = projectToViewPlane(new THREE.Vector3(0, 1, 0), newForward)
        || projectToViewPlane(new THREE.Vector3(1, 0, 0), newForward)
        || new THREE.Vector3(0, 0, 1);
    }

    // Build canonical in-plane axes for the target face.
    // These define the four valid "square to screen" roll states (0/90/180/270).
    const ax = Math.abs(newForward.x);
    const ay = Math.abs(newForward.y);
    const az = Math.abs(newForward.z);
    let baseA = null;
    let baseB = null;
    if (ax >= ay && ax >= az) {
      baseA = new THREE.Vector3(0, 1, 0);
      baseB = new THREE.Vector3(0, 0, 1);
    } else if (ay >= ax && ay >= az) {
      baseA = new THREE.Vector3(1, 0, 0);
      baseB = new THREE.Vector3(0, 0, 1);
    } else {
      baseA = new THREE.Vector3(1, 0, 0);
      baseB = new THREE.Vector3(0, 1, 0);
    }
    const a = projectToViewPlane(baseA, newForward);
    const b = projectToViewPlane(baseB, newForward);
    const candidates = [];
    if (a) { candidates.push(a.clone()); candidates.push(a.clone().negate()); }
    if (b) { candidates.push(b.clone()); candidates.push(b.clone().negate()); }
    if (!candidates.length) candidates.push(desiredUp.clone());

    // Snap roll to nearest 90-degree canonical orientation (minimum roll delta).
    let bestUp = candidates[0];
    let bestDot = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const d = candidates[i].dot(desiredUp);
      if (d > bestDot) {
        bestDot = d;
        bestUp = candidates[i];
      }
    }

    // Orthonormalize against forward.
    const right = new THREE.Vector3().crossVectors(newForward, bestUp);
    if (right.lengthSq() > 1e-10) {
      right.normalize();
      bestUp = new THREE.Vector3().crossVectors(right, newForward).normalize();
    }

    // Immediate reorientation: absolute pose using lookAt toward pivot
    cam.position.copy(toPos);
    cam.up.copy(bestUp);
    cam.lookAt(pivot);
    cam.updateMatrixWorld(true);

    // Sync controls to the new absolute state
    const controls = this.controls;
    if (controls && controls.updateMatrixState) {
      try { controls.updateMatrixState(); } catch { }
    }
    if (controls) controls.enabled = true;
  }
}
