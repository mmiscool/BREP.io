export function createSheetEditorButton(viewer) {
  function onClick() {
    try { viewer?.openSheet2DEditor?.(); } catch { }
  }
  return {
    label: "🧾",
    title: "Open 2D sheet editor",
    onClick,
  };
}
