import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/Addons.js';
import { SelectionFilter } from './SelectionFilter.js';
import {
    localStorage as LS,
    configureGithubStorage,
    getGithubStorageConfig,
    STORAGE_BACKEND_EVENT,
} from '../idbStorage.js';
import { fetchGithubUserRepos } from '../githubStorage.js';

// CADmaterials for each entity type


export const CADmaterials = {
    PLANE: {
        BASE: new THREE.MeshStandardMaterial({
            color: "#2eff2e",
            side: THREE.DoubleSide,
            transparent: true,
            opacity: .5,
            flatShading: true,
            metalness: 0.05,
            roughness: 0.85,
            depthTest: true,
            depthWrite: true,
            polygonOffset: false,
            emissiveIntensity: 0,
        }),
        SELECTED: new THREE.MeshStandardMaterial({
            color: "#2eff2e",
            side: THREE.DoubleSide,
            transparent: true,
            opacity: .5,
            flatShading: true,
            metalness: 0.05,
            roughness: 0.85,
            depthTest: true,
            depthWrite: false,
            polygonOffset: false,
            emissiveIntensity: 0,
        }),
    },
    EDGE: {
        BASE: new LineMaterial({
            color: "#009dff",
            linewidth: 3,
            transparent: false,
            dashed: true,
            dashSize: 0.5,
            gapSize: 0.5,
            worldUnits: false, // keep dash/line size constant in screen space
            // Depth-test against faces but don't write depth (avoid occluding faces).
            depthWrite: false,
        }),
        SELECTED: new LineMaterial({
            color: "#ff00ff",
            linewidth: 3,
            transparent: false,
            worldUnits: false,
            // Depth-test against faces but don't write depth (avoid occluding faces).
            depthWrite: false,
        }),
        // Overlay variant for helper/centerline edges. Uses depthTest=false so
        // it remains visible through faces. Viewer will keep its resolution
        // updated alongside other fat-line materials.
        // dashed line
        OVERLAY: new LineMaterial({
            color: "#ff0000",
            linewidth: 1.5,
            transparent: true,
            dashed: true,
            dashSize: 0.5,
            gapSize: 0.5,
            worldUnits: false,
            depthTest: false,
            depthWrite: false,
        }),
        // Dashed cyan overlay for symbolic thread major diameter rings
        THREAD_SYMBOLIC_MAJOR: new LineMaterial({
            color: "#00c8ff",
            linewidth: 1.5,
            transparent: true,
            dashed: true,
            dashSize: 0.6,
            gapSize: 0.6,
            worldUnits: false,
            depthTest: false,
            depthWrite: false,
        }),
    },
    LOOP: {
        BASE: new LineMaterial({
            color: "#ff0000",
            linewidth: 1.5,
            transparent: true,
        }),
        SELECTED: new LineMaterial({
            color: "#ff00ff",
            linewidth: 3,
            //linecap: "round",
            //linejoin: "round",
            transparent: true,
        }),
    },
    FACE: {
        BASE: new THREE.MeshStandardMaterial({
            color: "#00009e",
            side: THREE.FrontSide,
            transparent: false,
            opacity: 1,
            flatShading: true,
            metalness: 0.05,
            roughness: 0.85,
            depthTest: true,
            depthWrite: true,
            // Push faces slightly back so coplanar edges can sit on top.
            polygonOffset: true,
            polygonOffsetFactor: 2,
            polygonOffsetUnits: 1,
            emissiveIntensity: 0,
        }),
        SELECTED: new THREE.MeshStandardMaterial({
            color: "#ffc400",
            side: THREE.DoubleSide,
            transparent: false,
            opacity: 1,
            wireframe: false,
            flatShading: false,
            metalness: 0,
            roughness: 0.5,
            depthTest: true,
            depthWrite: true,
            // Keep selected faces slightly behind edges as well.
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: 1,
            emissiveIntensity: 0,
        })
    },
    VERTEX: {
        BASE: new THREE.PointsMaterial({
            color: '#4aff03',
            size: 6,
            sizeAttenuation: false, // keep a consistent pixel size
            transparent: true
        }),
        SELECTED: new THREE.PointsMaterial({
            color: '#00ffff',
            size: 7,
            sizeAttenuation: false,
            transparent: true
        })
    },
    FLAT_PATTERN: {
        OUTER_EDGE: new THREE.LineBasicMaterial({
            color: '#ff5fa2',
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
        }),
        INNER_EDGE: new THREE.LineBasicMaterial({
            color: '#00ffff',
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
        }),
        CENTERLINE: new THREE.LineBasicMaterial({
            color: '#00ffff',
            linewidth: 2,
            depthTest: true,
            depthWrite: false,
        }),
    },

};


