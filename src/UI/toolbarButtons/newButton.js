export function createNewButton(viewer) {
  async function onClick() {
    try {
      if (viewer?.fileManagerWidget?.newModel) {
        await viewer.fileManagerWidget.newModel();
        return;
      }
    } catch { }

    try {
      if (!viewer?.partHistory) return;
      const proceed = await confirm('Clear current model and start a new one?');
      if (!proceed) return;
      await viewer.partHistory.reset?.();
      try { viewer.partHistory.currentHistoryStepId = null; } catch { }
      await viewer.partHistory.runHistory?.();
    } catch { }
  }

  return { label: '📄', title: 'New model', onClick };
}
