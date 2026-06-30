import {Digraph, GraphNode} from "../digraphs/digraph.js"
import {checkSegment} from "./digraph_ab_elements.js"

// Example of segments argument (probably JSON array):
//    [
//        {
//            "id": "segment1",
//            "weight": 8,
//            "firstPoint": "p1",
//            "firstSide": "A",
//            "secondPoint": "p2",
//            "secondSide": "B"
//        },
//        {
//            "id": "segment2",
//            "weight": 3,
//            "firstPoint": "p2",
//            "firstSide": "A",
//            "secondPoint": "p3",
//            "secondSide": "B"
//        }
//        ...
//    ]
// Every point side (A or B) of a point P is a vertex of undirected graph (P/A or P/B),
// BUT path cannot enter to side A and exit from the same side A.
// So, every segment, connecting side X of point P with side Y of point Q,
// is transformed to a pair of digraph edges: P/X -> Q/inv(Y), Q/Y -> P/inv(X),
// where inv(A)=B, inv(B)=A

type ABSegmentLike = {
  id: string;
  weight: number;
  firstPoint: string;
  firstSide: string;
  secondPoint: string;
  secondSide: string;
};

export function abSegmentsToDigraph(segments: ABSegmentLike[]) {
  const allPointIds = new Set<string>();
  for (const segment of segments) {
    checkSegment(segment);
    addPointPair(allPointIds, segment);
  }
  const nodesA = toDigraphNodes(allPointIds, "A");
  const nodesB = toDigraphNodes(allPointIds, "B");
  for (const segment of segments) {
    addFirstToSecondEdge(nodesA, nodesB, segment);
    addSecondToFirstEdge(nodesA, nodesB, segment);
  }
  const result = new Digraph();
  result.addNodes(nodesA.values());
  result.addNodes(nodesB.values());
  return result;
}

export function pointToNode(point: string, side: string) {
  return point + "/" + side;
}

export function nodeToPoint(node: string) {
  if (node.endsWith("/A") || node.endsWith("/B")) {
    return node.substring(0, node.length - 2);
  } else {
    throw "'" + node + "' is not a correct node name in AB-digraph";
  }
}

// private
function addPointPair(pointSet: Set<string>, segment: ABSegmentLike) {
  pointSet.add(String(segment.firstPoint));
  pointSet.add(String(segment.secondPoint));
}

// private
function toDigraphNodes(pointSet: Set<string>, side: string) {
  const result = new Map<string, GraphNode>();
  for (const point of pointSet) {
    result.set(point, new GraphNode(pointToNode(point, side)));
  }
  return result;
}

// private
function addFirstToSecondEdge(
  nodesA: Map<string, GraphNode>,
  nodesB: Map<string, GraphNode>,
  segment: ABSegmentLike,
) {
  const firstNodes = segment.firstSide == "A" ? nodesB : nodesA;
  // - inversion!
  const secondNodes = segment.secondSide == "A" ? nodesA : nodesB;
  const firstNode = firstNodes.get(segment.firstPoint);
  const secondNode = secondNodes.get(segment.secondPoint);
  firstNode?.addEdge(segment.weight, secondNode?.id || '', segment.id);
}

// private
function addSecondToFirstEdge(
  nodesA: Map<string, GraphNode>,
  nodesB: Map<string, GraphNode>,
  segment: ABSegmentLike,
) {
  const firstNodes = segment.firstSide == "A" ? nodesA : nodesB;
  const secondNodes = segment.secondSide == "A" ? nodesB : nodesA;
  // - inversion!
  const firstNode = firstNodes.get(segment.firstPoint);
  const secondNode = secondNodes.get(segment.secondPoint);
  secondNode?.addEdge(segment.weight, firstNode?.id || '', segment.id);
}

// private
function _otherSide(side: string) {
  return side == "A" ? "B" : "A";
}