// this will provide a UI widget to control CAD materials and will allow the user to change the following properties.
// - Color (html color picker)
// - Opacity (range slider)
// - Linewidth (range slider) (only shows on LineBasicMaterial)
// - Wireframe (checkbox) (only shows on MeshBasicMaterial) items
//
// We will make the UI controls for each material in the global CADmaterials object
export class CADmaterialWidget {
    constructor(viewer = null) {
        this.viewer = viewer || null;
        this.uiElement = document.createElement("div");
        this.uiElement.classList.add('cmw');
        this._storageKey = '__CAD_MATERIAL_SETTINGS__';
        this._settings = this._loadAllSettings();
        this._defaultHoverColor = this._getDefaultHoverColor();
        this._defaultSidebarWidth = this._getDefaultSidebarWidth();
        this._materialEntries = this._collectMaterialEntries();
        this._materialMap = new Map(this._materialEntries.map((entry) => [entry.label, entry.material]));
        this._materialDefaults = this._captureMaterialDefaults(this._materialEntries);
        this._controlRefs = new Map();
        this._ensureStyles();
        this.createUI();
    }

    createUI() {
        // Hover color control (single global color)
        try {
            const savedHover = this._settings['__HOVER_COLOR__'];
            if (savedHover) SelectionFilter.setHoverColor(savedHover);
        } catch (_) { }

        const hoverRow = makeRightSpan();
        const hoverLabel = document.createElement('label');
        hoverLabel.className = 'cmw-label';
        hoverLabel.textContent = 'Hover Color';
        hoverRow.appendChild(hoverLabel);
        const hoverInput = document.createElement('input');
        hoverInput.type = 'color';
        hoverInput.className = 'cmw-input';
        const currentHover = this._settings['__HOVER_COLOR__'] || SelectionFilter.getHoverColor() || '#ffd54a';
        // Ensure hex format starting with #
        hoverInput.value = typeof currentHover === 'string' && currentHover.startsWith('#') ? currentHover : `#${new THREE.Color(currentHover).getHexString()}`;
        hoverInput.addEventListener('input', (event) => {
            const v = event.target.value;
            SelectionFilter.setHoverColor(v);
            this._settings['__HOVER_COLOR__'] = v;
            this._saveAllSettings();
        });
        hoverRow.appendChild(hoverInput);
        this.uiElement.appendChild(hoverRow);
        this._hoverInput = hoverInput;

        // Sidebar width control (global persistent setting)
        const widthRow = makeRightSpan();
        const widthLabel = document.createElement('label');
        widthLabel.className = 'cmw-label';
        widthLabel.textContent = 'Sidebar Width';
        widthRow.appendChild(widthLabel);

        // Determine initial width
        let initialWidth = 500;
        try {
            const savedW = parseInt(this._settings['__SIDEBAR_WIDTH__']);
            if (Number.isFinite(savedW) && savedW > 0) initialWidth = savedW;
            else {
                const sb = document.getElementById('sidebar');
                const cs = sb ? (sb.style.width || getComputedStyle(sb).width) : '';
                const w = parseInt(cs);
                if (Number.isFinite(w) && w > 0) initialWidth = w;
            }
        } catch { console.log("failed to determine initial sidebar width    ") }

        const widthInput = document.createElement('input');
        widthInput.type = 'number';
        widthInput.inputMode = 'numeric';
        widthInput.className = 'cmw-input';
        widthInput.min = 200;
        widthInput.max = 600;
        widthInput.step = 1;
        widthInput.value = String(initialWidth);
        const applySidebarWidth = (px) => {
            try {
                const sb = document.getElementById('sidebar');
                if (sb && Number.isFinite(px) && px > 0) sb.style.width = `${px}px`;
            } catch { /* ignore */ }
        };
        // Apply saved width immediately
        applySidebarWidth(initialWidth);
        const commitWidth = (raw) => {
            let v = parseInt(raw);
            if (!Number.isFinite(v)) return; // ignore incomplete input
            const min = Number(widthInput.min) || 200;
            const max = Number(widthInput.max) || 600;
            if (v < min) v = min; else if (v > max) v = max;
            widthInput.value = String(v);
            this._applySidebarWidth(v);
            this._settings['__SIDEBAR_WIDTH__'] = v;
            this._saveAllSettings();
        };
        widthInput.addEventListener('change', (event) => commitWidth(event.target.value));
        widthRow.appendChild(widthInput);
        this.uiElement.appendChild(widthRow);
        this._widthInput = widthInput;

        // Renderer mode control (global persistent setting)
        const rendererRow = makeRightSpan();
        const rendererLabel = document.createElement('label');
        rendererLabel.className = 'cmw-label';
        rendererLabel.textContent = 'Renderer';
        rendererRow.appendChild(rendererLabel);
        const rendererSelect = document.createElement('select');
        rendererSelect.className = 'cmw-input';
        const optWebgl = document.createElement('option');
        optWebgl.value = 'webgl';
        optWebgl.textContent = 'WebGL (Canvas)';
        const optSvg = document.createElement('option');
        optSvg.value = 'svg';
        optSvg.textContent = 'SVG';
        rendererSelect.appendChild(optWebgl);
        rendererSelect.appendChild(optSvg);
        const storedMode = String(this._settings['__RENDERER_MODE__'] || '').toLowerCase();
        const initialMode = storedMode === 'svg' ? 'svg' : 'webgl';
        rendererSelect.value = initialMode;
        rendererSelect.addEventListener('change', (event) => {
            const mode = event?.target?.value === 'svg' ? 'svg' : 'webgl';
            this._settings['__RENDERER_MODE__'] = mode;
            this._saveAllSettings();
            try { this.viewer?.setRendererMode?.(mode); } catch { }
        });
        rendererRow.appendChild(rendererSelect);
        this.uiElement.appendChild(rendererRow);
        this._rendererSelect = rendererSelect;
        try { this.viewer?.setRendererMode?.(initialMode); } catch { }

        const resetRow = makeRightSpan();
        const resetLabel = document.createElement('label');
        resetLabel.className = 'cmw-label';
        resetLabel.textContent = 'Reset';
        resetRow.appendChild(resetLabel);
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'cmw-button';
        resetButton.textContent = 'Reset to Defaults';
        resetButton.addEventListener('click', () => this._resetToDefaults());
        resetRow.appendChild(resetButton);
        this.uiElement.appendChild(resetRow);

        this._buildGithubStorageSection();

        // For each top-level group (e.g., EDGE, LOOP, FACE), render variants (e.g., BASE, SELECTED)
        for (const [groupName, groupVal] of Object.entries(CADmaterials)) {
            const groupContainer = document.createElement("div");
            groupContainer.className = 'cmw-group';

            // Group header
            const groupHeader = document.createElement('div');
            groupHeader.className = 'cmw-header';
            groupHeader.textContent = groupName;
            groupContainer.appendChild(groupHeader);

            // Back-compat: allow either a direct THREE.Material or an object of variants
            if (this._isMaterial(groupVal)) {
                const matContainer = document.createElement("div");
                matContainer.className = 'cmw-mat';
                this._buildMaterialControls(matContainer, groupName, groupVal);
                groupContainer.appendChild(matContainer);
            } else if (groupVal && typeof groupVal === 'object') {
                for (const [variantName, mat] of Object.entries(groupVal)) {
                    if (!this._isMaterial(mat)) continue;
                    const matContainer = document.createElement("div");
                    matContainer.className = 'cmw-mat';
                    this._buildMaterialControls(matContainer, `${groupName} - ${variantName}`, mat);
                    groupContainer.appendChild(matContainer);
                }
            }

            this.uiElement.appendChild(groupContainer);
        }

        // Normalize label widths via CSS classes
    }

