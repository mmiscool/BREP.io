const DEFAULT_SIZE = "A";
const DEFAULT_ORIENTATION = "landscape";

function toSheetSummary(sheet) {
  const safe = sheet && typeof sheet === "object" ? sheet : {};
  const width = Number(safe.widthIn) || 0;
  const height = Number(safe.heightIn) || 0;
  const units = String(safe.units || "in");
  const count = Array.isArray(safe.elements) ? safe.elements.length : 0;
  return `${width.toFixed(2).replace(/\.?0+$/, "")} x ${height.toFixed(2).replace(/\.?0+$/, "")} ${units} | ${count} items`;
}

export class Sheet2DWidget {
  constructor(viewer, { readOnly = false } = {}) {
    this.viewer = viewer || null;
    this._readOnly = !!readOnly;
    this.uiElement = document.createElement("div");
    this.uiElement.className = "sheet2d-widget-root";
    this.sheets = [];
    this._activeSheetId = null;
    this._removeManagerListener = null;
    this._openMenuSheetId = null;
    this._dragSheetId = null;
    this._boundDocumentPointerDown = (event) => this._onDocumentPointerDown(event);

    this._ensureStyles();
    this._buildUI();
    this.refreshFromHistory();
    this._renderList();
    this._bindManagerListener();
  }

  dispose() {
    if (typeof this._removeManagerListener === "function") {
      try { this._removeManagerListener(); } catch { }
    }
    this._removeManagerListener = null;
    document.removeEventListener("mousedown", this._boundDocumentPointerDown);
  }

  refreshFromHistory() {
    this.sheets = this._getSheetsFromManager();
    if (this._openMenuSheetId && !this.sheets.some((sheet) => sheet?.id === this._openMenuSheetId)) {
      this._openMenuSheetId = null;
      document.removeEventListener("mousedown", this._boundDocumentPointerDown);
    }
    if (!this._activeSheetId && this.sheets.length) {
      this._activeSheetId = this.sheets[0]?.id || null;
    }
    if (this._activeSheetId && !this.sheets.some((sheet) => sheet?.id === this._activeSheetId)) {
      this._activeSheetId = this.sheets[0]?.id || null;
    }
  }

  _getManager() {
    return this.viewer?.partHistory?.sheet2DManager || null;
  }

  _bindManagerListener() {
    const manager = this._getManager();
    if (!manager || typeof manager.addListener !== "function") return;
    this._removeManagerListener = manager.addListener((sheets) => {
      this.sheets = Array.isArray(sheets) ? sheets : [];
      if (this._openMenuSheetId && !this.sheets.some((sheet) => sheet?.id === this._openMenuSheetId)) {
        this._openMenuSheetId = null;
        document.removeEventListener("mousedown", this._boundDocumentPointerDown);
      }
      if (!this._activeSheetId && this.sheets.length) {
        this._activeSheetId = this.sheets[0]?.id || null;
      }
      if (this._activeSheetId && !this.sheets.some((sheet) => sheet?.id === this._activeSheetId)) {
        this._activeSheetId = this.sheets[0]?.id || null;
      }
      this._renderList();
    });
  }

  _getSheetsFromManager() {
    const manager = this._getManager();
    if (!manager || typeof manager.getSheets !== "function") return [];
    try {
      const sheets = manager.getSheets();
      return Array.isArray(sheets) ? sheets : [];
    } catch {
      return [];
    }
  }

  _buildUI() {
    const header = document.createElement("div");
    header.className = "sheet2d-widget-header";

    const title = document.createElement("div");
    title.className = "sheet2d-widget-title";
    title.textContent = this._readOnly ? "Sheets" : "2D Sheets";
    header.appendChild(title);

    if (!this._readOnly) {
      const createBtn = document.createElement("button");
      createBtn.className = "sheet2d-btn sheet2d-btn-primary";
      createBtn.type = "button";
      createBtn.textContent = "New Sheet";
      createBtn.title = "Create a new sheet";
      createBtn.addEventListener("click", () => this._createSheet());
      header.appendChild(createBtn);
    }

    this.uiElement.appendChild(header);

    this.listEl = document.createElement("div");
    this.listEl.className = "sheet2d-list";
    this.uiElement.appendChild(this.listEl);
  }

  _createSheet() {
    const manager = this._getManager();
    if (!manager || typeof manager.createSheet !== "function") return;
    const count = Array.isArray(this.sheets) ? this.sheets.length : 0;
    const sheet = manager.createSheet({
      name: `Instruction Sheet ${count + 1}`,
      sizeKey: DEFAULT_SIZE,
      orientation: DEFAULT_ORIENTATION,
      background: "#ffffff",
      elements: [],
    });
    this._activeSheetId = sheet?.id || this._activeSheetId;
    this._renderList();
    this._openSheet(sheet?.id);
  }

  _openSheet(sheetId) {
    if (!sheetId) return;
    this._activeSheetId = String(sheetId);
    this._renderList();
    try { this.viewer?.openSheet2DEditor?.(this._activeSheetId); } catch { }
  }

