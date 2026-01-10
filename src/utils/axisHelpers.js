import { BREP } from "../BREP/BREP.js";
import { Line2, LineGeometry, LineMaterial } from "three/examples/jsm/Addons.js";

const THREE = BREP.THREE;

export const DEFAULT_AXIS_HELPER_PX = 70;

const DEFAULT_AXIS_COLORS = {
  x: 0xff4d4d,
  y: 0x4dff4d,
  z: 0x4d7dff,
};

function buildAxisLine({
  axis,
  dir,
  color,
  name,
  selectable,
  lineWidth,
  depthTest,
  opacity,
  renderOrder,
}) {
  const geom = new LineGeometry();
  geom.setPositions([0, 0, 0, dir[0], dir[1], dir[2]]);
  const mat = new LineMaterial({
    color,
    linewidth: lineWidth,
    transparent: true,
    opacity,
    dashed: false,
    worldUnits: false,
    depthTest,
    depthWrite: false,
  });

  let line = null;
  if (selectable) {
    line = new BREP.Edge(geom);
    line.material = mat;
  } else {
    line = new Line2(geom, mat);
    line.type = "AXIS_HELPER";
  }

  line.name = `${name}:${axis}`;
  line.renderOrder = renderOrder;
  line.userData = line.userData || {};
  line.userData.axisHelperAxis = axis;
  line.userData.__baseMaterial = mat;
  line.userData.__defaultMaterial = mat;
  line.userData.polylineLocal = [
    [0, 0, 0],
    [dir[0], dir[1], dir[2]],
  ];
  line.userData.polylineWorld = false;
  return line;
}

export function createAxisHelperGroup(options = {}) {
  const {
    name = "AxisHelper",
    selectable = false,
    axisHelperPx = DEFAULT_AXIS_HELPER_PX,
    lineWidth = 2,
    depthTest = false,
    opacity = 1,
    renderOrder = 1000,
    colors = DEFAULT_AXIS_COLORS,
  } = options;

  const group = new THREE.Group();
  group.name = name;
  group.userData = group.userData || {};
  group.userData.axisHelper = true;
  group.userData.axisHelperPx = Number.isFinite(axisHelperPx)
    ? axisHelperPx
    : DEFAULT_AXIS_HELPER_PX;
  group.userData.axisHelperCompensateScale = true;
  group.userData.excludeFromFit = true;

  const base = {
    name,
    selectable,
    lineWidth,
    depthTest,
    opacity,
    renderOrder,
  };

  group.add(
    buildAxisLine({ axis: "X", dir: [1, 0, 0], color: colors.x, ...base }),
    buildAxisLine({ axis: "Y", dir: [0, 1, 0], color: colors.y, ...base }),
    buildAxisLine({ axis: "Z", dir: [0, 0, 1], color: colors.z, ...base }),
  );

  return group;
}