    _buildGithubStorageSection() {
        const group = document.createElement('div');
        group.className = 'cmw-group cmw-group-github';
        const header = document.createElement('div');
        header.className = 'cmw-header';
        header.textContent = 'GitHub Workspace';
        group.appendChild(header);

        const tokenRow = makeRightSpan();
        const tokenLabel = document.createElement('label');
        tokenLabel.className = 'cmw-label';
        tokenLabel.textContent = 'GitHub Token';
        tokenRow.appendChild(tokenLabel);
        const tokenInput = document.createElement('input');
        tokenInput.type = 'password';
        tokenInput.className = 'cmw-input';
        tokenInput.placeholder = 'ghp_...';
        tokenInput.autocomplete = 'off';
        tokenInput.autocorrect = 'off';
        tokenInput.autocapitalize = 'off';
        tokenInput.spellcheck = false;
        tokenInput.style.flex = '1 1 auto';
        tokenRow.appendChild(tokenInput);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'cmw-button';
        clearBtn.textContent = 'Clear';
        tokenRow.appendChild(clearBtn);
        group.appendChild(tokenRow);

        const tokenHelp = document.createElement('div');
        tokenHelp.className = 'cmw-help';
        tokenHelp.innerHTML = `
            <div><a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">Create a GitHub personal access token</a></div>
            <div>Steps: Settings → Developer settings → Personal access tokens → Fine‑grained tokens → Generate.</div>
            <div>Grant access to the target repo and enable Contents read/write.</div>
        `;
        group.appendChild(tokenHelp);

        const repoBtnRow = makeRightSpan();
        const repoBtnLabel = document.createElement('label');
        repoBtnLabel.className = 'cmw-label';
        repoBtnLabel.textContent = 'Repos';
        repoBtnRow.appendChild(repoBtnLabel);
        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.className = 'cmw-button';
        reloadBtn.textContent = 'Load Repos';
        repoBtnRow.appendChild(reloadBtn);
        group.appendChild(repoBtnRow);

        const repoRow = makeRightSpan();
        const repoLabel = document.createElement('label');
        repoLabel.className = 'cmw-label';
        repoLabel.textContent = 'Repo';
        repoRow.appendChild(repoLabel);
        const repoWrap = document.createElement('div');
        repoWrap.className = 'cmw-combo cmw-repo-combo';
        const repoInput = document.createElement('input');
        repoInput.type = 'text';
        repoInput.className = 'cmw-input cmw-repo-input';
        repoInput.placeholder = 'Load repos';
        repoInput.disabled = true;
        const repoList = document.createElement('div');
        repoList.className = 'cmw-combo-list';
        repoList.style.display = 'none';
        repoWrap.appendChild(repoInput);
        repoWrap.appendChild(repoList);
        repoRow.appendChild(repoWrap);
        group.appendChild(repoRow);

        const statusRow = makeRightSpan();
        const statusLabel = document.createElement('label');
        statusLabel.className = 'cmw-label';
        statusLabel.textContent = 'Storage';
        statusRow.appendChild(statusLabel);
        const statusValue = document.createElement('div');
        statusValue.className = 'cmw-status';
        statusValue.textContent = 'Per-file (Local Browser)';
        statusRow.appendChild(statusValue);
        group.appendChild(statusRow);

        this.uiElement.appendChild(group);

        const cfg = getGithubStorageConfig();
        if (cfg?.token) tokenInput.value = cfg.token;
        let repoCache = [];
        let pendingRepo = cfg?.repoFull || '';

        const updateStatus = (override) => {
            if (override) {
                statusValue.textContent = override;
                return;
            }
            const token = tokenInput.value.trim();
            const repo = repoInput.value.trim();
            if (token && repo) {
                statusValue.textContent = `Per-file (GitHub ready: ${repo})`;
                return;
            }
            if (token) {
                statusValue.textContent = 'Per-file (GitHub token set; choose a repo)';
                return;
            }
            statusValue.textContent = 'Per-file (Local Browser)';
        };

        const renderRepoList = (filter = '') => {
            const hasToken = !!tokenInput.value.trim();
            if (!hasToken) {
                repoInput.disabled = true;
                repoInput.placeholder = 'Enter token first';
                repoList.innerHTML = '<div class=\"cmw-combo-empty\">Enter token first</div>';
                return;
            }
            repoInput.disabled = false;
            repoInput.placeholder = 'Select a repo';

            const repos = repoCache
                .filter((r) => r && r.full_name)
                .filter((r) => !r.permissions || r.permissions.push !== false)
                .sort((a, b) => a.full_name.localeCompare(b.full_name));

            const term = String(filter || '').trim().toLowerCase();
            const filtered = term
                ? repos.filter((r) => String(r.full_name || '').toLowerCase().includes(term))
                : repos;

            repoList.innerHTML = '';
            if (!repoCache.length) {
                repoList.innerHTML = '<div class=\"cmw-combo-empty\">Load repos</div>';
                return;
            }
            if (!filtered.length) {
                repoList.innerHTML = '<div class=\"cmw-combo-empty\">No matches</div>';
                return;
            }
            for (const r of filtered) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'cmw-combo-item';
                const tag = r.private ? 'private' : 'public';
                item.textContent = `${r.full_name} (${tag})`;
                item.addEventListener('click', () => {
                    repoInput.value = r.full_name;
                    repoList.style.display = 'none';
                    applyConfig();
                });
                repoList.appendChild(item);
            }

            if (pendingRepo) {
                repoInput.value = pendingRepo;
                pendingRepo = '';
            }
        };

