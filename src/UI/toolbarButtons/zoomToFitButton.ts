export function createZoomToFitButton(viewer) {
  const onClick = () => {
    try {
      viewer?.zoomToFit?.();
    } catch {
      // best effort
    }
  };
  return { label: '⛶', title: 'Frame all geometry', onClick };
}
