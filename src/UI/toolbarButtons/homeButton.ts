export async function navigateHomeWithGuard(viewer) {
  try {
    const guard = viewer?.fileManagerWidget?.confirmNavigateHome;
    if (typeof guard === 'function') {
      const proceed = await guard.call(viewer.fileManagerWidget);
      if (!proceed) return false;
    }
    window.location.href = 'index.html';
    return true;
  } catch {
    return false;
  }
}

export function createHomeButton(viewer) {
  const onClick = async () => {
    await navigateHomeWithGuard(viewer);
  };
  return { label: '🏠', title: 'Back to workspace', onClick };
}