  _toggleRowMenu(sheetId) {
    const id = String(sheetId || "").trim();
    const willOpen = this._openMenuSheetId !== id;
    this._openMenuSheetId = willOpen ? id : null;
    document.removeEventListener("mousedown", this._boundDocumentPointerDown);
    if (willOpen) {
      document.addEventListener("mousedown", this._boundDocumentPointerDown);
    }
    this._renderList();
  }

  _closeRowMenu() {
    if (!this._openMenuSheetId) return;
    this._openMenuSheetId = null;
    document.removeEventListener("mousedown", this._boundDocumentPointerDown);
    this._renderList();
  }

  _onDocumentPointerDown(event) {
    if (!this._openMenuSheetId) return;
    const insideMenu = event?.target?.closest?.(".sheet2d-row-menu, .sheet2d-row-menu-btn");
    if (!insideMenu) this._closeRowMenu();
  }

  _renameSheet(sheet) {
    if (!sheet) return;
    const manager = this._getManager();
    if (!manager?.updateSheet) return;
    const next = prompt("Rename sheet", String(sheet.name || ""));
    if (next == null) return;
    const name = String(next).trim();
    if (!name) return;
    manager.updateSheet(sheet.id, { name });
  }

  _deleteSheet(sheet) {
    if (!sheet) return;
    const manager = this._getManager();
    if (!manager?.removeSheet) return;
    const ok = confirm(`Delete sheet "${sheet.name}"?`);
    if (!ok) return;
    manager.removeSheet(sheet.id);
  }

  _duplicateSheet(sheet) {
    if (!sheet) return;
    const manager = this._getManager();
    if (!manager?.duplicateSheet) return;
    const copy = manager.duplicateSheet(sheet.id);
    if (copy?.id) {
      this._activeSheetId = copy.id;
      this._renderList();
    }
  }

  _moveSheet(sheetId, toIndex) {
    const manager = this._getManager();
    const id = String(sheetId || "").trim();
    if (!manager?.moveSheet || !id) return;
    const moved = manager.moveSheet(id, toIndex);
    if (!moved) return;
    this._dragSheetId = null;
    this._openMenuSheetId = null;
  }

