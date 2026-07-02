# Loop And Path Ordering

This spec defines ordering and linking for generated paths.

## Purpose

After paths are generated, order them to reduce non-cutting travel while preserving required machining constraints and safe linking.

## Inputs

```ts
type PathOrderingInput = {
  paths: CamToolpathPath[];
  startPosition: CamPoint3;
  safeHeight: number;
  linkMode: "retract" | "low-hop" | "feed-link";
  allowReverse?: boolean;
  preserveLevelOrder?: boolean;
  protectedRegions?: CamProtectedRegion[];
};
```

## Output

- Ordered paths.
- Optional reversed path flags.
- Linking `CamMotionSegment[]`.
- Ordering summary and warnings.

## Constraints

Hard constraints:

- Preserve CAM history operation order.
- Preserve required Z-level order for waterline strategies.
- Do not reorder a path before its prerequisite containment path if material-removal rules require that order.
- Do not reverse paths when climb/conventional selection forbids it.

Soft objective:

- Minimize travel distance plus retract/plunge penalties.

## First-Pass Algorithm

Use deterministic nearest-neighbor:

1. Start from current tool position.
2. Build a candidate list of paths allowed by hard constraints.
3. For each candidate:
   - Compute cost to path start.
   - If reversal allowed, compute cost to path end.
   - Add retract/plunge penalty if link mode requires it.
4. Choose lowest cost; tie-break by original path index.
5. Rotate closed loops so their start point is nearest current position.
6. Reverse open paths if selected.
7. Append path and update current position.
8. Repeat until all paths ordered.

Optional improvement:

- Run a bounded 2-opt pass within one Z level when path count is moderate.
- Abort improvement if time budget is exceeded.

## Linking Algorithm

For each adjacent path pair:

1. Attempt selected link mode.
2. `feed-link`:
   - Check swept cutter volume along direct segment.
   - If safe, emit `link` segment at feed.
   - Otherwise fall back.
3. `low-hop`:
   - Compute local clearance height above protected regions.
   - Emit retract to local height, horizontal rapid/link, plunge.
   - If local clearance uncertain, fall back.
4. `retract`:
   - Retract to full safe height.
   - Rapid XY.
   - Plunge to next path start.

## Protected Region Checks

- Use mesh/cross-section protected regions from the generating strategy.
- If region data is missing or stale, use full retract.
- Never assume a direct down-position link is safe without checking.

## Tests

- Nearest-neighbor ordering reduces travel on a simple three-path fixture.
- Tie breaks by original order.
- Closed loop start rotates to nearest point.
- Open path reverses only when allowed.
- Waterline level order is preserved.
- Unsafe low-hop falls back to full retract.
- Motion segments represent every link.
