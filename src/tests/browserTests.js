// browserTests.js - BrowserTesting with UI widget (dark mode, top-right)

import { FloatingWindow } from '../UI/FloatingWindow.js';
import { Viewer } from '../UI/viewer.js';
import { ConsoleCapture } from './ConsoleCapture.js';
import { runSingleTest, runTests, testFunctions } from './tests.js';





export class BrowserTesting {
  constructor({
    containerEl = document.getElementById('viewport'),
    sidebarEl = document.getElementById('sidebar'),
    exposeEnvOnWindow = true,
    viewer = null, // optional: reuse existing Viewer instance if provided
  } = {}) {
    // URL flag to auto-progress (kept from previous behavior)
    this.autoProgress = window.location.href.includes("autoNext=true");

    // Initialize Viewer env (reuse provided viewer when available)
    this.env = viewer instanceof Viewer ? viewer : new Viewer({ container: containerEl, sidebar: sidebarEl });
    if (exposeEnvOnWindow) window.env = this.env;

    // Test registry (names in stable order)
    this.testNames = testFunctions.map(func => func.test.name);
    this._initialOrder = new Map(this.testNames.map((name, idx) => [name, idx]));
    this._sortState = { key: null, direction: "asc" };
    //console.log(testFunctions, this.testNames);

    this.currentIndex = 0;

    // Per-test runtime state
    this.enabled = new Map(this.testNames.map(n => [n, true]));
    this.status = new Map(this.testNames.map(n => [n, ""]));   // "", "pass", "fail"
    this.durationMs = new Map(this.testNames.map(n => [n, null]));
    this._isRunningSelected = false;
    this._stopRequested = false;
    this.errors = new Map(); // name -> { message, stack } captured on failure
    // Per-test canvas snapshot
    this.screenshots = new Map(); // name -> dataURL
    this.logWindow = null;
    this.logContent = null;

    // Popup container for screenshots between tests (kept from previous behavior)
    this.popupDiv = document.createElement("div");
    this.popupDiv.style.padding = "10px";
    this.popupDiv.style.background = "#0b0b0e";
    this.popupDiv.style.color = "#e5e7eb";
    this.popupDiv.style.border = "1px solid #2a2a33";
    this.popupDiv.style.borderRadius = "12px";
    this.popupDiv.style.maxWidth = "90vw";
    this.popupDiv.style.maxHeight = "100%";
    this.popupDiv.style.overflow = "auto";

    // Build the UI widget
    this.ui = this._buildUI();

    // Optional global for debugging
    window.browserTesting = this;
    if (this.autoProgress) {


      this.loggingTool = new ConsoleCapture({ captureStack: false });
      this.loggingTool.install();

    }
  }

  // ====== Small helpers ======
  sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
  nextFrame() { return new Promise(res => requestAnimationFrame(() => res())); }

  // ====== Screenshot dump (unchanged behavior) ======
  async dumpScreenshot() {
    await this.sleep(2000);
    const image = this.env.renderer.domElement.toDataURL();
    return image;
  }

  // ====== Visibility helpers ======
  show() { try { if (this.ui?.window?.root) this.ui.window.root.style.display = ''; } catch {} }
  hide() { try { if (this.ui?.window?.root) this.ui.window.root.style.display = 'none'; } catch {} }
  toggle() {
    try {
      if (!this.ui?.window?.root) return;
      const cur = this.ui.window.root.style.display;
      this.ui.window.root.style.display = (cur === 'none') ? '' : 'none';
    } catch {}
  }

