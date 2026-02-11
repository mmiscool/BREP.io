import { vectorizeImageData, renderShapesToSVG } from "./fuzzydraw.js";

const canvas = document.getElementById("draw");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const svg = document.getElementById("output");
const btnVectorize = document.getElementById("vectorize");
const btnClear = document.getElementById("clear");
const btnToolDraw = document.getElementById("tool-draw");
const btnToolErase = document.getElementById("tool-erase");
const status = document.getElementById("status");
const confidence = document.getElementById("confidence");
const tuningControls = document.getElementById("tuning-controls");
const autoUpdate = document.getElementById("auto-update");
const btnResetTuning = document.getElementById("reset-tuning");

function getThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    canvasBg: styles.getPropertyValue("--canvas-bg").trim() || "#ffffff",
    canvasInk: styles.getPropertyValue("--canvas-ink").trim() || "#111111",
    svgInk: styles.getPropertyValue("--svg-ink").trim() || "#0c1116",
    svgPoints: styles.getPropertyValue("--svg-points").trim() || "rgba(15, 88, 100, 0.65)",
  };
}

const toolSettings = {
  draw: {
    lineWidth: 8,
  },
  erase: {
    lineWidth: 22,
  },
};

let activeTool = "draw";

function applyTool(theme = getThemeColors()) {
  const settings = toolSettings[activeTool] || toolSettings.draw;
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = settings.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = activeTool === "erase" ? theme.canvasBg : theme.canvasInk;
}

function setActiveTool(nextTool) {
  if (!toolSettings[nextTool]) return;
  activeTool = nextTool;
  btnToolDraw.classList.toggle("is-active", activeTool === "draw");
  btnToolErase.classList.toggle("is-active", activeTool === "erase");
  btnToolDraw.setAttribute("aria-pressed", activeTool === "draw");
  btnToolErase.setAttribute("aria-pressed", activeTool === "erase");
  canvas.dataset.tool = activeTool;
  applyTool();
}

const tunables = [
  {
    key: "threshold",
    label: "Ink threshold",
    min: 0,
    max: 255,
    step: 1,
    value: 210,
    integer: true,
  },
  {
    key: "sampleStep",
    label: "Sample step",
    min: 1,
    max: 6,
    step: 1,
    value: 2,
    integer: true,
  },
  {
    key: "outlineStep",
    label: "Outline step",
    min: 1,
    max: 6,
    step: 1,
    value: 1,
    integer: true,
  },
  {
    key: "minComponentSize",
    label: "Min component size",
    min: 5,
    max: 200,
    step: 1,
    value: 25,
    integer: true,
  },
  {
    key: "lineMaxRmsRatio",
    label: "Line RMS ratio",
    min: 0.005,
    max: 0.05,
    step: 0.001,
    value: 0.02,
  },
  {
    key: "lineMaxDistRatio",
    label: "Line max dist ratio",
    min: 0.01,
    max: 0.12,
    step: 0.001,
    value: 0.05,
  },
  {
    key: "lineMinEigenRatio",
    label: "Line eigen ratio",
    min: 1,
    max: 20,
    step: 0.1,
    value: 8,
  },
  {
    key: "circleMaxRmsRatio",
    label: "Circle RMS ratio",
    min: 0.005,
    max: 0.08,
    step: 0.001,
    value: 0.08,
  },
  {
    key: "circleMaxSpreadRatio",
    label: "Circle spread ratio",
    min: 0.05,
    max: 0.6,
    step: 0.01,
    value: 0.25,
  },
  {
    key: "circleMinCurvatureRatio",
    label: "Circle curvature ratio",
    min: 0.05,
    max: 1,
    step: 0.01,
    value: 0.2,
  },
  {
    key: "fullCircleRatio",
    label: "Full circle span",
    min: 0.5,
    max: 1,
    step: 0.01,
    value: 0.9,
  },
  {
    key: "arcMinSpan",
    label: "Arc min span (rad)",
    min: 0.05,
    max: Math.PI,
    step: 0.01,
    value: Math.PI / 6,
  },
  {
    key: "circleByArcLengthRatio",
    label: "Circle by arc length",
    min: 0.5,
    max: 1,
    step: 0.01,
    value: 0.9,
  },
];

const controlsByKey = new Map();
let vectorizeTimer = null;

function clearCanvas() {
  const theme = getThemeColors();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  applyTool(theme);
}

clearCanvas();

