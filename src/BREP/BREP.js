
import { Edge, Face, Solid, Vertex } from "./BetterSolid.js";
import { Cube, Pyramid, Sphere, Cylinder, Cone, Torus } from "./primitives.js";
import { Sweep } from "./Sweep.js";
import { Revolve } from "./Revolve.js";
import { Tube } from "./Tube.js";
import { ChamferSolid } from "./chamfer.js";
import { ExtrudeSolid } from "./Extrude.js";
import { applyBooleanOperation } from "./applyBooleanOperation.js";
import { AssemblyComponent } from "./AssemblyComponent.js";
import { buildHelixPolyline } from "./helix.js";
import * as THREE from 'three';

export const BREP = {
    THREE,
    Solid,
    Face,
    Edge,
    Vertex,
    Cube,
    Pyramid,
    Sphere,
    Cylinder,
    Cone,
    Torus,
    Tube,
    Sweep,
    Revolve,
    ExtrudeSolid,
    ChamferSolid,
    applyBooleanOperation,
    AssemblyComponent,
    buildHelixPolyline,

}
