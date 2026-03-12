import { buildWireHarnessNetwork } from './wireHarnessRouting.js';

const FORMBOARD_GROUP_PREFIX = 'wire-harness-formboard:';
const DEFAULT_MARGIN_IN = 2;
const DEFAULT_COMPONENT_GAP_IN = 6;
const DEFAULT_LINE_STROKE = '#111827';
const DEFAULT_LABEL_COLOR = '#0f172a';

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampPositive(value, fallback = 1e-6) {
  return Math.max(1e-6, normalizeNumber(value, fallback));
}

function createId(prefix = 'id') {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function createGraphNode(nodeMap, nodeId, label, portRef, kind) {
  const id = normalizeText(nodeId, '');
  if (!id) return null;
  let node = nodeMap.get(id);
  if (!node) {
    node = {
      id,
      label: normalizeText(label, id),
      portRef: normalizeText(portRef, ''),
      kind: normalizeText(kind, '').toLowerCase() || 'waypoint',
      edges: [],
    };
    nodeMap.set(id, node);
  } else {
    if (!normalizeText(node.label, '')) node.label = normalizeText(label, id);
    if (!normalizeText(node.portRef, '')) node.portRef = normalizeText(portRef, '');
    if (!normalizeText(node.kind, '')) node.kind = normalizeText(kind, 'waypoint').toLowerCase();
  }
  return node;
}

function buildHarnessGraph(network) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  const segments = Array.isArray(network?.splineSegments) ? network.splineSegments : [];

  for (const segment of segments) {
    const edgeId = normalizeText(segment?.id, '');
    const firstId = normalizeText(segment?.firstPoint, '');
    const secondId = normalizeText(segment?.secondPoint, '');
    if (!edgeId || !firstId || !secondId || firstId === secondId) continue;

    const firstPort = network?.portsByRef?.get?.(normalizeText(segment?.firstPortRef, '')) || null;
    const secondPort = network?.portsByRef?.get?.(normalizeText(segment?.secondPortRef, '')) || null;
    const firstNode = createGraphNode(
      nodeMap,
      firstId,
      segment?.firstLabel || firstPort?.label || firstPort?.name,
      segment?.firstPortRef,
      firstPort?.kind,
    );
    const secondNode = createGraphNode(
      nodeMap,
      secondId,
      segment?.secondLabel || secondPort?.label || secondPort?.name,
      segment?.secondPortRef,
      secondPort?.kind,
    );
    if (!firstNode || !secondNode) continue;

    const edge = {
      id: edgeId,
      a: firstNode.id,
      b: secondNode.id,
      length: clampPositive(segment?.weight, 1),
      featureId: normalizeText(segment?.featureId, edgeId),
    };
    edgeMap.set(edge.id, edge);
    firstNode.edges.push(edge.id);
    secondNode.edges.push(edge.id);
  }

  return { nodes: nodeMap, edges: edgeMap };
}

function getEdgeOther(edge, nodeId) {
  if (!edge) return '';
  return edge.a === nodeId ? edge.b : edge.b === nodeId ? edge.a : '';
}

function listConnectedComponents(graph) {
  const components = [];
  const visited = new Set();
  for (const nodeId of graph.nodes.keys()) {
    if (visited.has(nodeId)) continue;
    const queue = [nodeId];
    const componentNodeIds = [];
    const componentEdgeIds = new Set();
    visited.add(nodeId);
    while (queue.length) {
      const currentId = queue.shift();
      componentNodeIds.push(currentId);
      const node = graph.nodes.get(currentId);
      for (const edgeId of Array.isArray(node?.edges) ? node.edges : []) {
        if (!graph.edges.has(edgeId)) continue;
        componentEdgeIds.add(edgeId);
        const otherId = getEdgeOther(graph.edges.get(edgeId), currentId);
        if (!otherId || visited.has(otherId)) continue;
        visited.add(otherId);
        queue.push(otherId);
      }
    }
    components.push({
      nodeIds: componentNodeIds,
      edgeIds: Array.from(componentEdgeIds),
    });
  }
  return components;
}

