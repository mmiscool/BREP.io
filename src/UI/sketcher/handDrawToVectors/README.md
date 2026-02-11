# FuzzyDraw

Zero-dependency raster-to-geometry detection for hand-drawn lines, circles, and arcs. Input is a PNG (or any `ImageData`) and output is clean SVG primitives.

## Library usage (browser)

```js
import { loadPNGToImageData, vectorizeImageData, shapesToSVG } from "./fuzzydraw.js";

const imageData = await loadPNGToImageData(fileOrUrl);
const shapes = vectorizeImageData(imageData);
const svg = shapesToSVG(shapes, imageData.width, imageData.height);
```

If you already have a canvas:

```js
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const shapes = vectorizeImageData(imageData);
```

## API

- `loadPNGToImageData(source)`
  - Accepts `ImageData`, `HTMLCanvasElement`, `HTMLImageElement`, `Blob` (PNG), or URL string.
- `vectorizeImageData(imageData, options)`
  - Returns an array of `{type: "line"|"circle"|"arc"|"unknown", ...}`
- `shapesToSVG(shapes, width, height, options)`
  - Returns an SVG string.
- `renderShapesToSVG(svgEl, shapes, options)`
  - Writes the shapes into an existing `<svg>` element.

Each detected shape also includes a `confidence` value in the range `[0,1]`.

### Options

```js
{
  threshold: 200,        // grayscale threshold for ink pixels
  minAlpha: 10,          // alpha threshold
  minComponentSize: 25,  // ignore tiny specks
  sampleStep: 2,         // downsample points
  outlineStep: 2,        // boundary sampling for path display
  lineMaxRmsRatio: 0.02, // line RMS error / component diagonal
  lineMaxDistRatio: 0.05,
  lineMinEigenRatio: 8,  // line eccentricity threshold
  circleMaxRmsRatio: 0.08, // circle RMS error / radius
  circleMaxSpreadRatio: 0.25, // (rmax - rmin) / radius
  circleMinCurvatureRatio: 0.2, // component diag / radius
  fullCircleRatio: 0.9,         // arc span to classify as circle
  arcMinSpan: Math.PI / 6,      // minimum arc span
  circleByArcLengthRatio: 0.9,  // arc length / circumference
  arcLineRatio: 0.15            // short arcs -> line
}
```

### SVG options

```js
{
  showPoints: true,                // draw detected point series
  pointsStroke: "rgba(15,88,100,.6)",
  pointsStrokeWidth: 1.2,
  pointsDash: "3 6"
}
```

## Demo

Open `index.html` in a browser. Use **Draw** or **Erase** on the canvas and click **Vectorize** to see the resulting SVG geometry.