        const loadRepos = async () => {
            const token = tokenInput.value.trim();
            if (!token) {
                updateStatus('Enter a token to load repos.');
                return;
            }
            updateStatus('Loading repos...');
            repoInput.disabled = true;
            repoList.innerHTML = '<div class=\"cmw-combo-empty\">Loading...</div>';
            try {
                repoCache = await fetchGithubUserRepos(token);
                renderRepoList(repoInput.value);
                updateStatus();
            } catch (e) {
                updateStatus(`Repo load failed: ${e?.message || e}`);
                repoInput.disabled = true;
            }
        };

        const applyConfig = async () => {
            const token = tokenInput.value.trim();
            const repoFull = repoInput.value.trim();
            try {
                if (token && repoFull) updateStatus('Connecting...');
                await configureGithubStorage({ token, repoFull, mode: 'local' });
                updateStatus();
            } catch (e) {
                updateStatus(`GitHub error: ${e?.message || e}`);
            }
        };

        reloadBtn.addEventListener('click', () => loadRepos());
        repoInput.addEventListener('input', () => {
            renderRepoList(repoInput.value);
            repoList.style.display = 'block';
        });
        repoInput.addEventListener('focus', () => {
            renderRepoList(repoInput.value);
            repoList.style.display = 'block';
        });
        repoInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                repoList.style.display = 'none';
                applyConfig();
            }
            if (event.key === 'Escape') {
                repoList.style.display = 'none';
            }
        });
        repoInput.addEventListener('blur', () => {
            // allow clicks to register before closing
            setTimeout(() => { repoList.style.display = 'none'; }, 120);
        });
        tokenInput.addEventListener('change', () => {
            if (!tokenInput.value.trim()) {
                repoCache = [];
                repoInput.disabled = true;
                repoInput.value = '';
                repoList.innerHTML = '<div class=\"cmw-combo-empty\">Load repos</div>';
            }
            applyConfig();
        });
        clearBtn.addEventListener('click', async () => {
            tokenInput.value = '';
            repoCache = [];
            repoInput.disabled = true;
            repoInput.value = '';
            repoList.innerHTML = '<div class=\"cmw-combo-empty\">Load repos</div>';
            try {
                await configureGithubStorage({ token: '', repoFull: '', repoFulls: [], mode: 'local' });
            } catch { /* ignore */ }
            updateStatus();
        });

        try {
            window.addEventListener(STORAGE_BACKEND_EVENT, () => {
                updateStatus();
            });
        } catch {}

        if (cfg?.token) {
            repoInput.disabled = false;
            loadRepos();
        } else {
            updateStatus();
        }

        try {
            document.addEventListener('click', (event) => {
                if (!repoWrap.contains(event.target)) repoList.style.display = 'none';
            });
        } catch {}
    }

    // --- Persistence helpers (browser only) ---
    _loadAllSettings() {
        try {
            const raw = LS.getItem(this._storageKey);
            const obj = raw ? JSON.parse(raw) : {};
            return (obj && typeof obj === 'object') ? obj : {};
        } catch { return {}; }
    }
    _saveAllSettings() {
        try {
            LS.setItem(this._storageKey, JSON.stringify(this._settings, null, 2));
            console.log(JSON.stringify(this._settings, null, 2));
        } catch {/* ignore */ }
    }
    _isMaterial(m) {
        return m && (m.isMaterial === true || m instanceof THREE.Material);
    }
    _collectMaterialEntries() {
        const entries = [];
        for (const [groupName, groupVal] of Object.entries(CADmaterials)) {
            if (this._isMaterial(groupVal)) {
                entries.push({ label: groupName, material: groupVal });
            } else if (groupVal && typeof groupVal === 'object') {
                for (const [variantName, mat] of Object.entries(groupVal)) {
                    if (!this._isMaterial(mat)) continue;
                    entries.push({ label: `${groupName} - ${variantName}`, material: mat });
                }
            }
        }
        return entries;
    }
    _captureMaterialDefaults(entries) {
        const defaults = {};
        for (const entry of entries) {
            defaults[entry.label] = this._extractMaterialSettings(entry.material);
        }
        return defaults;
    }
    _extractMaterialSettings(material) {
        const settings = {};
        if (material?.color && typeof material.color.getHexString === 'function') {
            settings.color = `#${material.color.getHexString()}`;
        }
        if (material instanceof THREE.LineBasicMaterial || material instanceof LineMaterial) {
            if (material.linewidth != null) settings.linewidth = Number(material.linewidth);
        }
        if (material instanceof THREE.PointsMaterial) {
            if (material.size != null) settings.pointSize = Number(material.size);
        }
        if (
            material instanceof THREE.MeshBasicMaterial ||
            material instanceof THREE.MeshMatcapMaterial ||
            material instanceof THREE.MeshToonMaterial ||
            material instanceof THREE.MeshStandardMaterial
        ) {
            if (material.opacity != null) settings.opacity = Number(material.opacity);
            settings.transparent = !!material.transparent;
            settings.wireframe = !!material.wireframe;
            settings.side = material.side;
        }
        return settings;
    }
    _applyMaterialSettings(material, settings) {
        if (!material || !settings) return;
        if (settings.color && material.color && typeof material.color.set === 'function') {
            material.color.set(this._sanitizeHexColor(settings.color));
        }
        if (material instanceof THREE.LineBasicMaterial || material instanceof LineMaterial) {
            if (settings.linewidth != null) material.linewidth = Number(settings.linewidth);
        }
        if (material instanceof THREE.PointsMaterial) {
            if (settings.pointSize != null) material.size = Number(settings.pointSize);
        }
        if (
            material instanceof THREE.MeshBasicMaterial ||
            material instanceof THREE.MeshMatcapMaterial ||
            material instanceof THREE.MeshToonMaterial ||
            material instanceof THREE.MeshStandardMaterial
        ) {
            if (settings.opacity != null) material.opacity = Number(settings.opacity);
            if (settings.transparent != null) material.transparent = !!settings.transparent;
            if (settings.wireframe != null) material.wireframe = !!settings.wireframe;
            if (settings.side != null) material.side = settings.side;
        }
    }
    _applySidebarWidth(px) {
        try {
            const sb = document.getElementById('sidebar');
            if (sb && Number.isFinite(px) && px > 0) sb.style.width = `${px}px`;
        } catch { /* ignore */ }
    }
    setSidebarWidth(px, { persist = true } = {}) {
        let v = Number(px);
        if (!Number.isFinite(v)) return null;
        const min = Number(this._widthInput?.min) || 200;
        const max = Number(this._widthInput?.max) || 600;
        if (v < min) v = min; else if (v > max) v = max;
        this._setSidebarWidthUi(v);
        this._settings['__SIDEBAR_WIDTH__'] = v;
        if (persist) this._saveAllSettings();
        return v;
    }
    _setSidebarWidthUi(px) {
        if (!this._widthInput) {
            this._applySidebarWidth(px);
            return;
        }
        let v = Number(px);
        if (!Number.isFinite(v)) return;
        const min = Number(this._widthInput.min) || 200;
        const max = Number(this._widthInput.max) || 600;
        if (v < min) v = min; else if (v > max) v = max;
        this._widthInput.value = String(v);
        this._applySidebarWidth(v);
    }
    _normalizeHexColor(value) {
        if (typeof value === 'string' && value.startsWith('#')) return this._sanitizeHexColor(value);
        try { return `#${new THREE.Color(value).getHexString()}`; } catch { return '#ffd54a'; }
    }
    _getDefaultHoverColor() {
        return this._normalizeHexColor(SelectionFilter.getHoverColor() || '#ffd54a');
    }
    _getDefaultSidebarWidth() {
        const fallback = 500;
        try {
            const sb = document.getElementById('sidebar');
            if (!sb) return fallback;
            const prev = sb.style.width;
            if (prev) sb.style.width = '';
            const cs = getComputedStyle(sb).width;
            if (prev) sb.style.width = prev;
            const w = parseInt(cs);
            if (Number.isFinite(w) && w > 0) return w;
        } catch { /* keep fallback */ }
        return fallback;
    }
    _formatRangeValue(value, step) {
        const v = Number(value);
        if (!Number.isFinite(v)) return '';
        const stepStr = step != null ? String(step) : '';
        let decimals = 0;
        if (stepStr.includes('.')) decimals = stepStr.split('.')[1].length;
        if (decimals > 0) {
            const fixed = v.toFixed(decimals);
            return fixed.replace(/\.?0+$/, '');
        }
        return String(Math.round(v));
    }
    _getRangeThumbSize(input) {
        if (!input) return 16;
        const cached = Number(input.dataset.cmwThumb);
        if (Number.isFinite(cached) && cached > 0) return cached;
        let measured = input.offsetHeight || 0;
        if (!measured) {
            try {
                measured = parseFloat(getComputedStyle(input).height) || 0;
            } catch { /* ignore */ }
        }
        const size = measured > 0 ? measured : 16;
        if (measured > 0) input.dataset.cmwThumb = String(size);
        return size;
    }
    _updateRangeBubble(input, bubble) {
        if (!input || !bubble) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const value = Number(input.value);
        if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
            bubble.textContent = '';
            bubble.style.left = '0%';
            bubble.style.transform = 'translateX(-50%)';
            return;
        }
        const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
        const thumbSize = this._getRangeThumbSize(input);
        const offset = (thumbSize / 2) - (pct * thumbSize);
        bubble.textContent = this._formatRangeValue(value, input.step);
        bubble.style.left = `${pct * 100}%`;
        bubble.style.transform = `translateX(-50%) translateX(${offset}px)`;
    }
    _createRangeField(input) {
        const wrap = document.createElement('div');
        wrap.className = 'cmw-range-wrap';
        wrap.appendChild(input);
        const bubble = document.createElement('span');
        bubble.className = 'cmw-range-bubble';
        wrap.appendChild(bubble);
        this._updateRangeBubble(input, bubble);
        return { wrap, bubble };
    }
    _createRangeRow({ label, min, max, step, value, onInput }) {
        const row = makeRightSpan();
        row.classList.add('cmw-row-range');
        const labelEl = document.createElement('label');
        labelEl.className = 'cmw-label';
        labelEl.textContent = label;
        row.appendChild(labelEl);
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'cmw-range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = Number.isFinite(value) ? value : min;
        const { wrap, bubble } = this._createRangeField(input);
        input.addEventListener('input', (event) => {
            const v = parseFloat(event.target.value);
            if (Number.isFinite(v)) onInput(v);
            this._updateRangeBubble(input, bubble);
        });
        row.appendChild(wrap);
        return { row, input, bubble };
    }
    _syncMaterialControls(labelText, material) {
        const controls = this._controlRefs.get(labelText);
        if (!controls || !material) return;
        if (controls.colorInput && material.color && typeof material.color.getHexString === 'function') {
            controls.colorInput.value = `#${material.color.getHexString()}`;
        }
        if (controls.lineWidthInput) {
            if (material.linewidth != null) controls.lineWidthInput.value = material.linewidth;
            if (controls.lineWidthBubble) this._updateRangeBubble(controls.lineWidthInput, controls.lineWidthBubble);
        }
        if (controls.pointSizeInput) {
            if (material.size != null) controls.pointSizeInput.value = material.size;
            if (controls.pointSizeBubble) this._updateRangeBubble(controls.pointSizeInput, controls.pointSizeBubble);
        }
        if (controls.opacityInput) {
            controls.opacityInput.value = material.opacity ?? 1;
            if (controls.opacityBubble) this._updateRangeBubble(controls.opacityInput, controls.opacityBubble);
        }
        if (controls.wireframeInput) {
            controls.wireframeInput.checked = !!material.wireframe;
        }
        if (controls.doubleSidedInput) {
            controls.doubleSidedInput.checked = material.side === THREE.DoubleSide;
        }
    }
    _resetToDefaults() {
        this._settings = {};
        try { LS.removeItem(this._storageKey); } catch { /* ignore */ }

        const hoverColor = this._normalizeHexColor(this._defaultHoverColor);
        SelectionFilter.setHoverColor(hoverColor);
        if (this._hoverInput) this._hoverInput.value = hoverColor;

        this._setSidebarWidthUi(this._defaultSidebarWidth);

        for (const [labelText, defaults] of Object.entries(this._materialDefaults || {})) {
            const material = this._materialMap.get(labelText);
            if (!material) continue;
            this._applyMaterialSettings(material, defaults);
            this._syncMaterialControls(labelText, material);
        }
    }
    _getMatKey(labelText) {
        return String(labelText);
    }
    _getSettingsFor(labelText) {
        const key = this._getMatKey(labelText);
        return this._settings[key] || {};
    }
    _setSettingsFor(labelText, kv) {
        const key = this._getMatKey(labelText);
        const prev = this._settings[key] || {};
        this._settings[key] = { ...prev, ...kv };
        this._saveAllSettings();
    }

    _sanitizeHexColor(value) {
        if (typeof value !== 'string') return value;
        if (!value.startsWith('#')) return value;
        // If color is in #RRGGBBAA form, drop alpha AA
        if (value.length === 9) return value.slice(0, 7);
        return value;
    }

    _applySavedToMaterial(labelText, material) {
        const s = this._getSettingsFor(labelText);
        if (s.color && material.color && typeof material.color.set === 'function') {
            material.color.set(this._sanitizeHexColor(s.color));
        }
        if (material instanceof THREE.LineBasicMaterial || material instanceof LineMaterial) {
            if (s.linewidth != null) material.linewidth = Number(s.linewidth);
        }
        if (material instanceof THREE.PointsMaterial) {
            if (s.pointSize != null) material.size = Number(s.pointSize);
        }
        if (
            material instanceof THREE.MeshBasicMaterial ||
            material instanceof THREE.MeshMatcapMaterial ||
            material instanceof THREE.MeshToonMaterial ||
            material instanceof THREE.MeshStandardMaterial
        ) {
            if (s.opacity != null) {
                material.opacity = Number(s.opacity);
                material.transparent = material.opacity < 1;
            }
            if (s.wireframe != null) material.wireframe = !!s.wireframe;
            if (s.doubleSided != null) material.side = s.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
        }
    }

    _buildMaterialControls(container, labelText, material) {
        // Apply saved settings first
        this._applySavedToMaterial(labelText, material);
        const controls = this._controlRefs.get(labelText) || {};

        // Color row
        if (material.color && typeof material.color.getHexString === 'function') {
            const colorRow = makeRightSpan();
            const colorLabel = document.createElement("label");
            colorLabel.className = 'cmw-label';
            colorLabel.textContent = labelText;
            colorRow.appendChild(colorLabel);
            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.className = 'cmw-input';
            colorInput.value = `#${material.color.getHexString()}`;
            colorInput.addEventListener("input", (event) => {
                const v = this._sanitizeHexColor(event.target.value);
                // Normalize UI value back to sanitized form so user sees what is applied
                if (v !== event.target.value) event.target.value = v;
                material.color.set(v);
                this._setSettingsFor(labelText, { color: v });
            });
            colorRow.appendChild(colorInput);
            container.appendChild(colorRow);
            controls.colorInput = colorInput;
        }

        // Line-specific controls
        if (material instanceof THREE.LineBasicMaterial || material instanceof LineMaterial) {
            const { row, input, bubble } = this._createRangeRow({
                label: 'Linewidth',
                min: 1,
                max: 10,
                step: 0.1,
                value: material.linewidth ?? 1,
                onInput: (v) => {
                    material.linewidth = v;
                    this._setSettingsFor(labelText, { linewidth: v });
                },
            });
            container.appendChild(row);
            controls.lineWidthInput = input;
            controls.lineWidthBubble = bubble;
        }

        // Points-specific controls
        if (material instanceof THREE.PointsMaterial) {
            const { row, input, bubble } = this._createRangeRow({
                label: 'Point Size',
                min: 1,
                max: 30,
                step: 0.5,
                value: material.size ?? 6,
                onInput: (v) => {
                    material.size = v;
                    this._setSettingsFor(labelText, { pointSize: v });
                },
            });
            container.appendChild(row);
            controls.pointSizeInput = input;
            controls.pointSizeBubble = bubble;
        }

        // Mesh material common controls
        if (
            material instanceof THREE.MeshBasicMaterial ||
            material instanceof THREE.MeshMatcapMaterial ||
            material instanceof THREE.MeshToonMaterial ||
            material instanceof THREE.MeshStandardMaterial
        ) {
            // Opacity
            const { row, input, bubble } = this._createRangeRow({
                label: 'Opacity',
                min: 0,
                max: 1,
                step: 0.01,
                value: material.opacity ?? 1,
                onInput: (v) => {
                    material.opacity = v;
                    material.transparent = material.opacity < 1;
                    this._setSettingsFor(labelText, { opacity: material.opacity });
                },
            });
            container.appendChild(row);
            controls.opacityInput = input;
            controls.opacityBubble = bubble;

            // Wireframe
            const wfRow = makeRightSpan();
            const wfLabel = document.createElement("label");
            wfLabel.className = 'cmw-label';
            wfLabel.textContent = "Wireframe";
            wfRow.appendChild(wfLabel);
            const wfInput = document.createElement("input");
            wfInput.type = "checkbox";
            wfInput.className = 'cmw-check';
            wfInput.checked = !!material.wireframe;
            wfInput.addEventListener("change", (event) => {
                material.wireframe = !!event.target.checked;
                this._setSettingsFor(labelText, { wireframe: material.wireframe });
            });
            wfRow.appendChild(wfInput);
            container.appendChild(wfRow);
            controls.wireframeInput = wfInput;

            // Double sided
            const dsRow = makeRightSpan();
            const dsLabel = document.createElement("label");
            dsLabel.className = 'cmw-label';
            dsLabel.textContent = "Double Sided";
            dsRow.appendChild(dsLabel);
            const dsInput = document.createElement("input");
            dsInput.type = "checkbox";
            dsInput.className = 'cmw-check';
            dsInput.checked = material.side === THREE.DoubleSide;
            dsInput.addEventListener("change", (event) => {
                material.side = event.target.checked ? THREE.DoubleSide : THREE.FrontSide;
                this._setSettingsFor(labelText, { doubleSided: event.target.checked });
            });
            dsRow.appendChild(dsInput);
            container.appendChild(dsRow);
            controls.doubleSidedInput = dsInput;
        }

        this._controlRefs.set(labelText, controls);
    }

    _ensureStyles() {
        if (document.getElementById('cad-materials-widget-styles')) return;
        const style = document.createElement('style');
        style.id = 'cad-materials-widget-styles';
        style.textContent = `
            /* Use HistoryWidget vars when present; fallback to similar values */
            :root { --cmw-border: var(--border, #262b36); --cmw-text: var(--text, #e6e6e6); --cmw-bg: var(--bg-elev, #12141b); }
            .cmw { display: flex; flex-direction: column; gap: 8px; color: var(--cmw-text); }
            .cmw-group {
                background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
                border: 1px solid var(--cmw-border);
                border-radius: 10px;
                overflow: hidden;
            }
            .cmw-group-github { overflow: visible; }
            .cmw-header {
                padding: 10px 12px;
                font-weight: 700;
                color: var(--cmw-text);
                border-bottom: 1px solid var(--cmw-border);
                background: transparent;
            }
            .cmw-mat { display: flex; flex-direction: column; }
            .cmw-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
            .cmw-row-range { align-items: flex-start; }
            .cmw-row-range .cmw-label { margin-top: 20px; }
            .cmw-label { width: 160px; color: var(--cmw-text); }
            .cmw-input { background: #0b0e14; color: var(--cmw-text); border: 1px solid #374151; border-radius: 8px; padding: 4px 6px; height: 28px; }
            .cmw-range-wrap { position: relative; width: 200px; padding-top: 20px; }
            .cmw-range { width: 100%; accent-color: #60a5fa; }
            .cmw-range-bubble {
                position: absolute;
                top: 0;
                left: 0;
                transform: translateX(-50%);
                background: #0b0e14;
                border: 1px solid #374151;
                border-radius: 6px;
                padding: 2px 6px;
                font-size: 12px;
                line-height: 1.2;
                color: #d1d5db;
                pointer-events: none;
                white-space: nowrap;
            }
            .cmw-check { accent-color: #60a5fa; }
            .cmw-button {
                background: #111827;
                color: var(--cmw-text);
                border: 1px solid #374151;
                border-radius: 8px;
                padding: 6px 10px;
                cursor: pointer;
            }
            .cmw-button:hover { border-color: #60a5fa; }
            .cmw-status { font-size: 12px; color: #9ca3af; }
            .cmw-help {
                padding: 0 12px 10px 12px;
                font-size: 12px;
                color: #9ca3af;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .cmw-help a { color: #93c5fd; text-decoration: underline; }
            .cmw-select-wrap {
                white-space: normal;
                height: auto;
                line-height: 1.2;
                text-overflow: clip;
                overflow-wrap: anywhere;
            }
            .cmw-select-wrap option { white-space: normal; }
            .cmw-combo {
                position: relative;
                flex: 1 1 auto;
                max-width: 90%;
            }
            .cmw-repo-input {
                width: 100%;
                box-sizing: border-box;
            }
            .cmw-combo-list {
                position: absolute;
                top: calc(100% + 4px);
                left: 0;
                right: 0;
                z-index: 10;
                background: #0b0e14;
                border: 1px solid #374151;
                border-radius: 8px;
                max-height: 220px;
                overflow: auto;
                box-shadow: 0 8px 24px rgba(0,0,0,.35);
            }
            .cmw-combo-item {
                display: block;
                width: 100%;
                text-align: left;
                background: transparent;
                color: var(--cmw-text);
                border: 0;
                padding: 6px 8px;
                cursor: pointer;
                white-space: normal;
                overflow-wrap: anywhere;
            }
            .cmw-combo-item:hover { background: #111827; }
            .cmw-combo-empty {
                padding: 6px 8px;
                color: #9ca3af;
                white-space: normal;
            }
        `;
        document.head.appendChild(style);
    }
}




function makeRightSpan() {
    const row = document.createElement('div');
    row.className = 'cmw-row';
    return row;
}
