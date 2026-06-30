export class GraphNode {
  id: string;
  weights: number[];
  neighbourIds: string[];
  edgeIds: string[];
  numberOfEdges: number;

  constructor(id: string) {
    if (id == null) {
      throw "Null id";
    }
    this.id = id;
    this.weights = [];
    this.neighbourIds = [];
    this.edgeIds = [];
    // Note: edgeIds is an optional additional information about edges, not important for processing
    this.numberOfEdges = 0;
  }

  addEdge(weight: number, otherNodeId: string, edgeId: string | null = null) {
    this.weights.push(weight);
    this.neighbourIds.push(otherNodeId);
    this.edgeIds.push(edgeId ?? this.id + "->" + otherNodeId);
    this.numberOfEdges++;
  }

  getWeight(k: number) {
    return this.weights[k];
  }

  getNeighbourId(k: number) {
    return this.neighbourIds[k];
  }

  getEdgeId(k: number) {
    return this.edgeIds[k];
  }
}

export class Digraph {
  nodeMap: Map<string, GraphNode>;

  constructor() {
    this.nodeMap = new Map();
  }

  addNode(node: GraphNode) {
    const id = node.id;
    if (id == null) {
      throw "Null id in " + node + ": probably it is not a graph node";
    }
    this.nodeMap.set(id, node);
  }

  addNodes(nodes: Iterable<GraphNode>) {
    for (const node of nodes) {
      this.addNode(node);
    }
  }

  getNode(id: string) {
    return this.nodeMap.get(id);
  }

  getAllNodeIds() {
    return this.nodeMap.keys();
  }

  getNumberOfNodes() {
    return this.nodeMap.size;
  }

  toJson(limitOfNodes?: number) {
    const json: Record<string, any> = {};
    let count = 0;
    for (const [id, node] of this.nodeMap) {
      const nodeJson: Record<string, number> = {};
      for (let k = 0; k < node.numberOfEdges; k++) {
        nodeJson[node.getNeighbourId(k)] = node.getWeight(k)
      }
      json[id] = nodeJson;
      ++count;
      if (limitOfNodes && count > limitOfNodes) {
        json["other_nodes"] = "cannot be shown (more than " + limitOfNodes + " nodes)";
        break;
      }
    }
    return json;
  }

  toJsonString(limitOfNodes?: number, space?: number) {
    return JSON.stringify(this.toJson(limitOfNodes), null, space);
  }
}
