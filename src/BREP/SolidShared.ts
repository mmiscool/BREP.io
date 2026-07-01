import { Manifold, ManifoldMesh } from "./setupManifold.js";

import * as THREE from "three";
import { CADmaterials } from "../UI/CADmaterials.js";
import { LineGeometry } from "three/examples/jsm/Addons.js";

import { Edge } from "./Edge.js";
import { Vertex } from "./Vertex.js";
import { Face } from "./Face.js";

// Use named exports from setupManifold.js

const debugMode = false;

export { Edge, Vertex, Face };

export {
    Manifold,
    ManifoldMesh,
    THREE,
    CADmaterials,
    LineGeometry,
    debugMode,
};
