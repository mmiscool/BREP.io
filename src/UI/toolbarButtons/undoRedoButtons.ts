export function createUndoButton(viewer) {
  const onClick = () => {
    try {
      if (typeof viewer?._runFeatureHistoryUndoRedo === 'function') {
        viewer._runFeatureHistoryUndoRedo('undo');
      } else {
        viewer?.partHistory?.undoFeatureHistory?.();
      }
    } catch {
      // best effort
    }
  };
  return { label: '↶', title: 'Undo feature history (Ctrl+Z)', onClick };
}

export function createRedoButton(viewer) {
  const onClick = () => {
    try {
      if (typeof viewer?._runFeatureHistoryUndoRedo === 'function') {
        viewer._runFeatureHistoryUndoRedo('redo');
      } else {
        viewer?.partHistory?.redoFeatureHistory?.();
      }
    } catch {
      // best effort
    }
  };
  return { label: '↷', title: 'Redo feature history (Ctrl+Y)', onClick };
}