  _renderList() {
    if (!this.listEl) return;
    this.listEl.textContent = "";
    if (!Array.isArray(this.sheets) || this.sheets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sheet2d-empty";
      empty.textContent = this._readOnly
        ? "No sheets."
        : "No sheets yet. Create one to start authoring instructions/manual pages.";
      this.listEl.appendChild(empty);
      return;
    }

    for (const sheet of this.sheets) {
      const sheetId = String(sheet?.id || "");
      const row = document.createElement("div");
      row.className = "sheet2d-row";
      if (sheetId === this._activeSheetId) row.classList.add("active");
      row.draggable = !this._readOnly;
      row.addEventListener("click", (event) => {
        if (event?.target?.closest?.(".sheet2d-row-menu-wrap")) return;
        this._openSheet(sheetId);
      });

      if (!this._readOnly) {
        row.addEventListener("dragstart", (event) => {
          this._dragSheetId = sheetId;
          row.classList.add("is-dragging");
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", sheetId);
          }
        });
        row.addEventListener("dragend", () => {
          this._dragSheetId = null;
          row.classList.remove("is-dragging");
          for (const target of this.listEl?.querySelectorAll?.(".sheet2d-row.is-drop-target") || []) {
            target.classList.remove("is-drop-target");
          }
        });
        row.addEventListener("dragover", (event) => {
          if (!this._dragSheetId || this._dragSheetId === sheetId) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          row.classList.add("is-drop-target");
        });
        row.addEventListener("dragleave", (event) => {
          if (!row.contains(event.relatedTarget)) {
            row.classList.remove("is-drop-target");
          }
        });
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          row.classList.remove("is-drop-target");
          const sourceId = String(this._dragSheetId || "").trim();
          this._dragSheetId = null;
          if (!sourceId || sourceId === sheetId) return;
          const targetIndex = this.sheets.findIndex((entry) => String(entry?.id || "") === sheetId);
          this._moveSheet(sourceId, targetIndex);
        });
      }

      const textWrap = document.createElement("div");
      textWrap.className = "sheet2d-row-text";
      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "sheet2d-name-btn";
      nameBtn.textContent = String(sheet?.name || "Sheet");
      nameBtn.title = "Open in editor";
      nameBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this._openSheet(sheetId);
      });
      textWrap.appendChild(nameBtn);

      const meta = document.createElement("div");
      meta.className = "sheet2d-meta";
      meta.textContent = toSheetSummary(sheet);
      textWrap.appendChild(meta);

      row.appendChild(textWrap);

      const actions = document.createElement("div");
      actions.className = "sheet2d-actions";

      if (!this._readOnly) {
        const menuWrap = document.createElement("div");
        menuWrap.className = "sheet2d-row-menu-wrap";

        const menuBtn = document.createElement("button");
        menuBtn.type = "button";
        menuBtn.className = "sheet2d-btn sheet2d-row-menu-btn";
        menuBtn.textContent = "⋯";
        menuBtn.title = "Sheet actions";
        menuBtn.setAttribute("aria-label", "Sheet actions");
        menuBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this._toggleRowMenu(sheetId);
        });
        menuWrap.appendChild(menuBtn);

        if (this._openMenuSheetId === sheetId) {
          const menu = document.createElement("div");
          menu.className = "sheet2d-row-menu";

          const renameBtn = document.createElement("button");
          renameBtn.type = "button";
          renameBtn.className = "sheet2d-row-menu-item";
          renameBtn.textContent = "Rename";
          renameBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._closeRowMenu();
            this._renameSheet(sheet);
          });
          menu.appendChild(renameBtn);

          const duplicateBtn = document.createElement("button");
          duplicateBtn.type = "button";
          duplicateBtn.className = "sheet2d-row-menu-item";
          duplicateBtn.textContent = "Duplicate";
          duplicateBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._closeRowMenu();
            this._duplicateSheet(sheet);
          });
          menu.appendChild(duplicateBtn);

          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "sheet2d-row-menu-item danger";
          deleteBtn.textContent = "Delete";
          deleteBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._closeRowMenu();
            this._deleteSheet(sheet);
          });
          menu.appendChild(deleteBtn);

          menuWrap.appendChild(menu);
        }

        actions.appendChild(menuWrap);
      }

      row.appendChild(actions);
      this.listEl.appendChild(row);
    }
  }

  _ensureStyles() {
    if (document.getElementById("sheet2d-widget-styles")) return;
    const style = document.createElement("style");
    style.id = "sheet2d-widget-styles";
    style.textContent = `
      .sheet2d-widget-root { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
      .sheet2d-widget-header { display: flex; align-items: center; gap: 8px; }
      .sheet2d-widget-title { flex: 1 1 auto; color: #f1f5f9; font-weight: 700; letter-spacing: .2px; }
      .sheet2d-btn {
        background: rgba(255,255,255,.04); color: #f8fafc; border: 1px solid #334155; border-radius: 8px;
        padding: 5px 8px; cursor: pointer; font-size: 12px; font-weight: 600;
      }
      .sheet2d-btn:hover { border-color: #60a5fa; background: rgba(96,165,250,.14); }
      .sheet2d-btn.danger { border-color: #7f1d1d; color: #fecaca; }
      .sheet2d-btn.danger:hover { border-color: #ef4444; background: rgba(239,68,68,.18); color: #fff; }
      .sheet2d-btn-primary { border-color: #2563eb; background: rgba(37,99,235,.2); }
      .sheet2d-list { display: flex; flex-direction: column; gap: 6px; }
      .sheet2d-row {
        display: flex; align-items: center; gap: 8px; border: 1px solid #1e293b; border-radius: 8px;
        background: rgba(15,23,42,.6); padding: 6px 8px; cursor: pointer;
        position: relative;
      }
      .sheet2d-row.active { border-color: #3b82f6; box-shadow: 0 0 0 1px rgba(59,130,246,.28) inset; }
      .sheet2d-row.is-dragging { opacity: .55; }
      .sheet2d-row.is-drop-target { border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(96,165,250,.22); }
      .sheet2d-row-text { flex: 1 1 auto; min-width: 0; }
      .sheet2d-name-btn {
        border: none; background: transparent; color: #e2e8f0; font-weight: 700; cursor: pointer; padding: 0;
        text-align: left; width: 100%;
      }
      .sheet2d-name-btn:hover { color: #bfdbfe; }
      .sheet2d-meta { color: #94a3b8; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sheet2d-actions { display: flex; align-items: center; gap: 4px; }
      .sheet2d-row-menu-wrap { position: relative; }
      .sheet2d-row-menu-btn {
        width: 32px;
        padding: 0;
        font-size: 18px;
        line-height: 1;
      }
      .sheet2d-row-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 148px;
        padding: 6px;
        border: 1px solid #334155;
        border-radius: 10px;
        background: #0b0e14;
        box-shadow: 0 16px 32px rgba(0,0,0,.42);
        display: flex;
        flex-direction: column;
        gap: 4px;
        z-index: 5;
      }
      .sheet2d-row-menu-item {
        width: 100%;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #f8fafc;
        text-align: left;
        padding: 7px 10px;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
      }
      .sheet2d-row-menu-item:hover { background: rgba(255,255,255,.06); }
      .sheet2d-row-menu-item.danger { color: #fecaca; }
      .sheet2d-empty { border: 1px dashed #334155; border-radius: 8px; padding: 10px; color: #94a3b8; font-size: 12px; }
      @media (max-width: 640px) {
        .sheet2d-actions { flex-wrap: wrap; justify-content: flex-end; }
      }
    `;
    document.head.appendChild(style);
  }
}
