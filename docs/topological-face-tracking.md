# Topological Face and Edge Naming Specification

This document is a language-agnostic specification for topological face and edge naming.

It is intended to define the observable behavior of the kernel, not the internal implementation strategy of any one codebase.

## 1. Scope

This specification defines:

- what a face name means
- what an edge name means
- how triangles relate to faces
- how edges are derived from adjacent faces
- what naming stability is expected across topology-changing operations

This specification does not require a particular storage layout, data structure, or programming language.

## 2. Normative language

The key words `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are to be interpreted as requirements of the specification.

## 3. Definitions

### 3.1 Face

A `Face` is a logical surface region of the solid model.

A face is not an individual triangle. A face is the semantic surface entity that downstream operations select, reference, and preserve.

Examples:

- a planar cap
- a cylindrical side wall
- a conical side wall
- a trimmed patch that still represents one logical side of a feature

### 3.2 Face name

A `Face name` is the persistent identifier of a face.

A face name identifies the logical surface region, not the tessellation used to represent it.

### 3.3 Triangle

A `Triangle` is a tessellation element used to represent geometry.

Triangles are geometric carriers only. They do not define topology by themselves.

### 3.4 Triangle ownership

`Triangle ownership` is the mapping from each triangle to exactly one face.

### 3.5 Edge

An `Edge` is the topological boundary between exactly two different faces.

An edge is not any arbitrary mesh edge. Mesh edges that lie entirely inside one face are not topological edges.

### 3.6 Boundary component

A `Boundary component` is one connected chain or loop belonging to the boundary between the same two faces.

If two faces meet in multiple disconnected places, each connected place is a distinct boundary component.

## 4. Face rules

### 4.1 Face identity

An implementation MUST treat a face as a logical surface region.

An implementation MUST NOT define a face purely as:

- a single triangle
- a temporary tessellation patch
- a planar-only grouping

Curved surfaces MAY be represented by many triangles and still be one face.

### 4.2 Triangle-to-face ownership

Every triangle MUST belong to exactly one face.

No triangle may belong to zero faces.

No triangle may belong to more than one face.

If a logical boundary passes through a tessellated region, the tessellation MUST be cut so that triangles on opposite sides of that boundary belong to different faces.

### 4.3 Face grouping

Multiple triangles MUST share the same face name when they represent the same logical surface region.

Multiple triangles MUST NOT share the same face name when they represent different logical surface regions.

### 4.4 Face stability

A face SHOULD preserve its face name across operations if it still represents the same logical surface region after the operation.

Examples:

- trimming a face without changing its identity SHOULD preserve its name
- retessellating a face SHOULD preserve its name
- subdividing a face into more triangles SHOULD preserve its name

If an operation creates a genuinely new logical surface region, that new region MUST receive a new face name.

If an operation destroys a logical face entirely, its face name MUST cease to identify any surviving region.

## 5. Edge rules

### 5.1 What counts as an edge

An edge exists exactly where two adjacent triangles belong to different faces.

If two adjacent triangles belong to the same face, their shared mesh edge MUST NOT be exposed as a topological edge.

### 5.2 Edge ownership

An edge is identified by the pair of faces that meet at that boundary.

An edge MUST therefore be derived from:

- face A
- face B
- one connected boundary component between those two faces

An edge is not owned by face A alone or by face B alone.

### 5.3 Canonical face-pair ordering

The two face names used in an edge name MUST be placed in canonical order.

The ordering rule MUST be deterministic and MUST be independent of traversal direction.

For this specification, canonical order is lexical ascending order of the two face names.

If the two adjacent faces are `FaceA` and `FaceB`, and `FaceA < FaceB` lexically, then the canonical pair is:

- `FaceA`
- `FaceB`

If `FaceB < FaceA`, then the canonical pair is:

- `FaceB`
- `FaceA`

## 6. Edge naming format

### 6.1 Canonical syntax

The canonical edge name format is:

`<FaceLow>|<FaceHigh>[<Index>]`

Where:

- `<FaceLow>` is the lexically smaller face name
- `<FaceHigh>` is the lexically larger face name
- `<Index>` is a non-negative integer

### 6.2 Index assignment

For a given face pair, each connected boundary component MUST receive a distinct index.

Indexing rules:

- indices MUST start at `0`
- indices MUST be unique within a face pair
- if exactly one boundary component exists for a face pair, its index MUST still be `0`

Examples:

- `Top|Wall[0]`
- `Bottom|Wall[0]`
- `Outer|Inner[0]`
- `FaceA|FaceB[0]`
- `FaceA|FaceB[1]`

### 6.3 Multiple boundaries between the same face pair

If the same two faces meet in multiple disconnected places, each disconnected boundary component MUST be named with the same canonical face pair and a different index.

Example:

- `FaceA|FaceB[0]`
- `FaceA|FaceB[1]`
- `FaceA|FaceB[2]`

### 6.4 Stability expectations for edge indices

Edge indices SHOULD remain stable when the same connected boundary component still exists after an operation.

If topology changes make a previous edge split, merge, appear, or disappear, reindexing within that face pair MAY occur.

This means:

- the face pair portion of the edge name is the primary identity
- the index distinguishes multiple components within that pair

## 7. Relationship between topology and tessellation

This specification requires topology to drive tessellation semantics, not the reverse.

Therefore:

- triangles MAY change during remeshing, smoothing, subdivision, or reconstruction
- face names SHOULD remain stable if the logical face remains the same
- edge names SHOULD remain stable if the same face pair and same boundary component remain the same
- incidental triangulation edges MUST NOT become topological edges

The kernel MUST behave as though faces and edges are first-class topological entities, even when geometry is stored or processed as triangles.

## 8. Operational behavior

### 8.1 Boolean operations

After a boolean operation:

- surviving logical faces SHOULD preserve their original face names
- newly created logical faces MUST receive new face names
- edges MUST be recomputed from adjacency between the resulting faces
- edge names MUST follow the canonical face-pair-plus-index rule

### 8.2 Remeshing and subdivision

After remeshing, subdivision, or similar tessellation-only changes:

- face names MUST continue to identify the same logical faces
- all replacement triangles for a face MUST inherit that face's name
- edges MUST still be derived only from boundaries between differently named faces

### 8.3 Trimming and splitting

If a face is trimmed but remains one logical face, it SHOULD keep its face name.

If a face is split into multiple logically distinct surface regions, those resulting regions MUST NOT all keep the same face name unless the system explicitly defines them as one face for feature semantics.

## 9. Required invariants

Any conforming implementation MUST preserve these invariants:

- every triangle has exactly one owning face
- every topological edge lies between exactly two different faces
- no internal triangulation edge inside one face is exposed as a topological edge
- every edge name is derived from its two adjacent face names
- the adjacent face names in an edge name are in canonical order
- every disconnected boundary component for the same face pair has a unique non-negative index

## 10. Failure conditions this specification is intended to prevent

A non-conforming implementation will usually exhibit one or more of these failures:

- one logical face is fragmented into unrelated names
- unrelated faces are merged under one name
- internal tessellation edges are exposed as topological edges
- the same face pair produces ambiguous or duplicate edge names
- selections and references do not survive topology-preserving rebuilds
- metadata attaches to mesh artifacts instead of to logical faces and edges

These failures are exactly what this specification is intended to avoid.
