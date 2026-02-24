export function createZoomToFitButton(viewer) {
  const onClick = () => { try { viewer?.zoomToFit?.(); } catch {} };
  return { label: '⛶', title: 'Frame all geometry', onClick };
}
