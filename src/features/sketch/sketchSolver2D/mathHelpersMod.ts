export function distance(point1, point2) {
  return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
}

export function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = angleInDegrees * Math.PI / 180.0;
  return {
    x: centerX + (radius * Math.cos(angleInRadians)),
    y: centerY + (radius * Math.sin(angleInRadians))
  };
}

export function calculateAngle(point1, point2) {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return (angle + 360) % 360;
}

export function rotatePoint(center, point, angleDeg) {
  const angleRad = (angleDeg % 360) * (Math.PI / 180);
  const { x: x1, y: y1 } = center;
  const { x: x2, y: y2 } = point;
  const xRotated = (x2 - x1) * Math.cos(angleRad) - (y2 - y1) * Math.sin(angleRad) + x1;
  const yRotated = (x2 - x1) * Math.sin(angleRad) + (y2 - y1) * Math.cos(angleRad) + y1;
  point.x = xRotated;
  point.y = yRotated;
  return { x: xRotated, y: yRotated };
}

export function roundToDecimals(number, decimals) {
  return Math.round(number * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