  // ====== Hook invoked between tests (kept & extended) ======
  async callBetweenTestsToRender(featureHistory, isLastTest) {
    // Keep parity with original assignments
    this.env.partHistory.features = featureHistory.features;
    this.env.scene = featureHistory.scene;

    try {
      if (this.autoProgress) await this.sleep(250);
      await this.nextFrame();
      await this.nextFrame();
      await this.env.renderer.render(this.env.scene, this.env.camera);

      // capture screenshot to the popupDiv
      const image = this.env.renderer.domElement.toDataURL();
      const img = document.createElement("img");
      img.src = image;
      img.style.maxWidth = "360px";
      img.style.height = "auto";
      img.style.display = "block";
      img.style.margin = "8px 0";
      this.popupDiv.appendChild(img);
    } catch (error) {
      console.log("Error occurred while writing to popup:", error);
    }

    if (this.autoProgress, !isLastTest) {
      const popup = window.open("", "_blank");
      if (popup && popup.document && popup.document.body) {
        popup.document.body.style.background = "#0b0b0e";
        popup.document.body.style.color = "#e5e7eb";
        popup.document.body.appendChild(this.popupDiv);

      }
    }
  }

  // ====== PUBLIC: run all tests via external test harness (legacy entry) ======
  async run() {
    // Preserve old entry point, now wired through the UI "Run All" anyway
    await runTests(this.env.partHistory, this.callBetweenTestsToRender.bind(this));
  }

  // ====== UI: Build top-right widget ======
  _buildUI() {
    // Floating window container (draggable, shade-on-title, resizable)
    const fw = new FloatingWindow({ title: 'Browser Testing', width: 500, height: 700, right: 16, top: 40, shaded: false });
    Object.assign(fw.content.style, {
      padding: "0",
      overflowX: "hidden",
      overflowY: "auto",
    });

    const btnPrev = makeHeaderButton("⏮️", "Run previous test");
    const btnNext = makeHeaderButton("⏭️", "Run next test");
    const btnRunSelected = makeHeaderButton("▶️", "Run selected tests");
    const btnStop = makeHeaderButton("⏹️", "Stop after current test");
    this._runSelectedButton = btnRunSelected;
    this._stopButton = btnStop;
    fw.addHeaderAction(btnPrev);
    fw.addHeaderAction(btnNext);
    fw.addHeaderAction(btnRunSelected);
    fw.addHeaderAction(btnStop);

    // Table container (content area already scrolls; this keeps structure)
    const tableWrap = document.createElement("div");
    Object.assign(tableWrap.style, {
      maxWidth: "100%",
      overflow: "visible",
    });

    // Table
    const table = document.createElement("table");
    Object.assign(table.style, {
      width: "100%",
      maxWidth: "100%",
      borderCollapse: "separate",
      borderSpacing: "0",
      tableLayout: "fixed",
    });

    const colgroup = document.createElement("colgroup");
    const testCol = document.createElement("col");
    const statusCol = document.createElement("col");
    const durationCol = document.createElement("col");
    const actionsCol = document.createElement("col");
    statusCol.style.width = "58px";
    durationCol.style.width = "64px";
    actionsCol.style.width = "82px";
    colgroup.appendChild(testCol);
    colgroup.appendChild(statusCol);
    colgroup.appendChild(durationCol);
    colgroup.appendChild(actionsCol);
    table.appendChild(colgroup);

    // THEAD
    this._sortHeaderButtons = new Map();
    const makeSortHeader = (label, key) => {
      const cell = th("", null);
      const button = sortHeaderButton(label);
      button.addEventListener("click", () => this._toggleSort(key));
      cell.appendChild(button);
      this._sortHeaderButtons.set(key, button);
      return cell;
    };

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    const testHeader = th("", null);
    const headerLabel = document.createElement("div");
    Object.assign(headerLabel.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      minWidth: "0",
      width: "100%",
    });
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.checked = true;
    selectAll.title = "Check or uncheck all tests";
    selectAll.setAttribute("aria-label", "Check or uncheck all tests");
    selectAll.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    selectAll.addEventListener("change", () => {
      this._setAllEnabled(selectAll.checked);
    });
    this._selectAllCheckbox = selectAll;
    const headerText = sortHeaderButton("Test");
    headerText.addEventListener("click", () => this._toggleSort("name"));
    this._sortHeaderButtons.set("name", headerText);
    headerLabel.appendChild(selectAll);
    headerLabel.appendChild(headerText);
    testHeader.appendChild(headerLabel);