function runComponentDijkstra(graph, component, startId) {
  const nodeIds = Array.isArray(component?.nodeIds) ? component.nodeIds : [];
  const pending = new Set(nodeIds);
  const distances = new Map(nodeIds.map((nodeId) => [nodeId, Number.POSITIVE_INFINITY]));
  const previous = new Map();
  const previousEdge = new Map();
  if (!pending.has(startId)) return { distances, previous, previousEdge };
  distances.set(startId, 0);

  while (pending.size) {
    let currentId = '';
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const nodeId of pending) {
      const distance = distances.get(nodeId);
      if (distance < currentDistance) {
        currentId = nodeId;
        currentDistance = distance;
      }
    }
    if (!currentId || !Number.isFinite(currentDistance)) break;
    pending.delete(currentId);

    const node = graph.nodes.get(currentId);
    for (const edgeId of Array.isArray(node?.edges) ? node.edges : []) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      const otherId = getEdgeOther(edge, currentId);
      if (!otherId || !pending.has(otherId)) continue;
      const candidate = currentDistance + clampPositive(edge.length, 1);
      if (candidate + 1e-9 < normalizeNumber(distances.get(otherId), Number.POSITIVE_INFINITY)) {
        distances.set(otherId, candidate);
        previous.set(otherId, currentId);
        previousEdge.set(otherId, edgeId);
      }
    }
  }

  return { distances, previous, previousEdge };
}

function resolveFarthestNode(component, distances, graph) {
  const preferred = (Array.isArray(component?.nodeIds) ? component.nodeIds : [])
    .filter((nodeId) => (graph.nodes.get(nodeId)?.edges || []).length <= 1);
  const candidates = preferred.length ? preferred : (Array.isArray(component?.nodeIds) ? component.nodeIds : []);
  let bestId = candidates[0] || '';
  let bestDistance = -1;
  for (const nodeId of candidates) {
    const distance = normalizeNumber(distances.get(nodeId), Number.NEGATIVE_INFINITY);
    if (distance > bestDistance) {
      bestDistance = distance;
      bestId = nodeId;
    }
  }
  return { nodeId: bestId, distance: bestDistance };
}

function tracePath(endId, previous) {
  const path = [];
  let currentId = normalizeText(endId, '');
  while (currentId) {
    path.push(currentId);
    currentId = normalizeText(previous.get(currentId), '');
  }
  return path.reverse();
}

function buildRootedComponentTree(graph, component) {
  const startId = Array.isArray(component?.nodeIds) ? component.nodeIds[0] : '';
  if (!startId) {
    return {
      rootId: '',
      trunkNodeIds: [],
      childrenByNode: new Map(),
      parentByNode: new Map(),
      parentEdgeByNode: new Map(),
      warnings: [],
    };
  }

  const initial = runComponentDijkstra(graph, component, startId);
  const farA = resolveFarthestNode(component, initial.distances, graph).nodeId || startId;
  const fromA = runComponentDijkstra(graph, component, farA);
  const farB = resolveFarthestNode(component, fromA.distances, graph).nodeId || farA;
  const trunkNodeIds = tracePath(farB, fromA.previous);
  const rootId = trunkNodeIds[0] || farA;
  const rooted = runComponentDijkstra(graph, component, rootId);
  const childrenByNode = new Map();
  const parentByNode = new Map();
  const parentEdgeByNode = new Map();

  for (const nodeId of Array.isArray(component?.nodeIds) ? component.nodeIds : []) {
    childrenByNode.set(nodeId, []);
  }

  for (const [nodeId, parentId] of rooted.previous.entries()) {
    if (!childrenByNode.has(parentId)) childrenByNode.set(parentId, []);
    childrenByNode.get(parentId).push(nodeId);
    parentByNode.set(nodeId, parentId);
  }
  for (const [nodeId, edgeId] of rooted.previousEdge.entries()) {
    parentEdgeByNode.set(nodeId, edgeId);
  }

  const warnings = [];
  const treeEdgeCount = parentEdgeByNode.size;
  const componentEdgeCount = Array.isArray(component?.edgeIds) ? component.edgeIds.length : 0;
  if (componentEdgeCount > treeEdgeCount) {
    warnings.push('Harness network contains one or more loops. Formboard output uses a tree projection and omits loop-closing segments.');
  }

  return {
    rootId,
    trunkNodeIds,
    childrenByNode,
    parentByNode,
    parentEdgeByNode,
    warnings,
  };
}

