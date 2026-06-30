// Generated from current part history on 2026-05-31T20:11:26.206Z
// Feature count: 5
declare const env: any;

export async function test_generated_history_20260531201126(partHistory = env.partHistory) {
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator =
    {
      "fields": [],
      "values": {}
    };

  const feature1 = await partHistory.newFeature("S");
  Object.assign(feature1.inputParams,
    {
      "id": "S3",
      "sketchPlane": null,
      "editSketch": null,
      "dumpSketchDiagnostics": null,
      "curveResolution": "resolution"
    });
  feature1.persistentData =
    {
      "sketch": {
        "points": [
          {
            "id": 0,
            "x": 0,
            "y": 0,
            "fixed": true,
            "construction": true,
            "externalReference": false
          },
          {
            "id": 1,
            "x": 0,
            "y": 0,
            "fixed": true,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 2,
            "x": 50.00004,
            "y": 49.999956,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 3,
            "x": 0,
            "y": 0,
            "fixed": true,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 4,
            "x": 50.000039,
            "y": 0,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 5,
            "x": 50.000039,
            "y": 0,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 6,
            "x": 50.00004,
            "y": 49.999957,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 7,
            "x": 0.000002,
            "y": 49.999957,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 8,
            "x": 0.000002,
            "y": 49.999957,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 9,
            "x": 0.000002,
            "y": 49.999957,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 10,
            "x": -49.999977,
            "y": 49.999957,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 12,
            "x": 50.00004,
            "y": 49.999956,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 13,
            "x": 50.00004,
            "y": 49.999956,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 14,
            "x": 100.00005,
            "y": 49.999956,
            "fixed": false,
            "construction": false,
            "externalReference": false
          }
        ],
        "geometries": [
          {
            "id": 1,
            "type": "line",
            "points": [
              1,
              4
            ],
            "construction": false
          },
          {
            "id": 2,
            "type": "line",
            "points": [
              5,
              2
            ],
            "construction": false
          },
          {
            "id": 3,
            "type": "line",
            "points": [
              6,
              7
            ],
            "construction": true
          },
          {
            "id": 4,
            "type": "line",
            "points": [
              8,
              3
            ],
            "construction": false
          },
          {
            "id": 5,
            "type": "line",
            "points": [
              9,
              10
            ],
            "construction": false
          },
          {
            "id": 7,
            "type": "line",
            "points": [
              13,
              14
            ],
            "construction": false
          }
        ],
        "constraints": [
          {
            "id": 0,
            "type": "⏚",
            "points": [
              0
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "0:0,0,1;"
          },
          {
            "id": 1,
            "type": "≡",
            "points": [
              1,
              3
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "1:0,0,1;3:0,0,1;"
          },
          {
            "id": 2,
            "type": "≡",
            "points": [
              4,
              5
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "4:50.000039,0,0;5:50.000039,0,0;"
          },
          {
            "id": 3,
            "type": "≡",
            "points": [
              2,
              6
            ],
            "status": "",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "2:1415.775597,1415.775502,0;6:1415.775597,1415.775502,0;"
          },
          {
            "id": 4,
            "type": "≡",
            "points": [
              7,
              8
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "7:0.000002,49.999957,0;8:0.000002,49.999957,0;"
          },
          {
            "id": 5,
            "type": "⟂",
            "points": [
              1,
              4,
              5,
              2
            ],
            "status": "",
            "error": null,
            "value": 90,
            "_previousSolveValue": 90,
            "previousPointValues": "1:0,0,1;4:2136.845946,0,0;5:2136.845946,0.000001,0;2:2136.845946,753.078375,0;"
          },
          {
            "id": 6,
            "type": "⟂",
            "points": [
              5,
              2,
              6,
              7
            ],
            "status": "solved",
            "error": null,
            "value": 90,
            "_previousSolveValue": 90,
            "previousPointValues": "5:50.0000395,0,0;2:50.0000395,49.999956,0;6:50.00004,49.999957,0;7:0.000002,49.999957,0;"
          },
          {
            "id": 7,
            "type": "⟂",
            "points": [
              6,
              7,
              8,
              3
            ],
            "status": "",
            "error": null,
            "value": 90,
            "_previousSolveValue": 90,
            "previousPointValues": "6:756.120784,500.309262,0;7:-0.000001,500.309262,0;8:0,500.240453,0;3:0,0,1;"
          },
          {
            "id": 8,
            "type": "≡",
            "points": [
              1,
              0
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "1:0,0,1;0:0,0,1;"
          },
          {
            "id": 9,
            "type": "━",
            "points": [
              1,
              4
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "1:0,0,1;4:50.000039,0,0;"
          },
          {
            "id": 11,
            "type": "≡",
            "points": [
              2,
              12
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "2:1415.775597,1415.775502,0;12:1415.775597,1415.775502,0;"
          },
          {
            "id": 12,
            "type": "≡",
            "points": [
              12,
              13
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "12:2020.419514,689.311357,0;13:2020.419514,689.311357,0;"
          },
          {
            "id": 13,
            "type": "≡",
            "points": [
              9,
              7
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "9:0.000002,49.999957,0;7:0.000002,49.999957,0;"
          },
          {
            "id": 14,
            "type": "━",
            "points": [
              13,
              14
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "13:50.00004,49.999956,0;14:100.00005,49.999956,0;"
          },
          {
            "id": 15,
            "type": "━",
            "points": [
              9,
              10
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "9:0.000002,49.999957,0;10:-49.999977,49.999957,0;"
          },
          {
            "id": 16,
            "type": "━",
            "points": [
              6,
              7
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": null,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "6:50.00004,49.999957,0;7:0.000002,49.999957,0;"
          },
          {
            "id": 17,
            "type": "⇌",
            "points": [
              9,
              10,
              8,
              3
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": 1415.775429,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": 1415.775429,
            "previousPointValues": "9:0.000002,49.999957,0;10:-49.999977,49.999957,0;8:0.000002,49.999957,0;3:0,0,1;"
          },
          {
            "id": 18,
            "type": "⇌",
            "points": [
              8,
              3,
              1,
              4
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": 1415.775601,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": 1415.775601,
            "previousPointValues": "8:0.000002,49.999957,0;3:0,0,1;1:0,0,1;4:50.000039,0,0;"
          },
          {
            "id": 19,
            "type": "⇌",
            "points": [
              8,
              3,
              5,
              2
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": 1415.7755124999999,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": 1415.7755124999999,
            "previousPointValues": "8:0.000002,49.999957,0;3:0,0,1;5:50.000039,0,0;2:50.00004,49.999956,0;"
          },
          {
            "id": 20,
            "type": "⇌",
            "points": [
              8,
              3,
              13,
              14
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": 1415.7755481249997,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_previousSolveValue": 1415.7755481249997,
            "previousPointValues": "8:0.000002,49.999957,0;3:0,0,1;13:50.00004,49.999956,0;14:100.00005,49.999956,0;"
          },
          {
            "id": 21,
            "type": "⟺",
            "points": [
              8,
              3
            ],
            "labelX": 0,
            "labelY": 0,
            "displayStyle": "",
            "value": 50,
            "valueNeedsSetup": true,
            "status": "solved",
            "error": null,
            "_distanceRequestedTarget": 50,
            "_distanceAppliedTarget": 50,
            "_distanceThrottleActive": false,
            "_distanceLastAppliedPassToken": "493:117",
            "_previousSolveValue": 50,
            "previousPointValues": "8:0.000002,49.999957,0;3:0,0,1;"
          }
        ]
      }
    };

  const feature2 = await partHistory.newFeature("SM.CF");
  Object.assign(feature2.inputParams,
    {
      "id": "SM.CF4",
      "path": [
        "S3:G5",
        "S3:G4",
        "S3:G1",
        "S3:G2",
        "S3:G7"
      ],
      "distance": "19",
      "thickness": "3",
      "reverseSheetSide": true,
      "bendRadius": "9",
      "neutralFactor": 0.5,
      "consumePathSketch": true
    });

  const feature3 = await partHistory.newFeature("S");
  Object.assign(feature3.inputParams,
    {
      "id": "S5",
      "sketchPlane": null,
      "editSketch": null,
      "dumpSketchDiagnostics": null,
      "curveResolution": "resolution"
    });
  feature3.persistentData =
    {
      "sketch": {
        "points": [
          {
            "id": 0,
            "x": 0,
            "y": 0,
            "fixed": true,
            "construction": true,
            "externalReference": false
          },
          {
            "id": 1,
            "x": -35.195316,
            "y": -126.685373,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 2,
            "x": 28.344033,
            "y": -77.153096,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 3,
            "x": -35.195316,
            "y": -126.685373,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 4,
            "x": 28.344033,
            "y": -126.685373,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 5,
            "x": 28.344033,
            "y": -126.685373,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 6,
            "x": 28.344033,
            "y": -77.153096,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 7,
            "x": -35.195316,
            "y": -77.153096,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 8,
            "x": -35.195316,
            "y": -77.153096,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 9,
            "x": -6.775156,
            "y": -99.483217,
            "fixed": false,
            "construction": false,
            "externalReference": false
          },
          {
            "id": 10,
            "x": -2.309131,
            "y": -112.881298,
            "fixed": false,
            "construction": false,
            "externalReference": false
          }
        ],
        "geometries": [
          {
            "id": 1,
            "type": "line",
            "points": [
              1,
              4
            ],
            "construction": false
          },
          {
            "id": 2,
            "type": "line",
            "points": [
              5,
              2
            ],
            "construction": false
          },
          {
            "id": 3,
            "type": "line",
            "points": [
              6,
              7
            ],
            "construction": false
          },
          {
            "id": 4,
            "type": "line",
            "points": [
              8,
              3
            ],
            "construction": false
          },
          {
            "id": 5,
            "type": "circle",
            "points": [
              9,
              10
            ],
            "construction": false
          }
        ],
        "constraints": [
          {
            "id": 0,
            "type": "⏚",
            "points": [
              0
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "0:0,0,1;"
          },
          {
            "id": 1,
            "type": "≡",
            "points": [
              1,
              3
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "1:-35.195316,-126.685373,0;3:-35.195316,-126.685373,0;"
          },
          {
            "id": 2,
            "type": "≡",
            "points": [
              4,
              5
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "4:28.344033,-126.685373,0;5:28.344033,-126.685373,0;"
          },
          {
            "id": 3,
            "type": "≡",
            "points": [
              2,
              6
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "2:28.344033,-77.153096,0;6:28.344033,-77.153096,0;"
          },
          {
            "id": 4,
            "type": "≡",
            "points": [
              7,
              8
            ],
            "status": "solved",
            "error": null,
            "_previousSolveValue": null,
            "previousPointValues": "7:-35.195316,-77.153096,0;8:-35.195316,-77.153096,0;"
          },
          {
            "id": 5,
            "type": "⟂",
            "points": [
              1,
              4,
              5,
              2
            ],
            "status": "solved",
            "error": null,
            "value": 270,
            "_previousSolveValue": 270,
            "previousPointValues": "1:-35.195316,-126.685373,0;4:28.344033,-126.685373,0;5:28.344033,-126.685373,0;2:28.344033,-77.153096,0;"
          },
          {
            "id": 6,
            "type": "⟂",
            "points": [
              5,
              2,
              6,
              7
            ],
            "status": "solved",
            "error": null,
            "value": 270,
            "_previousSolveValue": 270,
            "previousPointValues": "5:28.344033,-126.685373,0;2:28.344033,-77.153096,0;6:28.344033,-77.153096,0;7:-35.195316,-77.153096,0;"
          },
          {
            "id": 7,
            "type": "⟂",
            "points": [
              6,
              7,
              8,
              3
            ],
            "status": "solved",
            "error": null,
            "value": 270,
            "_previousSolveValue": 270,
            "previousPointValues": "6:28.344033,-77.153096,0;7:-35.195316,-77.153096,0;8:-35.195316,-77.153096,0;3:-35.195316,-126.685373,0;"
          }
        ]
      }
    };

  const feature4 = await partHistory.newFeature("SM.TAB");
  Object.assign(feature4.inputParams,
    {
      "id": "SM.TAB6",
      "profile": "S5:PROFILE",
      "thickness": 1,
      "placementMode": "forward",
      "bendRadius": 0.125,
      "neutralFactor": 0.5,
      "consumeProfileSketch": true
    });

  const feature5 = await partHistory.newFeature("SM.F");
  Object.assign(feature5.inputParams,
    {
      "id": "SM.F7",
      "faces": [
        "SM.TAB6:FLAT:SM.TAB6:flat_root:SIDE:SM.TAB6:flat_root:e2"
      ],
      "useOppositeCenterline": false,
      "flangeLength": 10,
      "edgeStartSetback": 0,
      "edgeEndSetback": 0,
      "flangeLengthReference": "outside",
      "angle": 90,
      "inset": "material_inside",
      "bendRadius": "4",
      "offset": 0
    });

  await partHistory.runHistory();

  // Manifold topology check: build vert→face map first, then check boundary edges
  const solids = [];
  const walkScene = (obj) => {
    if (!obj) return;
    if (Array.isArray(obj._triVerts) && obj._triVerts.length > 0) solids.push(obj);
    if (Array.isArray(obj.children)) obj.children.forEach(walkScene);
  };
  walkScene(partHistory.scene);

  for (const solid of solids) {
    const tv = solid._triVerts || [];
    const ids = solid._triIDs || [];
    const triCount = (tv.length / 3) | 0;
    if (!triCount) continue;

    // Build edge map and vert→faceName map in one pass
    const em = new Map(); // 'a,b' → true (directed edge exists)
    const vertFace = new Map(); // vertIdx → faceName
    const nameOf = (id) => solid._idToFaceName?.get(id) || String(id);
    for (let t = 0; t < triCount; t++) {
      const a = tv[t*3], b = tv[t*3+1], c = tv[t*3+2];
      const fn = nameOf(ids[t]);
      if (!vertFace.has(a)) vertFace.set(a, fn);
      if (!vertFace.has(b)) vertFace.set(b, fn);
      if (!vertFace.has(c)) vertFace.set(c, fn);
      em.set(a+','+b, true); em.set(b+','+c, true); em.set(c+','+a, true);
    }

    const pairSet = new Set();
    for (const k of em.keys()) {
      const comma = k.indexOf(',');
      const a = k.slice(0, comma), b = k.slice(comma+1);
      if (!em.has(b+','+a)) pairSet.add((vertFace.get(+a)||'?')+'|'+(vertFace.get(+b)||'?'));
    }
    if (pairSet.size > 0) {
      throw new Error(`${solid.name||'solid'} is non-manifold. Open boundary face pairs: ${[...pairSet].sort().slice(0,8).join(', ')}`);
    }
  }

  return partHistory;
}