    headRow.appendChild(testHeader);
    headRow.appendChild(makeSortHeader("Status", "status"));
    headRow.appendChild(makeSortHeader("Time", "duration"));
    headRow.appendChild(th("Actions", null));
    thead.appendChild(headRow);
    table.appendChild(thead);

    // TBODY (rows per test)
    const tbody = document.createElement("tbody");
    this._tbody = tbody;
    this._rowRefs = new Map(); // name -> { row, checkbox, statusCell, durationCell, runBtn, logBtn }
    this.testNames.forEach((name) => {
      const row = document.createElement("tr");
      Object.assign(row.style, rowStyle());

      // col 1: checkbox + label
      const c1 = document.createElement("td");
      c1.style.height = "10px";
      Object.assign(c1.style, cellStyle());
      c1.style.overflow = "hidden";
      const label = document.createElement("label");
      Object.assign(label.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: "0",
        width: "100%",
      });
      label.title = name;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.style.flex = "0 0 auto";
      cb.addEventListener("change", () => {
        this.enabled.set(name, cb.checked);
        this._syncSelectAllCheckbox();
      });
      const text = document.createElement("span");
      text.textContent = name;
      text.title = name;
      Object.assign(text.style, truncateTextStyle());
      label.appendChild(cb);
      label.appendChild(text);
      c1.appendChild(label);

      // col 2: status
      const c2 = document.createElement("td");
      Object.assign(c2.style, cellStyle());
      updateStatusCell(c2, this.status.get(name));

      // col 3: duration
      const c3 = document.createElement("td");
      Object.assign(c3.style, cellStyle());
      c3.style.overflow = "hidden";
      updateDurationCell(c3, this.durationMs.get(name));

      // col 4: actions
      const c4 = document.createElement("td");
      Object.assign(c4.style, cellStyle());
      c4.style.overflow = "hidden";
      const actionWrap = document.createElement("div");
      Object.assign(actionWrap.style, {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        minWidth: "0",
        width: "100%",
      });
      const runBtn = miniButton("▷");
      runBtn.title = `Run ${name}`;
      runBtn.setAttribute("aria-label", `Run ${name}`);
      runBtn.style.flex = "0 0 28px";
      runBtn.style.width = "28px";
      const logBtn = miniButton("Log");
      logBtn.title = `Show log for ${name}`;
      logBtn.setAttribute("aria-label", `Show log for ${name}`);
      logBtn.style.flex = "1 1 0";
      logBtn.style.minWidth = "0";
      actionWrap.appendChild(runBtn);
      actionWrap.appendChild(logBtn);
      c4.appendChild(actionWrap);

      // row events
      row.addEventListener("click", (e) => {
        // Don't change selection if clicking a control that handles its own action
        if (e.target?.closest?.("button,input,label")) return;
        this._selectByName(name);
      });

      // hook up actions
      runBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        this._selectByName(name);
        await this._runSingleByName(name);
      });
      logBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showErrorLog(name);
      });

      // assemble row
      row.appendChild(c1);
      row.appendChild(c2);
      row.appendChild(c3);
      row.appendChild(c4);
      tbody.appendChild(row);

      this._rowRefs.set(name, { row, checkbox: cb, statusCell: c2, durationCell: c3, runBtn, logBtn });
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);

    // Footer: current selection
    const footer = document.createElement("div");
    Object.assign(footer.style, {
      padding: "10px 12px",
      borderTop: "1px solid #23232b",
      color: "#a7aab3",
      display: "flex",
      justifyContent: "space-between",
      minWidth: "0",
      boxSizing: "border-box",
    });
    this._selectionLabel = document.createElement("span");
    this._selectionLabel.textContent = this._currentLabel();
    Object.assign(this._selectionLabel.style, truncateTextStyle());
    footer.appendChild(this._selectionLabel);

    // Assemble widget
    fw.content.appendChild(tableWrap);
    fw.content.appendChild(footer);

    // Wire header buttons
    btnPrev.addEventListener("click", async () => {
      await this._moveSelectionAndRun(-1);
    });
    btnNext.addEventListener("click", async () => {
      await this._moveSelectionAndRun(+1);
    });
    btnRunSelected.addEventListener("click", async () => {
      await this._runSelected();
    });
    btnStop.addEventListener("click", () => {
      this._requestStop();
    });

    // Initial selected row styling
    this._applySelectionStyles();
    this._syncSelectAllCheckbox();
    this._syncStopButton();
    this._syncSortHeaders();

    // Start shaded/collapsed if desired by default; keep behavior off by default
    // fw.setShaded(true);

    return { window: fw, table, tbody };
  }

  // ====== Selection helpers ======
  _currentLabel() {
    const name = this.testNames[this.currentIndex] || "(none)";
    return `Selected: ${name} (${this.currentIndex + 1}/${this.testNames.length})`;
  }

  _moveSelection(delta) {
    if (!this.testNames.length) return null;
    this.currentIndex = (this.currentIndex + delta + this.testNames.length) % this.testNames.length;
    this._applySelectionStyles();
    this._scrollRowIntoView();
    return this.testNames[this.currentIndex];
  }

  async _moveSelectionAndRun(delta) {
    const name = this._moveSelection(delta);
    if (!name) return;
    await this._runSingleByName(name);
  }

  _selectRow(idx) {
    if (idx < 0 || idx >= this.testNames.length) return;
    this.currentIndex = idx;
    this._applySelectionStyles();
    this._scrollRowIntoView();
  }

  _selectByName(name) {
    const idx = this.testNames.indexOf(name);
    if (idx < 0) return;
    this._selectRow(idx);
  }

  _toggleSort(key) {
    const selectedName = this.testNames[this.currentIndex] || null;
    const nextDirection = this._sortState.key === key && this._sortState.direction === "asc"
      ? "desc"
      : "asc";
    this._sortState = { key, direction: nextDirection };
    this._sortTests();
    if (selectedName) {
      const nextIndex = this.testNames.indexOf(selectedName);
      if (nextIndex >= 0) this.currentIndex = nextIndex;
    }
    this._renderRows();
    this._applySelectionStyles();
    this._scrollRowIntoView();
    this._syncSortHeaders();
  }

  _sortTests() {
    const { key, direction } = this._sortState;
    if (!key) return;
    const directionFactor = direction === "desc" ? -1 : 1;
    this.testNames.sort((a, b) => {
      let cmp = 0;
      if (key === "name") {
        cmp = a.localeCompare(b);
        if (cmp !== 0) return cmp * directionFactor;
      } else if (key === "status") {
        cmp = compareStatusValues(this.status.get(a), this.status.get(b), direction);
        if (cmp !== 0) return cmp;
      } else if (key === "duration") {
        cmp = compareDurationValues(this.durationMs.get(a), this.durationMs.get(b), direction);
        if (cmp !== 0) return cmp;
      }
      return (this._initialOrder.get(a) ?? 0) - (this._initialOrder.get(b) ?? 0);
    });
  }

  _renderRows() {
    if (!this._tbody) return;
    const fragment = document.createDocumentFragment();
    this.testNames.forEach((name) => {
      const row = this._rowRefs.get(name)?.row;
      if (row) fragment.appendChild(row);
    });
    this._tbody.appendChild(fragment);
  }

  _syncSortHeaders() {
    if (!this._sortHeaderButtons) return;
    this._sortHeaderButtons.forEach((button, key) => {
      const active = this._sortState.key === key;
      const marker = active ? (this._sortState.direction === "asc" ? " ▲" : " ▼") : "";
      const label = button.dataset.label || button.textContent.replace(/[ ▲▼]+$/u, "");
      button.dataset.label = label;
      button.textContent = `${label}${marker}`;
      button.setAttribute("aria-sort", active ? (this._sortState.direction === "asc" ? "ascending" : "descending") : "none");
      button.title = active
        ? `Sort ${label} ${this._sortState.direction === "asc" ? "descending" : "ascending"}`
        : `Sort ${label}`;
    });
  }

  _applySelectionStyles() {
    this._selectionLabel.textContent = this._currentLabel();
    this.testNames.forEach((name, idx) => {
      const ref = this._rowRefs.get(name);
      if (!ref) return;
      if (idx === this.currentIndex) {
        ref.row.style.outline = "2px solid #4155ff88";
        ref.row.style.background = "#12131a";
      } else {
        ref.row.style.outline = "none";
        ref.row.style.background = "transparent";
      }
    });
  }

  _scrollRowIntoView(name = this.testNames[this.currentIndex]) {
    const row = this._rowRefs.get(name)?.row;
    if (!row) return;

    const scrollContainer = this.ui?.window?.content || row.closest?.(".floating-window__content");
    if (scrollContainer) {
      try {
        const rowRect = row.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        const headerRect = this.ui?.table?.querySelector?.("thead")?.getBoundingClientRect?.();
        const stickyHeaderHeight = headerRect ? Math.max(0, Math.min(headerRect.height, containerRect.height)) : 0;
        const visibleTop = containerRect.top + stickyHeaderHeight;
        const visibleBottom = containerRect.bottom;
        const fullyVisible = rowRect.top >= visibleTop && rowRect.bottom <= visibleBottom;
        if (fullyVisible) return;
      } catch {}
    }

    try {
      row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    } catch {
      try { row.scrollIntoView(false); } catch {}
    }
  }

  _setAllEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    this.testNames.forEach((name) => {
      this.enabled.set(name, nextEnabled);
      const ref = this._rowRefs.get(name);
      if (ref?.checkbox) ref.checkbox.checked = nextEnabled;
    });
    this._syncSelectAllCheckbox();
  }

  _syncSelectAllCheckbox() {
    const total = this.testNames.length;
    const enabledCount = this.testNames.reduce((count, name) => (
      this.enabled.get(name) ? count + 1 : count
    ), 0);

    if (this._selectAllCheckbox) {
      this._selectAllCheckbox.checked = total > 0 && enabledCount === total;
      this._selectAllCheckbox.indeterminate = enabledCount > 0 && enabledCount < total;
      this._selectAllCheckbox.title = enabledCount === total
        ? "Uncheck all tests"
        : "Check all tests";
    }

    if (this._runSelectedButton) {
      const disabled = enabledCount === 0 || this._isRunningSelected;
      this._runSelectedButton.disabled = disabled;
      this._runSelectedButton.style.opacity = disabled ? "0.5" : "1";
      this._runSelectedButton.style.cursor = disabled ? "not-allowed" : "pointer";
      this._runSelectedButton.title = this._isRunningSelected
        ? "Selected tests are running"
        : `Run ${enabledCount} selected test${enabledCount === 1 ? "" : "s"}`;
    }
  }

  _requestStop() {
    if (!this._isRunningSelected) return;
    this._stopRequested = true;
    this._syncStopButton();
  }

  _syncStopButton() {
    if (!this._stopButton) return;
    const disabled = !this._isRunningSelected || this._stopRequested;
    this._stopButton.disabled = disabled;
    this._stopButton.style.opacity = disabled ? "0.5" : "1";
    this._stopButton.style.cursor = disabled ? "not-allowed" : "pointer";
    this._stopButton.title = this._stopRequested
      ? "Stop requested"
      : (this._isRunningSelected ? "Stop after current test" : "No selected run is active");
  }

  // ====== Status + error helpers ======
  _setStatus(name, value /* "", "pass", "fail" */) {
    this.status.set(name, value);
    const ref = this._rowRefs.get(name);
    if (ref) updateStatusCell(ref.statusCell, value);
    this._resortAfterValueChange("status");
  }

  _setDuration(name, value) {
    this.durationMs.set(name, value);
    const ref = this._rowRefs.get(name);
    if (ref) updateDurationCell(ref.durationCell, value);
    this._resortAfterValueChange("duration");
  }

  _resortAfterValueChange(key) {
    if (this._sortState.key !== key) return;
    const selectedName = this.testNames[this.currentIndex] || null;
    this._sortTests();
    if (selectedName) {
      const nextIndex = this.testNames.indexOf(selectedName);
      if (nextIndex >= 0) this.currentIndex = nextIndex;
    }
    this._renderRows();
    this._applySelectionStyles();
  }

  _setError(name, error) {
    if (!error) { this.errors.delete(name); return; }
    this.errors.set(name, {
      message: String(error && error.message ? error.message : error),
      stack: (error && error.stack) ? String(error.stack) : "",
    });
  }

  _showErrorLog(name) {
    const err = this.errors.get(name);
    this._ensureLogWindow();
    if (!this.logWindow || !this.logContent) return;
    this.logWindow.setTitle(`Log - ${name}`);
    this.logContent.innerHTML = "";

    const screenshot = this.screenshots.get(name);
    if (screenshot) {
      const shotWrap = document.createElement("div");
      Object.assign(shotWrap.style, {
        marginBottom: "8px",
        display: "flex",
        justifyContent: "center",
      });
      const img = document.createElement("img");
      img.src = screenshot;
      img.alt = `Canvas snapshot for ${name}`;
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.border = "1px solid #1e2030";
      img.style.borderRadius = "8px";
      shotWrap.appendChild(img);
      this.logContent.appendChild(shotWrap);
    }

    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.lineHeight = "1.5";
    pre.style.background = "#111217";
    pre.style.border = "1px solid #1e2030";
    pre.style.padding = "3px";
    pre.style.borderRadius = "8px";
    pre.textContent = err ? `${err.message}\n\n${err.stack}` : "No error captured for this test.";
    this.logContent.appendChild(pre);
    this.logWindow.root.style.display = "flex";
  }

  _ensureLogWindow() {
    if (this.logWindow) return;
    const fw = new FloatingWindow({
      title: "Log",
      width: 720,
      height: 520,
      right: 24,
      top: 80,
      shaded: false,
      onClose: () => this._hideLogWindow(),
    });

    const content = document.createElement("div");
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "10px";
    content.style.width = "100%";
    content.style.height = "100%";
    content.style.boxSizing = "border-box";

    fw.content.appendChild(content);

    this.logWindow = fw;
    this.logContent = content;
    try { fw.root.style.display = "none"; } catch {}
  }

  _hideLogWindow() {
    if (!this.logWindow?.root) return;
    try { this.logWindow.root.style.display = "none"; } catch {}
  }

  // ====== Execution helpers ======
  async _runSingleByName(name) {
    if (!name) return;
    const runStartMs = getNowMs();
    const functionToRun = testFunctions.find(func => func.test.name === name);
    // clear previous error for this test
    this._setError(name, null);
    this._setStatus(name, "");
    this._setDuration(name, "running");

    // Visually mark as running
    const ref = this._rowRefs.get(name);
    if (ref) {
      ref.row.style.background = "#151726";
    }
    this._scrollRowIntoView(name);

    if (!functionToRun) {
      const err = new Error(`Unknown test: ${name}`);
      this._setError(name, err);
      this._setStatus(name, "fail");
      if (ref) {
        const idx = this.testNames.indexOf(name);
        ref.row.style.background = idx === this.currentIndex ? "#12131a" : "transparent";
      }
      this._setDuration(name, getNowMs() - runStartMs);
      return;
    }

    try {
      // Try a single-test runner if provided; otherwise fall back to calling the function directly.
      if (typeof runSingleTest === "function") {
        this.startLogging();
        this.env.partHistory.reset();
        await runSingleTest(functionToRun, this.env.partHistory);
        // After the test completes, zoom-to-fit then capture a canvas snapshot for the log
        try {
          if (typeof this.env.zoomToFit === 'function') {
            this.env.zoomToFit(1.2);
          } else {
            this.env.render();
          }
          // Wait a frame to ensure the camera/render settled
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const dataURL = this.env.renderer?.domElement?.toDataURL?.("image/png");
          if (dataURL && typeof dataURL === 'string' && dataURL.startsWith('data:image')) {
            this.screenshots.set(name, dataURL);
          }
        } catch (_) { /* best-effort snapshot */ }

        this._setError(name, await this.endLogging());
        this._setStatus(name, "pass");
      }
    } catch (err) {
      console.error(`Error in test ${name}:`, err);
      this._setError(name, err);
      this._setStatus(name, "fail");
    } finally {
      this._setDuration(name, getNowMs() - runStartMs);
      // restore background depending on selection
      const idx = this.testNames.indexOf(name);
      if (ref) {
        if (idx === this.currentIndex) {
          ref.row.style.background = "#12131a";
        } else {
          ref.row.style.background = "transparent";
        }
      }
    }
  }

  async startLogging() {
    if (!this.loggingTool) return;
    this.loggingTool.clearLogs();

  }
  async endLogging() {
    if (!this.loggingTool) return "";
    let errorString = "";
    this.loggingTool.getLogs().forEach(log => {
      console.log(log);

      log.args.forEach(arg => {
        // test if log.args is a string and then move on to the next loop
        if (typeof arg === "string") {
          errorString += `${arg}\n`;
          return;
        }
        if (typeof arg === "object" && arg !== null) {
          errorString += `${JSON.stringify(arg, null, 2)}\n`;
        }
      });

    });
    return errorString;
  }


  async _runSelected() {
    if (this._isRunningSelected) return;

    this._isRunningSelected = true;
    this._stopRequested = false;
    this._syncSelectAllCheckbox();
    this._syncStopButton();

    // Reset quick screenshot board
    this.popupDiv.innerHTML = "";

    try {
      for (let i = 0; i < this.testNames.length; i++) {
        if (this._stopRequested) break;
        const name = this.testNames[i];
        if (!this.enabled.get(name)) continue;
        this._selectRow(i);

        await this._runSingleByName(name);
      }
    } finally {
      this._isRunningSelected = false;
      this._stopRequested = false;
      this._syncSelectAllCheckbox();
      this._syncStopButton();
    }
  }
}

