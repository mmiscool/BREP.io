export function createHomeButton(viewer) {
  const onClick = async () => {
    try {
      const guard = viewer?.fileManagerWidget?.confirmNavigateHome;
      if (typeof guard === 'function') {
        const proceed = await guard.call(viewer.fileManagerWidget);
        if (!proceed) return;
      }
      window.location.href = 'index.html';
    } catch { /* ignore */ }
  };
  return { label: 'Home', title: 'Back to workspace', onClick };
}
