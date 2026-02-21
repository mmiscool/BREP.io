# API Examples

Standalone browser demos for the BREP kernel and Sketcher2D APIs.
This page links every live `.html` demo under `/apiExamples/`, including the examples index page.

## Example Hub
- Demo: [https://BREP.io/apiExamples/index.html](https://BREP.io/apiExamples/index.html)
- Source: [apiExamples/index.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/index.html)

## BREP Booleans
- Demo: [https://BREP.io/apiExamples/BREP_Booleans.html](https://BREP.io/apiExamples/BREP_Booleans.html)
- Source: [apiExamples/BREP_Booleans.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/BREP_Booleans.html)

## BREP Primitives
- Demo: [https://BREP.io/apiExamples/BREP_Primitives.html](https://BREP.io/apiExamples/BREP_Primitives.html)
- Source: [apiExamples/BREP_Primitives.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/BREP_Primitives.html)

## BREP Transforms
- Demo: [https://BREP.io/apiExamples/BREP_Transforms.html](https://BREP.io/apiExamples/BREP_Transforms.html)
- Source: [apiExamples/BREP_Transforms.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/BREP_Transforms.html)

## BREP Export
- Demo: [https://BREP.io/apiExamples/BREP_Export.html](https://BREP.io/apiExamples/BREP_Export.html)
- Source: [apiExamples/BREP_Export.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/BREP_Export.html)

## Embeded 2D Sketcher
- Demo: [https://BREP.io/apiExamples/Embeded_2D_Sketcher.html](https://BREP.io/apiExamples/Embeded_2D_Sketcher.html)
- Source: [apiExamples/Embeded_2D_Sketcher.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/Embeded_2D_Sketcher.html)
- Includes host-side exports for SVG, DXF, and sampled per-curve 3D polylines.

## Embeded CAD
- Demo: [https://BREP.io/apiExamples/Embeded_CAD.html](https://BREP.io/apiExamples/Embeded_CAD.html)
- Source: [apiExamples/Embeded_CAD.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/Embeded_CAD.html)
- Mounts the full CAD app with the iframe-based `CadEmbed` API and shows host-side history/model controls.

## Embeded CAD (CDN)
- Demo: [https://BREP.io/apiExamples/Embeded_CAD_CDN.html](https://BREP.io/apiExamples/Embeded_CAD_CDN.html)
- Source: [apiExamples/Embeded_CAD_CDN.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/Embeded_CAD_CDN.html)
- Uses direct jsDelivr import:
  `import { BREP, CadEmbed } from "https://cdn.jsdelivr.net/npm/brep-io-kernel@latest/dist-kernel/brep-kernel.js";`

## Embeded CAD Integration Test
- Demo: [https://BREP.io/apiExamples/Embeded_CAD_Integration_Test.html](https://BREP.io/apiExamples/Embeded_CAD_Integration_Test.html)
- Source: [apiExamples/Embeded_CAD_Integration_Test.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/Embeded_CAD_Integration_Test.html)
- Runs in-browser assertions across the `CadEmbed` lifecycle and runtime methods.