// ====== Styling helpers ======
function darkButtonStyle() {
  return {
    background: "#1f2937",
    color: "#f9fafb",
    border: "1px solid #374151",
    padding: "3px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "700",
    outline: "none",
    transition: "background 120ms ease, transform 60ms ease, box-shadow 120ms ease",
    userSelect: "none",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  };
}
function decorateButtonHover(btn) {
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "#2b3545";
    btn.style.boxShadow = "0 3px 10px rgba(0,0,0,0.35)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "#1f2937";
    btn.style.transform = "none";
    btn.style.boxShadow = "none";
  });
  btn.addEventListener("mousedown", () => {
    btn.style.transform = "translateY(1px)";
  });
  btn.addEventListener("mouseup", () => {
    btn.style.transform = "none";
  });
}
function makeButton(label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  Object.assign(btn.style, darkButtonStyle());
  decorateButtonHover(btn);
  return btn;
}
function makeHeaderButton(label, title) {
  const btn = document.createElement("button");
  btn.className = "fw-btn";
  btn.type = "button";
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.style.minWidth = "36px";
  btn.style.textAlign = "center";
  btn.style.fontSize = "14px";
  btn.style.lineHeight = "1";
  return btn;
}
function sortHeaderButton(label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.label = label;
  btn.textContent = label;
  Object.assign(btn.style, {
    appearance: "none",
    background: "transparent",
    border: "0",
    color: "#9aa0aa",
    cursor: "pointer",
    display: "block",
    font: "inherit",
    fontWeight: "600",
    margin: "0",
    minWidth: "0",
    overflow: "hidden",
    padding: "0",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.color = "#e5e7eb";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.color = "#9aa0aa";
  });
  return btn;
}
function miniButton(label) {
  const btn = makeButton(label);
  btn.style.padding = "3px";
  btn.style.borderRadius = "6px";
  btn.style.fontSize = "10px";
  return btn;
}
function th(text, width) {
  const th = document.createElement("th");
  th.textContent = text;
  th.style.textAlign = "left";
  th.style.padding = "8px 6px";
  th.style.borderBottom = "1px solid #23232b";
  th.style.color = "#9aa0aa";
  th.style.fontWeight = "600";
  th.style.background = "#0b0b0e";
  th.style.position = "sticky";
  th.style.top = "0";
  th.style.zIndex = "3";
  th.style.overflow = "hidden";
  th.style.textOverflow = "ellipsis";
  th.style.whiteSpace = "nowrap";
  th.style.boxSizing = "border-box";
  if (width) th.style.width = width;
  return th;
}
function rowStyle() {
  return {
    borderBottom: "1px solid #1c1d25",
  };
}
function cellStyle() {
  return {
    padding: "3px 6px",
    verticalAlign: "middle",
    boxSizing: "border-box",
  };
}
function truncateTextStyle() {
  return {
    display: "block",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}
function compareStatusValues(a, b, direction = "asc") {
  const rank = (value) => {
    if (value === "fail") return 0;
    if (value === "pass") return 1;
    return 2;
  };
  const aRank = rank(a);
  const bRank = rank(b);
  const aEmpty = aRank === 2;
  const bEmpty = bRank === 2;
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  const cmp = aRank - bRank;
  return direction === "desc" ? -cmp : cmp;
}
function compareDurationValues(a, b, direction = "asc") {
  const aNumber = typeof a === "number" && Number.isFinite(a);
  const bNumber = typeof b === "number" && Number.isFinite(b);
  if (aNumber && bNumber) {
    const cmp = a - b;
    return direction === "desc" ? -cmp : cmp;
  }
  if (aNumber) return -1;
  if (bNumber) return 1;
  if (a === b) return 0;
  if (a === "running") return -1;
  if (b === "running") return 1;
  return 0;
}
function getNowMs() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {}
  return Date.now();
}
function formatDurationMs(value) {
  const ms = Math.max(0, Number(value) || 0);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
function updateDurationCell(cell, value) {
  cell.textContent = "";
  const label = document.createElement("span");
  const isRunning = value === "running";
  const text = isRunning ? "..." : (value == null ? "" : formatDurationMs(value));
  label.textContent = text;
  label.title = isRunning ? "Running" : text;
  label.style.display = "block";
  label.style.maxWidth = "100%";
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  label.style.textAlign = "right";
  label.style.color = isRunning ? "#dbeafe" : "#a7aab3";
  label.style.fontVariantNumeric = "tabular-nums";
  cell.appendChild(label);
}
function updateStatusCell(cell, value) {
  // value: "", "pass", "fail"
  cell.textContent = "";
  const badge = document.createElement("span");
  badge.textContent = value === "" ? "" : value.toUpperCase();
  badge.style.fontWeight = "800";
  badge.style.letterSpacing = "0.5px";
  badge.style.padding = value ? "2px 8px" : "0";
  badge.style.borderRadius = "999px";
  badge.style.display = "inline-block";
  badge.style.maxWidth = "100%";
  badge.style.overflow = "hidden";
  badge.style.textOverflow = "ellipsis";
  badge.style.boxSizing = "border-box";
  if (value === "pass") {
    badge.style.background = "#093d2a";
    badge.style.color = "#86efac";
    badge.style.border = "1px solid #14532d";
  } else if (value === "fail") {
    badge.style.background = "#3a0b0f";
    badge.style.color = "#fca5a5";
    badge.style.border = "1px solid #7f1d1d";
  } else {
    badge.style.background = "transparent";
    badge.style.color = "#a7aab3";
  }
  cell.appendChild(badge);
}


// Note: No default instance is created here.
// The BrowserTesting UI is now launched on-demand from a toolbar button.