let drawing = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatValue(value, integer) {
  if (integer) return String(Math.round(value));
  return Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function buildTuningControls() {
  tuningControls.innerHTML = "";

  tunables.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "tuning__control";

    const labelRow = document.createElement("div");
    labelRow.className = "tuning__label-row";

    const label = document.createElement("span");
    label.textContent = item.label;

    const value = document.createElement("span");
    value.className = "tuning__value";
    value.textContent = formatValue(item.value, item.integer);

    labelRow.appendChild(label);
    labelRow.appendChild(value);

    const inputRow = document.createElement("div");
    inputRow.className = "tuning__inputs";

    const range = document.createElement("input");
    range.type = "range";
    range.min = item.min;
    range.max = item.max;
    range.step = item.step;
    range.value = item.value;

    const number = document.createElement("input");
    number.type = "number";
    number.min = item.min;
    number.max = item.max;
    number.step = item.step;
    number.value = item.value;

    inputRow.appendChild(range);
    inputRow.appendChild(number);

    wrapper.appendChild(labelRow);
    wrapper.appendChild(inputRow);
    tuningControls.appendChild(wrapper);

    controlsByKey.set(item.key, {
      item,
      range,
      number,
      value,
    });

    const sync = (source) => {
      const raw = Number(source.value);
      if (!Number.isFinite(raw)) return;
      const clamped = clamp(raw, item.min, item.max);
      const normalized = item.integer ? Math.round(clamped) : clamped;
      range.value = normalized;
      number.value = normalized;
      value.textContent = formatValue(normalized, item.integer);
    };

    range.addEventListener("input", (event) => {
      sync(event.target);
      scheduleVectorize();
    });

    number.addEventListener("input", (event) => {
      sync(event.target);
      scheduleVectorize();
    });
  });
}

function getTuningOptions() {
  const options = {};
  for (const [key, control] of controlsByKey.entries()) {
    const raw = Number(control.number.value);
    const value = control.item.integer ? Math.round(raw) : raw;
    options[key] = Number.isFinite(value) ? value : control.item.value;
  }
  return options;
}

function scheduleVectorize() {
  if (!autoUpdate.checked) return;
  if (vectorizeTimer) window.clearTimeout(vectorizeTimer);
  vectorizeTimer = window.setTimeout(() => {
    runVectorize();
  }, 150);
}

function resetTuning() {
  controlsByKey.forEach((control) => {
    const { item, range, number, value } = control;
    range.value = item.value;
    number.value = item.value;
    value.textContent = formatValue(item.value, item.integer);
  });
  if (autoUpdate.checked) {
    runVectorize();
  }
}

function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

canvas.addEventListener("pointerdown", (event) => {
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  applyTool();
  const pos = pointerPos(event);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
});

canvas.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  const pos = pointerPos(event);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
});

window.addEventListener("pointerup", () => {
  drawing = false;
});

function runVectorize() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const shapes = vectorizeImageData(imageData, getTuningOptions());
  const theme = getThemeColors();

  renderShapesToSVG(svg, shapes, {
    width: canvas.width,
    height: canvas.height,
    stroke: theme.svgInk,
    strokeWidth: 3,
    fill: "none",
    showPoints: true,
    pointsStroke: theme.svgPoints,
    pointsStrokeWidth: 1.2,
    pointsDash: "2 6",
  });

  const summary = shapes.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    return acc;
  }, {});

  status.textContent = Object.keys(summary).length
    ? Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(" | ")
    : "No shapes detected";

  const types = ["line", "arc", "circle"];
  const confidenceByType = types.map((type) => {
    const values = shapes.filter((s) => s.type === type && Number.isFinite(s.confidence))
      .map((s) => s.confidence);
    if (!values.length) return `${type}: —`;
    const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
    return `${type}: ${avg.toFixed(2)}`;
  });

  confidence.textContent = `Confidence — ${confidenceByType.join(" | ")}`;
}

btnClear.addEventListener("click", () => {
  clearCanvas();
  svg.innerHTML = "";
  status.textContent = "";
  confidence.textContent = "";
});

btnToolDraw.addEventListener("click", () => {
  setActiveTool("draw");
});

btnToolErase.addEventListener("click", () => {
  setActiveTool("erase");
});

btnVectorize.addEventListener("click", () => {
  runVectorize();
});

btnResetTuning.addEventListener("click", () => {
  resetTuning();
});

autoUpdate.addEventListener("change", () => {
  if (autoUpdate.checked) {
    runVectorize();
  }
});

setActiveTool(activeTool);
buildTuningControls();
