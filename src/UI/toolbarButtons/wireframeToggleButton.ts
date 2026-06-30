export function createWireframeToggleButton(viewer) {
  const onClick = () => {
    try {
      viewer?.toggleWireframe?.();
    } catch {
      // best effort
    }
  };
  return { label: '🕸️', title: 'Toggle wireframe', onClick };
}