function computeLongestDescendantDistances(graph, tree, nodeId, cache) {
  if (cache.has(nodeId)) return cache.get(nodeId);
  const children = tree.childrenByNode.get(nodeId) || [];
  let best = 0;
  for (const childId of children) {
    const edgeId = tree.parentEdgeByNode.get(childId);
    const edge = graph.edges.get(edgeId);
    const length = clampPositive(edge?.length, 1);
    best = Math.max(best, length + computeLongestDescendantDistances(graph, tree, childId, cache));
  }
  cache.set(nodeId, best);
  return best;
}

function buildBranchAngleList(count, preferredSide = 1) {
  const direction = preferredSide >= 0 ? 1 : -1;
  const preferred = [75, 115, 45, 145, 25];
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const magnitude = preferred[Math.floor(index / 2)] || Math.min(165, 25 + (Math.floor(index / 2) * 20));
    const sign = index % 2 === 0 ? direction : -direction;
    out.push(sign * magnitude);
  }
  return out;
}

function layoutComponent(graph, component, tree) {
  const positions = new Map();
  const edgeLayout = [];
  const longestCache = new Map();
  const rootId = normalizeText(tree?.rootId, '');
  if (!rootId) {
    return {
      positions,
      segments: edgeLayout,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  const root = graph.nodes.get(rootId);
  positions.set(rootId, { x: 0, y: 0, node: root });
  computeLongestDescendantDistances(graph, tree, rootId, longestCache);

  const visit = (nodeId, angleDeg = 0, preferredSide = 1) => {
    const current = positions.get(nodeId);
    if (!current) return;
    const children = (tree.childrenByNode.get(nodeId) || []).slice();
    if (!children.length) return;

    children.sort((a, b) => {
      const aEdge = graph.edges.get(tree.parentEdgeByNode.get(a));
      const bEdge = graph.edges.get(tree.parentEdgeByNode.get(b));
      const aDistance = clampPositive(aEdge?.length, 1) + normalizeNumber(longestCache.get(a), 0);
      const bDistance = clampPositive(bEdge?.length, 1) + normalizeNumber(longestCache.get(b), 0);
      return bDistance - aDistance;
    });

    const primaryChildId = children.shift() || '';
    if (primaryChildId) {
      const edgeId = tree.parentEdgeByNode.get(primaryChildId);
      const edge = graph.edges.get(edgeId);
      const length = clampPositive(edge?.length, 1);
      const angleRad = (angleDeg * Math.PI) / 180;
      const nextX = current.x + (Math.cos(angleRad) * length);
      const nextY = current.y + (Math.sin(angleRad) * length);
      positions.set(primaryChildId, { x: nextX, y: nextY, node: graph.nodes.get(primaryChildId) });
      edgeLayout.push({ edgeId, fromId: nodeId, toId: primaryChildId });
      visit(primaryChildId, angleDeg, preferredSide);
    }

    const branchAngles = buildBranchAngleList(children.length, preferredSide);
    for (let index = 0; index < children.length; index += 1) {
      const childId = children[index];
      const edgeId = tree.parentEdgeByNode.get(childId);
      const edge = graph.edges.get(edgeId);
      const length = clampPositive(edge?.length, 1);
      const nextAngle = angleDeg + normalizeNumber(branchAngles[index], 0);
      const angleRad = (nextAngle * Math.PI) / 180;
      const nextX = current.x + (Math.cos(angleRad) * length);
      const nextY = current.y + (Math.sin(angleRad) * length);
      positions.set(childId, { x: nextX, y: nextY, node: graph.nodes.get(childId) });
      edgeLayout.push({ edgeId, fromId: nodeId, toId: childId });
      visit(childId, nextAngle, branchAngles[index] >= 0 ? 1 : -1);
    }
  };

  visit(rootId, 0, 1);

  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const entry of positions.values()) {
    bounds.minX = Math.min(bounds.minX, normalizeNumber(entry?.x, 0));
    bounds.minY = Math.min(bounds.minY, normalizeNumber(entry?.y, 0));
    bounds.maxX = Math.max(bounds.maxX, normalizeNumber(entry?.x, 0));
    bounds.maxY = Math.max(bounds.maxY, normalizeNumber(entry?.y, 0));
  }
  if (!Number.isFinite(bounds.minX)) {
    bounds.minX = 0;
    bounds.minY = 0;
    bounds.maxX = 0;
    bounds.maxY = 0;
  }

  return {
    positions,
    segments: edgeLayout,
    bounds,
  };
}

function estimateTextBoxWidthIn(text, minimum = 1.2) {
  return Math.max(minimum, normalizeText(text, '').length * 0.12);
}

function formatLength(value) {
  const rounded = Math.round(clampPositive(value, 0) * 100) / 100;
  return String(rounded).replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

export function buildWireHarnessFormboardDefinition(partHistory, options = {}) {
  const marginIn = Math.max(0.5, normalizeNumber(options.marginIn, DEFAULT_MARGIN_IN));
  const componentGapIn = Math.max(1, normalizeNumber(options.componentGapIn, DEFAULT_COMPONENT_GAP_IN));
  const labelFontSizeIn = Math.max(0.12, normalizeNumber(options.labelFontSizeIn, 0.22));
  const segmentStrokeWidthIn = Math.max(0.01, normalizeNumber(options.strokeWidthIn, 0.04));
  const includeTitle = options.includeTitle !== false;

  const network = buildWireHarnessNetwork(partHistory);
  const graph = buildHarnessGraph(network);
  const components = listConnectedComponents(graph)
    .filter((component) => Array.isArray(component?.edgeIds) && component.edgeIds.length > 0);
  if (!components.length) {
    return {
      ok: false,
      error: 'No harness spline network is available to flatten.',
      elements: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      suggestedSheet: { widthIn: 1, heightIn: 1 },
      warnings: [],
    };
  }

  const groupId = `${FORMBOARD_GROUP_PREFIX}${createId('grp')}`;
  const elements = [];
  const warnings = [];
  const overallBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  let yOffset = 0;
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const component = components[componentIndex];
    const componentGroupId = `${groupId}:cmp:${componentIndex + 1}`;
    const tree = buildRootedComponentTree(graph, component);
    warnings.push(...tree.warnings);
    const layout = layoutComponent(graph, component, tree);
    const componentWidth = layout.bounds.maxX - layout.bounds.minX;
    const componentHeight = layout.bounds.maxY - layout.bounds.minY;
    const shiftX = -layout.bounds.minX;
    const shiftY = yOffset - layout.bounds.minY;

    for (const segment of layout.segments) {
      const from = layout.positions.get(segment.fromId);
      const to = layout.positions.get(segment.toId);
      const edge = graph.edges.get(segment.edgeId);
      if (!from || !to || !edge) continue;
      const segmentElementId = createId('line');
      elements.push({
        id: segmentElementId,
        groupId: componentGroupId,
        type: 'line',
        x: from.x + shiftX,
        y: from.y + shiftY,
        x2: to.x + shiftX,
        y2: to.y + shiftY,
        stroke: DEFAULT_LINE_STROKE,
        strokeWidth: segmentStrokeWidthIn,
        lineStyle: 'solid',
        opacity: 1,
        formboard: {
          kind: 'segment',
          exactGeometry: true,
          edgeId: edge.id,
          featureId: edge.featureId,
          fromNodeId: segment.fromId,
          toNodeId: segment.toId,
          length: edge.length,
        },
      });

      const midX = ((from.x + to.x) * 0.5) + shiftX;
      const midY = ((from.y + to.y) * 0.5) + shiftY;
      const dx = normalizeNumber(to.x, 0) - normalizeNumber(from.x, 0);
      const dy = normalizeNumber(to.y, 0) - normalizeNumber(from.y, 0);
      const normalLen = Math.max(1e-6, Math.sqrt((dx * dx) + (dy * dy)));
      const normalX = (-dy / normalLen) * 0.22;
      const normalY = (dx / normalLen) * 0.22;
      const lengthText = `${formatLength(edge.length)} in`;
      elements.push({
        id: createId('text'),
        groupId: componentGroupId,
        type: 'text',
        x: midX + normalX - (estimateTextBoxWidthIn(lengthText, 1.1) * 0.5),
        y: midY + normalY - 0.14,
        w: estimateTextBoxWidthIn(lengthText, 1.1),
        h: 0.3,
        text: lengthText,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        fontSize: Math.max(0.12, labelFontSizeIn * 0.85),
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: '400',
        fontStyle: 'normal',
        textAlign: 'center',
        verticalAlign: 'middle',
        color: '#475569',
        formboard: {
          kind: 'segmentLabel',
          exactGeometry: true,
          edgeId: edge.id,
          lineElementId: segmentElementId,
          fromNodeId: segment.fromId,
          toNodeId: segment.toId,
        },
      });
    }

    for (const [nodeId, position] of layout.positions.entries()) {
      const node = graph.nodes.get(nodeId);
      const degree = (node?.edges || []).length;
      const isLeaf = degree <= 1;
      const isWaypoint = normalizeText(node?.kind, 'waypoint').toLowerCase() === 'waypoint';
      if (!isLeaf && isWaypoint) continue;
      const label = normalizeText(node?.label, nodeId);
      elements.push({
        id: createId('text'),
        groupId: componentGroupId,
        type: 'text',
        x: (position.x + shiftX) + 0.15,
        y: (position.y + shiftY) - 0.45,
        w: estimateTextBoxWidthIn(label, 1.5),
        h: 0.4,
        text: label,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        fontSize: labelFontSizeIn,
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: isLeaf ? '700' : '400',
        fontStyle: 'normal',
        textAlign: 'left',
        verticalAlign: 'middle',
        color: DEFAULT_LABEL_COLOR,
        formboard: {
          kind: 'nodeLabel',
          exactGeometry: true,
          nodeId,
        },
      });
      overallBounds.minX = Math.min(overallBounds.minX, (position.x + shiftX) - 0.1);
      overallBounds.minY = Math.min(overallBounds.minY, (position.y + shiftY) - 0.6);
      overallBounds.maxX = Math.max(overallBounds.maxX, (position.x + shiftX) + estimateTextBoxWidthIn(label, 1.5));
      overallBounds.maxY = Math.max(overallBounds.maxY, (position.y + shiftY) + 0.25);
    }

    overallBounds.minX = Math.min(overallBounds.minX, shiftX);
    overallBounds.minY = Math.min(overallBounds.minY, shiftY);
    overallBounds.maxX = Math.max(overallBounds.maxX, shiftX + componentWidth);
    overallBounds.maxY = Math.max(overallBounds.maxY, shiftY + componentHeight);
    yOffset += componentHeight + componentGapIn;
  }

  if (includeTitle) {
    const title = `Wire Harness Formboard · ${components.length} section${components.length === 1 ? '' : 's'}`;
    elements.push({
      id: createId('title'),
      groupId,
      type: 'text',
      x: 0,
      y: -0.9,
      w: estimateTextBoxWidthIn(title, 4),
      h: 0.5,
      text: title,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      opacity: 1,
      fontSize: Math.max(0.16, labelFontSizeIn * 1.1),
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'left',
      verticalAlign: 'middle',
      color: DEFAULT_LABEL_COLOR,
      formboard: {
        kind: 'title',
        exactGeometry: true,
      },
    });
    overallBounds.minX = Math.min(overallBounds.minX, 0);
    overallBounds.minY = Math.min(overallBounds.minY, -0.95);
    overallBounds.maxX = Math.max(overallBounds.maxX, estimateTextBoxWidthIn(title, 4));
  }

  const widthIn = Math.max(1, (overallBounds.maxX - overallBounds.minX) + (marginIn * 2));
  const heightIn = Math.max(1, (overallBounds.maxY - overallBounds.minY) + (marginIn * 2));

  return {
    ok: true,
    groupId,
    network,
    graph,
    elements,
    bounds: overallBounds,
    suggestedSheet: {
      widthIn,
      heightIn,
    },
    warnings: Array.from(new Set(warnings)),
  };
}

function translateElement(element, dx, dy) {
  const next = { ...(element || {}) };
  next.x = normalizeNumber(next.x, 0) + dx;
  next.y = normalizeNumber(next.y, 0) + dy;
  if (next.type === 'line') {
    next.x2 = normalizeNumber(next.x2, next.x) + dx;
    next.y2 = normalizeNumber(next.y2, next.y) + dy;
  }
  return next;
}

export function insertWireHarnessFormboard(sheetManager, sheetIdOrIndex, partHistory, options = {}) {
  if (!sheetManager?.getSheetById || !sheetManager?.updateSheet) return null;
  const sheet = sheetManager.getSheetById(sheetIdOrIndex);
  if (!sheet) return null;

  const definition = buildWireHarnessFormboardDefinition(partHistory, options);
  if (!definition?.ok) return {
    ...definition,
    sheet,
    insertedElements: [],
  };

  const resizeSheetToFit = options.resizeSheetToFit !== false;
  const currentWidth = Math.max(1, normalizeNumber(sheet?.widthIn, 11));
  const currentHeight = Math.max(1, normalizeNumber(sheet?.heightIn, 8.5));
  const requiredWidth = Math.max(1, normalizeNumber(definition?.suggestedSheet?.widthIn, currentWidth));
  const requiredHeight = Math.max(1, normalizeNumber(definition?.suggestedSheet?.heightIn, currentHeight));
  const shouldResizeSheet = resizeSheetToFit
    && (
      requiredWidth > currentWidth + 1e-6
      || requiredHeight > currentHeight + 1e-6
      || String(sheet?.sizeKey || '') === 'CUSTOM'
    );
  const nextWidth = resizeSheetToFit
    ? Math.max(currentWidth, requiredWidth)
    : currentWidth;
  const nextHeight = resizeSheetToFit
    ? Math.max(currentHeight, requiredHeight)
    : currentHeight;
  const offsetX = ((nextWidth - normalizeNumber(definition?.suggestedSheet?.widthIn, nextWidth)) * 0.5)
    + normalizeNumber(options.marginIn, DEFAULT_MARGIN_IN)
    - normalizeNumber(definition?.bounds?.minX, 0);
  const offsetY = ((nextHeight - normalizeNumber(definition?.suggestedSheet?.heightIn, nextHeight)) * 0.5)
    + normalizeNumber(options.marginIn, DEFAULT_MARGIN_IN)
    - normalizeNumber(definition?.bounds?.minY, 0);
  const translatedElements = definition.elements.map((element) => translateElement(element, offsetX, offsetY));

  const updatedSheet = sheetManager.updateSheet(sheet.id, (draft) => {
    const next = draft && typeof draft === 'object' ? draft : {};
    next.elements = (Array.isArray(next.elements) ? next.elements : [])
      .filter((element) => !String(element?.groupId || '').startsWith(FORMBOARD_GROUP_PREFIX));
    next.elements.push(...translatedElements);
    if (shouldResizeSheet) {
      next.sizeKey = 'CUSTOM';
      next.orientation = nextWidth >= nextHeight ? 'landscape' : 'portrait';
      next.customWidthIn = nextWidth;
      next.customHeightIn = nextHeight;
    }
    return next;
  });

  return {
    ...definition,
    sheet: updatedSheet || sheet,
    insertedElements: translatedElements,
  };
}

export function isWireHarnessFormboardGroup(groupId) {
  return normalizeText(groupId, '').startsWith(FORMBOARD_GROUP_PREFIX);
}

export function isWireHarnessFormboardElement(element) {
  return !!(element?.formboard && typeof element.formboard === 'object' && element.formboard.exactGeometry === true);
}

export function buildWireHarnessFormboardModel(elements = []) {
  const groupElements = Array.isArray(elements) ? elements.filter(Boolean) : [];
  const lines = groupElements.filter((element) => element?.type === 'line' && isWireHarnessFormboardElement(element));
  if (!lines.length) return null;

  const nodes = new Map();
  const childrenByNode = new Map();
  const parentByNode = new Map();
  const degreeByNode = new Map();
  const segmentsByNode = new Map();
  const segmentById = new Map();
  const segments = [];

  const ensureNode = (nodeId, x = 0, y = 0) => {
    const id = normalizeText(nodeId, '');
    if (!id) return null;
    let node = nodes.get(id);
    if (!node) {
      node = { id, x: normalizeNumber(x, 0), y: normalizeNumber(y, 0) };
      nodes.set(id, node);
    } else {
      node.x = normalizeNumber(x, node.x);
      node.y = normalizeNumber(y, node.y);
    }
    if (!childrenByNode.has(id)) childrenByNode.set(id, []);
    if (!degreeByNode.has(id)) degreeByNode.set(id, 0);
    if (!segmentsByNode.has(id)) segmentsByNode.set(id, []);
    return node;
  };

  for (const line of lines) {
    const meta = line.formboard || {};
    const fromNodeId = normalizeText(meta.fromNodeId, '');
    const toNodeId = normalizeText(meta.toNodeId, '');
    if (!fromNodeId || !toNodeId) continue;
    ensureNode(fromNodeId, line.x, line.y);
    ensureNode(toNodeId, line.x2, line.y2);
    childrenByNode.get(fromNodeId).push(toNodeId);
    parentByNode.set(toNodeId, fromNodeId);
    degreeByNode.set(fromNodeId, normalizeNumber(degreeByNode.get(fromNodeId), 0) + 1);
    degreeByNode.set(toNodeId, normalizeNumber(degreeByNode.get(toNodeId), 0) + 1);
    const segmentRecord = {
      id: String(line.id || ''),
      edgeId: normalizeText(meta.edgeId, ''),
      fromNodeId,
      toNodeId,
      length: normalizeNumber(meta.length, Math.hypot(
        normalizeNumber(line.x2, line.x) - normalizeNumber(line.x, 0),
        normalizeNumber(line.y2, line.y) - normalizeNumber(line.y, 0),
      )),
    };
    segments.push(segmentRecord);
    segmentById.set(segmentRecord.id, segmentRecord);
    segmentsByNode.get(fromNodeId).push(segmentRecord);
    segmentsByNode.get(toNodeId).push(segmentRecord);
  }

  return {
    nodes,
    childrenByNode,
    parentByNode,
    degreeByNode,
    segmentsByNode,
    segmentById,
    segments,
  };
}

export function collectWireHarnessFormboardDescendantNodeIds(model, rootNodeId) {
  const startId = normalizeText(rootNodeId, '');
  if (!model || !startId || !model.nodes?.has?.(startId)) return new Set();
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const children = model.childrenByNode?.get?.(nodeId) || [];
    for (const childId of children) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }
  return visited;
}

export function collectWireHarnessFormboardSegmentBranchNodeIds(model, pivotNodeId, segmentId) {
  const pivotId = normalizeText(pivotNodeId, '');
  const targetSegmentId = normalizeText(segmentId, '');
  const segment = model?.segmentById?.get?.(targetSegmentId) || null;
  if (!pivotId || !segment) return new Set();
  const otherNodeId = segment.fromNodeId === pivotId
    ? segment.toNodeId
    : (segment.toNodeId === pivotId ? segment.fromNodeId : '');
  if (!otherNodeId) return new Set();

  const visited = new Set();
  const queue = [otherNodeId];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const adjacent = model?.segmentsByNode?.get?.(nodeId) || [];
    for (const adjacentSegment of adjacent) {
      if (!adjacentSegment) continue;
      const nextNodeId = adjacentSegment.fromNodeId === nodeId
        ? adjacentSegment.toNodeId
        : adjacentSegment.fromNodeId;
      if (!nextNodeId || nextNodeId === pivotId || visited.has(nextNodeId)) continue;
      queue.push(nextNodeId);
    }
  }
  return visited;
}
