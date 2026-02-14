function edge(id, a, b, bend) {
    return {
        id,
        polyline: [a, b],
        ...(bend ? { bend } : {})
    };
}
function scenarioBaselineChannel() {
    const baseRightAttachLen = Math.hypot(230 - 218, 144 - 0);
    const baseLeftAttachLen = Math.hypot(22 - 0, 132 - 0);
    const returnAttachLen = Math.hypot(150 - 12, 58 - 48);
    const returnLip = {
        kind: 'flat',
        id: 's1-return-lip',
        label: 'Return Lip',
        color: 0xec4899,
        outline: [
            [0, 0],
            [returnAttachLen, 0],
            [132, 16],
            [10, 20]
        ],
        edges: [
            edge('s1-return-attach', [0, 0], [returnAttachLen, 0]),
            edge('s1-return-top', [132, 16], [10, 20]),
            edge('s1-return-left', [10, 20], [0, 0]),
            edge('s1-return-right', [returnAttachLen, 0], [132, 16])
        ]
    };
    const rightWall = {
        kind: 'flat',
        id: 's1-right-wall',
        label: 'Right Wall',
        color: 0x22c55e,
        outline: [
            [0, 0],
            [baseRightAttachLen, 0],
            [150, 48],
            [12, 58]
        ],
        edges: [
            edge('s1-right-attach', [0, 0], [baseRightAttachLen, 0]),
            edge('s1-right-top', [150, 48], [12, 58], {
                kind: 'bend',
                id: 's1-return-bend',
                color: 0xf97316,
                angleDeg: -100,
                midRadius: 3,
                kFactor: 0.39,
                children: [
                    {
                        flat: returnLip,
                        attachEdgeId: 's1-return-attach'
                    }
                ]
            }),
            edge('s1-right-left', [12, 58], [0, 0]),
            edge('s1-right-right', [baseRightAttachLen, 0], [150, 48])
        ]
    };
    const leftWall = {
        kind: 'flat',
        id: 's1-left-wall',
        label: 'Left Wall',
        color: 0x0ea5e9,
        outline: [
            [0, 0],
            [baseLeftAttachLen, 0],
            [122, 44],
            [-6, 36]
        ],
        edges: [
            edge('s1-left-attach', [0, 0], [baseLeftAttachLen, 0]),
            edge('s1-left-top', [122, 44], [-6, 36]),
            edge('s1-left-left', [-6, 36], [0, 0]),
            edge('s1-left-right', [baseLeftAttachLen, 0], [122, 44])
        ]
    };
    const root = {
        kind: 'flat',
        id: 's1-base',
        label: 'Base',
        color: 0x3b82f6,
        outline: [
            [0, 0],
            [230, 0],
            [218, 144],
            [22, 132]
        ],
        edges: [
            edge('s1-base-bottom', [0, 0], [230, 0]),
            edge('s1-base-right', [230, 0], [218, 144], {
                kind: 'bend',
                id: 's1-right-bend',
                color: 0xa855f7,
                angleDeg: 90,
                midRadius: 8,
                kFactor: 0.4,
                children: [
                    {
                        flat: rightWall,
                        attachEdgeId: 's1-right-attach'
                    }
                ]
            }),
            edge('s1-base-top', [218, 144], [22, 132]),
            edge('s1-base-left', [22, 132], [0, 0], {
                kind: 'bend',
                id: 's1-left-bend',
                color: 0x06b6d4,
                angleDeg: 90,
                midRadius: 8,
                kFactor: 0.4,
                children: [
                    {
                        flat: leftWall,
                        attachEdgeId: 's1-left-attach'
                    }
                ]
            })
        ]
    };
    return {
        id: 'baseline-channel',
        label: 'Baseline Channel',
        description: 'Two side bends plus a return lip. Mixed radii 8mm and 3mm.',
        tree: {
            thickness: 2,
            root
        }
    };
}
function scenarioSkewBracket() {
    const rightAttachLen = Math.hypot(260 - 240, 80 - 0);
    const leftAttachLen = Math.hypot(0 - 0, 120 - 0);
    const rightWing = {
        kind: 'flat',
        id: 's2-right-wing',
        label: 'Right Wing',
        color: 0x16a34a,
        outline: [
            [0, 0],
            [rightAttachLen, 0],
            [76, 52],
            [-12, 36]
        ],
        edges: [
            edge('s2-right-attach', [0, 0], [rightAttachLen, 0]),
            edge('s2-right-top', [76, 52], [-12, 36]),
            edge('s2-right-left', [-12, 36], [0, 0]),
            edge('s2-right-right', [rightAttachLen, 0], [76, 52])
        ]
    };
    const leftWing = {
        kind: 'flat',
        id: 's2-left-wing',
        label: 'Left Wing',
        color: 0x0284c7,
        outline: [
            [0, 0],
            [leftAttachLen, 0],
            [132, 40],
            [16, 58],
            [-10, 22]
        ],
        edges: [
            edge('s2-left-attach', [0, 0], [leftAttachLen, 0]),
            edge('s2-left-top', [132, 40], [16, 58]),
            edge('s2-left-tail', [16, 58], [-10, 22]),
            edge('s2-left-in', [-10, 22], [0, 0]),
            edge('s2-left-right', [leftAttachLen, 0], [132, 40])
        ]
    };
    const root = {
        kind: 'flat',
        id: 's2-root',
        label: 'Skew Plate',
        color: 0x1d4ed8,
        outline: [
            [0, 0],
            [240, 0],
            [260, 80],
            [190, 150],
            [0, 120]
        ],
        edges: [
            edge('s2-bottom', [0, 0], [240, 0]),
            edge('s2-right-lower', [240, 0], [260, 80], {
                kind: 'bend',
                id: 's2-right-bend',
                color: 0x7c3aed,
                angleDeg: 82,
                midRadius: 5,
                kFactor: 0.41,
                children: [
                    {
                        flat: rightWing,
                        attachEdgeId: 's2-right-attach'
                    }
                ]
            }),
            edge('s2-right-upper', [260, 80], [190, 150]),
            edge('s2-top-left', [190, 150], [0, 120]),
            edge('s2-left', [0, 120], [0, 0], {
                kind: 'bend',
                id: 's2-left-bend',
                color: 0x0891b2,
                angleDeg: -94,
                midRadius: 10,
                kFactor: 0.42,
                children: [
                    {
                        flat: leftWing,
                        attachEdgeId: 's2-left-attach'
                    }
                ]
            })
        ]
    };
    return {
        id: 'skew-bracket',
        label: 'Skew Bracket',
        description: 'Irregular pentagon base with opposing bends and different radii (5mm / 10mm).',
        tree: {
            thickness: 1.8,
            root
        }
    };
}
function scenarioHexStep() {
    const wallAttachLen = Math.hypot(250 - 220, 50 - 0);
    const returnAttachLen = Math.hypot(72 - -10, 70 - 62);
    const returnFlap = {
        kind: 'flat',
        id: 's3-return',
        label: 'Return Flap',
        color: 0xdb2777,
        outline: [
            [0, 0],
            [returnAttachLen, 0],
            [74, 22],
            [-4, 18]
        ],
        edges: [
            edge('s3-return-attach', [0, 0], [returnAttachLen, 0]),
            edge('s3-return-top', [74, 22], [-4, 18]),
            edge('s3-return-left', [-4, 18], [0, 0]),
            edge('s3-return-right', [returnAttachLen, 0], [74, 22])
        ]
    };
    const shortWall = {
        kind: 'flat',
        id: 's3-wall',
        label: 'Short Wall',
        color: 0x15803d,
        outline: [
            [0, 0],
            [wallAttachLen, 0],
            [72, 70],
            [-10, 62]
        ],
        edges: [
            edge('s3-wall-attach', [0, 0], [wallAttachLen, 0]),
            edge('s3-wall-top', [72, 70], [-10, 62], {
                kind: 'bend',
                id: 's3-return-bend',
                color: 0xea580c,
                angleDeg: 110,
                midRadius: 2,
                kFactor: 0.37,
                children: [
                    {
                        flat: returnFlap,
                        attachEdgeId: 's3-return-attach'
                    }
                ]
            }),
            edge('s3-wall-left', [-10, 62], [0, 0]),
            edge('s3-wall-right', [wallAttachLen, 0], [72, 70])
        ]
    };
    const root = {
        kind: 'flat',
        id: 's3-root',
        label: 'Hex Panel',
        color: 0x1e40af,
        outline: [
            [0, 0],
            [220, 0],
            [250, 50],
            [240, 130],
            [80, 160],
            [0, 110]
        ],
        edges: [
            edge('s3-bottom', [0, 0], [220, 0]),
            edge('s3-knee', [220, 0], [250, 50], {
                kind: 'bend',
                id: 's3-wall-bend',
                color: 0x7e22ce,
                angleDeg: -88,
                midRadius: 14,
                kFactor: 0.43,
                children: [
                    {
                        flat: shortWall,
                        attachEdgeId: 's3-wall-attach'
                    }
                ]
            }),
            edge('s3-right', [250, 50], [240, 130]),
            edge('s3-top-right', [240, 130], [80, 160]),
            edge('s3-top-left', [80, 160], [0, 110]),
            edge('s3-left', [0, 110], [0, 0])
        ]
    };
    return {
        id: 'hex-step',
        label: 'Hex Step',
        description: 'Hex-like base with a large-radius primary bend and a tight secondary return.',
        tree: {
            thickness: 2.2,
            root
        }
    };
}
function scenarioDoglegStrip() {
    const earAttachLen = Math.hypot(280 - 260, 50 - 0);
    const leftEar = {
        kind: 'flat',
        id: 's4-left-ear',
        label: 'Left Ear',
        color: 0x0891b2,
        outline: [
            [0, 0],
            [earAttachLen, 0],
            [58, 46],
            [-8, 34]
        ],
        edges: [
            edge('s4-left-attach', [0, 0], [earAttachLen, 0]),
            edge('s4-left-top', [58, 46], [-8, 34]),
            edge('s4-left-back', [-8, 34], [0, 0]),
            edge('s4-left-front', [earAttachLen, 0], [58, 46])
        ]
    };
    const rightEar = {
        kind: 'flat',
        id: 's4-right-ear',
        label: 'Right Ear',
        color: 0x0ea5e9,
        outline: [
            [0, 0],
            [earAttachLen, 0],
            [44, 58],
            [-10, 52]
        ],
        edges: [
            edge('s4-right-attach', [0, 0], [earAttachLen, 0]),
            edge('s4-right-top', [44, 58], [-10, 52]),
            edge('s4-right-back', [-10, 52], [0, 0]),
            edge('s4-right-front', [earAttachLen, 0], [44, 58])
        ]
    };
    const root = {
        kind: 'flat',
        id: 's4-root',
        label: 'Dogleg Strip',
        color: 0x1e3a8a,
        outline: [
            [0, 0],
            [260, 0],
            [280, 50],
            [260, 100],
            [0, 100],
            [-20, 50]
        ],
        edges: [
            edge('s4-bottom', [0, 0], [260, 0]),
            edge('s4-right-front', [260, 0], [280, 50], {
                kind: 'bend',
                id: 's4-right-bend',
                color: 0x9333ea,
                angleDeg: 75,
                midRadius: 12,
                kFactor: 0.44,
                children: [
                    {
                        flat: rightEar,
                        attachEdgeId: 's4-right-attach'
                    }
                ]
            }),
            edge('s4-right-back', [280, 50], [260, 100]),
            edge('s4-top', [260, 100], [0, 100]),
            edge('s4-left-back', [0, 100], [-20, 50], {
                kind: 'bend',
                id: 's4-left-bend',
                color: 0x6366f1,
                angleDeg: -112,
                midRadius: 4,
                kFactor: 0.38,
                children: [
                    {
                        flat: leftEar,
                        attachEdgeId: 's4-left-attach'
                    }
                ]
            }),
            edge('s4-left-front', [-20, 50], [0, 0])
        ]
    };
    return {
        id: 'dogleg-strip',
        label: 'Dogleg Strip',
        description: 'Six-sided strip with asymmetric end bends: wide-radius + tight-radius comparison.',
        tree: {
            thickness: 1.5,
            root
        }
    };
}
export const sampleScenarios = [
    scenarioBaselineChannel(),
    scenarioSkewBracket(),
    scenarioHexStep(),
    scenarioDoglegStrip()
];
export const defaultScenarioId = sampleScenarios[0].id;
export const sampleTree = sampleScenarios[0].tree;
