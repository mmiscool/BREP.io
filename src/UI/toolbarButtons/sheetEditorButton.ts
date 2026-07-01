export function createSheetEditorButton(viewer) {
  function onClick() {
    try {
      viewer?.openSheet2DEditor?.();
    } catch {
      // best effort
    }
  }
  return {
    label: "🧾",
    title: "Open 2D sheet editor",
    onClick,
  };
}
