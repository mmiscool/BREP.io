import {nodeToPoint, pointToNode} from "./digraph_ab_builder.js"
import {PathInformation, ShortestPathTree} from "../digraphs/spt.js"

export class DigraphABShortestPathFinder {
  treeA: any;
  treeB: any;
  startPointId: string | null;

  constructor(digraph: any) {
    this.treeA = new ShortestPathTree(digraph);
    this.treeB = new ShortestPathTree(digraph);
    this.startPointId = null;
  }

  processPair(pointPair: any) {
    this.rebuild(pointPair.startPoint);
    pointPair.route = this.getShortestPathInformation(pointPair.endPoint);
  }

  rebuild(startPointId: string) {
    if (startPointId != this.startPointId) {
      this.build(startPointId);
    }
  }

  build(startPointId: string) {
    this.treeA.build(pointToNode(startPointId, "A"));
    this.treeB.build(pointToNode(startPointId, "B"));
    this.startPointId = startPointId;
  }

  // Rarely used
  getShortestPathInformationForBothSides(endPointId: string) {
    const result: any[] = [];
    addIfExists(result, this.treeA.getShortestPathInformation(pointToNode(endPointId, "A")));
    addIfExists(result, this.treeA.getShortestPathInformation(pointToNode(endPointId, "B")));
    addIfExists(result, this.treeB.getShortestPathInformation(pointToNode(endPointId, "A")));
    addIfExists(result, this.treeB.getShortestPathInformation(pointToNode(endPointId, "B")));
    return result;
  }

  getShortestPathInformation(endPointId: string, includePointsWhenNotFound = false) {
    const forBothSides = this.getShortestPathInformationForBothSides(endPointId);
    if (forBothSides.length == 0) {
      return includePointsWhenNotFound ?
        new PathInformation(this.startPointId, endPointId) :
        new PathInformation();
    }
    let result = forBothSides[0];
    for (let k = 1; k < forBothSides.length; k++) {
      if (forBothSides[k].distance < result.distance) {
        result = forBothSides[k];
      }
    }
    if (containsDuplicates(result.nodes)) {
      result.containsDuplicates = true;
    }
    return result;
  }
}

export function containsDuplicates(nodesArray: string[]) {
  const points = new Set();
  for (const node of nodesArray) {
    const p = nodeToPoint(node);
    if (points.has(p)) {
      return true;
    }
    points.add(p);
  }
  return false;
}

// private
function addIfExists(array: any[], pathInformation: any) {
  if (pathInformation.feasible) {
    array.push(pathInformation);
  }
}
